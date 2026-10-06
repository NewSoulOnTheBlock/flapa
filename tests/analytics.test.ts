import { expect, test } from 'bun:test'
import { bestHours, hourBlock, learn, learningNote, statFromTweet, weightNudges, type PostStat } from '../src/lib/analytics'

const NOW = new Date(2026, 9, 6, 20, 0).getTime()
const at = (daysAgo: number, hour: number) => { const d = new Date(NOW - daysAgo * 86_400_000); d.setHours(hour, 0, 0, 0); return d.getTime() }
const stat = (o: Partial<PostStat> & { id: string }): PostStat => ({
  at: at(1, 9), text: 'a normal post about charts and vibes that is long enough to be ordinary for her feed today', impressions: 200,
  likes: 4, replies: 1, reposts: 0, quotes: 0, bookmarks: 0, category: 'Market', format: 'observation', ...o,
})

test('needs at least three posts older than six hours', () => {
  expect(learn([stat({ id: '1' }), stat({ id: '2' })], NOW)).toBeNull()
  expect(learn([stat({ id: '1' }), stat({ id: '2' }), stat({ id: '3', at: NOW - 3_600_000 })], NOW)).toBeNull()
})

test('finds the winning section, explains the winner, and nudges weights within bounds', () => {
  const rows = [
    stat({ id: '1' }), stat({ id: '2' }), stat({ id: '3' }), stat({ id: '4' }),
    stat({ id: '5', category: 'Kawaii', format: 'question', impressions: 1200, likes: 60, replies: 20, reposts: 6, text: 'WAIT who else buys coins for the ticker?' }),
    stat({ id: '6', category: 'Kawaii', format: 'question', impressions: 900, likes: 40, replies: 12, text: 'SERIOUSLY what is your comfort chart?' }),
    stat({ id: '7', category: 'Lore', impressions: 40, likes: 0, replies: 0 }),
  ]
  const l = learn(rows, NOW)!
  expect(l.posts).toBe(7)
  expect(l.baseline.impressions).toBe(200)
  expect(l.categories[0]!.tag).toBe('Kawaii')
  expect(l.winners.map(w => w.id)).toEqual(['5', '6'])
  expect(l.winners[0]!.why).toContain('asks a question')
  expect(l.losers[0]!.id).toBe('7')
  const w = weightNudges(l)
  expect(w.Kawaii).toBeGreaterThan(1)
  expect(w.Kawaii).toBeLessThanOrEqual(1.6)
  expect(w.Lore).toBeGreaterThanOrEqual(0.6)
  expect(learningNote(l)).toContain('Kawaii')
})

test('best hours need two posts and a better-than-usual result', () => {
  const rows = [
    stat({ id: '1', at: at(1, 9) }), stat({ id: '2', at: at(2, 9) }), stat({ id: '3', at: at(3, 9) }),
    stat({ id: '4', at: at(1, 21), impressions: 800, likes: 30 }), stat({ id: '5', at: at(2, 21), impressions: 700, likes: 25 }),
    stat({ id: '6', at: at(3, 1), impressions: 2000, likes: 90 }),
  ]
  expect(bestHours(learn(rows, NOW))).toEqual(['20-23h'])
  expect(hourBlock(at(0, 13))).toBe('12-15h')
})

test('reads X tweet objects, preferring private impressions', () => {
  const s = statFromTweet({ id: '9', text: 'hi', created_at: '2026-10-06T10:00:00Z', public_metrics: { like_count: 3, reply_count: 1, retweet_count: 2, quote_count: 0, bookmark_count: 1, impression_count: 50 }, non_public_metrics: { impression_count: 55, user_profile_clicks: 4 } }, { category: 'Market' })
  expect(s).toMatchObject({ id: '9', impressions: 55, likes: 3, reposts: 2, profileClicks: 4, category: 'Market' })
})
