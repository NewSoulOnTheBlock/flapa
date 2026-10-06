// hands — the mind's trades on BNB Chain. Was PACS trader. Paper mode fills at the live
// PancakeSwap v2 pool price (fee included) and keeps paper books; live mode goes through
// helper/trade.mjs, the only process that ever holds the key, with its own hard cap below these limits.
import { join } from 'node:path'
import type { Body } from '../core/body'
import type { Mode, Organ, Outward } from '../core/types'
import {
  buyRefusals, copySignals, DEFAULT_LIMITS, exitFor, fromWei, LIMIT_RANGE, minOut, shareOf, today, toWei,
  type Position, type TradeDay, type TradeLimits, type TradeRecord,
} from '../lib/limits'
import { marketLine } from '../lib/market'
import type { Eyes } from './eyes'

const POOL_FEE = 0.0025
const EXIT_EVERY_MS = 2 * 60_000
const SCAN_EVERY_MS = 20 * 60_000
const COPY_WINDOW_MS = 2 * 3_600_000

export type Helper = (cmd: string, args: Record<string, unknown>) => Promise<any>

/** Runs the key-holding helper in its own process; one JSON line comes back. */
export function nodeHelper(root: string): Helper {
  return async (cmd, args) => {
    const p = Bun.spawn(['node', join(root, 'helper', 'trade.mjs'), cmd, JSON.stringify(args)], { stdout: 'pipe', stderr: 'pipe', cwd: root })
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
    const line = out.trim().split('\n').pop() ?? ''
    let v: any
    try { v = JSON.parse(line) } catch { throw new Error(`helper said: ${(err || out).slice(0, 200)}`) }
    if (v.error) throw new Error(v.error)
    return v
  }
}

