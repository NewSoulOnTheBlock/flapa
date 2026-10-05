export type MoodEvent = { at: number; what: string; valence: number; energy: number }

/** Valence -1 (miserable) to 1 (elated); energy 0 (drained) to 1 (wired). */
export type Mood = {
  valence: number
  energy: number
  baseValence: number
  baseEnergy: number
  updated: number
  events: MoodEvent[]
}

declare module 'claude-code' {
  interface PluginState {
    'mood-state': {
      mood: Mood
      /** Whose mood it is: a persona id, or "default". */
      owner: string
    }
  }
}
