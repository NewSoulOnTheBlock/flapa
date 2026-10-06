import { expect, test } from 'bun:test'
import type { GraphResult } from '../src/lib/wallets/graph'
import type { WalletMetrics } from '../src/lib/wallets/metrics'
import { DEFAULT_WEIGHTS, labelsOf, learnWeights, scoreWallets } from '../src/lib/wallets/score'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const m = (o: Partial<WalletMetrics> & { wallet: string }): WalletMetrics => ({
  firstSeen: NOW - 20 * 86_400_000, lastActive: NOW - 3_600_000, trades: 80, buys: 40, sells: 40, tradesPerDay: 4,
  positions: 40, tokensWon: 20, tokensLost: 20, winRate: 0.5, realizedBnb: 0.2, roi: 0.1, largestWinBnb: 0.3, largestLossBnb: -0.2,
  maxDrawdownBnb: 0.2, sharpeLike: 0.2, medianHoldMin: 120, avgHoldMin: 150, medianEntryMin: 300, earlyEntries: 2,
  fwd: { '1h': 0.02 }, excess: { '1h': 0 }, positiveFwd1h: 0.5, leadMin: NaN, leadCount: 0, highConviction: 0, convictionEdge: 0,
  discoveries: 1, entrySkill: 0.9, exitSkill: 0.8, pattern: 'one-shot', alpha7d: 0, alpha30d: 0, alphaAll: 0, currentAlpha: 0,
  alphaTrend: 'steady', evidence: 'interesting', consistency: 50, recentTokens: [], ...o,
})
const graph: GraphResult = { follows: [{ leader: 'star', follower: 'b', shared: 5, followRate: 0.7, medianDelaySec: 38 }], clusters: [{ id: 1, wallets: ['star', 'b'], leader: 'star' }], influence: new Map([['star', 0.7]]), clusterOf: new Map([['star', 1], ['b', 1]]), leads: new Map([['star', 5], ['b', -5]]) }

test('labels are several, separate behaviors', () => {
  expect(labelsOf(m({ wallet: 'x', medianEntryMin: 3, medianHoldMin: 10 }))).toEqual(['early money', 'sniper'])
  expect(labelsOf(m({ wallet: 'x', medianEntryMin: 20, leadCount: 5, leadMin: 45, excess: { '1h': 0.2 }, winRate: 0.7, realizedBnb: 1 }))).toEqual(['insider-like', 'smart money', 'early money'])
  expect(labelsOf(m({ wallet: 'x', tradesPerDay: 400 }))).toContain('bot')
  expect(labelsOf(m({ wallet: 'x', excess: { '1h': -0.2 }, discoveries: 0 }))).toContain('exit liquidity')
})

test('the early, ahead-of-attention, consistent cluster leader ranks first with reasons; bots never make the radar', () => {
  const ws = [
    m({ wallet: 'star', medianEntryMin: 4, earlyEntries: 30, leadCount: 12, leadMin: 41, fwd: { '1h': 0.6 }, excess: { '1h': 0.45 }, winRate: 0.8, tokensWon: 32, tokensLost: 8, consistency: 85, currentAlpha: 0.5, alpha7d: 0.5, alpha30d: 0.3, alphaTrend: 'improving', discoveries: 14 }),
    m({ wallet: 'b', medianEntryMin: 60 }), m({ wallet: 'c' }), m({ wallet: 'd', medianEntryMin: 900, fwd: { '1h': -0.05 }, excess: { '1h': -0.1 }, discoveries: 0 }),
    m({ wallet: 'bot', tradesPerDay: 900, medianEntryMin: 1, fwd: { '1h': 0.9 }, excess: { '1h': 0.9 } }),
  ]
  const ps = scoreWallets(ws, graph, DEFAULT_WEIGHTS, new Map(), NOW)
  expect(ps[0]!.wallet).toBe('star')
  expect(ps[0]!.tier).toBe('known')
  expect(ps[0]!.isLeader).toBe(true)
  expect(ps[0]!.reasons.join(' | ')).toContain('leads wallet cluster #1')
  expect(ps[0]!.reasons.some(r => r.includes('early-entry timing'))).toBe(true)
  expect(ps.find(p => p.wallet === 'bot')!.tier).toBe('none')
  expect(ps.find(p => p.wallet === 'd')!.tier).toBe('none')
})

test('a strong wallet gone quiet for two weeks is dormant', () => {
  const ps = scoreWallets([m({ wallet: 'old', lastActive: NOW - 20 * 86_400_000, medianEntryMin: 2 }), m({ wallet: 'x' })], { ...graph, follows: [], clusters: [], clusterOf: new Map(), influence: new Map(), leads: new Map() }, DEFAULT_WEIGHTS, new Map([['old', 'known']]), NOW)
  expect(ps.find(p => p.wallet === 'old')!.tier).toBe('dormant')
})

test('weights stay put until 30 outcomes, then lean toward what predicted returns', () => {
  expect(learnWeights([])).toEqual(DEFAULT_WEIGHTS)
  const sigs = Array.from({ length: 40 }, (_, i) => ({ data: { pct: { early: i * 2.5, forward: 50, excess: 50, consistency: 50, currentAlpha: 50, conviction: 50, discovery: 50, influence: 50 } }, outcome: { excess1h: i / 100 } }))
  const w = learnWeights(sigs)
  expect(w.early).toBeGreaterThan(DEFAULT_WEIGHTS.early)
  expect(Math.round(Object.values(w).reduce((a, b) => a + b, 0))).toBe(100)
})
