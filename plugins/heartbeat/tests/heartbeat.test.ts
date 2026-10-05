import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const MIN = 60_000
const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test('/heartbeat now submits the six-step loop', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  const ran = await $.command.run({ command: 'heartbeat', args: 'now', ...typed })
  expect(ran.text).toContain('Beating now')
  await clock.advance(1)
  expect(sent.length).toBe(1)
  for (const step of ['What are my goals?', 'What is my plan?', 'What are the steps?',
    'What have I done?', 'What should I do next?', 'Do it.']) {
    expect(sent[0]).toContain(step)
  }
})

test('goals set by command ride along in the beat', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'heartbeat', args: 'goals ship SprotoPad v2', ...typed })
  await $.command.run({ command: 'heartbeat', args: 'now', ...typed })
  await clock.advance(1)
  expect(sent[0]).toContain('ship SprotoPad v2')
})

test('the timer beats once an hour, not before', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })

  await clock.advance(MIN) // first tick starts the rhythm
  await clock.advance(58 * MIN)
  expect(sent.length).toBe(0)
  await clock.advance(2 * MIN)
  expect(sent.length).toBe(1)
})

test('off stops the beat', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '/tmp/project', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'heartbeat', args: 'off', ...typed })
  await clock.advance(3 * 60 * MIN)
  expect(sent.length).toBe(0)
})

/** Stands in for the todo-pane plugin's session state. */
function todoList(on: On, items: { id: string; text: string; isDone: boolean }[]) {
  on('state.get', (_$, e, next) =>
    e.plugin === 'todo-pane' && e.key === 'items' ? { value: { value: items, version: 1 } } : next(e),
  )
}

test('the beat takes its goals from the to-do list', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  todoList(on, [
    { id: '1', text: 'ship SprotoPad v2', isDone: false },
    { id: '2', text: 'write the launch thread', isDone: false },
    { id: '3', text: 'audit the fee router', isDone: true },
  ])
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.command.run({ command: 'heartbeat', args: 'now', ...typed })
  await clock.advance(1)
  expect(sent[0]).toContain("open items on the person's to-do list")
  expect(sent[0]).toContain('- ship SprotoPad v2')
  expect(sent[0]).toContain('- write the launch thread')
  expect(sent[0]).toContain('Already checked off')
  expect(sent[0]).toContain('- audit the fee router')
  const beat = sent[0] ?? ''
  expect(beat.indexOf('ship SprotoPad v2')).toBeLessThan(beat.indexOf('write the launch thread'))

  const status = await $.command.run({ command: 'heartbeat', args: '', ...typed })
  expect(status.text).toContain('2 open (ship SprotoPad v2; write the launch thread), 1 done')
})

test('an empty to-do list falls back to the log file', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  todoList(on, [])
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run({ command: 'heartbeat', args: 'now', ...typed })
  await clock.advance(1)
  expect(sent[0]).toContain('no open items')
  expect(sent[0]).toContain('.claude/heartbeat.md')
})
