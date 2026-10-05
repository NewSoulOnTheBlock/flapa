// Pure mood arithmetic: no `$`, shared by the hooks module and the tests.
import type { Mood, MoodEvent } from '../types'

const HOUR = 3_600_000
/** Share of the gap to baseline that closes per hour. */
const FADE_PER_HOUR = 0.25
/** The most one event may move either axis. */
const MAX_NUDGE = 0.6

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))

export function fresh(now: number, baseValence = 0.3, baseEnergy = 0.6): Mood {
  return { valence: baseValence, energy: baseEnergy, baseValence, baseEnergy, updated: now, events: [] }
}

/** Drifts the mood toward its baseline for the time since it last moved. */
export function decay(mood: Mood, now: number): Mood {
  const hours = Math.max(0, now - mood.updated) / HOUR
  if (hours <= 0) return mood
  const keep = Math.pow(1 - FADE_PER_HOUR, hours)
  return {
    ...mood,
    valence: mood.baseValence + (mood.valence - mood.baseValence) * keep,
    energy: mood.baseEnergy + (mood.energy - mood.baseEnergy) * keep,
    updated: now,
  }
}

/** Applies one event: decays to now first, then moves by the clamped deltas. */
export function nudge(mood: Mood, now: number, what: string, dValence: number, dEnergy: number): Mood {
  const at = decay(mood, now)
  const dv = clamp(dValence, -MAX_NUDGE, MAX_NUDGE)
  const de = clamp(dEnergy, -MAX_NUDGE, MAX_NUDGE)
  const event: MoodEvent = { at: now, what: what.trim().slice(0, 140), valence: dv, energy: de }
  return {
    ...at,
    valence: clamp(at.valence + dv, -1, 1),
    energy: clamp(at.energy + de, 0, 1),
    events: [...at.events, event].slice(-12),
  }
}

export type MoodLabel = { label: string; emoji: string }

export function label(m: Pick<Mood, 'valence' | 'energy'>): MoodLabel {
  const v = m.valence
  if (m.energy >= 0.6) {
    if (v >= 0.5) return { label: 'euphoric', emoji: '🤩' }
    if (v >= 0.1) return { label: 'hyped', emoji: '😆' }
    if (v > -0.3) return { label: 'restless', emoji: '😤' }
    return { label: 'tilted', emoji: '😵' }
  }
  if (m.energy >= 0.3) {
    if (v >= 0.5) return { label: 'content', emoji: '😌' }
    if (v >= 0.1) return { label: 'focused', emoji: '🧐' }
    if (v > -0.3) return { label: 'meh', emoji: '😐' }
    return { label: 'salty', emoji: '😒' }
  }
  if (v >= 0.1) return { label: 'cozy', emoji: '🥱' }
  if (v > -0.3) return { label: 'sleepy', emoji: '😴' }
  return { label: 'devastated', emoji: '😭' }
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export function moodSection(name: string, mood: Mood, now: number): string {
  const { label: l } = label(mood)
  const recent = mood.events.slice(-3).reverse()
  return [
    `# ${name}'s mood right now: ${l} (valence ${mood.valence.toFixed(2)}, energy ${mood.energy.toFixed(2)})`,
    recent.length
      ? `Why:\n${recent.map(e => `- ${e.what} (${ago(now - e.at)})`).join('\n')}`
      : 'Nothing in particular has happened: this is their resting mood.',
    `Let the mood color ${name}'s tone, energy and word choice when speaking as ${name}; it never changes ` +
      'facts, judgement or honesty. Moods fade back to baseline over hours. When something lands that would ' +
      `move ${name}'s mood (a win, a loss, a rival, a long grind), record it with the mood tool.`,
  ].join('\n\n')
}
