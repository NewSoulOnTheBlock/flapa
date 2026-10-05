import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { add, find, setDone } from '../hooks/todo'

const PANE = {
  component: 'Pane',
  requestId: 'todo',
  props: {
    title: 'To-do',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('adding a to-do and pressing it strikes it through', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'todo-pane', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /Nothing yet/ })).toBeDefined()

  await ui.input({ key: 'add', text: 'buy milk' })
  const row = await ui.find({ type: 'Text', text: /buy milk/ })
  expect(row?.props.strikethrough).toBe(false)

  const toggle = await ui.find({ type: 'Button', text: /\[ \]/ })
  await ui.press({ key: toggle!.key! })
  const struck = await ui.find({ type: 'Text', text: /buy milk/ })
  expect(struck?.props.strikethrough).toBe(true)
  expect(await ui.find({ type: 'Button', text: /\[x\]/ })).toBeDefined()
  await ui.unmount()
})

test('the list is saved to the store for the next session', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({ plugin: 'todo-pane', surface: 'terminal', ...PANE })
  await ui.input({ key: 'add', text: 'ship it' })
  await ui.unmount()
  const again = await $.ui.mount({ plugin: 'todo-pane', surface: 'terminal', ...PANE })
  expect(await again.find({ type: 'Text', text: /ship it/ })).toBeDefined()
  await again.unmount()
})

test('list operations: add skips open duplicates, find by id, text or unique piece', () => {
  const { list } = add([], ['ship the fix', 'write the thread', 'Ship the fix'], 'agent', 1)
  expect(list.map(t => t.text)).toEqual(['ship the fix', 'write the thread'])
  expect(list[0]?.by).toBe('agent')
  const id = list[1]!.id
  expect(find(list, id)).toEqual({ ok: true, item: list[1] })
  expect(find(list, 'SHIP THE FIX')).toEqual({ ok: true, item: list[0] })
  expect(find(list, 'thread')).toEqual({ ok: true, item: list[1] })
  const ambiguous = find(list, 'the')
  expect(ambiguous.ok).toBe(false)
  expect(find(setDone(list, id, true), 'nope').ok).toBe(false)
})

const TOOL = 'mcp__todo-pane__todo'

function engineBeneath(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__todo-pane__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return clock
}

test('the agent adds steps and checks them off, and the pane shows each change as it lands', async ($, on) => {
  engineBeneath(on)
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'todo-pane', surface: 'terminal', ...PANE })
  await ui.input({ key: 'add', text: 'my own item' })

  const added = await $.tool.call({ tool: TOOL, action: 'add', items: ['read the record', 'push the fix'] } as never)
  expect(String(added.result)).toContain('Added 2.')
  // Live: the open pane already shows the new steps and what just happened.
  expect(await ui.find({ type: 'Text', text: /^push the fix$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /♥ added 2 items · just now/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 open · 0 done' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '3 open · 0 done' })).toBeDefined()

  const done = await $.tool.call({ tool: TOOL, action: 'done', item: 'read the record' } as never)
  expect(String(done.result)).toContain('Checked off "read the record"')
  expect((await ui.find({ type: 'Text', text: /^read the record$/ }))?.props.strikethrough).toBe(true)
  expect(await ui.find({ type: 'Text', text: /♥ checked off "read the record"/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 open · 1 done' })).toBeDefined()

  const vague = await $.tool.call({ tool: TOOL, action: 'done', item: 'e' } as never)
  expect((vague as { deny?: string }).deny).toContain('matches')

  const listed = await $.tool.call({ tool: TOOL, action: 'list' } as never)
  expect(String(listed.result)).toContain('- [ ] my own item')
  expect(String(listed.result)).toContain('- [x] read the record')
  await ui.unmount()
})
