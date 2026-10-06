// memory — what the mind keeps. Was PACS memory-graph: a quick model reads each turn and keeps
// what matters; recall scores words and entities and walks one hop along shared entities.
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { addMemories, normalize, parseExtraction, recall, type Memory } from '../lib/memory'

export function extractionSystem(name: string): string {
  return [
    `You keep the long-term memory of ${name}, an AI agent persona living in an always-on body.`,
    `Each exchange is one thing that happened to ${name}: the person talking to them, a heartbeat, a market`,
    'signal, a post. Extract what is worth remembering weeks from now: facts about the person and their projects,',
    `people and accounts, events, decisions, commitments, preferences, and views ${name} expressed.`,
    'Skip passing detail, raw numbers that will be stale tomorrow, and anything already obvious.',
    'Never extract credentials: keys, seed phrases, passwords, tokens.',
    'Answer with only a JSON array, at most 5 items, [] when nothing qualifies:',
    '[{"text": "one self-contained sentence", "kind": "fact|event|person|preference|decision",',
    '  "about": ["lowercase entity names: people, @handles, $tickers, projects"]}]',
  ].join('\n')
}

export function memory(body: Body): Organ {
  const store = body.store('memory')
  const key = () => `memories:${body.personaId()}`
  const list = () => store.get<Memory[]>(key(), [])
  const name = () => ((body.has('identity') ? (body.organ('identity').view?.() as any)?.active?.name : null) ?? 'the agent') as string

  return {
    name: 'memory',
    role: 'Long-term memory: extracted after every turn, recalled by words and shared entities.',
    tools: [
      {
        name: 'remember',
        description: 'Keep one thing in long-term memory on purpose.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            kind: { type: 'string', enum: ['fact', 'event', 'person', 'preference', 'decision'] },
            about: { type: 'array', items: { type: 'string' }, description: 'lowercase entities' },
          },
          required: ['text'],
        },
        run: input => {
          const m = normalize(input)
          if (!m) return 'not kept: too short, or it looks like a secret'
          const { list: next, added } = addMemories(list(), [m], Date.now())
          store.set(key(), next)
          return added ? 'kept' : 'already known: refreshed it'
        },
      },
      {
        name: 'recall',
        description: 'Search long-term memory.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        run: ({ query }) => {
          const hits = recall(list(), String(query ?? ''), 10)
          return hits.length ? hits.map(m => `- (${m.id}) ${m.text}`).join('\n') : 'nothing comes to mind'
        },
      },
      {
        name: 'forget',
        description: 'Drop one memory by id.',
        input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        run: ({ id }) => {
          const before = list()
          const after = before.filter(m => m.id !== id)
          store.set(key(), after)
          return after.length < before.length ? 'forgotten' : `no memory ${id}`
        },
      },
    ],
    sense: turn => {
      const all = list()
      const hits = recall(all, turn.stimulus.text)
      if (!hits.length) return undefined
      const ids = new Set(hits.map(m => m.id))
      store.set(key(), all.map(m => (ids.has(m.id) ? { ...m, hits: m.hits + 1 } : m)))
      return `# What you remember that may bear on this\n${hits.map(m => `- ${m.text}`).join('\n')}`
    },
    after: async (turn, result) => {
      if (!result.text && !result.tools.length) return
      const exchange = [
        `STIMULUS (${turn.stimulus.kind}${turn.stimulus.from ? ` from ${turn.stimulus.from}` : ''}):\n${turn.stimulus.text.slice(0, 3000)}`,
        result.tools.length ? `TOOLS USED: ${result.tools.map(t => `${t.name} → ${t.result.slice(0, 160)}`).join(' | ')}` : '',
        `${name().toUpperCase()}:\n${result.text.slice(0, 3000)}`,
      ].filter(Boolean).join('\n\n')
      const raw = await body.brain.quick(extractionSystem(name()), `<exchange>\n${exchange}\n</exchange>`)
      const incoming = parseExtraction(raw).map(normalize).filter((m): m is NonNullable<typeof m> => !!m)
      if (!incoming.length) return
      const { list: next, added } = addMemories(list(), incoming, Date.now())
      store.set(key(), next)
      if (added) body.bus.emit('memory.added', 'memory', { added, texts: incoming.map(m => m.text) })
    },
    view: () => {
      const all = list()
      return { count: all.length, recent: [...all].sort((a, b) => b.at - a.at).slice(0, 40) }
    },
    actions: {
      search: ({ query }) => recall(list(), String(query ?? ''), 20),
      forget: ({ id }) => { store.set(key(), list().filter(m => m.id !== id)); return { ok: true } },
    },
  }
}
