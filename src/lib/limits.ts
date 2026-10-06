// The rules every trade passes, carried over from PACS trader: limits, sizing, exits, the day's books.
import type { CopyMeta } from './wallets/copy'
export type TradeLimits = {
  maxPerTradeBnb: number; maxDailyBnb: number; maxDailyLossBnb: number; maxOpen: number
  minLiquidityUsd: number; takeProfitPct: number; stopLossPct: number; slippagePct: number; cooldownMin: number
}
export type Position = {
  token: string; symbol: string
  /** Raw token units, as a decimal string (bigger than a double holds). */
  amountWei: string; decimals: number; costBnb: number
  /** BNB per whole token at entry, the best since, and the latest seen. */
  entryPrice: number; peakPrice: number; lastPrice: number
  /** Half was sold at the take-profit; the rest now rides a trailing stop. */
  tookProfit?: boolean
  openedAt: number
  /** A paper position: dry-run fills at the pool's price, no chain involved. */
  paper: boolean
  /** A copy trade: who she copied and the plan for getting out (src/lib/wallets/copy.ts). */
  copy?: CopyMeta
}
export type TradeRecord = {
  at: number; side: 'buy' | 'sell'; token: string; symbol: string; bnb: number
  why: string; by: 'agent' | 'person' | 'exit'; paper: boolean; hash?: string; error?: string; pnlBnb?: number
}
export type TradeDay = { day: string; spentBnb: number; realizedBnb: number }
export type CopySignal = { token: string; traders: string[]; usd: number; lastAt: number }

export const DEFAULT_LIMITS: TradeLimits = {
  maxPerTradeBnb: 0.02,
  maxDailyBnb: 0.1,
  maxDailyLossBnb: 0.05,
  maxOpen: 3,
  minLiquidityUsd: 20_000,
  takeProfitPct: 60,
  stopLossPct: 25,
  slippagePct: 12,
  cooldownMin: 360,
}

/** What each limit may be set to: a typo must not become a 100 BNB trade. */
export const LIMIT_RANGE: Record<keyof TradeLimits, [number, number]> = {
  maxPerTradeBnb: [0.001, 1],
  maxDailyBnb: [0.001, 5],
  maxDailyLossBnb: [0.001, 5],
  maxOpen: [1, 10],
  minLiquidityUsd: [1_000, 10_000_000],
  takeProfitPct: [5, 1000],
  stopLossPct: [3, 90],
  slippagePct: [0.5, 30],
  cooldownMin: [0, 10_080],
}

export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Today's books, rolled over at local midnight. */
export function today(day: TradeDay | undefined, now: number): TradeDay {
  const k = dayKey(now)
  return day && day.day === k ? day : { day: k, spentBnb: 0, realizedBnb: 0 }
}

export type BuyCheck = {
  bnb: number
  token: string
  liquidityUsd: number
  /** True when fomo says selling it is disabled (a honeypot sign). */
  isSellBlocked: boolean
  isPerson: boolean
}

/** Why a buy may not happen, or [] when it may. A person's own call skips no limit but the cooldown. */
export function buyRefusals(
  c: BuyCheck, limits: TradeLimits, day: TradeDay, positions: readonly Position[], trades: readonly TradeRecord[], now: number,
): string[] {
  const why: string[] = []
  if (!(c.bnb > 0)) why.push('the size must be above 0 BNB')
  if (c.bnb > limits.maxPerTradeBnb + 1e-12) why.push(`${c.bnb} BNB is over the per-trade limit of ${limits.maxPerTradeBnb} BNB`)
  if (day.spentBnb + c.bnb > limits.maxDailyBnb + 1e-12) {
    why.push(`today's buys would reach ${(day.spentBnb + c.bnb).toFixed(4)} BNB, over the daily limit of ${limits.maxDailyBnb} BNB`)
  }
  if (-day.realizedBnb >= limits.maxDailyLossBnb) why.push(`today's realized loss hit the ${limits.maxDailyLossBnb} BNB stop`)
  const isOpen = positions.some(p => p.token.toLowerCase() === c.token.toLowerCase())
  if (!isOpen && positions.length >= limits.maxOpen) why.push(`already ${positions.length} open positions (limit ${limits.maxOpen})`)
  if (c.liquidityUsd < limits.minLiquidityUsd) {
    why.push(`its PancakeSwap v2 pool holds $${Math.round(c.liquidityUsd).toLocaleString('en-US')}, under the $${limits.minLiquidityUsd.toLocaleString('en-US')} minimum`)
  }
  if (c.isSellBlocked) why.push('fomo flags selling it as disabled (honeypot sign)')
  if (!c.isPerson) {
    const last = trades.find(t => t.side === 'buy' && !t.error && t.token.toLowerCase() === c.token.toLowerCase())
    if (last && now - last.at < limits.cooldownMin * 60_000) {
      why.push(`bought it ${Math.round((now - last.at) / 60_000)}m ago; cooldown is ${limits.cooldownMin}m`)
    }
  }
  return why
}

