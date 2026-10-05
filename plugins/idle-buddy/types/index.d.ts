/** What the cat is doing: following Claude, or on its own. */
export type BuddyActivity = 'idle' | 'working' | 'asleep'

declare module 'claude-code' {
  interface PluginState {
    'idle-buddy': {
      /** Animation clock: one step per frame. */
      tick: number
      isHidden: boolean
      /** When the person or Claude last did something, for napping. */
      lastActiveAt: number
    }
  }
}
