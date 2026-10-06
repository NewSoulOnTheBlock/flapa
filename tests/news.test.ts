import { expect, test } from 'bun:test'
import { newsjackPick, parseDigest, parseRss, relevance, sameStory, stories } from '../src/lib/news'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const rss = (items: [string, string, number][]) => `<rss><channel>${items.map(([t, l, minsAgo]) =>
  `<item><title><![CDATA[${t}]]></title><link>${l}</link><pubDate>${new Date(NOW - minsAgo * 60_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`

test('parses RSS items with their source and time, decoding entities', () => {
  const items = parseRss(rss([['BNB hits &amp; holds a new high', 'https://a/1', 10]]), 'CoinDesk')
  expect(items).toEqual([{ title: 'BNB hits & holds a new high', link: 'https://a/1', source: 'CoinDesk', at: NOW - 600_000 }])
})

test('relevance favors her niche', () => {
  expect(relevance('Binance lists a new memecoin on BNB Chain')).toBeGreaterThanOrEqual(6)
  expect(relevance('Fed holds rates steady')).toBe(0)
})

test('the same story from two outlets is confirmed; old news drops out', () => {
  expect(sameStory('Binance to delist three tokens next week', 'Binance will delist three tokens next week, exchange says')).toBe(true)
  const s = stories([
    { title: 'Binance to delist three tokens next week', link: 'a', source: 'CoinDesk', at: NOW - 600_000 },
    { title: 'Binance will delist three tokens next week, exchange says', link: 'b', source: 'Decrypt', at: NOW - 300_000 },
    { title: 'Old story', link: 'c', source: 'Decrypt', at: NOW - 30 * 3_600_000 },
  ], NOW)
  expect(s.length).toBe(1)
  expect(s[0]).toMatchObject({ confidence: 'confirmed', sources: ['Decrypt', 'CoinDesk'] })
})

test('newsjacking picks fresh, on-niche, unhandled stories only', () => {
  const s = stories([
    { title: 'Memecoin frenzy on BNB Chain as PancakeSwap volume surges', link: 'x', source: 'The Block', at: NOW - 10 * 60_000 },
    { title: 'Bitcoin edges up', link: 'y', source: 'CoinDesk', at: NOW - 5 * 60_000 },
    { title: 'BNB memecoin news from this morning', link: 'z', source: 'Decrypt', at: NOW - 3 * 3_600_000 },
  ], NOW)
  expect(newsjackPick(s, NOW, new Set())?.link).toBe('x')
  expect(newsjackPick(s, NOW, new Set(['x']))).toBeUndefined()
})

test('digest JSON is parsed defensively', () => {
  expect(parseDigest('here: [{"name":"BNB memecoins","why":"volume","sources":["Decrypt"]}]')).toEqual([{ name: 'BNB memecoins', why: 'volume', sources: ['Decrypt'] }])
  expect(parseDigest('nope')).toEqual([])
})
