// Classification and scoring, pure. Every wallet gets several labels (never one), eight dimension
// percentiles, an insider-like score with its reasons, and a radar tier. "Insider-like" is behavior:
// early, ahead of attention, repeatedly. It is not evidence of non-public information.
import type { GraphResult } from './graph'
import type { WalletMetrics } from './metrics'

export type Label = 'insider-like' | 'smart money' | 'early money' | 'sniper' | 'gambler' | 'exit liquidity' | 'bot'
export type Tier = 'known' | 'emerging' | 'watch' | 'active' | 'dormant' | 'none'
export const TIER_NAMES: Record<Tier, string> = { known: '🔴 known insider-like', emerging: '🟠 emerging', watch: '🟡 watchlist', active: '🟢 active alpha', dormant: '⚫ dormant', none: '' }

export type Component = 'early' | 'forward' | 'excess' | 'consistency' | 'currentAlpha' | 'conviction' | 'discovery' | 'influence'
export const DEFAULT_WEIGHTS: Record<Component, number> = { early: 25, forward: 20, excess: 15, consistency: 15, currentAlpha: 10, conviction: 5, discovery: 5, influence: 5 }

export type Profile = WalletMetrics & {
  labels: Label[]; primary: Label | 'unclassified'
  pct: Record<Component | 'profitability' | 'timing', number>
  score: number; tier: Tier; reasons: string[]
  cluster?: number; isLeader: boolean; followers: number
}

const fin = (x: number, d = 0) => (Number.isFinite(x) ? x : d)

export function labelsOf(m: WalletMetrics): Label[] {
  const out: Label[] = []
  const ex = fin(m.excess['1h']!, 0)
  if (m.tradesPerDay > 150 || (m.positions >= 30 && fin(m.medianHoldMin, 999) < 3)) out.push('bot')
  if (fin(m.medianEntryMin, 1e9) <= 60 && m.leadCount >= 3 && fin(m.leadMin, 0) >= 15 && ex > 0 && m.evidence !== 'insufficient') out.push('insider-like')
  if (m.winRate >= 0.55 && ex > 0 && m.realizedBnb > 0 && m.evidence !== 'insufficient') out.push('smart money')
  if (fin(m.medianEntryMin, 1e9) <= 30) out.push('early money')
  if (fin(m.medianEntryMin, 1e9) <= 5 && fin(m.medianHoldMin, 1e9) <= 30) out.push('sniper')
  if (m.sharpeLike < 0.1 && m.winRate < 0.35 && m.largestWinBnb > 0.5) out.push('gambler')
  if (ex < -0.05 && m.discoveries === 0) out.push('exit liquidity')
  return out
}
const PRIORITY: Label[] = ['insider-like', 'smart money', 'early money', 'sniper', 'gambler', 'exit liquidity', 'bot']

/** Percentile (0-100) of each value within its column; higher is better after `dir`. */
function percentiles(values: number[], dir: 1 | -1): number[] {
  const sorted = values.map((v, i) => ({ v: fin(v * dir, -Infinity), i })).sort((a, b) => a.v - b.v)
  const out = new Array(values.length).fill(0)
  sorted.forEach((x, rank) => { out[x.i] = values.length > 1 ? Math.round((rank / (values.length - 1)) * 100) : 50 })
  return out
}

export function scoreWallets(ms: readonly WalletMetrics[], g: GraphResult, weights: Record<Component, number> = DEFAULT_WEIGHTS, prevTiers: ReadonlyMap<string, Tier> = new Map(), now = Date.now()): Profile[] {
  const cols: Record<Component | 'profitability' | 'timing', [number[], 1 | -1]> = {
    early: [ms.map(m => fin(m.medianEntryMin, 1e9)), -1],
    forward: [ms.map(m => fin(m.fwd['1h'] ?? m.fwd['6h'] ?? NaN, -1)), 1],
    excess: [ms.map(m => fin(m.excess['1h'] ?? m.excess['6h'] ?? NaN, -1)), 1],
    consistency: [ms.map(m => m.consistency), 1],
    currentAlpha: [ms.map(m => fin(m.currentAlpha, -1)), 1],
    conviction: [ms.map(m => (m.highConviction >= 2 ? m.convictionEdge : 0)), 1],
    discovery: [ms.map(m => m.discoveries / Math.max(1, m.positions)), 1],
    influence: [ms.map(m => (g.influence.get(m.wallet) ?? 0) + Math.max(0, g.leads.get(m.wallet) ?? 0) / 10), 1],
    profitability: [ms.map(m => m.realizedBnb), 1],
    timing: [ms.map(m => (fin(m.entrySkill, 0) + fin(m.exitSkill, 0)) / 2), 1],
  }
  // Bots are ranked against nobody: their speed would push every real wallet's percentiles down.
  const real = ms.map(x => !labelsOf(x).includes('bot'))
  const rank = (v: number[], d: 1 | -1) => {
    const idx = v.map((_, i) => i).filter(i => real[i])
    const p = percentiles(idx.map(i => v[i]!), d)
    const out = new Array(v.length).fill(0)
    idx.forEach((i, k) => { out[i] = p[k] })
    return out
  }
  const pcts = Object.fromEntries(Object.entries(cols).map(([k, [v, d]]) => [k, rank(v, d)])) as Record<keyof typeof cols, number[]>
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  return ms.map((m, i) => {
    const pct = Object.fromEntries(Object.keys(cols).map(k => [k, pcts[k as keyof typeof cols][i]!])) as Profile['pct']
    const labels = labelsOf(m)
    let score = Math.round((Object.keys(weights) as Component[]).reduce((s, k) => s + weights[k] * pct[k], 0) / total)
    if (m.evidence === 'insufficient') score = Math.round(score * 0.6)
    if (labels.includes('bot') || labels.includes('exit liquidity')) score = Math.min(score, 30)
    const followers = g.follows.filter(f => f.leader === m.wallet).length
    const cluster = g.clusterOf.get(m.wallet)
    const isLeader = cluster !== undefined && g.clusters.find(c => c.id === cluster)?.leader === m.wallet
    const p: Profile = { ...m, labels, primary: PRIORITY.find(l => labels.includes(l)) ?? 'unclassified', pct, score, tier: 'none', reasons: [], cluster, isLeader, followers }
    p.tier = tierOf(p, prevTiers.get(m.wallet), now)
    p.reasons = reasonsFor(p)
    return p
  }).sort((a, b) => b.score - a.score)
}

