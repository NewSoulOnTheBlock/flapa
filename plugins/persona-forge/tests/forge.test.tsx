import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { QUESTIONS, parseDraft, personaFile, uniqueId } from '../hooks/forge'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = {
  component: 'Pane',
  requestId: 'forge',
  props: {
    title: 'Forge', isFocused: true, bodyColumns: 80, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
} as const

const REPLY = JSON.stringify({
  name: 'Nyx', handle: '@nyxnightshift', tagline: 'gm is a lie',
  voice: 'deadpan. lowercase.\n\nnever uses emoji.', backstory: 'born at 3am.',
  values: ['sleep is for bulls'], taboos: ['explains a joke'],
  examples: ['charts are just vibes with axes'],
  stances: [{ topic: 'gm posts', stance: 'performative', confidence: 0.8, reason: 'it is always night somewhere' }],
})

test('ids stay unique and the forge always adds the two core taboos', () => {
  expect(uniqueId('Flapa', ['flapa', 'flapa-2'])).toBe('flapa-3')
  const d = parseDraft(`sure!\n${REPLY}\n`, [], ['nyx'])
  expect(d?.id).toBe('nyx-2')
  expect(d?.handle).toBe('nyxnightshift')
  expect(d?.taboos).toHaveLength(3)
  expect(d?.taboos.join(' ')).toContain('openly an AI agent')
  expect(d?.taboos.join(' ')).toContain('not advice')
  expect(personaFile(d!)).not.toContain('stances')
  expect(parseDraft('no json here', [], [])).toBeUndefined()
})

function engineBeneath(on: On) {
  mock.store(on)
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'profiles' ? { value: { value: [], version: 1 } } : next(e),
  )
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return {
      value: { isAnswered: true, text: REPLY, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    } as never
  })
  const written: Record<string, string> = {}
  on('fs.write', (_$, e) => {
    // Paths arrive resolved: keep the part from .claude on, slashes forward.
    const forward = e.path.split('\\').join('/')
    written[forward.slice(forward.indexOf('.claude/personas/'))] = e.text
    return { value: undefined }
  })
  const commands: string[] = []
  on('command.run', (_$, e, next) => {
    if (e.command === 'persona') {
      commands.push(e.args)
      return { text: 'imported' }
    }
    return next(e)
  })
  const stances: unknown[] = []
  on('tool.call', (_$, e, next) => {
    if (e.tool === 'mcp__opinion-ledger__stance') {
      stances.push(e)
      return { result: 'ok' }
    }
    return next(e)
  })
  return { clock, asked, written, commands, stances }
}

test('interview, forge, review, save: the persona lands in persona-core with its stances', async ($, on) => {
  const engine = engineBeneath(on)
  await $.command.run({ command: 'forge', args: 'Nyx', ...typed })
  const ui = await $.ui.mount({ plugin: 'persona-forge', surface: 'terminal', ...PANE })

  // /forge Nyx pre-answers the name: the interview starts at question two.
  expect(await ui.find({ type: 'Text', text: QUESTIONS[1]!.ask })).toBeDefined()
  await ui.input({ key: 'q-1', text: '@nyxnightshift' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Text', text: QUESTIONS[1]!.ask })).toBeDefined()
  await ui.input({ key: 'q-1', text: '@nyxnightshift' })
  for (let i = 2; i < QUESTIONS.length; i++) {
    if (i === 5) await ui.press({ key: 'skip' })
    else await ui.input({ key: `q-${i}`, text: `answer ${i}` })
  }

  await ui.press({ key: 'forge' })
  await engine.clock.advance(5)
  expect(engine.asked[0]).toContain("What's the agent's name?\nNyx")
  expect(engine.asked[0]).toContain('What do they love?\n(no answer: decide)')
  expect(await ui.find({ type: 'Text', text: /charts are just vibes/ })).toBeDefined()

  await ui.press({ key: 'save' })
  await engine.clock.advance(5)
  expect(Object.keys(engine.written)).toEqual(['.claude/personas/nyx.json'])
  expect(JSON.parse(engine.written['.claude/personas/nyx.json']!).voice).toBe('deadpan. lowercase.\n\nnever uses emoji.')
  expect(engine.commands).toEqual(['import .claude/personas/nyx.json'])
  expect(engine.stances).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /saved to .claude\/personas\/nyx.json and active; 1\/1 stances seeded/ })).toBeDefined()
  await ui.unmount()
})
