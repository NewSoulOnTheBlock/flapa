import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { activityOf, frame } from './frames'

const FRAME_MS = 300
const MOOD = { plugin: 'mood-state', key: 'mood' } as const

const tick = atom({ plugin: 'idle-buddy', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'idle-buddy', key: 'isHidden' } as const, false)
const lastActiveAt = atom({ plugin: 'idle-buddy', key: 'lastActiveAt' } as const, 0)

/** The mood-state label for the active persona, when that mod is loaded. */
async function moodLabel($: EngineInterface): Promise<string | undefined> {
  try {
    const { value } = await $.state.get(MOOD)
    if (!value) return undefined
    const v = value.valence
    const e = value.energy
    // The same grid mood-state labels with (kept here so the cat needs no import from it).
    if (e >= 0.6) return v >= 0.5 ? 'euphoric' : v >= 0.1 ? 'hyped' : v > -0.3 ? 'restless' : 'tilted'
    if (e >= 0.3) return v >= 0.5 ? 'content' : v >= 0.1 ? 'focused' : v > -0.3 ? 'meh' : 'salty'
    return v >= 0.1 ? 'cozy' : v > -0.3 ? 'sleepy' : 'devastated'
  } catch {
    return undefined
  }
}

async function touch($: EngineInterface) {
  const now = await $.clock.now()
  await update($, lastActiveAt, () => now)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const hidden = ((await $.store.get('hidden')) as boolean | undefined) === true
    await update($, isHidden, () => hidden)
    await touch($)
    // The heartbeat of the animation: each step redraws the band.
    $.clock.every(FRAME_MS, () => {
      void (async () => {
        if (!(await read($, isHidden))) await update($, tick, n => (n + 1) % 1_000_000)
      })()
    })
    await $.command.register({ name: 'buddy', description: 'The idle cat in the bottom left: /buddy on | off' })
    return next(e)
  })

  // Anything the person or Claude does wakes the cat.
  on('prompt.submit', async ($, e, next) => {
    await touch($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await touch($)
    return next(e)
  })

  on('command.run', { command: 'buddy' }, async ($, e) => {
    const hide = e.args.trim() === 'off'
    await $.store.set('hidden', hide)
    await update($, isHidden, () => hide)
    return { text: hide ? 'Buddy is hiding. /buddy on brings it back.' : 'Buddy is back.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band; and hidden means hidden.
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, tick)
    const idleMs = (await $.clock.now()) - (await read($, lastActiveAt))
    const activity = activityOf(e.props.isWorking, idleMs)
    const [a, b, c] = frame(n, activity, await moodLabel($))
    // What the plugins beneath (and the engine) draw here, kept beside the cat.
    const beneath = await next(e)

    if (e.props.maxRows < 3) {
      return (
        <Box flexDirection="row" columnGap={1}>
          <Text dimColor>{b.trim()}</Text>
          <Box flexGrow={1}>{beneath}</Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" columnGap={1}>
        <Box key="buddy" flexDirection="column" flexShrink={0}>
          <Text dimColor={activity === 'asleep'}>{a}</Text>
          <Text dimColor={activity === 'asleep'}>{b}</Text>
          <Text dimColor={activity === 'asleep'}>{c}</Text>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          {beneath}
        </Box>
      </Box>
    )
  })
}
