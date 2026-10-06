// FomoAPI (https://fomoapi.family): fomo.family's data over REST and a live WebSocket. Bearer key in FOMO_API_KEY.
// REST: leaderboards, trader positions and rank cards, token stats/warnings/candles. WebSocket: every buy and
// sell as it happens, filterable by trader, token or chain. Parsers turn it into the wallet warehouse's rows,
// with a trader's handle (prefixed "@") as the wallet id.
import type { Candle, Token, Trade } from './wallets/warehouse'

export const FOMO_API = 'https://api.fomoapi.family'
export const FOMO_WS = 'wss://api.fomoapi.family/ws/alerts'
export const CHAIN = { solana: 1399811149, ethereum: 1, base: 8453, bnb: 56, robinhood: 4663 } as const
export const chainName = (id: number) => ({ 1399811149: 'Solana', 1: 'Ethereum', 8453: 'Base', 56: 'BNB Chain', 4663: 'Robinhood', 143: 'Monad' } as Record<number, string>)[id] ?? `chain ${id}`

/** A trader's id in the warehouse: the handle, lowercased, with an @ so it never looks like an address. */
export const traderId = (handle: string) => `@${handle.replace(/^@/, '').toLowerCase()}`
/** Tokens are keyed by chain and address; EVM addresses lowercase, Solana mints keep their case. */
export const tokenKey = (networkId: number, address: string) => `${networkId}:${/^0x/i.test(address) ? address.toLowerCase() : address}`
export const parseTokenKey = (key: string) => { const i = key.indexOf(':'); return { networkId: Number(key.slice(0, i)), address: key.slice(i + 1) } }

export type FomoApi = {
  get(path: string): Promise<any>
  leaderboard(window: '24h' | '7d' | '30d' | 'all', limit?: number): Promise<any[]>
  positions(handle: string, limit?: number): Promise<any[]>
  rank(handle: string): Promise<any>
  profile(handle: string): Promise<any>
  warnings(address: string, networkId: number): Promise<any>
  stats(address: string, networkId: number): Promise<any>
  ohlcv(address: string, networkId: number, interval: string, limit: number): Promise<any[]>
}

