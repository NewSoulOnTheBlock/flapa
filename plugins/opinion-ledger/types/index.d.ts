export type StanceChange = { stance: string; confidence: number; reason: string; at: number }

/** One held opinion. `history` holds what it was before, newest last. */
export type Opinion = {
  id: string
  topic: string
  stance: string
  /** 0 to 1. */
  confidence: number
  reason: string
  since: number
  updated: number
  history: StanceChange[]
}

declare module 'claude-code' {
  interface PluginState {
    'opinion-ledger': {
      /** The active persona's ledger, mirrored from the store for the pane. */
      ledger: Opinion[]
      /** Whose ledger it is: a persona id, or "default". */
      owner: string
    }
  }
}
