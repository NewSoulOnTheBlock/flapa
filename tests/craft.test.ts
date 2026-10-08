// Every scheduled post and reply carries a craft: the persona's own when it has one, a voice-neutral default
// otherwise. A post starts from what is really happening (live bags, recent trades), never from paper or invented numbers.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineBrief, type Catalog } from '../src/lib/posting'
import { DEFAULT_POST_CRAFT, DEFAULT_REPLY_CRAFT, happening } from '../src/lib/craft'
import { normalizePersona } from '../src/organs/identity'
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

const flapa = normalizePersona(JSON.parse(readFileSync(join(import.meta.dir, '..', 'examples', 'personas', 'flapa.json'), 'utf8')))
const pick = { category: 'Trader Psychology', topic: 'Buying tops', angle: 'self-own', format: 'deadpan one-liner', storyline: false }

test("the scheduled-post brief carries the persona's own craft and what is happening", () => {
  const b = engineBrief(pick, { recent: [], everyHours: 2, happening: 'your bags: $BOB -8.3%', craft: flapa.craft.post })
  expect(flapa.craft.post).toContain('shitposting craft')
  expect(b).toContain(flapa.craft.post)
  expect(b).not.toContain(DEFAULT_POST_CRAFT)
  expect(b).toContain('your bags: $BOB -8.3%')
  expect(b).toContain('no price predictions') // the rules still close the brief
  expect(b.indexOf('no buy or sell calls')).toBeGreaterThan(b.indexOf(flapa.craft.post))
})

test('a persona without a craft gets the voice-neutral default, and the safety rules either way', () => {
  const b = engineBrief(pick, { recent: [], everyHours: 2, craft: '  ' })
  expect(b).toContain(DEFAULT_POST_CRAFT)
  expect(DEFAULT_POST_CRAFT).not.toMatch(/lowercase|shitpost|punchline/i)
  expect(b).toContain('no buy or sell calls')
})

test('replies carry the persona reply craft, or the default', () => {
  const r = (craft?: string) => replyBrief({ author: 'someone', text: 'i finally sold my bags', remembered: [], kind: 'outbound', craft })
  expect(r(flapa.craft.reply)).toContain(flapa.craft.reply)
  expect(r()).toContain(DEFAULT_REPLY_CRAFT)
})

test('a craft may be written as a list of lines', () => {
  const p = normalizePersona({ name: 'Icarus', craft: { post: ['How to write it:', '- short lines'], reply: 'Plain.' } })
  expect(p.craft).toEqual({ post: 'How to write it:\n- short lines', reply: 'Plain.' })
  expect(normalizePersona({ name: 'Blank' }).craft).toEqual({ post: '', reply: '' })
})

test("Flapa's formats are the guide's joke shapes, and no angle drops the safety lines", () => {
  const c = JSON.parse(readFileSync(join(import.meta.dir, '..', 'examples', 'personas', 'flapa.topics.json'), 'utf8')) as Catalog
  for (const shape of ['false expertise', 'escalation', 'underreaction', 'callback', 'bureaucratic language']) expect(c.formats.some(f => f.startsWith(shape))).toBe(true)
  const angle = (n: string) => c.categories.find(x => x.name === n)!.angle
  expect(angle('Competitive Trader Energy')).toContain('never a real person')
  expect(angle('Crypto-Specific Topics')).toContain('no telling anyone to buy or sell')
  expect(angle('Trading & Market Mechanics')).toContain('never a call to trade')
})
