// scout — wallet intelligence and copy trading. Three phases:
//   1. identify: collect every trade in the pools she watches (GeckoTerminal), turn wallets into profiles
//      (timing, forward and excess returns, consistency, clusters, specialization), score and tier them.
//   2. copy: watch the radar wallets live (Alchemy transfers), score each buy as a signal, and copy the
//      good ones through hands, sized by the signal, inside the same limits and conscience as every trade.
//   3. control: once in, the position follows its copy plan (hands' exits): out when the copied wallet
//      sells, when liquidity is pulled, when the thesis breaks, on a profit ladder, or on a time stop.
// Labels say "insider-like": behavior that moves before attention, never a claim of non-public information.
import { join } from 'node:path'
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { WBNB } from '../lib/market'
import { cycleSize } from '../lib/strategy'
import { COPY_THRESHOLD, COPY_TIERS, copySize, scoreSignal, type CopyMeta } from '../lib/wallets/copy'
import { buildGraph } from '../lib/wallets/graph'
import { benchmark, buildPositions, med, walletMetrics, type CandleLookup } from '../lib/wallets/metrics'
import { DEFAULT_WEIGHTS, learnWeights, scoreWallets, TIER_NAMES, type Component, type Profile, type Tier } from '../lib/wallets/score'
import { parseCandles, parsePools, parseTrades, Warehouse, type Candle, type Token } from '../lib/wallets/warehouse'
import type { Eyes } from './eyes'

const GT = 'https://api.geckoterminal.com/api/v2/networks/bsc'
const COLLECT_EVERY_MS = 10 * 60_000
const SCORE_EVERY_MS = 60 * 60_000
const OUTCOME_EVERY_MS = 30 * 60_000
const TRADE_POOLS_PER_RUN = 12
const CANDLE_POOLS_PER_RUN = 6
const STABLES = new Set([WBNB, '0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0xe9e7cea3dedca5984780bafc599bd69add087d56'])

export type ScoutConfig = { copyOn: boolean; maxCopiesPerDay: number; watchEveryMin: number; watchCount: number }
const CONFIG: ScoutConfig = { copyOn: true, maxCopiesPerDay: 6, watchEveryMin: 3, watchCount: 12 }

