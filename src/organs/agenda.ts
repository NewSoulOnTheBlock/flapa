// agenda — what the mind is working toward, and the pulse that works it. Was PACS todo-pane + heartbeat.
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { add, describe, find, remove, setDone, type Todo } from '../lib/todo'

type Heart = { isOn: boolean; everyMin: number; beats: number; lastBeatAt: number }
type Beat = { at: number; n: number; text: string }

const HEART: Heart = { isOn: false, everyMin: 60, beats: 0, lastBeatAt: 0 }

export function beatPrompt(n: number, todos: readonly Todo[]): string {
  const open = todos.filter(t => !t.isDone)
  const done = todos.filter(t => t.isDone)
  return [
    `Heartbeat #${n}. Run the loop, in order, briefly:`,
    '1. What are my goals?  2. What is my plan?',
    '3. What are the steps? Put each step of this beat on the agenda first (todo tool, action add).',
    '4. What have I done? Check it against what your tools show, not only memory.',
    '5. What should I do next? The single most valuable next step.',
    '6. Do it. Check each step off the moment it is finished (todo tool, action done).',
    '',
    open.length ? ["Goals: the open items on the agenda, in order:", ...open.map(t => `- ${t.text}`)].join('\n')
      : 'The agenda has no open items: look at your market, your posts and your memories, and pick something worth doing.',
    done.length ? ['Already done:', ...done.slice(-10).map(t => `- ${t.text}`)].join('\n') : '',
    '',
    "Never remove or rewrite the person's own items. A step you are blocked on stays open, and you say why.",
    'End with a three-line note: Done / Next / Blocked. If nothing is worth doing, say so in one line and stop.',
  ].filter(s => s !== undefined).join('\n')
}

export function agenda(body: Body): Organ {
  const store = body.store('agenda')
  const todos = () => store.get<Todo[]>('todos', [])
  const heart = () => ({ ...HEART, ...store.get<Partial<Heart>>('heart', {}) })
  const setHeart = (h: Partial<Heart>) => store.set('heart', { ...heart(), ...h })

  /** One beat at a time, whether the clock or the dashboard's button asks. */
  let beating = false
  const beat = async (): Promise<boolean> => {
    if (beating) return false
    beating = true
    try {
      const h = setHeart({ lastBeatAt: Date.now(), beats: heart().beats + 1 })
      const r = await body.think({ kind: 'beat', text: beatPrompt(h.beats, todos()), from: 'heartbeat' })
      store.update<Beat[]>('journal', [], j => [...j, { at: Date.now(), n: h.beats, text: r.text.slice(0, 2000) }].slice(-50))
      return true
    } finally {
      beating = false
    }
  }

  return {
    name: 'agenda',
    role: 'Goals and steps, worked by a heartbeat: goals → plan → steps → done → next → do it.',
    tools: [{
      name: 'todo',
      description: "Your agenda, shared live with the person. Actions: list | add (items) | done | undo | remove (ref = id or text). Only remove items you added.",
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'done', 'undo', 'remove'] },
          items: { type: 'array', items: { type: 'string' } },
          ref: { type: 'string' },
        },
        required: ['action'],
      },
      run: ({ action, items, ref }) => {
        const list = todos()
        if (action === 'list') return describe(list)
        if (action === 'add') {
          const r = add(list, Array.isArray(items) ? items.map(String) : [String(ref ?? '')], 'agent', Date.now())
          store.set('todos', r.list)
          body.bus.emit('agenda', 'agenda', { added: r.added.map(t => t.text) })
          return r.added.length ? `added ${r.added.map(t => `${t.id} "${t.text}"`).join(', ')}` : 'nothing new to add'
        }
        const f = find(list, String(ref ?? ''))
        if (!f.ok) return `error: ${f.error}`
        if (action === 'remove' && f.item.by === 'person') return "error: that is the person's item; mark it done instead"
        store.set('todos', action === 'remove' ? remove(list, f.item.id) : setDone(list, f.item.id, action === 'done'))
        body.bus.emit('agenda', 'agenda', { [String(action)]: f.item.text })
        return `${action}: ${f.item.text}`
      },
    }],
    sense: () => {
      const open = todos().filter(t => !t.isDone)
      return open.length ? `# Your agenda\n${open.map(t => `- ${t.text}`).join('\n')}` : undefined
    },
    rhythms: [{
      name: 'heartbeat',
      due: now => { const h = heart(); return h.isOn && now - h.lastBeatAt >= h.everyMin * 60_000 },
      run: beat,
    }],
    view: () => ({ todos: todos(), heart: heart(), journal: store.get<Beat[]>('journal', []).slice(-8).reverse() }),
    actions: {
      add: ({ text }) => { store.set('todos', add(todos(), [String(text ?? '')], 'person', Date.now()).list); return { ok: true } },
      toggle: ({ id }) => { const t = todos().find(x => x.id === id); if (t) store.set('todos', setDone(todos(), id, !t.isDone)); return { ok: true } },
      remove: ({ id }) => { store.set('todos', remove(todos(), id)); return { ok: true } },
      heart: ({ isOn, everyMin }) => {
        const h: Partial<Heart> = {}
        if (typeof isOn === 'boolean') { h.isOn = isOn; if (isOn) h.lastBeatAt = Date.now() }
        if (Number(everyMin) >= 5) h.everyMin = Math.round(Number(everyMin))
        return setHeart(h)
      },
      beat: () => {
        if (beating) return { ok: false, note: 'already beating' }
        void beat().catch(err => body.bus.emit('rhythm.error', 'agenda', { rhythm: 'heartbeat', error: String(err) }))
        return { ok: true }
      },
    },
  }
}
