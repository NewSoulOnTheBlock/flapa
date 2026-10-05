import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isAllowedDomain, parseReview, screen } from '../hooks/rules'

const FLAPA = '0xFe59B933944B4d267A14c59020C0eB19a97d7777'
const allow = { domains: ['x.com', 'flapa.xyz'], addresses: [FLAPA] }
const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const CHECK = 'mcp__guardrails__check'

test('fixed rules: holds, blocks and passes', () => {
  expect(screen('lost 47% on a frog today and i am still smiling', allow).verdict).toBe('pass')
  expect(screen('#2 on the fomo board, coming for you cosmic358 😤', allow).verdict).toBe('pass')
  expect(screen('$Flapa going to 1M mc soon', allow).verdict).toBe('hold')
  expect(screen('buy $flapa before it rips', allow).reasons).toContain('reads like a buy call')
  expect(screen('this will 100x, guaranteed', allow).reasons).toEqual(
    expect.arrayContaining(['promises an outcome', 'predicts a price']),
  )
  expect(screen('last chance to get in', allow).reasons).toContain('uses pressure to buy')
  expect(screen('dm me for the whitelist', allow).verdict).toBe('hold')
  expect(screen("i'm a real human btw", allow).verdict).toBe('block')
  expect(screen(`key: ${'ab'.repeat(32)}`, allow).verdict).toBe('block')
  expect(screen('official binance support account here', allow).verdict).toBe('block')
})

test('links and addresses: only her own pass', () => {
  expect(screen(`my CA: ${FLAPA}`, allow).verdict).toBe('pass')
  expect(screen(`my CA: ${FLAPA.toLowerCase()}`, allow).verdict).toBe('pass')
  expect(screen('new site https://www.flapa.xyz/lore', allow).verdict).toBe('pass')
  expect(screen('see https://x.com/flapakuwai/status/1', allow).verdict).toBe('pass')
  expect(screen('check 0x1111111111111111111111111111111111111111', allow).verdict).toBe('hold')
  expect(screen('see https://flapa-lore.xyz', allow).reasons).toEqual(['links to flapa-lore.xyz, not on the allow list'])
  expect(screen('go to pump.fun', allow).verdict).toBe('hold')
  expect(screen('So11111111111111111111111111111111111111112 is wrapped sol', allow).verdict).toBe('hold')
  expect(isAllowedDomain('docs.flapa.xyz', ['flapa.xyz'])).toBe(true)
  expect(isAllowedDomain('flapa.xyz.evil.com', ['flapa.xyz'])).toBe(false)
})

test('the reviewer: only a clean PASS passes', () => {
  expect(parseReview('PASS').verdict).toBe('pass')
  expect(parseReview('pass.').verdict).toBe('pass')
  expect(parseReview('HOLD: implies the price will rise')).toEqual({ verdict: 'hold', reasons: ['reviewer: implies the price will rise'] })
  expect(parseReview('PASS, though it hints at gains').verdict).toBe('hold')
  expect(parseReview('').verdict).toBe('hold')
})

function engineBeneath(on: On, review = 'PASS') {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 9, 5, 12) })
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? {
          value: {
            value: { id: 'flapa', name: 'Flapa', handle: '@flapakuwai', tagline: '', backstory: '', voice: '', values: [], taboos: ['shills'], examples: [] },
            version: 1,
          },
        }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__guardrails__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const asked: string[] = []
  on('model.complete', (_$, e) => {
    asked.push(`${e.system}\n${e.prompt}`)
    return { value: { isAnswered: true, text: review, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } as never
  })
  return { asked }
}

const start = { cwd: '/tmp/p', surface: 'terminal', isInteractive: true } as const
const verdictOf = async ($: any, text: string) =>
  JSON.parse(String((await $.tool.call({ tool: CHECK, text, by: 'x-bridge' } as never)).result)) as { verdict: string; reasons: string[] }

test('check: rules first, then the reviewer, and every attempt is logged', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)

  expect((await verdictOf($, 'gm, the charts missed you')).verdict).toBe('pass')
  expect(engine.asked).toHaveLength(1)
  expect(engine.asked[0]).toContain('breaks her own taboos')

  // A rule hit never reaches the reviewer.
  expect((await verdictOf($, 'buy this now')).verdict).toBe('hold')
  expect(engine.asked).toHaveLength(1)

  // Her own contract passes once it is on the allow list.
  expect((await verdictOf($, `CA ${FLAPA}`)).verdict).toBe('hold')
  await $.command.run({ command: 'agent', args: `allow ${FLAPA}`, ...typed })
  expect((await verdictOf($, `CA ${FLAPA}`)).verdict).toBe('pass')

  const shown = String((await $.command.run({ command: 'agent', args: 'log', ...typed })).text)
  expect(shown.split('\n')).toHaveLength(4)
  expect(shown).toContain('⋯ 0m x-bridge post: buy this now (reads like a buy call)')
})

test('the reviewer can hold what the rules pass', async ($, on) => {
  engineBeneath(on, 'HOLD: implies $Flapa is early')
  await $.session.start(start)
  const v = await verdictOf($, 'still so early on this one ngl')
  expect(v).toEqual({ verdict: 'hold', reasons: ['reviewer: implies $Flapa is early'] })
})

test('the dial: review holds everything, pause blocks everything, resume lifts it', async ($, on) => {
  engineBeneath(on)
  await $.session.start(start)

  await $.command.run({ command: 'agent', args: 'review', ...typed })
  expect((await verdictOf($, 'gm')).reasons).toEqual(['review mode: everything waits for a yes'])

  const paused = await $.command.run({ command: 'agent', args: 'pause market is wild', ...typed })
  expect(paused.text).toContain('Agent paused (market is wild)')
  expect(await verdictOf($, 'gm')).toEqual({ verdict: 'block', reasons: ['agent paused: market is wild'] })
  expect(String((await $.command.run({ command: 'agent', args: '', ...typed })).text)).toContain('⏸ paused')

  await $.command.run({ command: 'agent', args: 'resume', ...typed })
  expect((await verdictOf($, 'gm')).verdict).toBe('pass')
})
