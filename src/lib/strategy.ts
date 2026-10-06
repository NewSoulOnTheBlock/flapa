// The trade cycle: every few hours she makes one trade. Pure rules, so the same market gives the same
// decision and the whole thing is testable. Candidates come from GeckoTerminal's BNB Chain pools; only
// PancakeSwap v2 pools against WBNB count, because those are the only pools hands can trade.
//
// Each cycle, in order:
//   1. today's realized loss hit the stop -> skip (the limits would refuse anyway)
//   2. all position slots full, or today's budget spent -> sell the weakest bag (rotation is a trade too)
//   3. otherwise buy the best-scoring candidate: liquid, at least 3 days old, rising but not parabolic,
//      more buyers than sellers in the last hour, and actively traded
//   4. nothing passes -> skip; she never buys junk just to fill the slot
import type { Position, TradeDay, TradeLimits } from './limits'
import { label, WBNB } from './market'

export type Candidate = {
  token: string; symbol: string; liquidityUsd: number; volume24hUsd: number
  change1hPct: number; change6hPct: number; buys1h: number; sells1h: number; ageDays: number
}

export type CycleConfig = { isOn: boolean; everyHours: number; lastAt?: number }
export const CYCLE_DEFAULT: CycleConfig = { isOn: true, everyHours: 2 }

export type CycleDecision =
  | { kind: 'buy'; bnb: number; options: Candidate[] }
  | { kind: 'sell'; token: string; symbol: string; paper: boolean; pct: number; why: string }
  | { kind: 'skip'; why: string }

/** Stablecoins and majors: nothing to trade against WBNB here. */
const NOT_TRADES = new Set([
  WBNB,
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH
])

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** GeckoTerminal pool listings -> v2 WBNB candidates, one per token (the deepest pool wins). */
export function parseGeckoPools(json: any, now: number): Candidate[] {
  const best = new Map<string, Candidate>()
  for (const p of json?.data ?? []) {
    const a = p?.attributes ?? {}, r = p?.relationships ?? {}
    if (r.dex?.data?.id !== 'pancakeswap_v2') continue
    if (String(r.quote_token?.data?.id ?? '').toLowerCase() !== `bsc_${WBNB}`) continue
    const token = String(r.base_token?.data?.id ?? '').toLowerCase().replace(/^bsc_/, '')
    if (!/^0x[0-9a-f]{40}$/.test(token) || NOT_TRADES.has(token)) continue
    const c: Candidate = {
      token,
      symbol: label(String(a.name ?? '').split(' / ')[0], 20) || '?',
      liquidityUsd: num(a.reserve_in_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      change1hPct: num(a.price_change_percentage?.h1),
      change6hPct: num(a.price_change_percentage?.h6),
      buys1h: num(a.transactions?.h1?.buys),
      sells1h: num(a.transactions?.h1?.sells),
      ageDays: a.pool_created_at ? (now - Date.parse(a.pool_created_at)) / 86_400_000 : 0,
    }
    const held = best.get(token)
    if (!held || c.liquidityUsd > held.liquidityUsd) best.set(token, c)
  }
  return [...best.values()]
}

/** Why a candidate is out, or null when it passes the filter. */
export function rejectReason(c: Candidate, limits: TradeLimits): string | null {
  if (c.liquidityUsd < limits.minLiquidityUsd) return 'thin pool'
  if (c.ageDays < 3) return 'under 3 days old'
  if (c.change1hPct <= 0) return 'not rising this hour'
  if (c.change1hPct > 30 || c.change6hPct > 100) return 'already parabolic'
  if (c.change6hPct < -15) return 'still falling over 6h'
  if (c.buys1h <= c.sells1h) return 'more sellers than buyers'
  if (c.volume24hUsd < c.liquidityUsd * 0.2) return 'barely traded'
  return null
}

/** Higher is better: steady momentum, buy pressure, and real volume. */
export function score(c: Candidate): number {
  const buyShare = c.buys1h / Math.max(1, c.buys1h + c.sells1h)
  return Math.min(c.change1hPct, 30) + 40 * (buyShare - 0.5) + 5 * Math.log10(Math.max(1, c.volume24hUsd))
}

/** One buy's size: the daily budget spread over the day's cycles, never over the per-trade cap. */
export function cycleSize(limits: TradeLimits, everyHours: number): number {
  const perCycle = limits.maxDailyBnb / Math.max(1, Math.floor(24 / everyHours))
  return Math.max(0.001, Math.floor(Math.min(limits.maxPerTradeBnb, perCycle) * 10_000) / 10_000)
}

const change = (p: Position) => p.lastPrice / p.entryPrice - 1

export function planCycle(c: {
  candidates: Candidate[]; positions: readonly Position[]; limits: TradeLimits; day: TradeDay; everyHours: number
}): CycleDecision {
  const { limits, day, positions } = c
  if (-day.realizedBnb >= limits.maxDailyLossBnb) return { kind: 'skip', why: `today's realized loss hit the ${limits.maxDailyLossBnb} BNB stop` }
  const bnb = cycleSize(limits, c.everyHours)
  const full = positions.length >= limits.maxOpen
  const spent = day.spentBnb + bnb > limits.maxDailyBnb + 1e-12
  if (full || spent) {
    if (!positions.length) return { kind: 'skip', why: "today's buying budget is spent" }
    const weakest = [...positions].sort((a, b) => change(a) - change(b))[0]!
    const pctMove = (change(weakest) * 100).toFixed(1)
    return {
      kind: 'sell', token: weakest.token, symbol: weakest.symbol, paper: weakest.paper, pct: 100,
      why: `rotation: ${full ? 'every slot is full' : "today's budget is spent"}, so the weakest bag goes (${Number(pctMove) >= 0 ? '+' : ''}${pctMove}%)`,
    }
  }
  const held = new Set(positions.map(p => p.token.toLowerCase()))
  const options = c.candidates
    .filter(x => !held.has(x.token) && rejectReason(x, limits) === null)
    .sort((a, b) => score(b) - score(a))
  if (!options.length) return { kind: 'skip', why: 'no pool passed the filter this cycle' }
  return { kind: 'buy', bnb, options: options.slice(0, 5) }
}

export function buyWhy(x: Candidate): string {
  return `trade cycle: $${x.symbol} up ${x.change1hPct.toFixed(1)}% this hour (${x.change6hPct.toFixed(1)}% over 6h), ${x.buys1h} buys vs ${x.sells1h} sells, $${Math.round(x.liquidityUsd).toLocaleString('en-US')} liquidity. Wrong if it loses the hour's gain.`
}
