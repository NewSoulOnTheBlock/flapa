// The cat, frame by frame: pure, so the tests can step through it.
// Every glyph is ASCII, one cell wide, so the cat never jitters.
import type { BuddyActivity } from '../types'

export type Activity = BuddyActivity

/** Faces per mood-state label; the idle face when there is no mood. */
const MOOD_FACE: Record<string, string> = {
  euphoric: '^w^', hyped: '*o*', restless: 'o_o', tilted: '>_<',
  content: '^_^', focused: 'o.o', meh: '-_-', salty: '>.>',
  cozy: 'u_u', sleepy: '-.-', devastated: 'T_T',
}

const CYCLE = 32 // ticks per idle loop

/** The cat's three lines for one tick. */
export function frame(tick: number, activity: Activity, mood?: string): [string, string, string] {
  const t = ((tick % CYCLE) + CYCLE) % CYCLE
  const tail = ['~', '-', '~', '_'][Math.floor(tick / 2) % 4]!
  const ears = '  /\\_/\\'

  if (activity === 'asleep') {
    const z = ['z  ', 'zZ ', 'zZz', ' Zz', '  z', '   '][Math.floor(tick / 2) % 6]!
    return [`${ears} ${z}`, ' ( -.- )', `  > ^ <__${tick % 8 < 4 ? '' : '_'}`]
  }

  if (activity === 'working') {
    const dots = ['.  ', '.. ', '...', ' ..', '  .', '   '][tick % 6]!
    const eyes = tick % 4 < 2 ? 'o.O' : 'O.o'
    const paws = tick % 2 === 0 ? ' _>_^_<_ ' : ' _<_^_>_ '
    return [`${ears} ${dots}`, ` ( ${eyes} )`, ` ${paws}`]
  }

  // Idle: mostly still, with a blink, a double blink, a glance each way.
  const base = mood ? MOOD_FACE[mood] ?? 'o.o' : 'o.o'
  let face = ` ( ${base} )`
  if (t === 9 || t === 21 || t === 23) face = ' ( -.- )'
  else if (t >= 13 && t <= 15) face = ` (${base}  )`
  else if (t >= 16 && t <= 18) face = ` (  ${base})`
  const body = Math.floor(tick / 4) % 2 === 0 ? '  > ^ <' : '  >   <'
  return [ears, face, `${body}  ${tail}`]
}

export const NAP_AFTER_MS = 10 * 60_000

export function activityOf(isWorking: boolean, idleMs: number): Activity {
  if (isWorking) return 'working'
  return idleMs >= NAP_AFTER_MS ? 'asleep' : 'idle'
}
