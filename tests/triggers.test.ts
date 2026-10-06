import { expect, test } from 'bun:test'
import type { PostStat } from '../src/lib/analytics'
import { bigMoves, crossedMilestone, isSlump } from '../src/lib/triggers'

test('milestones fire on the crossing only', () => {
  expect(crossedMilestone(129, 151)).toBe(150)
  expect(crossedMilestone(151, 160)).toBeUndefined()
  expect(crossedMilestone(140, 260)).toBe(250)
})

test('big moves need 5% and a 12-hour quiet period per coin', () => {
  const now = Date.parse('2026-10-06T20:00:00Z')
  const prices = { binancecoin: { usd: 820, usd_24h_change: 6.2 }, bitcoin: { usd: 85000, usd_24h_change: -1.1 } }
  expect(bigMoves(prices, {}, now).map(m => m.symbol)).toEqual(['BNB'])
  expect(bigMoves(prices, { binancecoin: now - 3_600_000 }, now)).toEqual([])
  expect(bigMoves({ bitcoin: { usd: 80000, usd_24h_change: -7 } }, {}, now)[0]).toMatchObject({ symbol: 'BTC', pct: -7 })
})

test('a slump is the last five posts at under half her usual', () => {
  const now = Date.parse('2026-10-06T20:00:00Z')
  const post = (i: number, impressions: number): PostStat => ({ id: String(i), at: now - (i + 1) * 12 * 3_600_000, text: 'x', impressions, likes: Math.round(impressions / 50), replies: 0, reposts: 0, quotes: 0, bookmarks: 0 })
  const normal = Array.from({ length: 10 }, (_, i) => post(i + 5, 400))
  expect(isSlump([...Array.from({ length: 5 }, (_, i) => post(i, 400)), ...normal], now)).toBe(false)
  expect(isSlump([...Array.from({ length: 5 }, (_, i) => post(i, 60)), ...normal], now)).toBe(true)
})
