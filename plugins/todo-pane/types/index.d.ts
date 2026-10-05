export type Todo = {
  id: string
  text: string
  isDone: boolean
  /** Who put it on the list: the person, or the agent through the todo tool. */
  by?: 'person' | 'agent'
}

/** The latest change the agent made, shown live at the top of the pane. */
export type TodoActivity = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'todo-pane': { items: Todo[]; activity: TodoActivity | null }
  }
}
