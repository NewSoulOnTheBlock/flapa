// eyes — what the mind sees of markets. Was PACS fomo (leaderboard + daily post) and trader's
// DexScreener lookups. Read-only: eyes never act, they brief the mind.
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { FOMO_MCP_URL, isDue, parseToolReply, postBrief, rpcBody, toRows, DAILY_DEFAULT, type DailyConfig, type FomoRow, type FomoWindow } from '../lib/fomo'
import { dexUrl, marketLine, pickPool, type Market } from '../lib/market'
import { parseGeckoPools, type Candidate } from '../lib/strategy'
import type { FomoApi } from '../lib/fomoapi'
import { digestPrompt, FEEDS, newsBrief, newsjackPick, parseDigest, parseRss, stories, type Narrative, type NewsItem } from '../lib/news'

import { bigMoves, moveBrief } from '../lib/triggers'

const NEWS_EVERY_MS = 30 * 60_000

const DAILY_RETRY_MS = 15 * 60_000

export type Research = {
  at: number; by: 'agent' | 'person'; token: string; symbol: string; line: string
  priceUsd?: number; liquidityUsd?: number; change24hPct?: number; marketCapUsd?: number
}

export type Eyes = Organ & {
  market(token: string): Promise<Market | null>
  fomo(tool: string, args: Record<string, unknown>): Promise<any>
  /** Active PancakeSwap v2 WBNB pools on BNB Chain, for the trade cycle. */
  candidates(): Promise<Candidate[]>
}

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/bsc'
const GECKO_LISTS = [`${GECKO}/trending_pools?page=1`, `${GECKO}/dexes/pancakeswap_v2/pools?page=1&sort=h24_volume_usd_desc`, `${GECKO}/dexes/pancakeswap_v2/pools?page=2&sort=h24_volume_usd_desc`]

