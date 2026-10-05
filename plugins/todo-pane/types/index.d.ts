export type Todo = { id: string; text: string; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    'todo-pane': { items: Todo[] }
  }
}
