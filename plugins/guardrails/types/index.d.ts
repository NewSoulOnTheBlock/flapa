/** How much the agent does on her own: everything, nothing without a look, or nothing at all. */
export type Dial = 'auto' | 'review' | 'paused'

/** pass: goes out. hold: waits for the person. block: never goes out. */
export type Verdict = 'pass' | 'hold' | 'block'

/** One public action the agent tried, and what the screen said. */
export type AuditEntry = {
  at: number
  /** The plugin or tool that asked: x-bridge, the agent, … */
  by: string
  kind: 'post' | 'reply'
  text: string
  verdict: Verdict
  reasons: string[]
}

declare module 'claude-code' {
  interface PluginState {
    guardrails: {
      dial: Dial
      /** Why it was paused, when it is. */
      pausedWhy: string
      log: AuditEntry[]
    }
  }
}
