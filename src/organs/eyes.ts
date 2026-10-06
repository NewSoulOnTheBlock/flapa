// eyes — what the mind sees of markets. Was PACS fomo (leaderboard + daily post) and trader's
// DexScreener lookups. Read-only: eyes never act, they brief the mind.
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { FOMO_MCP_URL, isDue, parseToolReply, postBrief, rpcBody, toRows, DAILY_DEFAULT, type DailyConfig, type FomoRow, type FomoWindow } from '../lib/fomo'
import { dexUrl, marketLine, pickPool, type Market } from '../lib/market'

const DAILY_RETRY_MS = 15 * 60_000

export type Research = {
  at: number; by: 'agent' | 'person'; token: string; symbol: string; line: string
  priceUsd?: number; liquidityUsd?: number; change24hPct?: number; marketCapUsd?: number
}

export type Eyes = Organ & {
  market(token: string): Promise<Market | null>
  fomo(tool: string, args: Record<string, unknown>): Promise<any>
}

export function eyes(body: Body, fetcher: typeof fetch = fetch): Eyes {
  const store = body.store('eyes')
  let rpcId = 0

  async function fomo(tool: string, args: Record<string, unknown>): Promise<any> {
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

  return {
    name: 'eyes',
    role: 'Market sight: DexScreener pools on BNB Chain and the fomo.family leaderboard. Never acts.',
    market,
    fomo,
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
    }],
    view: () => ({ board: store.get('board', null), daily: daily(), research: store.get<Research[]>('research', []) }),
    actions: {
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
