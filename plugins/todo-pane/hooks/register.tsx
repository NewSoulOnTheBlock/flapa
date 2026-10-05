import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Todo } from '../types'
import { add, describe, find, remove, setDone } from './todo'

const PANE = 'todo'
const TOOL = 'mcp__todo-pane__todo'
const STORE_KEY = 'items'
const items = atom({ plugin: 'todo-pane', key: 'items' } as const, [])
const activity = atom({ plugin: 'todo-pane', key: 'activity' } as const, null)

/** Every write goes to state (the pane redraws at once) and to the store. */
async function save($: EngineInterface, fn: (l: Todo[]) => Todo[]): Promise<Todo[]> {
  const next = await update($, items, fn)
  await $.store.set(STORE_KEY, next)
  return next
}

async function note($: EngineInterface, text: string) {
  const at = await $.clock.now()
  await update($, activity, () => ({ text, at }))
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

export const register: Register = on => {
  // Restore the list saved by earlier sessions, register /todo and the tool, open the pane.
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Todo[] | undefined
    if (Array.isArray(saved)) await update($, items, () => saved)
    await $.command.register({
      name: 'todo',
      description: 'Open the to-do pane; /todo <text> adds an item',
    })
    await $.tool.register({
      name: 'todo',
      description:
        "Read and update the person's to-do list, which they watch live in the To-do pane. Add the steps you " +
        'plan to take, and mark each one done the moment it is finished, so progress shows as it happens. ' +
        "Items are named by id or by their text. Never remove or rewrite the person's own items unless asked.",
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'done', 'undo', 'remove'] },
          items: { type: 'array', items: { type: 'string' }, description: 'add: the texts to add' },
          item: { type: 'string', description: 'done / undo / remove: the id or text of one item' },
        },
        required: ['action'],
      },
    })
    void $.ui.open({ id: PANE, title: 'To-do' })

    return next(e)
  })

  // /todo opens the pane; /todo <text> also adds an item.
  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()
    if (text) await save($, l => add(l, [text], 'person', Date.now()).list)
    await $.ui.open({ id: PANE, title: 'To-do', focus: true })

    return { text: text ? `Added to-do: ${text}` : 'To-do pane opened.' }
  })

  // The agent's hands on the list: each call lands in the pane as it happens.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { action?: string; items?: string[]; item?: string }
    const list = await read($, items)
    void $.ui.open({ id: PANE, title: 'To-do' })

    switch (input.action) {
      case 'list':
        return { result: describe(list) }
      case 'add': {
        const texts = (input.items ?? (input.item ? [input.item] : [])).filter(t => typeof t === 'string')
        if (!texts.length) return { deny: 'add needs items: the texts to add' }
        const { list: grown, added } = add(list, texts, 'agent', await $.clock.now())
        const next = await save($, () => grown)
        await note($, added.length === 1 ? `added "${added[0]!.text}"` : `added ${added.length} items`)
        return { result: `${added.length ? `Added ${added.length}.` : 'Already on the list.'}\n${describe(next)}` }
      }
      case 'done':
      case 'undo':
      case 'remove': {
        const found = find(list, input.item ?? '')
        if (!found.ok) return { deny: found.error }
        const { item } = found
        const next = await save($, l =>
          input.action === 'remove' ? remove(l, item.id) : setDone(l, item.id, input.action === 'done'),
        )
        const verb = input.action === 'done' ? 'checked off' : input.action === 'undo' ? 'reopened' : 'removed'
        await note($, `${verb} "${item.text}"`)
        return { result: `${verb[0]!.toUpperCase()}${verb.slice(1)} "${item.text}".\n${describe(next)}` }
      }
      default:
        return { deny: 'action is one of list, add, done, undo, remove' }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Every surface but mobile draws an Input; mobile adds through /todo <text>.
    const Input = 'Input' in table ? table.Input : undefined
    const list = await read($, items)
    const last = await read($, activity)
    // The clock only matters when there is a change to date.
    const now = last ? await $.clock.now() : 0
    const open = list.filter(t => !t.isDone).length

    return (
      <Box flexDirection="column">
        <Text bold>
          {open} open · {list.length - open} done
        </Text>
        {last && now - last.at < 30 * 60_000 && (
          <Text color="magenta">
            ♥ {last.text} · {ago(now - last.at)}
          </Text>
        )}
        {Input ? (
          <Input
            key="add"
            label="+ "
            placeholder="add a to-do, Enter to save"
            submitLabel="add"
            value=""
            autoFocus
            onSubmit={(value: string) => {
              const text = value.trim()
              if (text) void save($, l => add(l, [text], 'person', Date.now()).list)
            }}
          />
        ) : (
          <Text dimColor>Add with /todo &lt;text&gt;</Text>
        )}
        {list.length === 0 && <Text dimColor>Nothing yet.</Text>}
        {list.map(t => (
          <Box key={`row-${t.id}`} flexDirection="row">
            <Button
              key={`toggle-${t.id}`}
              plain
              onPress={() => void save($, l => setDone(l, t.id, !t.isDone))}
            >
              {t.isDone ? '[x]' : '[ ]'}
            </Button>
            <Text> </Text>
            <Text strikethrough={t.isDone} dimColor={t.isDone}>
              {t.text}
            </Text>
            {t.by === 'agent' && <Text dimColor> ♥</Text>}
          </Box>
        ))}
        {list.some(t => t.isDone) && (
          <Button key="clear" dimColor onPress={() => void save($, l => l.filter(o => !o.isDone))}>
            clear done
          </Button>
        )}
      </Box>
    )
  })
}
