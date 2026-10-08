// Setup: the brain comes from the person's credential (tested before it is kept), then a persona, then colors,
// then a checklist whose tests only read.
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { credentialKind, NoBrain, pickBrain, SwitchBrain, type Brain } from '../src/core/brain'
import { publicSnapshot } from '../src/core/publish'
import { THEMES } from '../src/lib/themes'
import { identity } from '../src/organs/identity'
import { setup } from '../src/organs/setup'
import { FakeBrain, tempBody } from './helpers'

const API = `sk-ant-api03-${'a'.repeat(40)}`
const OAUTH = `sk-ant-oat01-${'b'.repeat(40)}`
const personas = join(import.meta.dir, '..', 'examples', 'personas')

test('credentials are told apart by their published prefixes', () => {
  expect(credentialKind(API)).toBe('api')
  expect(credentialKind(` ${OAUTH} `)).toBe('oauth')
  expect(credentialKind('sk-ant-admin01-xyz')).toBeNull()
  expect(credentialKind('hello')).toBeNull()
})

test('the environment wins, then setup; with nothing there is no brain, and it says how to get one', async () => {
  expect(pickBrain({}, {}).kind).toBe('none')
  expect(pickBrain({ anthropicApiKey: API }, {}).kind).toBe('api')
  expect(pickBrain({ claudeOauthToken: OAUTH }, {}).kind).toBe('cli')
  expect(pickBrain({ claudeOauthToken: OAUTH }, { ANTHROPIC_API_KEY: 'x' }).kind).toBe('api')
  expect(pickBrain({ anthropicApiKey: API }, { FLAPA_BRAIN: 'cli' }).kind).toBe('cli')
  await expect(new NoBrain().quick()).rejects.toThrow('setup')
})

function grow(opts: { works?: boolean; fetcher?: typeof fetch; withPersona?: boolean } = {}) {
  const brain = new SwitchBrain(new NoBrain())
  const made: string[] = []
  const makeBrain = (s: { anthropicApiKey?: string; claudeOauthToken?: string }): Brain => {
    made.push(s.anthropicApiKey ? 'api' : 'oauth')
    const b = new FakeBrain([], () => (opts.works === false ? '' : 'OK'))
    if (opts.works === false) b.quick = async () => { throw new Error('401 invalid x-api-key') }
    return b
  }
  const body = tempBody(brain)
  body.grow(identity(body, opts.withPersona ? personas : join(body.home, 'personas')), setup(body, { brain, env: {}, makeBrain, fetcher: opts.fetcher }))
  return { body, brain, made, s: body.organ('setup') as any }
}

test('a working credential is tested, kept beside the state, and swapped in with no restart', async () => {
  const { body, brain, made, s } = grow()
  expect(s.view().steps[0]).toMatchObject({ id: 'brain', ok: false })
  const r = await s.actions.brain({ credential: API })
  expect(made).toEqual(['api'])
  expect(brain.kind).toBe('fake')
  expect(r.source).toContain(API.slice(-4))
  expect(r.source).not.toContain(API.slice(0, 20))
  expect(JSON.parse(readFileSync(join(body.home, 'secrets.json'), 'utf8'))).toEqual({ anthropicApiKey: API })
  expect(s.view().steps[0].ok).toBe(true)
  // Never in the dashboard state, the public snapshot, or a state seed.
  expect(JSON.stringify(s.view())).not.toContain(API)
  expect(JSON.stringify(publicSnapshot(body, []))).not.toContain(API)
})

test('a credential that fails its test is never kept', async () => {
  const { body, brain, s } = grow({ works: false })
  await expect(s.actions.brain({ credential: OAUTH })).rejects.toThrow('OAuth token did not work')
  expect(existsSync(join(body.home, 'secrets.json'))).toBe(false)
  expect(brain.kind).toBe('none')
  await expect(s.actions.brain({ credential: 'my password' })).rejects.toThrow('neither')
})

test('colors: eight schemes, one chosen, and the public snapshot carries only the colors', async () => {
  expect(THEMES).toHaveLength(8)
  expect(new Set(THEMES.map(t => t.id)).size).toBe(8)
  for (const t of THEMES) for (const k of ['bg', 'surface', 'ink', 'pink', 'lav', 'mint', 'butter'] as const) expect(t[k]).toMatch(/^#[0-9a-f]{6}$/i)
  const { body, s } = grow({ withPersona: true })
  expect(() => s.actions.theme({ id: 'nope' })).toThrow('no theme')
  s.actions.theme({ id: 'solar' })
  expect(s.view().theme.name).toBe('Solar')
  expect((publicSnapshot(body, []) as any).theme.id).toBe('solar')
})

test('finishing needs the brain, a persona and colors; tests only read and keep their result', async () => {
  const chainId = (id: string) => (async () => new Response(JSON.stringify({ result: id }))) as unknown as typeof fetch
  const { s } = grow({ withPersona: true, fetcher: chainId('0x38') })
  expect(() => s.actions.finish()).toThrow('come first')
  await s.actions.brain({ credential: API })
  s.actions.theme({ id: 'midnight' })
  expect(s.view().ready).toBe(true)
  s.actions.finish()
  expect(s.view().finished).toBe(true)
  const rpc = await s.actions.test({ step: 'rpc' })
  expect(rpc).toMatchObject({ ok: true, detail: 'BNB Chain (56) answers' })
  expect(s.view().steps.find((x: any) => x.id === 'rpc').last.ok).toBe(true)
  const brainTest = await s.actions.test({ step: 'brain' })
  expect(brainTest.ok).toBe(true)
  await expect(s.actions.test({ step: 'persona' })).rejects.toThrow('nothing to test')

  const wrong = grow({ withPersona: true, fetcher: chainId('0x1') }).s
  const r = await wrong.actions.test({ step: 'rpc' })
  expect(r.ok).toBe(false)
  expect(r.detail).toContain('not BNB Chain')
})

test('keys that are present but fail their test show as not working', async () => {
  const down = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
  const { s } = grow({ fetcher: down })
  expect(s.view().steps.find((x: any) => x.id === 'rpc').ok).toBe(true)
  await s.actions.test({ step: 'rpc' })
  expect(s.view().steps.find((x: any) => x.id === 'rpc').ok).toBe(false)
})