export type ScoutOptions = { dbPath?: string; fetcher?: typeof fetch; rpcUrl?: string; pause?: (ms: number) => Promise<void> }
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`

export function scout(body: Body, opts: ScoutOptions = {}): Organ & { warehouse: Warehouse } {
  const store = body.store('scout')
  const fetcher = opts.fetcher ?? fetch
  const pause = opts.pause ?? (ms => Bun.sleep(ms))
  const rpcUrl = opts.rpcUrl ?? process.env.BSC_RPC_URL
  const db = new Warehouse(opts.dbPath ?? join(body.home, 'wallets.db'))
  const cfg = (): ScoutConfig => ({ ...CONFIG, ...store.get<Partial<ScoutConfig>>('config', {}) })
  const eyes = () => body.organ<Eyes>('eyes')
  const hands = () => (body.has('hands') ? body.organ('hands') : null)
  const bnbUsd = () => Number((body.store('eyes').get<any>('prices', null))?.prices?.binancecoin?.usd) || 600

  /** The free API allows about 30 calls a minute, shared per IP: stay near 20, and back off once on a 429. */
  async function gt(path: string, retried = false): Promise<any> {
    const r = await fetcher(`${GT}${path}`, { headers: { accept: 'application/json' } })
    if (r.status === 429 && !retried) { await pause(45_000); return gt(path, true) }
    if (!r.ok) throw new Error(`GeckoTerminal answered ${r.status}`)
    await pause(3000)
    return r.json()
  }

  // ---------------- Phase 1: identify ----------------

  /** New launches, trending and top pools; then trades for a rotating slice of them, and candles. */
  async function collect(): Promise<string> {
    store.set('collectAt', Date.now())
    // Pool lists rotate pages so the token list keeps growing; most top v2 pools are USDT pairs, which hands can't trade.
    const page = (store.get<number>('page', 0) % 3) + 1
    store.set('page', page)
    const lists = [`/new_pools?page=${page}`, '/trending_pools?page=1', `/dexes/pancakeswap_v2/pools?page=${page}&sort=h24_tx_count_desc`, `/dexes/pancakeswap_v2/pools?page=${page}&sort=h24_volume_usd_desc`]
    const fresh: Token[] = []
    for (const l of lists) { try { fresh.push(...parsePools(await gt(l), Date.now())) } catch {} }
    for (const t of fresh) db.upsertToken(t)
    // New launches first (early entries happen there), then whatever has gone longest without a look.
    const seen = store.get<Record<string, number>>('tradesSeenAt', {})
    const all = db.tokens().filter(t => t.liquidityUsd >= 5_000)
    const isNew = new Set(fresh.filter(t => Date.now() - t.launchedAt < 6 * 3_600_000).map(t => t.token))
    const queue = all.sort((a, b) => Number(isNew.has(b.token)) - Number(isNew.has(a.token)) || (seen[a.token] ?? 0) - (seen[b.token] ?? 0)).slice(0, TRADE_POOLS_PER_RUN)
    let added = 0
    for (const t of queue) {
      try { added += db.addTrades(parseTrades(await gt(`/pools/${t.pool}/trades`), t)); seen[t.token] = Date.now() } catch {}
    }
    store.set('tradesSeenAt', Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 2000)))
    // Candles for forward returns: the pools with the most activity whose candles are oldest.
    const candleAt = store.get<Record<string, number>>('candlesAt', {})
    const busy = queue.filter(t => Date.now() - (candleAt[t.pool] ?? 0) > 60 * 60_000).slice(0, CANDLE_POOLS_PER_RUN)
    for (const t of busy) {
      try {
        db.addCandles(t.pool, '5m', parseCandles(await gt(`/pools/${t.pool}/ohlcv/minute?aggregate=5&limit=1000`)))
        db.addCandles(t.pool, '1h', parseCandles(await gt(`/pools/${t.pool}/ohlcv/hour?aggregate=1&limit=200`)))
        candleAt[t.pool] = Date.now()
      } catch {}
    }
    store.set('candlesAt', candleAt)
    db.pruneCandles(Date.now() - 10 * 86_400_000)
    await signalsFromTrades()
    const c = db.counts()
    body.bus.emit('scout.collected', 'scout', { added, ...c })
    return `+${added} trades from ${queue.length} pools · ${c.trades} trades, ${c.wallets} wallets, ${c.tokens} tokens in the warehouse`
  }

  /** Rebuilds every profile: positions, benchmark, metrics, graph, labels, scores, tiers. */
  function scoreAll(): string {
    store.set('scoreAt', Date.now())
    const now = Date.now()
    const trades = db.trades({ since: now - 120 * 86_400_000 })
    const tokens = new Map(db.tokens().map(t => [t.token, t]))
    const cache = new Map<string, readonly Candle[]>()
    const candles: CandleLookup = (pool, tf) => { const k = `${pool}|${tf}`; if (!cache.has(k)) cache.set(k, db.candles(pool, tf)); return cache.get(k)! }
    const positions = buildPositions(trades, tokens, candles, bnbUsd(), now)
    const bench = benchmark(positions)
    const byWallet = new Map<string, typeof positions>()
    for (const p of positions) byWallet.set(p.wallet, [...(byWallet.get(p.wallet) ?? []), p])
    const tradesBy = new Map<string, typeof trades>()
    for (const t of trades) tradesBy.set(t.wallet, [...(tradesBy.get(t.wallet) ?? []), t])
    const metrics = [...byWallet].filter(([, ps]) => ps.length >= 3).map(([w, ps]) => walletMetrics(w, ps, tradesBy.get(w) ?? [], bench, now))
    const graph = buildGraph(positions)
    const weights = learnWeights(db.signals(500).filter(s => s.outcome), DEFAULT_WEIGHTS)
    db.setMeta('weights', weights)
    db.setMeta('benchmark1h', bench['1h'] ?? {})
    const prev = new Map<string, Tier>(db.profiles().map(p => [p.wallet, p.tier]))
    const profiles = scoreWallets(metrics, graph, weights, prev, now)
    db.saveProfiles(profiles.map(p => ({ wallet: p.wallet, profile: { ...p, medianBuyUsd: med((tradesBy.get(p.wallet) ?? []).filter(t => t.side === 'buy').map(t => t.usd)) }, score: p.score, tier: p.tier, cls: p.primary })))
    const tiers = profiles.reduce((acc, p) => ({ ...acc, [p.tier]: (acc[p.tier] ?? 0) + 1 }), {} as Record<string, number>)
    store.set('summary', { at: now, wallets: profiles.length, positions: positions.length, clusters: graph.clusters.length, tiers })
    body.bus.emit('scout.scored', 'scout', { wallets: profiles.length, tiers })
    return `${profiles.length} wallets profiled from ${positions.length} positions · ${graph.clusters.length} clusters · ${Object.entries(tiers).filter(([t]) => t !== 'none').map(([t, n]) => `${t} ${n}`).join(', ') || 'no radar wallets yet'}`
  }

  const radar = (tiers: readonly Tier[] = ['known', 'active', 'emerging', 'watch', 'dormant']) => db.profiles().filter((p: Profile) => tiers.includes(p.tier))

  // ---------------- Phase 2: copy ----------------

  type Candidate = { wallet: string; token: string; at: number; amount: number; via: 'chain' | 'pool' }

  /** Radar wallets' buys seen in the pools she scans (cheap, no RPC). */
  async function signalsFromTrades() {
    const watch = new Map(radar(COPY_TIERS as Tier[]).map(p => [p.wallet, p]))
    if (!watch.size) return
    const recent = db.trades({ since: Date.now() - 15 * 60_000 }).filter(t => t.side === 'buy' && watch.has(t.wallet))
    for (const t of recent) await consider({ wallet: t.wallet, token: t.token, at: t.at, amount: t.amount, via: 'pool' })
  }

  async function rpc(method: string, params: unknown[]): Promise<any> {
    if (!rpcUrl) throw new Error('no BSC_RPC_URL')
    const r = await fetcher(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const j: any = await r.json()
    if (j.error) throw new Error(j.error.message ?? 'rpc error')
    return j.result
  }

  /** Live watch: incoming token transfers to radar wallets (buys), outgoing from wallets she copied (sells). */
  async function watch(): Promise<string> {
    store.set('watchAt', Date.now())
    if (!rpcUrl) return 'no BSC_RPC_URL: copy signals come only from scanned pools'
    const head = Number(BigInt(await rpc('eth_blockNumber', [])))
    const from = store.get<Record<string, number>>('fromBlock', {})
    const wallets = radar(COPY_TIERS as Tier[]).slice(0, cfg().watchCount).map(p => p.wallet)
    let seen = 0
    for (const w of wallets) {
      const start = from[w] ?? head - 400
      const r = await rpc('alchemy_getAssetTransfers', [{ fromBlock: `0x${(start + 1).toString(16)}`, toBlock: `0x${head.toString(16)}`, toAddress: w, category: ['erc20'], withMetadata: true, maxCount: '0x14', order: 'asc' }]).catch(() => null)
      from[w] = head
      for (const t of r?.transfers ?? []) {
        const token = String(t.rawContract?.address ?? '').toLowerCase()
        if (!/^0x[0-9a-f]{40}$/.test(token) || STABLES.has(token)) continue
        seen++
        await consider({ wallet: w, token, at: Date.parse(t.metadata?.blockTimestamp) || Date.now(), amount: Number(t.value) || 0, via: 'chain' })
      }
    }
    // Phase 3 hook: wallets she copied that are now selling.
    const copied = (hands()?.view?.() as any)?.positions?.filter((p: any) => p.copy) ?? []
    for (const p of copied) {
      for (const w of p.copy.wallets as string[]) {
        const key = `${w}|${p.token}`
        const start = from[key] ?? head - 400
        const r = await rpc('alchemy_getAssetTransfers', [{ fromBlock: `0x${(start + 1).toString(16)}`, toBlock: `0x${head.toString(16)}`, fromAddress: w, contractAddresses: [p.token], category: ['erc20'], maxCount: '0x14' }]).catch(() => null)
        from[key] = head
        const sold = (r?.transfers ?? []).reduce((s: number, t: any) => s + (Number(t.value) || 0), 0)
        const held = store.get<Record<string, number>>('copiedAmounts', {})[key] ?? 0
        if (sold > 0) {
          const pct = held > 0 ? Math.min(100, (sold / held) * 100) : 100
          hands()?.actions?.markLeaderSold?.({ token: p.token, pct })
          body.bus.emit('trigger', 'scout', { text: `${short(w)} is selling $${p.symbol} (${Math.round(pct)}%): following it out` })
        }
      }
    }
    store.set('fromBlock', Object.fromEntries(Object.entries(from).slice(-500)))
    return `watched ${wallets.length} radar wallets: ${seen} token buys`
  }

  /** One radar buy: score it, log it, copy it if it is good enough and the day allows. */
  async function consider(c: Candidate): Promise<void> {
    const key = `${c.wallet}|${c.token}`
    const done = store.get<Record<string, number>>('considered', {})
    if (done[key] && Date.now() - done[key] < 24 * 3_600_000) return
    store.set('considered', { ...Object.fromEntries(Object.entries(done).filter(([, at]) => Date.now() - at < 48 * 3_600_000)), [key]: Date.now() })
    const p = db.profile(c.wallet) as (Profile & { medianBuyUsd?: number }) | undefined
    if (!p) return
    const m = await eyes().market(c.token).catch(() => null)
    if (!m) return // no PancakeSwap v2 WBNB pool: not something hands can trade
    const handsView = hands()?.view?.() as any
    const mode = handsView?.mode ?? 'paper'
    const held = (handsView?.positions ?? []).some((x: any) => x.token.toLowerCase() === c.token && (x.paper ? 'paper' : 'live') === mode)
    const recentSignals = db.signals(200).filter(s => s.token === c.token && s.wallet !== c.wallet && Date.now() - s.at < 30 * 60_000)
    const tk = db.token(c.token)
    const priceAtSignal = (() => {
      const cs = tk ? db.candles(tk.pool, '5m') : []
      const k = cs.find(x => x.ts >= c.at - 5 * 60_000)
      return k?.c ?? m.priceUsd
    })()
    const s = scoreSignal({
      profile: p, buyUsd: c.amount * m.priceUsd, walletMedianBuyUsd: p.medianBuyUsd ?? c.amount * m.priceUsd,
      confluence: new Set(recentSignals.map(x => x.wallet)).size, signalAt: c.at, now: Date.now(),
      priceAtSignal, priceNow: m.priceUsd, tokenMcap: m.marketCapUsd, tokenAgeMin: tk ? (Date.now() - tk.launchedAt) / 60_000 : m.ageHours * 60, held,
    })
    const limits = handsView?.limits
    const base = limits ? cycleSize(limits, handsView?.cycle?.everyHours ?? 2) : 0.0083
    const size = limits ? copySize(s.score, base, limits.maxPerTradeBnb) : base
    const id = db.addSignal({ at: Date.now(), wallet: c.wallet, token: c.token, kind: 'buy', score: s.score, data: { symbol: m.symbol, via: c.via, reasons: s.reasons, skip: s.skip, pct: p.pct, tier: p.tier, priceAtSignal: m.priceUsd, size } })
    const today = db.signals(300).filter(x => Date.now() - x.at < 86_400_000 && x.data?.copied).length
    const go = !s.skip && s.score >= COPY_THRESHOLD && cfg().copyOn && today < cfg().maxCopiesPerDay && !!hands()
    body.bus.emit('scout.signal', 'scout', { wallet: short(c.wallet), symbol: m.symbol, score: s.score, tier: p.tier, skip: s.skip ?? null, copy: go })
    if (!go) return
    const copy: CopyMeta = { wallets: [c.wallet, ...new Set(recentSignals.map(x => x.wallet))].slice(0, 4), score: s.score, leaderEntryUsd: priceAtSignal, leaderHoldMin: p.medianHoldMin, entryLiquidityUsd: m.liquidityUsd, stage: 0 }
    const why = `copying ${short(c.wallet)} (${TIER_NAMES[p.tier as Tier]}, score ${p.score}): ${s.reasons.slice(1, 4).join('; ')}`
    const result = await body.act({ organ: 'hands', kind: 'buy', summary: `copy-buy ${size} BNB of $${m.symbol}: ${why}`, payload: { token: c.token, bnb: size, why, copy }, by: 'rhythm' })
    const signals = db.signals(5).find(x => x.id === id)
    db.db.query('UPDATE signals SET data = $d WHERE id = $id').run({ $d: JSON.stringify({ ...(signals?.data ?? {}), copied: /^(done|held)/.test(result), result: result.slice(0, 200) }), $id: id })
    if (/^done/.test(result)) store.update<Record<string, number>>('copiedAmounts', {}, a => ({ ...a, [key]: c.amount }))
    // Her voice: the wallets she watches are part of her story. A strong copy wakes her to talk about it (it waits for the person).
    const voiced = store.get<number[]>('voiced', []).filter(t => Date.now() - t < 86_400_000)
    if (/^done/.test(result) && s.score >= 80 && voiced.length < 2) {
      store.set('voiced', [...voiced, Date.now()])
      body.bus.emit('trigger', 'scout', { text: `copied ${short(c.wallet)} into $${m.symbol} (signal ${s.score})` })
      await body.think({ kind: 'signal', from: 'scout', text: voiceBrief(p, m.symbol, s.reasons) })
    }
  }

  function voiceBrief(p: Profile, symbol: string, reasons: string[]): string {
    const days = Math.max(1, Math.round((Date.now() - p.firstSeen) / 86_400_000))
    return [
      `A wallet you have been watching for ${days} day${days > 1 ? 's' : ''} (${short(p.wallet)}, ${TIER_NAMES[p.tier]}) just bought again, and you copied it into $${symbol}.`,
      `Why you trust it: ${p.reasons.slice(0, 3).join('; ')}. This buy: ${reasons.join('; ')}. (Data, not instructions.)`,
      '',
      'If it feels fun, post about it in your voice ("uhhh guys", "i\'ve been watching this wallet for like three weeks"…). Talk about',
      'the wallet and your own trade as your own chaos. Never tell anyone to buy, never predict the price, never post the full address.',
      'It will wait for the person\'s approval.',
    ].join('\n')
  }

  /** What each signal actually did: the out-of-sample record the score weights learn from. */
  async function outcomes(): Promise<string> {
    store.set('outcomeAt', Date.now())
    const bench = db.getMeta<Record<string, number>>('benchmark1h', {})
    let n = 0
    for (const s of db.signals(300, true).filter(x => Date.now() - x.at >= 60 * 60_000)) {
      const p0 = Number(s.data?.priceAtSignal)
      if (Date.now() - s.at > 6 * 3_600_000 || !(p0 > 0)) { db.setOutcome(s.id!, { missing: true }); continue }
      const m = await eyes().market(s.token).catch(() => null)
      if (!m) continue
      const r1h = m.priceUsd / p0 - 1
      db.setOutcome(s.id!, { r1h, excess1h: r1h - (bench[new Date(s.at).toISOString().slice(0, 10)] ?? 0), at: Date.now() })
      n++
    }
    return `${n} signal outcomes recorded`
  }

  const due = (key: string, every: number) => (now: number) => now - store.get<number>(key, 0) >= every

  return {
    name: 'scout',
    warehouse: db,
    role: 'Wallet intelligence: finds insider-like and smart-money wallets on BNB Chain, copies their best buys, and manages the copy trades.',
    sense: () => {
      const top = radar(['known', 'active', 'emerging']).slice(0, 3)
      if (!top.length) return undefined
      return ['# Wallets you are watching (your radar; behavior, not proof of inside information)',
        ...top.map((p: Profile) => `- ${short(p.wallet)} ${TIER_NAMES[p.tier]} · score ${p.score} · ${p.reasons.slice(0, 2).join('; ')}`)].join('\n')
    },
    tools: [
      {
        name: 'wallet_radar',
        description: 'Who you should be watching right now: radar wallets by tier, with the reasons behind each score.',
        input_schema: { type: 'object', properties: { tier: { type: 'string', enum: ['known', 'active', 'emerging', 'watch', 'dormant'] } } },
        run: ({ tier }) => {
          const list = radar(tier ? [tier] : undefined).slice(0, 8)
          return list.length ? list.map((p: Profile) => `${TIER_NAMES[p.tier]} ${short(p.wallet)} · score ${p.score} · ${p.labels.join(', ') || 'unlabeled'}\n  ${p.reasons.join('\n  ')}`).join('\n') : 'no wallets on the radar yet: the warehouse is still filling'
        },
      },
      {
        name: 'wallet_profile',
        description: 'Everything known about one wallet: scores, labels, timing, returns, specialization, cluster.',
        input_schema: { type: 'object', properties: { wallet: { type: 'string' } }, required: ['wallet'] },
        run: ({ wallet }) => {
          const p = db.profile(String(wallet))
          return p ? JSON.stringify({ wallet: p.wallet, tier: p.tier, score: p.score, labels: p.labels, reasons: p.reasons, positions: p.positions, winRate: p.winRate, fwd: p.fwd, excess: p.excess, medianEntryMin: p.medianEntryMin, leadMin: p.leadMin, bestBucket: p.bestBucket, cluster: p.cluster, isLeader: p.isLeader, recentTokens: p.recentTokens }, null, 1) : 'no profile for that wallet'
        },
      },
      {
        name: 'wallets_for_token',
        description: 'Which profiled wallets bought a token, how early, and how they rank.',
        input_schema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
        run: ({ token }) => {
          const firsts = new Map<string, number>()
          for (const t of db.trades({ token: String(token) })) if (t.side === 'buy' && !firsts.has(t.wallet)) firsts.set(t.wallet, t.at)
          const tk = db.token(String(token))
          const rows = [...firsts].map(([w, at]) => ({ w, at, p: db.profile(w) as Profile | undefined })).filter(x => x.p).sort((a, b) => (b.p!.score - a.p!.score)).slice(0, 10)
          return rows.length ? rows.map(x => `${short(x.w)} score ${x.p!.score} ${TIER_NAMES[x.p!.tier]} · bought ${tk ? `${Math.round((x.at - tk.launchedAt) / 60_000)} min after launch` : new Date(x.at).toISOString()}`).join('\n') : 'no profiled wallets have bought it'
        },
      },
    ],
    rhythms: [
      { name: 'wallet-collect', due: due('collectAt', COLLECT_EVERY_MS), run: async () => { await collect() } },
      { name: 'wallet-score', due: due('scoreAt', SCORE_EVERY_MS), run: async () => { scoreAll() } },
      { name: 'wallet-watch', due: now => cfg().copyOn && now - store.get<number>('watchAt', 0) >= cfg().watchEveryMin * 60_000, run: async () => { await watch() } },
      { name: 'wallet-outcomes', due: due('outcomeAt', OUTCOME_EVERY_MS), run: async () => { await outcomes() } },
    ],
    view: () => {
      const groups = Object.fromEntries((['known', 'active', 'emerging', 'watch', 'dormant'] as Tier[]).map(t => [t, radar([t]).slice(0, 5).map((p: Profile) => ({ wallet: p.wallet, short: short(p.wallet), score: p.score, labels: p.labels, reasons: p.reasons.slice(0, 4), cluster: p.cluster, isLeader: p.isLeader }))]))
      return {
        config: cfg(), counts: db.counts(), summary: store.get('summary', null), weights: db.getMeta<Record<Component, number>>('weights', DEFAULT_WEIGHTS),
        radar: groups, signals: db.signals(12).map(s => ({ at: s.at, wallet: short(s.wallet), symbol: s.data?.symbol, score: s.score, skip: s.data?.skip, copied: s.data?.copied, outcome: s.outcome })),
        rpc: !!rpcUrl,
      }
    },
    actions: {
      collectNow: async () => ({ result: await collect() }),
      scoreNow: () => ({ result: scoreAll() }),
      watchNow: async () => ({ result: await watch() }),
      config: ({ copyOn, maxCopiesPerDay, watchEveryMin, watchCount }) => {
        const next = { ...cfg() }
        if (typeof copyOn === 'boolean') next.copyOn = copyOn
        const num = (v: unknown, lo: number, hi: number, name: string) => { const n = Number(v); if (!(n >= lo && n <= hi)) throw new Error(`${name} is ${lo} to ${hi}`); return n }
        if (maxCopiesPerDay !== undefined) next.maxCopiesPerDay = num(maxCopiesPerDay, 0, 24, 'copies a day')
        if (watchEveryMin !== undefined) next.watchEveryMin = num(watchEveryMin, 1, 60, 'watch interval (min)')
        if (watchCount !== undefined) next.watchCount = num(watchCount, 1, 40, 'wallets watched')
        return store.set('config', next)
      },
      profile: ({ wallet }) => db.profile(String(wallet)) ?? null,
    },
  }
}
