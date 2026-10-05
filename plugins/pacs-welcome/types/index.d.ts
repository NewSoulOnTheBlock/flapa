/** A greeting the active persona gave, and whom it is from. */
export type WelcomeGreeting = { personaId: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'pacs-welcome': {
      /** True from session start until the first prompt, or after /welcome. */
      isShown: boolean
      greeting: WelcomeGreeting | null
      isGreeting: boolean
    }
  }
}
