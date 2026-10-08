// The posting engine: real variety, seasons respected, the person's catalog loads, and the brief carries the rules.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineBrief, pickTopic, validateCatalog, TOPIC_MEMORY, type Catalog, type PostRecord } from '../src/lib/posting'
import { conscience } from '../src/organs/conscience'
import { identity } from '../src/organs/identity'
import { voice } from '../src/organs/voice'
import { FakeBrain, fakeMarket, tempBody } from './helpers'

const personas = join(import.meta.dir, '..', 'examples', 'personas')
const flapa = JSON.parse(readFileSync(join(personas, 'flapa.topics.json'), 'utf8')) as Catalog

/** A seeded generator, so picks are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

describe("Flapa's catalog", () => {
  test('is valid and holds all twelve of the person\'s sections', () => {
    expect(validateCatalog(flapa)).toEqual([])
    expect(flapa.categories.length).toBe(12)
    const topics = flapa.categories.reduce((n, c) => n + c.topics.length, 0)
    expect(topics).toBeGreaterThanOrEqual(350) // 399 as given; room for the person to prune
    expect(flapa.categories.filter(c => c.side === 'trading').length).toBe(6)
  })
})

describe('picking', () => {
  test('never the same category twice in a row, no topic repeated within memory', () => {
    const rng = seeded(7)
    const history: PostRecord[] = []
    const october = new Date('2026-10-06T12:00:00')
    for (let i = 0; i < 120; i++) {
      const p = pickTopic(flapa, history, october, rng)
      if (history.length) expect(p.category).not.toBe(history.at(-1)!.category)
      const recent = history.slice(-TOPIC_MEMORY).flatMap(h => [h.topic, h.blend].filter(Boolean))
      expect(recent).not.toContain(p.topic)
      history.push({ at: i, category: p.category, topic: p.topic, blend: p.blend?.topic })
    }
    // Over 120 posts every section comes up, and roughly half are trading.
    expect(new Set(history.map(h => h.category)).size).toBe(12)
    const trading = history.filter(h => flapa.categories.find(c => c.name === h.category)!.side === 'trading').length
    expect(trading).toBeGreaterThan(40)
    expect(trading).toBeLessThan(80)
  })

  test('seasonal topics only in season', () => {
    const rng = seeded(3)
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) seen.add(pickTopic(flapa, [], new Date('2026-10-06T12:00:00'), rng).topic)
    expect(seen.has('Cherry blossoms')).toBe(false)
    expect(seen.has('Hanami')).toBe(false)
    expect([...seen].some(t => t === 'Autumn leaves' || t === 'Momiji')).toBe(true)
  })

  test('a blend always pairs trading with kawaii', () => {
    const rng = seeded(11)
    let blends = 0
    for (let i = 0; i < 200; i++) {
      const p = pickTopic(flapa, [], new Date('2026-10-06T12:00:00'), rng)
      if (!p.blend) continue
      blends++
      const side = (name: string) => flapa.categories.find(c => c.name === name)!.side
      expect(side(p.category)).not.toBe(side(p.blend.category))
    }
    expect(blends).toBeGreaterThan(25) // ~25% of 200
    expect(blends).toBeLessThan(80)
  })
})

test('the brief names the topic, the shape, recent posts to avoid, and the rules', () => {
  const p = { category: 'Japanese Food & Drinks', topic: 'Matcha lattes', angle: 'craveable', format: 'hot take', storyline: true, blend: { category: 'Trading & Market Mechanics', topic: 'RSI' } }
  const b = engineBrief(p, { recent: ['old post one'], storyline: 'trading starts soon', everyHours: 8 })
  for (const s of ['Matcha lattes', 'RSI', 'hot take', 'old post one', 'trading starts soon', 'no price predictions', 'never a named or tagged real person', 'down']) expect(b).toContain(s)
})

test('the organ uses the engine: picks, posts, remembers the topic, labels the post', async () => {
  const brain = new FakeBrain([
    req => {
      const brief = String(req.messages.at(-1)!.content)
      expect(brief).toContain('posting engine picked the subject')
      return { calls: [{ id: 'c1', name: 'post', input: { text: 'ranking my top 3 snacks for a red day, results are emotional' } }] }
    },
    () => ({ text: 'posted' }),
  ])
  const body = tempBody(brain)
  body.grow(identity(body, personas), conscience(body), voice(body, { fetcher: fakeMarket({ bnb: 1 }), catalogDir: personas, rng: seeded(5) }))
  const v = body.organ('voice') as any
  expect(v.view().engine.ok).toBe(true)
  const preview = v.actions.roll()
  expect(typeof preview.topic).toBe('string')
  expect(v.view().engine.recent.length).toBe(0) // a roll is only a preview
  expect((await v.actions.postNow()).result).toContain('done (paper)')
  expect(v.view().engine.recent.length).toBe(1)
  expect(v.view().posted[0].topic).toBeTruthy()
})

test('a broken catalog falls back to the plain brief instead of going silent', async () => {
  const brain = new FakeBrain([req => { expect(String(req.messages.at(-1)!.content)).toContain('regular post'); return { text: 'nothing' } }])
  const body = tempBody(brain)
  body.grow(identity(body, personas), conscience(body), voice(body, { fetcher: fakeMarket({ bnb: 1 }), catalogDir: join(personas, 'nope') }))
  expect((body.organ('voice').view!() as any).engine.ok).toBe(false)
  await (body.organ('voice') as any).actions.postNow()
})
