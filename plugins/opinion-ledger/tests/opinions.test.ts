import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applyStance, topicKey } from '../hooks/register'

const COMPOSE = {
  model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [],
  outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [],
} as const

const STANCE = 'mcp__opinion-ledger__stance'
const STANCES = 'mcp__opinion-ledger__stances'

/** The engine and persona-core beneath: `who` is the active persona, switchable. */
function engineBeneath(on: On) {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 5) })
  const who = { current: { id: 'vex', name: 'Vex' } as { id: string; name: string } | null }
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? {
          value: {
            value: who.current
              ? { ...who.current, handle: '', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] }
              : null,
            version: 1,
          },
        }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__opinion-ledger__${e.name}` } }))
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' as const }] }))
  return who
}

test('stances: new, reaffirmed, revised with history', () => {
  const a = applyStance([], { topic: 'Memecoins', stance: 'culture first', confidence: 0.7, reason: 'r1' }, 1)
  expect(a.change).toBe('new')
  const b = applyStance(a.list, { topic: 'memecoins', stance: 'Culture first', confidence: 0.9, reason: 'r2' }, 2)
  expect(b.change).toBe('reaffirmed')
  expect(b.list[0]?.history).toEqual([])
  expect(b.list[0]?.confidence).toBe(0.9)
  const c = applyStance(b.list, { topic: 'MEMECOINS', stance: 'mostly extraction', confidence: 2, reason: 'r3' }, 3)
  expect(c.change).toBe('revised')
  expect(c.list[0]?.stance).toBe('mostly extraction')
  expect(c.list[0]?.confidence).toBe(1)
  expect(c.list[0]?.history[0]).toEqual({ stance: 'culture first', confidence: 0.9, reason: 'r2', at: 1 })
  expect(topicKey('L2 fees!')).toBe('l2-fees')
})

test('the persona takes stances through the tool, and they reach the system prompt', async ($, on) => {
  engineBeneath(on)
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  const noReason = await $.tool.call({ tool: STANCE, topic: 'memecoins', stance: 'culture first', confidence: 0.7 } as never)
  expect((noReason as { deny?: string }).deny).toContain('reason')

  const took = await $.tool.call(
    { tool: STANCE, topic: 'memecoins', stance: 'culture first, utility second', confidence: 0.7, reason: 'communities outlast roadmaps' } as never,
  )
  expect(String(took.result)).toContain('Vex took a new stance on "memecoins"')

  const prompt = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'opinion-ledger:stances')
  expect(prompt?.text).toContain("# Vex's stances")
  expect(prompt?.text).toContain('- memecoins: culture first, utility second (confidence 0.7, since 2026-10-05)')

  await $.tool.call(
    { tool: STANCE, topic: 'Memecoins', stance: 'utility first', confidence: 0.6, reason: 'watched three culture coins bleed out' } as never,
  )
  const listed = await $.tool.call({ tool: STANCES, query: 'memecoins' } as never)
  expect(String(listed.result)).toContain('utility first')
  expect(String(listed.result)).toContain('was: "culture first, utility second"')
})

test('each persona keeps its own ledger', async ($, on) => {
  const who = engineBeneath(on)
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: STANCE, topic: 'gas', stance: 'too high', confidence: 0.8, reason: 'paid 40 gwei' } as never)

  who.current = { id: 'nyx', name: 'Nyx' }
  const nyx = await $.tool.call({ tool: STANCES, query: '' } as never)
  expect(String(nyx.result)).not.toContain('too high')

  who.current = { id: 'vex', name: 'Vex' }
  const vex = await $.tool.call({ tool: STANCES, query: 'gas' } as never)
  expect(String(vex.result)).toContain('too high')
})
