export type MemoryKind = 'fact' | 'event' | 'person' | 'preference' | 'decision'

/** One memory. `about` names its entities: the edges recall walks along. */
export type Memory = {
  id: string
  text: string
  kind: MemoryKind
  about: string[]
  at: number
  hits: number
}

declare module 'claude-code' {
  interface PluginState {
    'memory-graph': {
      /** The active persona's memories, mirrored from the store for the pane. */
      memories: Memory[]
      /** Whose memories they are: a persona id, or "default". */
      owner: string
      /** The pane's search text. */
      query: string
    }
  }
}
