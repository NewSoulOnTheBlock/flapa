export type SeedStance = { topic: string; stance: string; confidence: number; reason: string }

/** What the forge drafts: a persona-core persona plus starting stances. */
export type ForgeDraft = {
  id: string
  name: string
  handle: string
  tagline: string
  voice: string
  backstory: string
  values: string[]
  taboos: string[]
  examples: string[]
  stances: SeedStance[]
}

declare module 'claude-code' {
  interface PluginState {
    'persona-forge': {
      /** Index of the question on screen; equal to the count when all are asked. */
      step: number
      answers: string[]
      draft: ForgeDraft | null
      status: string
    }
  }
}
