// Phase 2 and 3, pure: when a radar wallet buys, should she copy it, and how big? Once she is in, when
// does she get out? The copied wallet's own behavior is part of the exit plan: if it leaves, she leaves.
import type { Profile, Tier } from './score'

export const COPY_THRESHOLD = 65
export const COPY_TIERS: readonly Tier[] = ['known', 'active', 'emerging']
export const MAX_SIGNAL_AGE_MIN = 30
export const MAX_CHASE = 0.3

export type SignalContext = {
  profile: Pick<Profile, 'wallet' | 'tier' | 'score' | 'isLeader' | 'bestBucket' | 'reasons'>
  buyUsd: number; walletMedianBuyUsd: number
  /** Other radar wallets that bought the same token in the last 30 minutes. */
  confluence: number
  signalAt: number; now: number
  priceAtSignal: number; priceNow: number
  tokenMcap: number; tokenAgeMin: number
  held: boolean
}
export type SignalScore = { score: number; reasons: string[]; skip?: string }

const mcapBucket = (m: number) => (!Number.isFinite(m) ? undefined : m < 100_000 ? 'under $100k mcap' : m < 500_000 ? '$100k-500k mcap' : m < 2_000_000 ? '$500k-2M mcap' : 'over $2M mcap')
const ageBucket = (min: number) => (!Number.isFinite(min) ? undefined : min < 60 ? 'tokens under 1h old' : min < 1440 ? 'tokens under a day old' : min < 10080 ? 'tokens under a week old' : 'older tokens')

export function scoreSignal(c: SignalContext): SignalScore {
  const p = c.profile
  if (!COPY_TIERS.includes(p.tier)) return { score: 0, reasons: [], skip: `wallet is not on the radar (${p.tier})` }
  if (c.held) return { score: 0, reasons: [], skip: 'already holding it' }
  const ageMin = (c.now - c.signalAt) / 60_000
  if (ageMin > MAX_SIGNAL_AGE_MIN) return { score: 0, reasons: [], skip: `stale: the wallet bought ${Math.round(ageMin)} min ago` }
  const ran = c.priceAtSignal > 0 ? c.priceNow / c.priceAtSignal - 1 : 0
  if (ran > MAX_CHASE) return { score: 0, reasons: [], skip: `already ran +${Math.round(ran * 100)}% since the wallet bought` }
  const reasons: string[] = [`wallet score ${p.score} (${p.tier})`]
  let s = p.score * 0.55 + ({ known: 10, active: 8, emerging: 3 } as Record<string, number>)[p.tier]!
  const conv = c.buyUsd / Math.max(1, c.walletMedianBuyUsd)
  if (conv >= 3) { s += 12; reasons.push(`high conviction: ${conv.toFixed(1)}x its usual size`) }
  else if (conv >= 1.5) { s += 6; reasons.push(`sized up: ${conv.toFixed(1)}x its usual`) }
  else if (conv < 0.5) { s -= 8; reasons.push('a small, tentative buy') }
  if (c.confluence > 0) { s += Math.min(16, 8 * c.confluence); reasons.push(`${c.confluence} other radar wallet${c.confluence > 1 ? 's' : ''} bought it too`) }
  const fits = p.bestBucket && (p.bestBucket.name === mcapBucket(c.tokenMcap) || p.bestBucket.name === ageBucket(c.tokenAgeMin))
  if (fits) { s += 8; reasons.push(`in its specialty: ${p.bestBucket!.name}`) }
  if (p.isLeader) { s += 5; reasons.push('a cluster leader: others tend to follow') }
  if (ran > 0.1) { s -= 6; reasons.push(`price already +${Math.round(ran * 100)}% since its buy`) }
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons }
}

/** Size: the trade cycle's normal size, scaled by conviction in the signal (0.5x to 2x), never over the cap. */
export function copySize(score: number, baseBnb: number, maxPerTradeBnb: number): number {
  const mult = Math.min(2, Math.max(0.5, score / 70))
  return Math.max(0.001, Math.floor(Math.min(maxPerTradeBnb, baseBnb * mult) * 10_000) / 10_000)
}

/** What a copied position remembers about why it exists. */
export type CopyMeta = {
  wallets: string[]; score: number
  leaderEntryUsd: number; leaderHoldMin: number; entryLiquidityUsd: number
  /** Profit ladder stage: 0 none taken, 1 a third taken at +40%, 2 another third at +100%. */
  stage: number
  /** Set when the copied wallet sells: the share it sold. */
  leaderSoldPct?: number
}
export type CopyExit = { pct: number; why: string; stage?: number } | null

export function copyExit(pos: { entryPrice: number; peakPrice: number; openedAt: number }, copy: CopyMeta, m: { priceBnb: number; priceUsd: number; liquidityUsd: number }, now: number): CopyExit {
  const change = pos.entryPrice > 0 ? m.priceBnb / pos.entryPrice - 1 : 0
  if ((copy.leaderSoldPct ?? 0) >= 50) return { pct: Math.max(50, Math.min(100, Math.round(copy.leaderSoldPct!))), why: `the wallet she copied sold ${Math.round(copy.leaderSoldPct!)}% of its bag` }
  if (copy.entryLiquidityUsd > 0 && m.liquidityUsd < copy.entryLiquidityUsd * 0.6) return { pct: 100, why: `liquidity pulled: $${Math.round(m.liquidityUsd).toLocaleString('en-US')} from $${Math.round(copy.entryLiquidityUsd).toLocaleString('en-US')}` }
  if (copy.leaderEntryUsd > 0 && m.priceUsd < copy.leaderEntryUsd * 0.85) return { pct: 100, why: 'thesis broken: 15% under the copied wallet\'s entry' }
  if (copy.stage < 2 && change >= 1.0) return { pct: 50, why: `profit ladder: +${Math.round(change * 100)}%, second third off`, stage: 2 }
  if (copy.stage < 1 && change >= 0.4) return { pct: 33, why: `profit ladder: +${Math.round(change * 100)}%, first third off`, stage: 1 }
  if (copy.stage >= 1 && pos.peakPrice > 0 && m.priceBnb <= pos.peakPrice * 0.75) return { pct: 100, why: `trailing stop after the ladder: ${Math.round((m.priceBnb / pos.peakPrice - 1) * 100)}% off the peak` }
  const maxHoldMin = Math.min(2880, Math.max(120, 2 * (Number.isFinite(copy.leaderHoldMin) ? copy.leaderHoldMin : 240)))
  if ((now - pos.openedAt) / 60_000 > maxHoldMin && change < 0.05) return { pct: 100, why: `time stop: ${Math.round((now - pos.openedAt) / 3_600_000)}h with nothing to show` }
  return null
}
