import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseToolReply, postBrief, toRows, usd } from '../hooks/fomo'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const PANE = {
  component: 'Pane', requestId: 'fomo',
  props: { title: 'FOMO', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// The shape fomo-mcp really returned for the 24h top 3 on 2026-10-05, trimmed.
const BOARD = {
  count: 3, has_more: true,
  items: [
    { rank: 1, handle: 'cosmic358', pnlUsd: 150210.94, volumeUsd: 1010971.88, trades: 222,
      topTokens: [{ token: { address: '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7', networkId: 1 }, pnlUsd: 539558.49 },
        { token: { address: 'BXoHJddsWJLHtAopeiSbKUSELsu8hSFMs8baGMDkpump', networkId: 1399811149 }, pnlUsd: 12000 }] },
    { rank: 2, handle: '000000', pnlUsd: 145006.12, volumeUsd: 7892230.98, trades: 228,
      topTokens: [{ token: { address: 'CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp', networkId: 1399811149 }, pnlUsd: 351507.57 },
        { token: { address: 'ZRO', networkId: 1337 }, pnlUsd: 75570.15 }] },
    { rank: 3, handle: 'latentvariable3', pnlUsd: 142574.85, volumeUsd: 1949336.58, trades: 453,
      topTokens: [{ token: { address: '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7', networkId: 1 }, pnlUsd: 100328.36 }] },
  ],
}
const NAMES: Record<string, string> = {
  '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7': 'IMD',
  CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp: 'CARDS',
}
const sse = (result: unknown) => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } })}\n\n`

test('replies parse from server-sent events or plain JSON, errors included', () => {
  expect(parseToolReply(sse({ a: 1 }))).toEqual({ ok: true, value: { a: 1 } })
  expect(parseToolReply(JSON.stringify({ result: { content: [{ type: 'text', text: '{"b":2}' }] } }))).toEqual({ ok: true, value: { b: 2 } })
  expect(parseToolReply(JSON.stringify({ error: { message: 'allowance used up' } }))).toEqual({ ok: false, error: 'allowance used up' })
  expect(parseToolReply(JSON.stringify({ result: { isError: true, content: [{ type: 'text', text: 'unknown handle' }] } })))
    .toEqual({ ok: false, error: 'unknown handle' })
})

test("rows carry each trader's biggest winner, named", () => {
  const rows = toRows(BOARD.items, NAMES)
  expect(rows.map(r => [r.handle, r.top?.symbol])).toEqual([['cosmic358', 'IMD'], ['000000', 'CARDS'], ['latentvariable3', 'IMD']])
  expect(usd(150210.94)).toBe('+$150.2k')
  expect(usd(-2_500_000)).toBe('-$2.50M')
})

test('the post brief states the facts and what they do not mean', () => {
  const brief = postBrief(toRows(BOARD.items, NAMES), '24h')
  expect(brief).toContain('1. cosmic358: +$150.2k PnL over 24h (222 trades); biggest winner $IMD (+$539.6k on that position)')
  expect(brief).toContain('2. 000000: +$145.0k PnL over 24h (228 trades); biggest winner $CARDS')
  expect(brief).toContain('not necessarily made in that window')
  expect(brief).toContain('No buy calls')
  expect(brief).toContain('publish it with your post tool')
})

function engineBeneath(on: On) {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  const calls: { tool: string; args: any }[] = []
  on('http.fetch', (_$, e) => {
    const body = JSON.parse(e.init!.body!)
    calls.push({ tool: body.params.name, args: body.params.arguments })
    const result = body.params.name === 'fomo_get_leaderboard'
      ? { ...BOARD, items: BOARD.items.slice(0, body.params.arguments.limit) }
      : { count: 1, items: [{ token: { symbol: NAMES[body.params.arguments.query] ?? '?' } }] }
    return { value: { status: 200, ok: true, headers: { 'content-type': 'text/event-stream' }, text: sse(result) } }
  })
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return { clock, calls, prompts }
}

const start = { cwd: '/tmp/p', surface: 'terminal', isInteractive: true } as const

test('/fomo loads the board into the tab, naming each token only once', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)
  await $.command.run({ command: 'fomo', args: '24h', ...typed })
  await engine.clock.advance(5)
  const ui = await $.ui.mount({ plugin: 'fomo', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /cosmic358/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$CARDS \+\$351\.5k/ })).toBeDefined()
  expect(engine.calls[0]).toEqual({ tool: 'fomo_get_leaderboard', args: { window: '24h', limit: 10, response_format: 'json' } })
  // IMD appears twice but is looked up once; ZRO is short enough to stand as its own name.
  expect(engine.calls.filter(c => c.tool === 'fomo_search_tokens')).toHaveLength(2)

  await $.command.run({ command: 'fomo', args: '', ...typed })
  await engine.clock.advance(5)
  expect(engine.calls.filter(c => c.tool === 'fomo_search_tokens')).toHaveLength(2)
  await ui.unmount()
})

test('/fomo post pulls the top 3 and hands the agent a brief to post from', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)
  const r = await $.command.run({ command: 'fomo', args: 'post', ...typed })
  expect(r.text).toContain('will write and post')
  await engine.clock.advance(5)
  expect(engine.calls[0]?.args.limit).toBe(3)
  expect(engine.prompts).toHaveLength(1)
  expect(engine.prompts[0]).toContain('3. latentvariable3: +$142.6k PnL over 24h')
})
