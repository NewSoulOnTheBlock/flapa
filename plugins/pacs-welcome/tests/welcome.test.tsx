import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { banner } from '../hooks/banner'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const band = (bodyColumns = 120, maxRows = 30) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows, bodyColumns, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
  }) as const

const FLAPA = {
  id: 'flapa', name: 'Flapa', handle: 'flapakuwai', tagline: "i know i'm just a girl but im gonna be the best!",
  backstory: '', voice: 'bubbly chart nerd', values: [], taboos: [], examples: ['the frog says yes'],
}

function engineBeneath(on: On, opts: { active: typeof FLAPA | null; profiles: string[] }) {
  mock.store(on)
  const clock = mock.clock(on)
  on('state.get', (_$, e, next) => {
    if (e.plugin === 'persona-core' && e.key === 'active') return { value: { value: opts.active, version: 1 } }
    if (e.plugin === 'persona-core' && e.key === 'profiles') {
      return { value: { value: opts.profiles.map(id => ({ ...FLAPA, id })), version: 1 } }
    }
    if (e.plugin === 'mood-state' && e.key === 'mood') {
      return { value: { value: { valence: 0.6, energy: 0.8, baseValence: 0.3, baseEnergy: 0.6, updated: 0, events: [] }, version: 1 } }
    }
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const asked: { system?: string; prompt: string }[] = []
  on('model.complete', (_$, e) => {
    asked.push({ system: e.system, prompt: e.prompt })
    return {
      value: { isAnswered: true, text: '"gm!! the charts missed you. i did not. ok maybe a little"', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    } as never
  })
  return { clock, asked }
}

test('the block font spells names and drops what it cannot draw', () => {
  const rows = banner('Flapa')
  expect(rows).toHaveLength(5)
  expect(rows[0]).toBe('█████ █      ███  ████   ███')
  expect(banner('a!b')[2]).toBe(banner('ab')[2])
})

test('first run: PACS banner and the steps to forge an agent', async ($, on) => {
  engineBeneath(on, { active: null, profiles: [] })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band() })
  expect(await ui.find({ type: 'Text', text: banner('PACS')[0]! })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Personal Agentic Core System' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No agent yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/forge' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('personas but none active: pick one up', async ($, on) => {
  engineBeneath(on, { active: null, profiles: ['flapa', 'nyx'] })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band() })
  expect(await ui.find({ type: 'Text', text: /No agent is active/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'flapa, nyx' })).toBeDefined()
  await ui.unmount()
})

test('an active persona: their name in block letters and a greeting in their voice', async ($, on) => {
  const engine = engineBeneath(on, { active: FLAPA, profiles: ['flapa'] })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  await engine.clock.advance(5)
  expect(engine.asked[0]?.system).toContain('You are Flapa (@flapakuwai)')
  expect(engine.asked[0]?.system).toContain('Right now you feel euphoric.')

  const ui = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band() })
  expect(await ui.find({ type: 'Text', text: banner('Flapa')[0]! })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'gm!! the charts missed you. i did not. ok maybe a little' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Personal Agentic Core System · Flapa @flapakuwai · euphoric/ })).toBeDefined()
  await ui.unmount()

  // Narrow or short: the name alone, no block letters.
  const narrow = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band(20, 30) })
  expect(await narrow.find({ type: 'Text', text: 'FLAPA' })).toBeDefined()
  await narrow.unmount()
})

test('the first message tucks it away; /welcome brings it back', async ($, on) => {
  engineBeneath(on, { active: null, profiles: [] })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band() })
  expect(await ui.find({ type: 'Text', text: 'Personal Agentic Core System' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()

  await $.command.run({ command: 'welcome', args: '', ...typed })
  const again = await $.ui.mount({ plugin: 'pacs-welcome', surface: 'terminal', ...band() })
  expect(await again.find({ type: 'Text', text: 'Personal Agentic Core System' })).toBeDefined()
  await again.unmount()
})
