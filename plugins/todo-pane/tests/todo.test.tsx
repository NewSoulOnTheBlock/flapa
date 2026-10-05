import { test, expect, mock } from 'claude-code/testing'

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
