// P.A.C.S ships blank: the first persona, and its posting catalog, come from the forge.
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { identity } from '../src/organs/identity'
import { FakeBrain, tempBody } from './helpers'

const PERSONA = JSON.stringify({
  id: 'icarus', name: 'Icarus', handle: '@IcarusSunCult', tagline: 'I was sent back to climb.',
  voice: 'Short, clipped lines.', backstory: 'Compiled in a late future.', values: ['Finishing what was started'],
  taboos: ['chases side quests'], examples: ['Day 41. Continue.'],
  style: { always: ['Continue.'], never: ['🚀'], notes: ['no emoji'] }, reputation: 'the agent that climbs', favorites: ['@someone'],
})
const CATALOG = JSON.stringify({
  formats: ['a log line', 'a two-voice argument'],
  categories: [
    { name: 'The climb', side: 'trading', weight: 1, angle: 'solemn', topics: ['holder count', 'liquidity'] },
    { name: 'Memory', side: 'life', weight: 1, angle: 'quiet', topics: ['corrupted logs', 'the second voice'] },
  ],
})

test('a blank body has no persona and says so in the prompt', async () => {
  const body = tempBody()
  const id = identity(body, join(body.home, 'personas'))
  body.grow(id)
  expect((id.view!() as any).active).toBeNull()
  expect(await id.sense!({ id: 't', stimulus: { kind: 'chat', text: 'hi' }, startedAt: 0, personaId: 'default' })).toContain('no persona yet')
})

test('the forge writes the persona and a valid topics catalog, and makes it active', async () => {
  const brain = new FakeBrain([], system => (system.includes('posting catalog') ? CATALOG : PERSONA))
  const body = tempBody(brain)
  const dir = join(body.home, 'personas')
  const id = identity(body, dir)
  body.grow(id)
  const p = await id.actions!.forge!({ notes: 'name: Icarus\nwhat: an agent sent back to climb' }) as any
  expect(p.id).toBe('icarus')
  expect(p.topicsProblems).toEqual([])
  expect(p.taboos.some((t: string) => t.includes('human'))).toBe(true)
  expect(p.style.never).toEqual(['🚀'])
  expect((id.view!() as any).active.name).toBe('Icarus')
  const c = JSON.parse(readFileSync(join(dir, 'icarus.topics.json'), 'utf8'))
  expect(c.categories).toHaveLength(2)
  expect(c.blendChance).toBe(0.25)
})

test('a bad catalog draft is skipped, not fatal', async () => {
  const brain = new FakeBrain([], system => (system.includes('posting catalog') ? '{"formats": []}' : PERSONA))
  const body = tempBody(brain)
  const dir = join(body.home, 'personas')
  const id = identity(body, dir)
  body.grow(id)
  const p = await id.actions!.forge!({ notes: 'name: Icarus\nwhat: an agent sent back to climb' }) as any
  expect(p.topicsProblems.length).toBeGreaterThan(0)
  expect(existsSync(join(dir, 'icarus.topics.json'))).toBe(false)
  expect((id.view!() as any).active.id).toBe('icarus')
})
