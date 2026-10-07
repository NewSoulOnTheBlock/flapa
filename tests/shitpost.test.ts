// The shitposting guide reaches her: every scheduled post and reply carries the craft, and a post starts from
// what is really happening to her (live bags, recent trades), never from paper practice or invented numbers.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineBrief, type Catalog } from '../src/lib/posting'
import { happening, REPLY_CRAFT, SHITPOST_CRAFT } from '../src/lib/shitpost'
import { replyBrief } from '../src/lib/social'
import type { Position, TradeRecord } from '../src/lib/limits'

const now = Date.parse('2026-10-07T07:00:00Z')
const pos = (symbol: string, entry: number, last: number, paper = false): Position =>
  ({ token: `0x${symbol}`, symbol, amountWei: '1', decimals: 18, costBnb: 0.0083, entryPrice: entry, peakPrice: entry, lastPrice: last, openedAt: now - 3_600_000, paper })
const trade = (o: Partial<TradeRecord>): TradeRecord =>
  ({ at: now - 30 * 60_000, side: 'buy', token: '0x', symbol: 'X', bnb: 0.0083, why: '', by: 'agent', paper: false, ...o })

test('happening lists live bags with their change and recent trades, and skips paper', () => {
  const h = happening([pos('BOB', 1, 0.917), pos('PAPER', 1, 2, true)], [trade({ symbol: 'BOB' }), trade({ symbol: 'OLD', at: now - 30 * 3_600_000 }), trade({ symbol: 'P', paper: true })], now)
  expect(h).toContain('$BOB -8.3%')
  expect(h).toContain('30m ago: you bought $BOB')
  expect(h).not.toContain('PAPER')
  expect(h).not.toContain('$OLD')
  expect(h).not.toContain('$P ')
  expect(h).toContain('never invent numbers')
})

test('a sell carries its result, and a quiet day says nothing', () => {
  expect(happening([], [trade({ side: 'sell', symbol: 'W', pnlBnb: -0.002 })], now)).toContain('you sold $W (lost 0.0020 BNB)')
  expect(happening([], [], now)).toBe('')
})

test('the scheduled-post brief carries the craft and what is happening', () => {
  const p = { category: 'Trader Psychology', topic: 'Buying tops', angle: 'self-own', format: 'deadpan one-liner', storyline: false }
  const b = engineBrief(p, { recent: [], everyHours: 2, happening: 'your bags: $BOB -8.3%' })
  expect(b).toContain(SHITPOST_CRAFT)
  expect(b).toContain('your bags: $BOB -8.3%')
  expect(b).toContain('no price predictions') // the rules still close the brief
  expect(b.indexOf('no buy or sell calls')).toBeGreaterThan(b.indexOf(SHITPOST_CRAFT))
})

test('replies carry the reply craft', () => {
  expect(replyBrief({ author: 'someone', text: 'i finally sold my bags', remembered: [], kind: 'outbound' })).toContain(REPLY_CRAFT)
})

test("Flapa's formats are the guide's joke shapes, and no angle drops the safety lines", () => {
  const c = JSON.parse(readFileSync(join(import.meta.dir, '..', 'personas', 'flapa.topics.json'), 'utf8')) as Catalog
  for (const shape of ['false expertise', 'escalation', 'underreaction', 'callback', 'bureaucratic language']) expect(c.formats.some(f => f.startsWith(shape))).toBe(true)
  const angle = (n: string) => c.categories.find(x => x.name === n)!.angle
  expect(angle('Competitive Trader Energy')).toContain('never a real person')
  expect(angle('Crypto-Specific Topics')).toContain('no telling anyone to buy or sell')
  expect(angle('Trading & Market Mechanics')).toContain('never a call to trade')
})