export function hands(body: Body, helper: Helper): Organ {
  const store = body.store('hands')
  const eyes = () => body.organ<Eyes>('eyes')
  const limits = (): TradeLimits => ({ ...DEFAULT_LIMITS, ...store.get<Partial<TradeLimits>>('limits', {}) })
  const positions = () => store.get<Position[]>('positions', [])
  const trades = () => store.get<TradeRecord[]>('trades', [])
  const day = () => today(store.get<TradeDay | undefined>('day', undefined), Date.now())
  const scanOn = () => store.get('scan', false)

  const record = (t: TradeRecord) => {
    store.update<TradeRecord[]>('trades', [], l => [t, ...l].slice(0, 300))
    body.bus.emit('trade', 'hands', t)
  }

  async function sellBlocked(token: string): Promise<boolean> {
    try { return (await eyes().fomo('fomo_get_token_warnings', { address: token, network: 'bnb' }))?.disableSelling === true } catch { return false }
  }

  async function refusals(token: string, bnb: number, by: Outward['by']): Promise<{ why: string[]; liq: number }> {
    const m = await eyes().market(token)
    const why = buyRefusals(
      { bnb, token, liquidityUsd: m?.liquidityUsd ?? 0, isSellBlocked: await sellBlocked(token), isPerson: by === 'person' },
      limits(), day(), positions(), trades(), Date.now(),
    )
    if (!m) why.unshift('no PancakeSwap v2 WBNB pool')
    return { why, liq: m?.liquidityUsd ?? 0 }
  }

  async function buy(o: Outward, mode: Mode): Promise<string> {
    const token = String(o.payload.token)
    const bnb = Number(o.payload.bnb)
    // Checked again here: an approval can arrive hours after the request.
    const { why } = await refusals(token, bnb, o.by)
    if (why.length) throw new Error(why.join('; '))
    const m = (await eyes().market(token))!
    let amountWei: bigint, decimals = 18, hash: string | undefined
    if (mode === 'paper') {
      const tokens = (bnb / m.priceBnb) * (1 - POOL_FEE)
      if (!(tokens > 0) || tokens >= 1e20) throw new Error('paper fill out of range')
      amountWei = toWei(tokens)
    } else {
      const q = await helper('quote', { side: 'buy', token, amountWei: toWei(bnb).toString() })
      const r = await helper('buy', { token, bnbWei: toWei(bnb).toString(), minOutWei: minOut(BigInt(q.amountOutWei), limits().slippagePct).toString() })
      amountWei = BigInt(r.tokensWei)
      decimals = Number(q.decimals)
      hash = r.hash
    }
    const got = fromWei(amountWei, decimals)
    const price = bnb / got
    const held = positions().find(p => p.token.toLowerCase() === token.toLowerCase())
    const next: Position = held
      ? { ...held, amountWei: (BigInt(held.amountWei) + amountWei).toString(), costBnb: held.costBnb + bnb, entryPrice: (held.costBnb + bnb) / (fromWei(held.amountWei, held.decimals) + got), lastPrice: m.priceBnb }
      : { token: m.token, symbol: m.symbol, amountWei: amountWei.toString(), decimals, costBnb: bnb, entryPrice: price, peakPrice: price, lastPrice: m.priceBnb, openedAt: Date.now(), paper: mode === 'paper' }
    store.set('positions', [...positions().filter(p => p.token.toLowerCase() !== token.toLowerCase()), next])
    store.set('day', { ...day(), spentBnb: day().spentBnb + bnb })
    record({ at: Date.now(), side: 'buy', token: m.token, symbol: m.symbol, bnb, why: String(o.payload.why ?? ''), by: o.by === 'person' ? 'person' : 'agent', paper: mode === 'paper', hash })
    return `bought ${got.toPrecision(4)} $${m.symbol} for ${bnb} BNB${hash ? ` (${hash})` : ''}`
  }

  async function sell(o: Outward, mode: Mode): Promise<string> {
    const token = String(o.payload.token)
    const p = positions().find(x => x.token.toLowerCase() === token.toLowerCase())
    if (!p) throw new Error('no open position in that token')
    if (p.paper !== (mode === 'paper')) throw new Error(`that is a ${p.paper ? 'paper' : 'live'} position; switch hands to ${p.paper ? 'paper' : 'live'} to sell it`)
    const pct = Math.min(100, Math.max(1, Number(o.payload.pct) || 100))
    const amount = shareOf(p.amountWei, pct)
    let out: number, hash: string | undefined
    if (mode === 'paper') {
      const m = await eyes().market(token)
      if (!m) throw new Error('no pool price to fill against')
      out = fromWei(amount, p.decimals) * m.priceBnb * (1 - POOL_FEE)
    } else {
      const q = await helper('quote', { side: 'sell', token, amountWei: amount.toString() })
      const r = await helper('sell', { token, amountWei: amount.toString(), minBnbWei: minOut(BigInt(q.amountOutWei), limits().slippagePct).toString() })
      out = fromWei(r.bnbWei)
      hash = r.hash
    }
    const costShare = p.costBnb * (pct / 100)
    const pnl = out - costShare
    const left = BigInt(p.amountWei) - amount
    store.set('positions', left > 0n
      ? positions().map(x => (x.token === p.token ? { ...p, amountWei: left.toString(), costBnb: p.costBnb - costShare, tookProfit: p.tookProfit || o.payload.tookProfit === true } : x))
      : positions().filter(x => x.token !== p.token))
    store.set('day', { ...day(), realizedBnb: day().realizedBnb + pnl })
    record({ at: Date.now(), side: 'sell', token: p.token, symbol: p.symbol, bnb: out, pnlBnb: pnl, why: String(o.payload.why ?? ''), by: o.by === 'exit' ? 'exit' : o.by === 'person' ? 'person' : 'agent', paper: mode === 'paper', hash })
    if (body.has('affect')) {
      const move = (body.organ('affect') as any).move as (w: string, v: number, e: number) => void
      const swing = Math.max(-0.5, Math.min(0.5, pnl / Math.max(costShare, 1e-9)))
      move(`${pnl >= 0 ? 'won' : 'lost'} ${Math.abs(pnl).toFixed(4)} BNB on $${p.symbol}`, swing, 0.15)
    }
    return `sold ${pct}% of $${p.symbol} for ${out.toFixed(4)} BNB (${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)})${hash ? ` (${hash})` : ''}`
  }

  const portfolio = (): string => {
    const l = limits(), d = day(), ps = positions()
    return [
      `Today: bought ${d.spentBnb.toFixed(4)}/${l.maxDailyBnb} BNB · realized ${d.realizedBnb >= 0 ? '+' : ''}${d.realizedBnb.toFixed(4)} BNB (stop at -${l.maxDailyLossBnb})`,
      ps.length ? `Open (${ps.length}/${l.maxOpen}):\n${ps.map(p => {
        const chg = (p.lastPrice / p.entryPrice - 1) * 100
        return `- [${p.paper ? 'paper' : 'live'}] $${p.symbol} ${p.token}: cost ${p.costBnb.toFixed(4)} BNB, ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%${p.tookProfit ? ' (half taken, trailing)' : ''}`
      }).join('\n')}` : 'No open positions.',
      `Limits: ${l.maxPerTradeBnb} BNB/trade, $${l.minLiquidityUsd} min liquidity, TP +${l.takeProfitPct}% (half), SL -${l.stopLossPct}%.`,
    ].join('\n')
  }

  return {
    name: 'hands',
    role: 'Trades on BNB Chain (PancakeSwap v2) inside hard limits. Paper by default.',
    liveReady: () => (process.env.FLAPA_TRADER_KEY ? undefined : 'set FLAPA_TRADER_KEY in the environment (never paste it anywhere)'),
    tools: [
      { name: 'portfolio', description: 'Your positions, today\'s books and your limits.', input_schema: { type: 'object', properties: {} }, run: portfolio },
      {
        name: 'trade',
        description: 'Buy or sell a BNB Chain token through PancakeSwap v2. Limits are enforced in code; your conscience may hold it. Give a thesis: why this, why now, what would prove you wrong.',
        input_schema: {
          type: 'object',
          properties: {
            side: { type: 'string', enum: ['buy', 'sell'] },
            token: { type: 'string', description: '0x contract address' },
            bnb: { type: 'number', description: 'buy size in BNB' },
            pct: { type: 'number', description: 'sell: share of the position, 1-100' },
            why: { type: 'string' },
          },
          required: ['side', 'token', 'why'],
        },
        run: async ({ side, token, bnb, pct, why }, turn) => {
          if (!/^0x[0-9a-fA-F]{40}$/.test(String(token))) return 'error: token must be a 0x address'
          const by = turn.stimulus.kind === 'chat' ? 'agent' : 'rhythm'
          if (side === 'buy') {
            const size = Number(bnb) || limits().maxPerTradeBnb
            const { why: no } = await refusals(String(token), size, by)
            if (no.length) return `refused by limits: ${no.join('; ')}`
            return body.act({ organ: 'hands', kind: 'buy', summary: `buy ${size} BNB of ${token}: ${why}`, payload: { token, bnb: size, why }, by })
          }
          return body.act({ organ: 'hands', kind: 'sell', summary: `sell ${pct ?? 100}% of ${token}: ${why}`, payload: { token, pct: pct ?? 100, why }, by })
        },
      },
    ],
    perform: (o, mode) => (o.kind === 'buy' ? buy(o, mode) : sell(o, mode)),
    rhythms: [
      {
        name: 'exits',
        due: (now, last) => positions().length > 0 && now - last >= EXIT_EVERY_MS,
        run: async () => {
          for (const p of positions()) {
            const m = await eyes().market(p.token).catch(() => null)
            if (!m) continue
            const seen = { ...p, lastPrice: m.priceBnb, peakPrice: Math.max(p.peakPrice, m.priceBnb) }
            store.set('positions', positions().map(x => (x.token === p.token ? seen : x)))
            const exit = exitFor(seen, m.priceBnb, limits())
            if (exit) {
              await body.act({ organ: 'hands', kind: 'sell', summary: `${exit.why}: $${p.symbol}`, payload: { token: p.token, pct: exit.pct, why: exit.why, tookProfit: exit.why.startsWith('take profit') }, by: 'exit' })
            }
          }
        },
      },
      {
        name: 'copy-scan',
        due: (now, last) => scanOn() && now - last >= SCAN_EVERY_MS,
        run: async () => {
          const lb = await eyes().fomo('fomo_get_leaderboard', { window: '24h', limit: 10 })
          const swaps: Parameters<typeof copySignals>[0][number][] = []
          for (const t of lb?.items ?? []) {
            const s = await eyes().fomo('fomo_list_trader_swaps', { handle: t.handle, limit: 30 }).catch(() => null)
            for (const x of s?.items ?? []) {
              swaps.push({ trader: t.handle, side: x.side, token: x.token?.address ?? '', networkId: Number(x.token?.networkId), usd: Number(x.usdValue) || 0, at: Date.parse(x.createdAt) || 0 })
            }
          }
          const briefed = store.get<Record<string, number>>('briefed', {})
          const now = Date.now()
          const ignore = new Set([...positions().map(p => p.token.toLowerCase()), ...Object.entries(briefed).filter(([, at]) => now - at < 86_400_000).map(([k]) => k)])
          const news = copySignals(swaps, now - COPY_WINDOW_MS, ignore).slice(0, 3)
          if (!news.length) return
          const lines: string[] = []
          for (const s of news) {
            const m = await eyes().market(s.token).catch(() => null)
            lines.push(`- ${s.token}: bought by ${s.traders.join(', ')} ($${Math.round(s.usd)} in 2h)\n  ${m ? marketLine(m) : 'no PancakeSwap v2 WBNB pool: not tradable here'}`)
            briefed[s.token.toLowerCase()] = now
          }
          store.set('briefed', Object.fromEntries(Object.entries(briefed).filter(([, at]) => now - at < 7 * 86_400_000)))
          await body.think({
            kind: 'signal', from: 'hands',
            text: [
              'Copy-trade signals: fomo top traders (24h board) bought these on BNB Chain in the last 2 hours.', ...lines, '',
              `Judge each one. If one is worth it, call trade (buy, at most ${limits().maxPerTradeBnb} BNB) with a thesis. Passing is a fine answer: top traders also buy things that dump.`,
            ].join('\n'),
          })
        },
      },
    ],
    view: () => ({ limits: limits(), day: day(), positions: positions(), trades: trades().slice(0, 30), scan: scanOn() }),
    actions: {
      limits: (patch: Record<string, unknown>) => {
        const next = { ...limits() }
        for (const [k, v] of Object.entries(patch)) {
          const range = LIMIT_RANGE[k as keyof TradeLimits]
          const n = Number(v)
          if (!range) throw new Error(`no limit named ${k}`)
          if (!(n >= range[0] && n <= range[1])) throw new Error(`${k} must be between ${range[0]} and ${range[1]}`)
          next[k as keyof TradeLimits] = n
        }
        return store.set('limits', next)
      },
      scan: ({ isOn }) => store.set('scan', !!isOn),
      sell: async ({ token, pct }) => ({ result: await body.act({ organ: 'hands', kind: 'sell', summary: `person: sell ${pct ?? 100}% of ${token}`, payload: { token, pct: pct ?? 100, why: 'the person sold it' }, by: 'person' }) }),
    },
  } as Organ & { liveReady: () => string | undefined }
}
