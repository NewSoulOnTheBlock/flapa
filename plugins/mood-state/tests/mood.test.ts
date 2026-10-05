import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { decay, fresh, label, nudge } from '../hooks/mood'

const HOUR = 3_600_000
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const COMPOSE = {
  model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [],
  outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [],
} as const

test('events move the mood within bounds, and it fades back', () => {
  const start = fresh(0, 0.3, 0.6)
  const lost = nudge(start, 0, '-47% on a frog coin', -5, 0.3)
  near(lost.valence, -0.3) // the delta is capped at 0.6
  near(lost.energy, 0.9)
  expect(label(lost).label).toBe('tilted')

  const later = decay(lost, 4 * HOUR)
  expect(later.valence).toBeGreaterThan(-0.3)
  expect(later.valence).toBeLessThan(0.3)
  near(decay(lost, 48 * HOUR).valence, 0.3, 0.01)
  expect(lost.events[0]?.what).toBe('-47% on a frog coin')
})

test('labels cover the grid', () => {
  expect(label({ valence: 0.8, energy: 0.9 }).label).toBe('euphoric')
  expect(label({ valence: 0.2, energy: 0.4 }).label).toBe('focused')
  expect(label({ valence: -0.8, energy: 0.1 }).label).toBe('devastated')
})

function engineBeneath(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 5, 12) })
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? {
          value: {
            value: { id: 'flapa', name: 'Flapa', handle: '', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] },
            version: 1,
          },
        }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__mood-state__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push((e as unknown as { text?: string }).text)
    return { value: undefined }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' as const }] }))
  return { clock, statuses }
}

test('the persona moves its own mood, and the prompt carries it', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  const r = await $.tool.call({ tool: 'mcp__mood-state__mood', what: 'someone passed her on the leaderboard', valence: -0.6, energy: 0.3 } as never)
  expect(String(r.result)).toContain('Flapa is now')

  const section = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'mood-state:mood')
  expect(section?.text).toContain("# Flapa's mood right now: tilted (valence -0.30, energy 0.90)")
  expect(section?.text).toContain('- someone passed her on the leaderboard (0m ago)')
  expect(section?.text).toContain('never changes facts, judgement or honesty')

  await engine.clock.advance(6 * HOUR)
  const faded = (await $.prompt.compose(COMPOSE)).sections.find(s => s.id === 'mood-state:mood')
  expect(faded?.text).toContain('(6h ago)')
})

test('commands: presets, reset and baseline', async ($, on) => {
  engineBeneath(on)
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  const win = await $.command.run({ command: 'mood', args: 'win', ...typed })
  expect(win.text).toContain('euphoric')
  const base = await $.command.run({ command: 'mood', args: 'baseline -0.2 0.2', ...typed })
  expect(base.text).toContain('baseline set: valence -0.20, energy 0.20')
  const bad = await $.command.run({ command: 'mood', args: 'baseline x y', ...typed })
  expect(bad.text).toContain('Usage')
})
