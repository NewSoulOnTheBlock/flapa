// Pure list operations: no `$`, shared by the hooks module and the tests.
import type { Todo } from '../types'

export type Found = { ok: true; item: Todo } | { ok: false; error: string }

/** Finds one item by id, by exact text (any case), or by a unique piece of its text. */
export function find(list: readonly Todo[], ref: string): Found {
  const q = ref.trim().toLowerCase()
  if (!q) return { ok: false, error: 'name the item by id or text' }
  const byId = list.find(t => t.id === ref.trim())
  if (byId) return { ok: true, item: byId }
  const exact = list.filter(t => t.text.toLowerCase() === q)
  if (exact.length === 1) return { ok: true, item: exact[0]! }
  const partial = list.filter(t => t.text.toLowerCase().includes(q))
  if (partial.length === 1) return { ok: true, item: partial[0]! }
  if (partial.length === 0) return { ok: false, error: `no item matches "${ref}"` }
  return { ok: false, error: `"${ref}" matches ${partial.length} items: ${partial.map(t => `${t.id} "${t.text}"`).join(', ')}` }
}

/** Adds items, skipping any already open with the same text. */
export function add(list: readonly Todo[], texts: readonly string[], by: Todo['by'], now: number): { list: Todo[]; added: Todo[] } {
  const next = [...list]
  const added: Todo[] = []
  texts.map(t => t.trim()).filter(Boolean).forEach((text, i) => {
    if (next.some(t => !t.isDone && t.text.toLowerCase() === text.toLowerCase())) return
    const item: Todo = { id: `${now.toString(36)}${i}`, text, isDone: false, by }
    next.push(item)
    added.push(item)
  })
  return { list: next, added }
}

export function setDone(list: readonly Todo[], id: string, isDone: boolean): Todo[] {
  return list.map(t => (t.id === id ? { ...t, isDone } : t))
}

export function remove(list: readonly Todo[], id: string): Todo[] {
  return list.filter(t => t.id !== id)
}

/** The list as the agent reads it. */
export function describe(list: readonly Todo[]): string {
  if (!list.length) return 'The to-do list is empty.'
  const open = list.filter(t => !t.isDone)
  const done = list.filter(t => t.isDone)
  const row = (t: Todo) => `- [${t.isDone ? 'x' : ' '}] ${t.text} (id ${t.id}${t.by === 'agent' ? ', added by agent' : ''})`
  return [
    `${open.length} open, ${done.length} done.`,
    ...open.map(row),
    ...(done.length ? ['done:', ...done.map(row)] : []),
  ].join('\n')
}
