import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Todo } from '../types'

const PANE = 'todo'
const STORE_KEY = 'items'
const items = atom({ plugin: 'todo-pane', key: 'items' } as const, [])

export const register: Register = on => {
  // Restore the list saved by earlier sessions, register /todo, open the pane.
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Todo[] | undefined
    if (Array.isArray(saved)) await update($, items, () => saved)
    await $.command.register({
      name: 'todo',
      description: 'Open the to-do pane; /todo <text> adds an item',
    })
    void $.ui.open({ id: PANE, title: 'To-do' })

    return next(e)
  })

  // /todo opens the pane; /todo <text> also adds an item.
  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()
    if (text) {
      const list = await update($, items, l => [...l, { id: `${Date.now()}`, text, isDone: false }])
      await $.store.set(STORE_KEY, list)
    }
    await $.ui.open({ id: PANE, title: 'To-do', focus: true })

    return { text: text ? `Added to-do: ${text}` : 'To-do pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Every surface but mobile draws an Input; mobile adds through /todo <text>.
    const Input = 'Input' in table ? table.Input : undefined
    const list = await read($, items)
    const open = list.filter(t => !t.isDone).length

    const save = async (fn: (l: Todo[]) => Todo[]) => {
      const next = await update($, items, fn)
      await $.store.set(STORE_KEY, next)
    }

    return (
      <Box flexDirection="column">
        <Text bold>
          {open} open · {list.length - open} done
        </Text>
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
            if (text) void save(l => [...l, { id: `${Date.now()}`, text, isDone: false }])
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
              onPress={() => void save(l => l.map(o => (o.id === t.id ? { ...o, isDone: !o.isDone } : o)))}
            >
              {t.isDone ? '[x]' : '[ ]'}
            </Button>
            <Text> </Text>
            <Text strikethrough={t.isDone} dimColor={t.isDone}>
              {t.text}
            </Text>
          </Box>
        ))}
        {list.some(t => t.isDone) && (
          <Button key="clear" dimColor onPress={() => void save(l => l.filter(o => !o.isDone))}>
            clear done
          </Button>
        )}
      </Box>
    )
  })
}
