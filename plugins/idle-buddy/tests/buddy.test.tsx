import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NAP_AFTER_MS, activityOf, frame } from '../hooks/frames'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const band = (isWorking: boolean, maxRows = 8) =>
  ({
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows, bodyColumns: 100, scroll: { offset: 0, bodyRows: maxRows }, view: {} },
  }) as const

test('every frame is three lines of single-cell ASCII', () => {
  for (const activity of ['idle', 'working', 'asleep'] as const) {
    for (let t = 0; t < 64; t++) {
      const lines = frame(t, activity, t % 2 ? 'tilted' : undefined)
      expect(lines).toHaveLength(3)
      for (const line of lines) expect(/^[\x20-\x7e]*$/.test(line)).toBe(true)
    }
  }
})

test('idle blinks and glances; mood picks the face', () => {
  expect(frame(0, 'idle')[1]).toBe(' ( o.o )')
  expect(frame(9, 'idle')[1]).toBe(' ( -.- )')
  expect(frame(13, 'idle')[1]).toBe(' (o.o  )')
  expect(frame(16, 'idle')[1]).toBe(' (  o.o)')
  expect(frame(0, 'idle', 'tilted')[1]).toBe(' ( >_< )')
  expect(frame(0, 'idle', 'devastated')[1]).toBe(' ( T_T )')
})

test('it works while Claude works and naps when nothing happens', () => {
  expect(activityOf(true, NAP_AFTER_MS * 2)).toBe('working')
  expect(activityOf(false, NAP_AFTER_MS - 1)).toBe('idle')
  expect(activityOf(false, NAP_AFTER_MS)).toBe('asleep')
  expect(frame(4, 'asleep')[0]).toContain('zZz')
})

function engineBeneath(on: On) {
  mock.store(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return clock
}

test('the band draws the cat, animates on the clock, and keeps what is beneath', async ($, on) => {
  const clock = engineBeneath(on)
  // Something beneath draws in the band too: it must survive beside the cat.
  on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return <Text>beneath</Text>
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'idle-buddy', surface: 'terminal', ...band(false) })
  expect(await ui.find({ type: 'Text', text: '  /\\_/\\' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'beneath' })).toBeDefined()

  await clock.advance(9 * 300)
  expect(await ui.find({ type: 'Text', text: ' ( -.- )' })).toBeDefined()
  await ui.unmount()

  const busy = await $.ui.mount({ plugin: 'idle-buddy', surface: 'terminal', ...band(true) })
  expect(await busy.find({ type: 'Text', text: /\( (o\.O|O\.o) \)/ })).toBeDefined()
  await busy.unmount()
})

test('/buddy off hides it and the band falls through', async ($, on) => {
  engineBeneath(on)
  // Stands in for the engine's own band beneath.
  on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'buddy', args: 'off', ...typed })
  const ui = await $.ui.mount({ plugin: 'idle-buddy', surface: 'terminal', ...band(false) })
  expect(await ui.find({ type: 'Text', text: /\/\\_\/\\/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  await ui.unmount()
})