/** The least a swap may return: the quote less the slippage allowance (which also absorbs a token tax). */
export function minOut(quoteWei: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round((100 - slippagePct) * 100))
  return (quoteWei * bps) / 10_000n
}

/** Raw units of a share of a position, rounded down; 100% is exactly all of it. */
export function shareOf(amountWei: string, pct: number): bigint {
  const all = BigInt(amountWei)
  if (pct >= 100) return all
  return (all * BigInt(Math.round(pct * 100))) / 10_000n
}

export function toWei(bnb: number): bigint {
  // Through a fixed 9-decimal string: floats like 0.1 must not become 0.1000000000000000055.
  const [i, f = ''] = bnb.toFixed(9).split('.')
  return BigInt(i!) * 10n ** 18n + BigInt(f.padEnd(18, '0'))
}

export function fromWei(wei: bigint | string, decimals = 18): number {
  const w = BigInt(wei)
  const neg = w < 0n
  const a = neg ? -w : w
  const base = 10n ** BigInt(decimals)
  const n = Number(a / base) + Number(a % base) / Number(base)
  return neg ? -n : n
}

export type Exit = { pct: number; why: string } | null

/** Whether a position should be sold now: stop loss, take profit (half), or a trailing stop after it. */
export function exitFor(p: Position, price: number, limits: TradeLimits): Exit {
  if (!(price > 0) || !(p.entryPrice > 0)) return null
  const change = (price / p.entryPrice - 1) * 100
  if (change <= -limits.stopLossPct) return { pct: 100, why: `stop loss: ${change.toFixed(1)}% from entry` }
  // A flag, not the peak: a price that jumps past the target between two checks must still sell half.
  if (!p.tookProfit && change >= limits.takeProfitPct) return { pct: 50, why: `take profit: +${change.toFixed(1)}%, selling half` }
  // After the take-profit, the rest rides with a trailing stop of the same width as the stop loss.
  if (p.tookProfit && price <= p.peakPrice * (1 - limits.stopLossPct / 100)) {
    return { pct: 100, why: `trailing stop: ${((price / p.peakPrice - 1) * 100).toFixed(1)}% off the peak` }
  }
  return null
}

/** fomo top traders' recent BNB Chain buys, grouped by token, strongest first. */
export function copySignals(
  swaps: readonly { trader: string; side: string; token: string; networkId: number; usd: number; at: number }[],
  sinceMs: number,
  ignore: ReadonlySet<string>,
): CopySignal[] {
  const by = new Map<string, CopySignal>()
  for (const s of swaps) {
    if (s.networkId !== 56 || s.side !== 'buy' || s.at < sinceMs) continue
    const k = s.token.toLowerCase()
    if (ignore.has(k)) continue
    const cur = by.get(k) ?? { token: s.token, traders: [], usd: 0, lastAt: 0 }
    if (!cur.traders.includes(s.trader)) cur.traders.push(s.trader)
    cur.usd += s.usd
    cur.lastAt = Math.max(cur.lastAt, s.at)
    by.set(k, cur)
  }
  return [...by.values()].sort((a, b) => b.traders.length - a.traders.length || b.usd - a.usd)
}
