/** One agent persona. `id` is its slug: the key other mods scope their data by. */
export type Persona = {
  id: string
  name: string
  handle: string
  tagline: string
  backstory: string
  voice: string
  values: string[]
  taboos: string[]
  examples: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'persona-core': {
      /** The persona speaking this session, or null for plain Claude. */
      active: Persona | null
      profiles: Persona[]
    }
  }
}
