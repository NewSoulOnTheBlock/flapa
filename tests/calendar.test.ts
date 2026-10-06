import { expect, test } from 'bun:test'
import { lastSlot, nextSlots, slotDue, slotHours } from '../src/lib/calendar'
import { parseScore, pickTopic } from '../src/lib/posting'

const T = (h: number, m = 0, day = 6) => new Date(2026, 9, day, h, m).getTime()

test('slots come from her best hours, then defaults, spaced out', () => {
  expect(slotHours([], 3)).toEqual([9, 13, 20])
  expect(slotHours(['12-15h', '08-11h'], 3)).toEqual([9, 13, 20])
  expect(slotHours(['20-23h'], 2)).toEqual([9, 21])
  expect(slotHours(['00-03h', '12-15h'], 4)).toEqual([1, 9, 13, 20])
})

test('a slot is due once, within two hours, and not while a try cools down', () => {
  const hours = [9, 13, 20]
  expect(lastSlot(T(10), hours)).toBe(T(9))
  expect(lastSlot(T(8), hours)).toBe(T(20, 0, 5))
  expect(slotDue(T(9, 5), hours, T(20, 0, 5), 0, 30 * 60_000)).toBe(true)
  expect(slotDue(T(9, 5), hours, T(9, 1), 0, 30 * 60_000)).toBe(false)
  expect(slotDue(T(12, 0), hours, 0, 0, 30 * 60_000)).toBe(false)
  expect(slotDue(T(9, 20), hours, 0, T(9, 5), 30 * 60_000)).toBe(false)
  expect(nextSlots(T(10), hours, 3)).toEqual([T(13), T(20), T(9, 0, 7)])
})

test('self-scores parse to 0-100', () => {
  expect(parseScore('posted!\nSCORE 8/7/9/8/6')).toEqual({ total: 76, parts: [8, 7, 9, 8, 6] })
  expect(parseScore('no score here')).toBeUndefined()
})

test('every pick carries an objective and a kind; polls only on question shapes', () => {
  const cat = { blendChance: 0, storylineChance: 0, formats: ['question to followers', 'hot take'], categories: [{ name: 'A', side: 'trading' as const, weight: 1, angle: 'x', topics: ['t1', 't2', 't3'] }] }
  let s = 1
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  for (let i = 0; i < 200; i++) {
    const p = pickTopic(cat, [], new Date(2026, 9, 6), rng)
    expect(['grow', 'engage', 'authority', 'promo']).toContain(p.objective!)
    if (p.kind === 'poll') expect(p.format).toContain('question')
  }
})