export function fomoApi(key: string, fetcher: typeof fetch = fetch): FomoApi {
  async function get(path: string): Promise<any> {
    const r = await fetcher(`${FOMO_API}${path}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } })
    const text = await r.text()
    let j: any
    try { j = JSON.parse(text) } catch { throw new Error(`FomoAPI ${r.status}: not JSON`) }
    if (!r.ok) throw new Error(`FomoAPI ${r.status}: ${j?.error ?? ''} ${j?.message ?? ''}`.trim())
    return j
  }
  const enc = encodeURIComponent
  return {
    get,
    leaderboard: async (w, limit = 50) => (await get(`/v2/leaderboard/${w}?limit=${limit}`)).data ?? [],
    positions: async (h, limit = 100) => (await get(`/v2/users/${enc(h)}/positions?limit=${limit}`)).data ?? [],
    rank: async h => (await get(`/v2/users/${enc(h)}/rank`)).data ?? null,
    profile: async h => (await get(`/v2/users/${enc(h)}`)).data ?? null,
    warnings: async (a, n) => (await get(`/v2/token/${enc(a)}/warnings?networkId=${n}`)).data ?? null,
    stats: async (a, n) => (await get(`/v2/token/${enc(a)}/stats?networkId=${n}`)).data ?? null,
    ohlcv: async (a, n, interval, limit) => (await get(`/v2/token/${enc(a)}/ohlcv?networkId=${n}&interval=${interval}&limit=${limit}`)).data ?? [],
  }
}

export const fomoApiFromEnv = (env: Record<string, string | undefined>, fetcher?: typeof fetch): FomoApi | null =>
  env.FOMO_API_KEY ? fomoApi(env.FOMO_API_KEY, fetcher) : null

// ---- parsers ----

/** A trader's swaps → warehouse trades. Token-to-token swaps are skipped: no clean entry price. */
export function positionsToTrades(handle: string, rows: readonly any[], bnbUsd: number): Trade[] {
  const out: Trade[] = []
  for (const p of rows) {
    if (p?.side !== 'buy' && p?.side !== 'sell') continue
    const address = p?.token?.address, networkId = Number(p?.token?.networkId)
    const amount = Number(p.side === 'buy' ? p?.out?.humanAmount : p?.in?.humanAmount)
    const usd = Number(p?.usdValue)
    const at = Date.parse(p?.createdAt)
    if (!address || !Number.isFinite(networkId) || !(amount > 0) || !(usd > 0) || !at) continue
    const key = tokenKey(networkId, address)
    out.push({ tx: String(p.id), wallet: traderId(handle), token: key, pool: key, at, block: 0, side: p.side, bnb: bnbUsd > 0 ? usd / bnbUsd : 0, usd, priceUsd: usd / amount, amount })
  }
  return out
}

/** A live alert (swap_buy / swap_sell) → a warehouse trade, when it carries a price. */
export function alertToTrade(a: any, bnbUsd: number): Trade | null {
  if (a?.type !== 'alert' || (a.alertType !== 'swap_buy' && a.alertType !== 'swap_sell') || !a.trader || !a.tokenAddress) return null
  const usd = Number(a.usdValue), price = Number(a.priceUsd), at = Date.parse(a.ts) || Date.now()
  if (!(usd > 0) || !(price > 0) || !Number.isFinite(Number(a.chainId))) return null
  const key = tokenKey(Number(a.chainId), a.tokenAddress)
  return { tx: String(a.tradeId ?? a.eventId), wallet: traderId(a.trader), token: key, pool: key, at, block: 0, side: a.alertType === 'swap_buy' ? 'buy' : 'sell', bnb: bnbUsd > 0 ? usd / bnbUsd : 0, usd, priceUsd: price, amount: usd / price }
}

export function ohlcvToCandles(rows: readonly any[]): Candle[] {
  return rows.map(r => ({ ts: Number(r.time), o: Number(r.open), h: Number(r.high), l: Number(r.low), c: Number(r.close), v: Number(r.volume) || 0 }))
    .filter(c => c.ts > 0 && c.c > 0).sort((a, b) => a.ts - b.ts)
}

/** A token row from its candles: price now, and launch time when the history reaches back to it. */
export function tokenFromCandles(key: string, symbol: string, c1h: readonly Candle[], limit: number, firstTradeAt: number, mcapUsd = 0): Token {
  const last = c1h.at(-1)
  // A short history (fewer candles than asked for) starts at the launch; a full one does not reach it.
  const launchedAt = c1h.length && c1h.length < limit ? c1h[0]!.ts : firstTradeAt
  return { token: key, pool: key, symbol, launchedAt, fdvUsd: mcapUsd, priceUsd: last?.c ?? 0, liquidityUsd: 0, updatedAt: Date.now() }
}

// ---- the live stream ----

export type FomoStream = { stop: () => void; subscribe: (filter: Record<string, unknown>) => void; isOpen: () => boolean }

/** Keeps one WebSocket open (reconnecting with backoff), re-sending the subscriptions after every reconnect. */
export function openStream(key: string, filters: Record<string, unknown>[], onAlert: (a: any) => void, onStatus: (s: string) => void = () => {}, WS: typeof WebSocket = WebSocket): FomoStream {
  let ws: WebSocket | null = null, stopped = false, open = false, retry = 1000
  const subs = [...filters]
  const seen = new Set<string>()
  const connect = () => {
    if (stopped) return
    ws = new WS(`${FOMO_WS}?key=${encodeURIComponent(key)}`)
    ws.onopen = () => { open = true; retry = 1000; onStatus('open'); for (const f of subs) ws!.send(JSON.stringify({ action: 'subscribe', ...f })) }
    ws.onmessage = e => {
      let m: any
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (m.type === 'alert') {
        if (m.eventId && seen.has(m.eventId)) return // the replay after a reconnect repeats recent events
        if (m.eventId) { seen.add(m.eventId); if (seen.size > 5000) seen.delete(seen.values().next().value!) }
        onAlert(m)
      } else if (m.type === 'error') onStatus(`error: ${m.code ?? ''} ${m.message ?? ''}`)
      else if (m.type === 'welcome') onStatus(m.realtime ? 'live' : `delayed ${m.delaySeconds}s`)
    }
    ws.onclose = () => { open = false; onStatus('closed'); if (!stopped) { setTimeout(connect, retry); retry = Math.min(60_000, retry * 2) } }
    ws.onerror = () => {}
  }
  connect()
  return {
    stop: () => { stopped = true; ws?.close() },
    isOpen: () => open,
    subscribe: f => { subs.push(f); if (open) ws!.send(JSON.stringify({ action: 'subscribe', ...f })) },
  }
}
