import { expect, test } from 'bun:test'
import { notePerson, opportunityQuery, opportunityScore, pickOpportunities, planMention, strength, type Candidate } from '../src/lib/social'

test('sorts mentions into kinds and reply tiers', () => {
  expect(planMention('@flapakuwai dm me for promo')).toMatchObject({ kind: 'spam', reply: 'skip' })
  expect(planMention('@flapakuwai you are an idiot')).toMatchObject({ kind: 'troll', reply: 'skip' })
  expect(planMention('@flapakuwai this is a scam')).toMatchObject({ kind: 'critic', reply: 'yellow' })
  expect(planMention('@flapakuwai want to collab on a space?')).toMatchObject({ kind: 'opportunity', reply: 'yellow' })
  expect(planMention('@flapakuwai how do you pick your coins?')).toMatchObject({ kind: 'question', reply: 'green' })
  expect(planMention('@flapakuwai how do you pick your coins?', 900_000)).toMatchObject({ kind: 'question', reply: 'yellow' })
  expect(planMention('@flapakuwai gm queen 💜')).toMatchObject({ kind: 'fan', reply: 'green' })
})

test('people records grow and relationship strength reflects warmth', () => {
  let people = notePerson({}, { handle: 'Bob', at: 1, text: 'gm', kind: 'fan', followers: 500 })
  people = notePerson(people, { handle: 'bob', at: 2, text: 'how?', kind: 'question' })
  people = notePerson(people, { handle: 'bob', at: 3, text: 'my reply', replied: true })
  const bob = people.bob!
  expect(bob).toMatchObject({ mentions: 2, replies: 1, followers: 500, firstAt: 1, lastAt: 3 })
  expect(strength(bob)).toBeGreaterThan(0.4)
  const hater = notePerson({}, { handle: 'h', at: 1, text: 'scam', kind: 'critic' }).h!
  expect(strength(hater)).toBeLessThan(0.2)
})

const NOW = Date.parse('2026-10-06T20:00:00Z')
const cand = (o: Partial<Candidate>): Candidate => ({ id: '1', author: 'someone', authorFollowers: 20_000, text: 'memecoin season on bnb is wild, charts everywhere', at: NOW - 20 * 60_000, likes: 40, replies: 5, reposts: 6, ...o })

test('fresh, fitting, moving posts from real accounts score high; stale or crowded ones low', () => {
  const good = opportunityScore(cand({}), NOW, new Set()).score
  expect(good).toBeGreaterThan(55)
  expect(opportunityScore(cand({ at: NOW - 5 * 3_600_000 }), NOW, new Set()).score).toBeLessThan(good)
  expect(opportunityScore(cand({ replies: 400 }), NOW, new Set()).score).toBeLessThan(good)
  expect(opportunityScore(cand({ text: 'what a lovely sunset tonight' }), NOW, new Set()).score).toBeLessThan(good)
})

test('picks the best opportunity, never her own post or one already answered', () => {
  const list = [
    cand({ id: 'a', author: 'flapakuwai' }), cand({ id: 'b', text: 'memecoin season on bnb is wild, charts everywhere https://t.co/abc' }),
    cand({ id: 'c', authorFollowers: 400_000, likes: 300 }), cand({ id: 'd', text: 'dm me for promo memecoin' }),
    cand({ id: 'e', likes: 500, text: '$CT memecoin loading up before an explosive breakout 🚀' }), cand({ id: 'f', authorFollowers: 200, likes: 500 }),
  ]
  const picked = pickOpportunities(list, NOW, new Set(), { self: 'FlapaKuwai', already: new Set(['c']), take: 5 })
  expect(picked.map(p => p.c.id)).toEqual(['b'])
})

test('search query uses the watch list when there is one', () => {
  expect(opportunityQuery(['@a', 'b'])).toBe('(from:a OR from:b) -is:retweet -is:reply lang:en')
  expect(opportunityQuery([])).toContain('memecoin')
})
