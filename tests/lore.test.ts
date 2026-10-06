import { expect, test } from 'bun:test'
import { dayOf, EMPTY_LORE, loreSection, mergeLore, neverHits, storyChapters } from '../src/lib/lore'

test('lore grows by at most two items a run, without duplicates', () => {
  const a = mergeLore(EMPTY_LORE, { catchphrases: ['chart goblin mode', 'chart goblin mode'], jokes: ['buying tickers for vibes', 'third'], characters: ['the bear'] })
  expect(a.added).toEqual(['catchphrases: chart goblin mode', 'jokes: buying tickers for vibes'])
  const b = mergeLore(a.lore, { catchphrases: ['CHART GOBLIN MODE'], characters: ['the bear'] })
  expect(b.added).toEqual(['characters: the bear'])
  expect(mergeLore(b.lore, 'not json').added).toEqual([])
})

test('story chapters come from real events, once each', () => {
  const born = Date.parse('2026-10-01T00:00:00Z'), d = (n: number) => born + n * 86_400_000
  const input = {
    bornAt: born,
    trades: [
      { at: d(1), side: 'buy', symbol: 'CAKE', paper: true },
      { at: d(2), side: 'sell', symbol: 'CAKE', pnlBnb: 0.002, paper: true },
      { at: d(3), side: 'buy', symbol: 'BOB', paper: false },
      { at: d(4), side: 'sell', symbol: 'BOB', pnlBnb: -0.01, paper: false },
    ],
    followers: [{ at: d(0), followers: 90 }, { at: d(5), followers: 131 }],
    bigPosts: [{ at: d(6), ratio: 4.2, text: 'sushi secured' }, { at: d(7), ratio: 1.5, text: 'meh' }],
  }
  const ch = storyChapters(input, new Set())
  expect(ch.map(c => c.key)).toEqual(['first-trade', 'first-win', 'first-live-trade', `loss-${d(4)}`, 'followers-100', `viral-${d(6)}`])
  expect(storyChapters(input, new Set(ch.map(c => c.key)))).toEqual([])
  expect(dayOf(born, d(4))).toBe(5)
  const s = loreSection({ ...EMPTY_LORE, catchphrases: ['gm chartlings'], chapters: ch }, born)
  expect(s).toContain('gm chartlings')
  expect(s).toContain('Day 5: got wrecked on $BOB')
})

test('never-say phrases are caught case-insensitively', () => {
  expect(neverHits('This is NOT FINANCIAL ADVICE lol', ['not financial advice', 'wagmi'])).toEqual(['not financial advice'])
  expect(neverHits('gm', [])).toEqual([])
})

test('never-say phrases match whole words only', () => {
  expect(neverHits('that was unfair', ['nfa'])).toEqual([])
  expect(neverHits('nfa but i bought', ['nfa'])).toEqual(['nfa'])
  expect(neverHits('gunning for #1 again', ['to the moon'])).toEqual([])
})