export function eyes(body: Body, fetcher: typeof fetch = fetch, opts: { api?: FomoApi | null } = {}): Eyes {
  const api = opts.api ?? null
  const store = body.store('eyes')
  let rpcId = 0

  /** fomo data: FomoAPI's REST when FOMO_API_KEY is set (same shapes the old MCP tools returned), else the MCP. */
  async function fomo(tool: string, args: Record<string, unknown>): Promise<any> {
    if (api) {
      const a = args as any
      switch (tool) {
        case 'fomo_get_leaderboard': return { items: await api.leaderboard(a.window ?? '24h', a.limit ?? 10) }
        case 'fomo_get_trader': return api.profile(String(a.handle))
        case 'fomo_list_trader_swaps': return { items: await api.positions(String(a.handle), a.limit ?? 30) }
        case 'fomo_get_token_warnings': return api.warnings(String(a.address), a.network === 'bnb' ? 56 : Number(a.network) || 56)
        default: throw new Error(`no FomoAPI route for ${tool}`)
      }
    }
    return fomoMcp(tool, args)
  }

  async function fomoMcp(tool: string, args: Record<string, unknown>): Promise<any> {
    const r = await fetcher(FOMO_MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: rpcBody(++rpcId, tool, { ...args, response_format: 'json' }),
    })
    if (!r.ok) throw new Error(`fomo-mcp answered ${r.status}`)
    const parsed = parseToolReply(await r.text())
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.value
  }

  async function market(token: string): Promise<Market | null> {
    const r = await fetcher(dexUrl(token))
    if (!r.ok) throw new Error(`DexScreener answered ${r.status}`)
    return pickPool(await r.json(), token, Date.now())
  }

  async function candidates(): Promise<Candidate[]> {
    const merged = new Map<string, Candidate>()
    let answered = 0
    for (const url of GECKO_LISTS) {
      const r = await fetcher(url, { headers: { accept: 'application/json' } }).catch(() => null)
      if (!r?.ok) continue
      answered++
      for (const c of parseGeckoPools(await r.json(), Date.now())) {
        const held = merged.get(c.token)
        if (!held || c.liquidityUsd > held.liquidityUsd) merged.set(c.token, c)
      }
    }
    if (!answered) throw new Error('GeckoTerminal did not answer')
    return [...merged.values()]
  }

  async function board(window: FomoWindow, limit = 10): Promise<FomoRow[]> {
    const r = await fomo('fomo_get_leaderboard', { window, limit })
    const rows = toRows(r?.items ?? [], {})
    for (const row of rows.slice(0, 3)) {
      try { row.x = (await fomo('fomo_get_trader', { handle: row.handle }))?.twitter ?? null } catch { row.x = null }
    }
    store.set('board', { window, rows, at: Date.now() })
    return rows
  }

  /** Every lookup, hers or the person's, kept for the research pane. */
  async function research(token: string, by: 'agent' | 'person'): Promise<string> {
    const m = await market(token)
    const note: Research = m
      ? { at: Date.now(), by, token: m.token, symbol: m.symbol, line: marketLine(m), priceUsd: m.priceUsd, liquidityUsd: m.liquidityUsd, change24hPct: m.change24hPct, marketCapUsd: m.marketCapUsd }
      : { at: Date.now(), by, token, symbol: '?', line: 'no PancakeSwap v2 WBNB pool for that token' }
    store.update<Research[]>('research', [], l => [note, ...l.filter(r => r.token.toLowerCase() !== note.token.toLowerCase())].slice(0, 20))
    body.bus.emit('research', 'eyes', note)
    return note.line
  }

  const daily = () => ({ ...DAILY_DEFAULT, ...store.get<Partial<DailyConfig>>('daily', {}) })

  type Newsjack = { isOn: boolean; perDay: number; done: string[]; fired: number[] }
  const newsjack = (): Newsjack => ({ isOn: true, perDay: 2, done: [], fired: [], ...store.get<Partial<Newsjack>>('newsjack', {}) })

  /** Headlines from the feeds, each kept with its source and time; then a fast reaction if one is squarely hers. */
  async function readNews(): Promise<string> {
    store.set('newsAt', Date.now())
    const got: NewsItem[] = []
    for (const f of FEEDS) {
      try {
        const r = await fetcher(f.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; PACSBot/1.0)' } })
        if (r.ok) got.push(...parseRss(await r.text(), f.source))
      } catch {}
    }
    const keep = new Map(store.get<NewsItem[]>('news', []).map(n => [n.link || n.title, n]))
    for (const n of got) keep.set(n.link || n.title, n)
    store.set('news', [...keep.values()].filter(n => Date.now() - n.at <= 48 * 3_600_000).sort((a, b) => b.at - a.at).slice(0, 250))
    const nj = newsjack()
    const today = nj.fired.filter(t => Date.now() - t < 86_400_000)
    const pick = nj.isOn && today.length < nj.perDay ? newsjackPick(stories(store.get<NewsItem[]>('news', []), Date.now()), Date.now(), new Set(nj.done)) : undefined
    if (pick) {
      // Marked first: one story gets one reaction, whatever happens in the thought.
      store.set('newsjack', { ...nj, done: [...nj.done, pick.link || pick.title].slice(-200), fired: [...today, Date.now()] })
      body.bus.emit('newsjack', 'eyes', { title: pick.title, sources: pick.sources })
      await body.think({ kind: 'news', text: newsBrief(pick), from: 'eyes' })
    }
    return `${got.length} headlines from ${FEEDS.length} feeds${pick ? `; reacting to: ${pick.title}` : ''}`
  }

  /** Once a day: the three narratives that matter, with their sources. */
  async function writeDigest(): Promise<string> {
    const s = stories(store.get<NewsItem[]>('news', []), Date.now()).filter(x => x.relevance > 0 || x.confidence === 'confirmed')
    let trending: string[] = []
    try { trending = (await candidates()).sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 10).map(c => `$${c.symbol}`) } catch {}
    const narratives = parseDigest(await body.brain.quick('You are a careful crypto market researcher. You only report what the sources support.', digestPrompt(s, trending)))
    store.set('digest', { at: Date.now(), narratives })
    return narratives.length ? narratives.map(n => n.name).join(' · ') : 'no digest this time'
  }

  return {
    name: 'eyes',
    role: 'Market sight: DexScreener pools on BNB Chain, the fomo.family leaderboard (FomoAPI), news and prices. Never acts.',
    market,
    fomo,
    candidates,
    tools: [
      {
        name: 'market',
        description: "A BNB Chain token's PancakeSwap v2 / WBNB pool: price, liquidity, volume, moves, pool age.",
        input_schema: { type: 'object', properties: { token: { type: 'string', description: '0x contract address' } }, required: ['token'] },
        run: async ({ token }) => {
          if (!/^0x[0-9a-fA-F]{40}$/.test(String(token))) return 'error: token must be a 0x address'
          return research(String(token), 'agent')
        },
      },
      {
        name: 'leaderboard',
        description: 'The fomo.family trader leaderboard by PnL. Token figures are PnL on that position, not in the window.',
        input_schema: { type: 'object', properties: { window: { type: 'string', enum: ['24h', '7d', '30d', 'all'] } } },
        run: async ({ window }) => {
          const rows = await board((window as FomoWindow) || '24h')
          return rows.map(r => `${r.rank}. ${r.handle}${r.x ? ` (@${r.x})` : ''}: PnL ${r.pnlUsd.toFixed(0)} USD, ${r.trades} trades${r.top ? `, biggest winner $${r.top.symbol}` : ''}`).join('\n') || 'empty board'
        },
      },
    ],
    rhythms: [{
      name: 'daily-post',
      // While fomo is down, it tries again every 15 minutes instead of giving up the day.
      due: (now, last) => isDue(daily(), new Date(now)) && now - last >= DAILY_RETRY_MS,
      run: async () => {
        const rows = await board('24h', 3)
        if (!rows.length) throw new Error('the fomo board came back empty; trying again in 15 minutes')
        // Marked before thinking: whatever she writes, the day's post is never attempted twice.
        const d = new Date()
        store.set('daily', { ...daily(), lastDay: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
        await body.think({ kind: 'daily', text: postBrief(rows, '24h'), from: 'eyes' })
      },
    }, {
      name: 'news',
      due: now => now - store.get<number>('newsAt', 0) >= NEWS_EVERY_MS,
      run: async () => { await readNews() },
    }, {
      // Trigger: BNB or BTC moving 5%+ in a day wakes her to react (once per coin per 12 hours).
      name: 'market-move',
      due: now => now - store.get<number>('pricesAt', 0) >= NEWS_EVERY_MS,
      run: async () => {
        store.set('pricesAt', Date.now())
        const r = await fetcher('https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,bitcoin&vs_currencies=usd&include_24hr_change=true')
        if (!r.ok) return
        const prices = await r.json()
        store.set('prices', { at: Date.now(), prices })
        const move = bigMoves(prices, store.get<Record<string, number>>('movesFired', {}), Date.now())[0]
        if (!move) return
        store.update<Record<string, number>>('movesFired', {}, f => ({ ...f, [move.coin]: Date.now() }))
        body.bus.emit('trigger', 'eyes', { text: `${move.symbol} ${move.pct > 0 ? 'up' : 'down'} ${Math.abs(move.pct).toFixed(1)}% today: reacting` })
        await body.think({ kind: 'signal', text: moveBrief(move), from: 'eyes' })
      },
    }, {
      name: 'digest',
      // Daily, once there are enough headlines to say something.
      due: now => store.get<NewsItem[]>('news', []).length >= 10 && now - (store.get<{ at: number } | null>('digest', null)?.at ?? 0) >= 24 * 3_600_000,
      run: async () => { await writeDigest() },
    }],
    sense: () => {
      const d = store.get<{ at: number; narratives: Narrative[] } | null>('digest', null)
      if (!d?.narratives.length) return undefined
      return `# What is going on in your market (digest from ${new Date(d.at).toDateString()}; headlines, not certainties)\n${d.narratives.map(n => `- ${n.name}: ${n.why}`).join('\n')}`
    },
    view: () => ({
      board: store.get('board', null), daily: daily(), research: store.get<Research[]>('research', []),
      stories: stories(store.get<NewsItem[]>('news', []), Date.now()).slice(0, 15),
      digest: store.get('digest', null), newsjack: newsjack(),
    }),
    actions: {
      newsjack: ({ isOn, perDay }) => {
        const next = { ...newsjack() }
        if (typeof isOn === 'boolean') next.isOn = isOn
        if (perDay !== undefined) { const n = Number(perDay); if (!(n >= 0 && n <= 6)) throw new Error('0 to 6 news reactions a day'); next.perDay = n }
        return store.set('newsjack', next)
      },
      newsNow: async () => ({ result: await readNews() }),
      digestNow: async () => ({ result: await writeDigest() }),
      market: async ({ token }) => {
        if (!/^0x[0-9a-fA-F]{40}$/.test(String(token))) throw new Error('paste a 0x token address')
        return research(String(token), 'person')
      },
      refresh: async ({ window }) => board((window as FomoWindow) || '24h'),
      daily: ({ isOn, hour }) => store.set('daily', {
        ...daily(),
        ...(typeof isOn === 'boolean' ? { isOn } : {}),
        ...(Number.isInteger(hour) && hour >= 0 && hour <= 23 ? { hour } : {}),
      }),
    },
  }
}