export function tierOf(p: Profile, prev: Tier | undefined, now: number): Tier {
  if (p.labels.includes('bot') || p.labels.includes('exit liquidity')) return 'none'
  const idleDays = (now - p.lastActive) / 86_400_000
  if (idleDays > 14 && (p.score >= 70 || prev === 'known' || prev === 'emerging' || prev === 'active')) return 'dormant'
  const proven = p.evidence === 'interesting' || p.evidence === 'meaningful'
  if (p.score >= 80 && proven && fin(p.currentAlpha, 0) >= 0) return 'known'
  if (idleDays <= 1 && fin(p.currentAlpha, 0) > 0.05 && p.score >= 65 && p.evidence !== 'insufficient') return 'active'
  if (p.score >= 70 && p.evidence !== 'insufficient') return 'emerging'
  if (p.score >= 60) return 'watch'
  return 'none'
}

const pctTxt = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'} percentile`
const sign = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`

/** Why the score is what it is, strongest reasons first. */
export function reasonsFor(p: Profile): string[] {
  const r: [number, string][] = []
  if (Number.isFinite(p.medianEntryMin)) r.push([p.pct.early, `${pctTxt(p.pct.early)} early-entry timing (median ${p.medianEntryMin < 120 ? `${Math.round(p.medianEntryMin)} min` : `${(p.medianEntryMin / 60).toFixed(1)} h`} after launch)`])
  if (p.fwd['1h'] !== undefined) r.push([p.pct.forward, `${pctTxt(p.pct.forward)} 1-hour forward return (median ${sign(p.fwd['1h']!)})`])
  if (p.excess['1h'] !== undefined) r.push([p.pct.excess, `${sign(p.excess['1h']!)} over the day's typical entry, 1h after buying`])
  if (p.tokensWon + p.tokensLost >= 3) r.push([p.winRate * 100, `${Math.round(p.winRate * 100)}% winning tokens (${p.tokensWon}/${p.tokensWon + p.tokensLost})`])
  if (p.leadCount >= 2) r.push([70 + Math.min(30, p.leadCount * 3), `${Math.round(p.leadMin)} min median lead before volume spikes (${p.leadCount} times)`])
  if (p.earlyEntries >= 3) r.push([60 + Math.min(40, p.earlyEntries * 2), `${p.earlyEntries} entries in a token's first 30 minutes`])
  if (p.discoveries >= 2) r.push([p.pct.discovery, `found ${p.discoveries} tokens before they doubled`])
  if (p.alphaTrend === 'improving') r.push([85, 'improving over the last 7 days'])
  if (p.alphaTrend === 'fading') r.push([40, 'fading: last 7 days weaker than the last 30'])
  if (p.bestBucket) r.push([75, `strongest at ${p.bestBucket.name} (${sign(p.bestBucket.excess1h)} excess over ${p.bestBucket.n})`])
  if (p.isLeader) r.push([99, `leads wallet cluster #${p.cluster} (${p.followers} wallets follow its entries)`])
  if (p.highConviction >= 2 && p.convictionEdge > 0.05) r.push([70, `sizes up when right: big bets beat its normal ones by ${sign(p.convictionEdge)}`])
  r.push([50, `${p.positions} tokens observed (${p.evidence} evidence)`])
  return r.sort((a, b) => b[0] - a[0]).slice(0, 7).map(x => x[1])
}

/** Out-of-sample learning: components whose percentiles predicted good signal outcomes get more weight. */
export function learnWeights(signals: readonly { data: any; outcome?: any }[], base: Record<Component, number> = DEFAULT_WEIGHTS): Record<Component, number> {
  const done = signals.filter(s => s.outcome && Number.isFinite(s.outcome.excess1h) && s.data?.pct)
  if (done.length < 30) return base
  const ys = done.map(s => s.outcome.excess1h as number)
  const corr = (xs: number[]) => {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0)
    const vx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0)), vy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0))
    return vx > 0 && vy > 0 ? cov / (vx * vy) : 0
  }
  const raw = Object.fromEntries((Object.keys(base) as Component[]).map(k => [k, base[k] * Math.min(1.5, Math.max(0.5, 1 + corr(done.map(s => Number(s.data.pct[k]) || 0))))])) as Record<Component, number>
  const sum = Object.values(raw).reduce((a, b) => a + b, 0)
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round((v / sum) * 1000) / 10])) as Record<Component, number>
}
