import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addMemories, isSecret, parseExtraction, recall } from '../hooks/memory'
import type { Memory } from '../types'

const REMEMBER = 'mcp__memory-graph__remember'
const RECALL = 'mcp__memory-graph__recall'

function mem(id: string, text: string, about: string[], at = 1): Memory {
  return { id, text, kind: 'fact', about, at, hits: 0 }
}

test('recall scores words and entities, then hops one link', () => {
  const list = [
    mem('a', 'Kelby launched SprotoPad on mainnet', ['sprotopad', 'kelby']),
    mem('b', 'SprotoPad fees route to the deployer after bonding', ['sprotopad']),
    mem('c', 'The deployer wallet is a hardware wallet', ['deployer wallet', 'sprotopad']),
    mem('d', 'Nyx dislikes airdrops', ['nyx']),
  ]
  const found = recall(list, 'what happened with sprotopad launch?', 1)
  expect(found[0]?.id).toBe('a')
  // b and c share the entity "sprotopad": one hop brings them in.
  expect(found.map(m => m.id)).toContain('b')
  expect(found.map(m => m.id)).not.toContain('d')
  expect(recall(list, 'the and with')).toEqual([])
})

test('near-duplicates fold into the memory already held', () => {
  const first = addMemories([], [{ text: 'Vex thinks L2 fees are too high for memecoins', kind: 'fact', about: ['vex'] }], 1)
  const again = addMemories(first.list, [{ text: 'Vex thinks L2 fees are too high for memecoins.', kind: 'fact', about: ['l2'] }], 2)
  expect(again.added).toBe(0)
  expect(again.list).toHaveLength(1)
  expect(again.list[0]?.about).toEqual(['vex', 'l2'])
  expect(again.list[0]?.at).toBe(2)
})

test('credentials are never memories, prose is', () => {
  expect(isSecret(`key 0x${'ab'.repeat(32)}`)).toBe(true)
  expect(isSecret('abandon ability able about above absent absorb abstract absurd abuse access accident')).toBe(true)
  expect(isSecret('password: hunter2')).toBe(true)
  expect(isSecret('kelby wants the launch thread drafted before friday and the deploy checked with the team first')).toBe(false)
})

test('extraction output is parsed leniently', () => {
  expect(parseExtraction('Here you go:\n[{"text":"x"}]\nthanks')).toEqual([{ text: 'x' }])
  expect(parseExtraction('no json')).toEqual([])
})

function engineBeneath(on: On, reply: string) {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5) })
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? {
          value: {
            value: { id: 'vex', name: 'Vex', handle: '', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] },
            version: 1,
          },
        }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__memory-graph__${e.name}` } }))
  on('ui.status', () => ({ value: undefined }))
  const submitted: { text: string; context: readonly string[] }[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: reply,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    } as never
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  return { clock, submitted, asked }
}

const turn = (answer: string) =>
  ({ answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' }) as const

test('a finished turn becomes memories, recalled on the next related prompt', async ($, on) => {
  const engine = engineBeneath(
    on,
    '[{"text":"Kelby is launching $VEX on Robinhood Chain next week","kind":"event","about":["kelby","$vex","robinhood chain"]},' +
      '{"text":"my seed phrase is abandon ability able about above absent absorb abstract absurd abuse access accident","kind":"fact","about":[]}]',
  )
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'we launch $VEX on robinhood chain next week', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(turn('noted. ship before you shill.') as never)
  await engine.clock.advance(5)
  expect(engine.asked[0]).toContain('we launch $VEX')

  const all = await $.tool.call({ tool: RECALL, query: '$vex launch' } as never)
  expect(String(all.result)).toContain('Kelby is launching $VEX on Robinhood Chain next week')
  expect(String(all.result)).not.toContain('seed phrase')

  await $.prompt.submit({ text: 'how should we hype the $vex launch?', wait: false, origin: { kind: 'composer' } })
  const last = engine.submitted[engine.submitted.length - 1]
  expect(last?.context.join('\n')).toContain('Memories Vex recalls')
  expect(last?.context.join('\n')).toContain('$VEX on Robinhood Chain')
})

test('remember refuses credentials; auto extraction can be switched off', async ($, on) => {
  const engine = engineBeneath(on, '[{"text":"should not be stored at all","kind":"fact","about":[]}]')
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  const refused = await $.tool.call({ tool: REMEMBER, text: `deployer key 0x${'cd'.repeat(32)}` } as never)
  expect((refused as { deny?: string }).deny).toContain('credential')
  const kept = await $.tool.call({ tool: REMEMBER, text: 'Kelby prefers app-side features over new contracts', about: ['kelby'] } as never)
  expect(String(kept.result)).toContain('Vex will remember that')

  await $.command.run({
    command: 'memory', args: 'auto off',
    origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 },
  })
  await $.prompt.submit({ text: 'anything', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(turn('ok') as never)
  await engine.clock.advance(5)
  expect(engine.asked).toHaveLength(0)
})

test('a turn that ran tools is engineering: the persona is kept out of its memories', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? { value: { value: { id: 'vex', name: 'Vex', handle: '', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] }, version: 1 } }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__memory-graph__${e.name}` } }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e, next) => (e.tool === 'Read' ? { result: 'file text' } as never : next(e)))
  const systems: string[] = []
  on('model.complete', (_$, e) => {
    systems.push(e.system ?? '')
    return { value: { isAnswered: true, text: '[]', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  const done = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

  await $.prompt.submit({ text: 'make the cat use ascii', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Read', file_path: 'x' } as never)
  await $.turn.complete({ ...done, answer: 'done, ascii only' } as never)
  await clock.advance(5)
  expect(systems[0]).toContain('THIS TURN WAS ENGINEERING WORK')

  await $.prompt.submit({ text: 'hi vex', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ ...done, answer: 'gm' } as never)
  await clock.advance(5)
  expect(systems[1]).not.toContain('THIS TURN WAS ENGINEERING WORK')
})
