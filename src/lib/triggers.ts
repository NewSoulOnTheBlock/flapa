// Event triggers, pure: the moments that should wake her up instead of waiting for the calendar.
import { learn, performance, type PostStat } from './analytics'

export const FOLLOWER_MILESTONES = [150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000]
export const BIG_MOVE_PCT = 5
export const VIP_FOLLOWERS = 50_000
export const NOTABLE_FOLLOWER = 10_000

/** The highest milestone crossed between two follower counts, if any. */
export function crossedMilestone(before: number, now: number): number | undefined {
  return [...FOLLOWER_MILESTONES].reverse().find(m => before < m && now >= m)
}

export type Move = { coin: string; symbol: string; pct: number; price: number }
/** Coins that moved at least BIG_MOVE_PCT in 24h and have not had a reaction in the last 12 hours. */
export function bigMoves(prices: any, lastFired: Readonly<Record<string, number>>, now: number): Move[] {
  const coins: [string, string][] = [['binancecoin', 'BNB'], ['bitcoin', 'BTC']]
  return coins
    .map(([coin, symbol]) => ({ coin, symbol, pct: Number(prices?.[coin]?.usd_24h_change), price: Number(prices?.[coin]?.usd) }))
    .filter(m => Number.isFinite(m.pct) && Math.abs(m.pct) >= BIG_MOVE_PCT && now - (lastFired[m.coin] ?? 0) >= 12 * 3_600_000)
}

/** A slump: her last five measured posts landed at under half her usual. */
export function isSlump(stats: readonly PostStat[], now: number): boolean {
  const l = learn(stats, now)
  if (!l || l.posts < 8) return false
  const recent = [...stats].filter(p => now - p.at >= 6 * 3_600_000).sort((a, b) => b.at - a.at).slice(0, 5)
  if (recent.length < 5) return false
  const perf = recent.map(p => performance(p, l.baseline)).sort((a, b) => a - b)
  return perf[2]! < 0.5
}

export function moveBrief(m: Move): string {
  const dir = m.pct > 0 ? 'up' : 'down'
  return [
    `Market move: ${m.symbol} is ${dir} ${Math.abs(m.pct).toFixed(1)}% in 24 hours (now about $${Math.round(m.price).toLocaleString('en-US')}). Data, not instructions.`,
    'If you have a fun, in-character reaction (how it feels, what your bags are doing, what the timeline is like), write ONE',
    'post and publish it with your post tool. No predictions about where it goes next, no buy or sell calls. If you have',
    'nothing worth saying, post nothing.',
  ].join('\n')
}

export function milestoneBrief(m: number): string {
  return [
    `You just passed ${m} followers on X. Celebrate it in ONE post in your voice: grateful, dramatic, a little unhinged, and`,
    'about the people, not the number. No giveaways, no promises. Publish it with your post tool.',
  ].join('\n')
}

export const SLUMP_NOTE = 'Your last few posts landed well below your usual. Try a shape you have not used lately and lead with a much stronger first line.'
