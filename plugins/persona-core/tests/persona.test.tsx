import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { personaSection, blank, slug } from '../hooks/register'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const COMPOSE = {
  model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [],
  outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [],
} as const

const PANE = {
  component: 'Pane',
  requestId: 'persona',
  props: {
    title: 'Persona', isFocused: true, bodyColumns: 60, placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 }, view: {},
  },
} as const

function engineBeneath(on: On) {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' as const }] }))
}

test('slugs and blank personas', () => {
  expect(slug('  Vex the Oracle! ')).toBe('vex-the-oracle')
  expect(blank('vex', 'Vex').values).toEqual([])
})

test('no persona: the system prompt is untouched', async ($, on) => {
  engineBeneath(on)
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.id)).toEqual(['base'])
})

test('a persona built by command rides in the system prompt', async ($, on) => {
  engineBeneath(on)
  await $.command.run({ command: 'persona', args: 'new Vex', ...typed })
  await $.command.run({ command: 'persona', args: 'set handle vexonchain', ...typed })
  await $.command.run({ command: 'persona', args: 'set voice dry, terse, lowercase, never uses emoji', ...typed })
  await $.command.run({ command: 'persona', args: 'add values ship before you shill', ...typed })
  await $.command.run({ command: 'persona', args: 'add taboos promise anyone returns', ...typed })

  const composed = await $.prompt.compose(COMPOSE)
  const section = composed.sections.find(s => s.id === 'persona-core:identity')
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('# Agent persona: Vex (@vexonchain)')
  expect(section?.text).toContain('dry, terse, lowercase')
  expect(section?.text).toContain('- ship before you shill')
  expect(section?.text).toContain('Vex never:\n- promise anyone returns')
  expect(section?.text).toContain('never claims to be human')
  // The engine's own sections stay first, untouched.
  expect(composed.sections[0]?.id).toBe('base')

  await $.command.run({ command: 'persona', args: 'off', ...typed })
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['base'])
  await $.command.run({ command: 'persona', args: 'use vex', ...typed })
  expect((await $.prompt.compose(COMPOSE)).sections.length).toBe(2)
})

test('the pane creates, edits and trims a persona', async ($, on) => {
  engineBeneath(on)
  const ui = await $.ui.mount({ plugin: 'persona-core', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /No personas yet/ })).toBeDefined()

  await ui.input({ key: 'new', text: 'Nyx' })
  await ui.input({ key: 'f-tagline', text: 'the night shift of the timeline' })
  await ui.input({ key: 'add-examples', text: 'gm is a lie. it is always night somewhere.' })
  await ui.input({ key: 'add-examples', text: 'charts are just vibes with axes.' })
  expect(await ui.find({ type: 'Text', text: /charts are just vibes/ })).toBeDefined()

  await ui.press({ key: 'rm-examples-1' })
  expect(await ui.find({ type: 'Text', text: /charts are just vibes/ })).toBeUndefined()

  const section = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'persona-core:identity')
  expect(section?.text).toContain('Tagline: the night shift of the timeline')
  expect(section?.text).toContain('> gm is a lie.')
  await ui.unmount()
})

test('personaSection leaves out empty parts', () => {
  const text = personaSection(blank('kit', 'Kit'))
  expect(text).not.toContain('Voice:')
  expect(text).not.toContain('never:\n')
})

test('import reads a whole persona file; set keeps line breaks', async ($, on) => {
  engineBeneath(on)
  const file = JSON.stringify({
    name: 'Flapa', handle: '@flapakuwai', tagline: "i'm gonna be the best!",
    voice: 'bubbly chart nerd.\n\nlowercase, occasional ALL CAPS.', backstory: 'born in a trading terminal.',
    values: ['winning'], taboos: ['claims to be human'], examples: [], bogus: 'ignored',
  })
  on('fs.read', (_$, e) => (e.path.endsWith('flapa.json') ? { value: file } : { deny: 'no such file' }))

  const r = await $.command.run({ command: 'persona', args: 'import .claude/personas/flapa.json', ...typed })
  expect(r.text).toContain('Imported Flapa (flapa)')
  const section = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'persona-core:identity')
  expect(section?.text).toContain('# Agent persona: Flapa (@flapakuwai)')
  expect(section?.text).toContain('bubbly chart nerd.\n\nlowercase')
  expect(section?.text).not.toContain('bogus')

  await $.command.run({ command: 'persona', args: 'set backstory line one\n\nline two', ...typed })
  const again = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'persona-core:identity')
  expect(again?.text).toContain('Backstory:\nline one\n\nline two')

  const missing = await $.command.run({ command: 'persona', args: 'import nope.json', ...typed })
  expect(missing.text).toContain('Could not read nope.json')
})

test('the update tool edits the active persona', async ($, on) => {
  engineBeneath(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__persona-core__${e.name}` } }))
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  const none = await $.tool.call({ tool: 'mcp__persona-core__update', set: { voice: 'x' } } as never)
  expect((none as { deny?: string }).deny).toContain('No active persona')

  await $.command.run({ command: 'persona', args: 'new Flapa', ...typed })
  await $.command.run({ command: 'persona', args: 'add values winning', ...typed })
  const r = await $.tool.call({
    tool: 'mcp__persona-core__update',
    set: { handle: '@flapakuwai' },
    add: { examples: ['the chart says no. the frog says yes. i am listening to the frog'] },
    remove: { values: ['winning'] },
  } as never)
  expect(String(r.result)).toBe('Flapa: set handle, removed 1 from values, added 1 to examples.')
  const section = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'persona-core:identity')
  expect(section?.text).toContain('(@flapakuwai)')
  expect(section?.text).toContain('> the chart says no.')
  expect(section?.text).not.toContain('Values and convictions')
})

function startBeneath(on: On, store: Record<string, unknown>) {
  mock.store(on, store)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__persona-core__${e.name}` } }))
  return opened
}
const start = { cwd: '/tmp/p', surface: 'terminal', isInteractive: true } as const

test('the Persona tab comes back next session when it was left open', async ($, on) => {
  const opened = startBeneath(on, { paneOpen: true })
  await $.session.start(start)
  expect(opened).toContain('persona')
})

test('a tab the person closed stays closed', async ($, on) => {
  const opened = startBeneath(on, { paneOpen: false })
  await $.session.start(start)
  expect(opened).not.toContain('persona')
})

test('opening the tab by command is what gets remembered', async ($, on) => {
  const opened = startBeneath(on, {})
  await $.session.start(start)
  expect(opened).not.toContain('persona')
  await $.command.run({ command: 'persona', args: '', ...typed })
  opened.length = 0
  await $.session.start(start)
  expect(opened).toContain('persona')
})
