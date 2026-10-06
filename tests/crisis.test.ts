import { expect, test } from 'bun:test'
import { checkCrisis, isHostile } from '../src/lib/crisis'
import { screen } from '../src/lib/rules'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const m = (author: string, text: string, minsAgo = 5) => ({ id: `${author}${minsAgo}${text.length}`, author, text, at: NOW - minsAgo * 60_000 })

test('spots hostile mentions', () => {
  expect(isHostile('this is a scam and you know it')).toBe(true)
  expect(isHostile('rugged again lmao')).toBe(true)
  expect(isHostile('love this chart flapa')).toBe(false)
})

test('a pile-on needs volume and breadth inside the hour', () => {
  const troll = Array.from({ length: 8 }, (_, i) => m('troll', `scam ${i}`, i))
  expect(checkCrisis(troll, NOW).isCrisis).toBe(false)
  const crowd = ['a', 'b', 'c', 'd', 'e', 'f'].map((a, i) => m(a, 'you are a fraud', i * 5))
  const c = checkCrisis(crowd, NOW)
  expect(c).toMatchObject({ isCrisis: true, hostile: 6, authors: 6 })
  expect(c.sample.length).toBe(5)
  const old = ['a', 'b', 'c', 'd', 'e', 'f'].map(a => m(a, 'you are a fraud', 120))
  expect(checkCrisis(old, NOW).isCrisis).toBe(false)
})

test('yellow-tier topics wait for the person', () => {
  expect(screen('the election results are wild today', { domains: [], addresses: [] }).verdict).toBe('hold')
  expect(screen('thoughts and prayers after the earthquake', { domains: [], addresses: [] }).verdict).toBe('hold')
  expect(screen('that dev is a fraud and got indicted', { domains: [], addresses: [] }).verdict).toBe('hold')
  expect(screen('my chart is crying again but i am fine', { domains: [], addresses: [] }).verdict).toBe('pass')
})
