// memory — what the mind keeps. Two backends behind one organ:
//   mem0 (when main passes a client, i.e. MEM0_API_KEY is set): every turn goes to mem0, which extracts,
//     dedupes and updates memories itself; recall is mem0's semantic search. People she meets on X are
//     scoped by user_id "x:<handle>" so each account has its own memories.
//   local (no key): was PACS memory-graph, a quick model extracts each turn; recall scores words and walks
//     one hop along shared entities. Also the source of the one-time migration into mem0.
import type { Body } from '../core/body'
import type { Organ, Turn, TurnResult } from '../core/types'
import type { Mem0, Mem0Hit } from '../lib/mem0'
import { addMemories, normalize, parseExtraction, recall, type Memory } from '../lib/memory'

const SYNC_EVERY_MS = 10 * 60_000
/** Never sent to mem0, whatever the turn was about. */
const SECRET = /\b(?:0x)?[0-9a-f]{64}\b|\b(?:seed|recovery) phrase\b|\bprivate key\b|\bm0-[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9-]{20,}/i

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

export type MemoryOrgan = Organ & {
  settled(): Promise<void>
  /** What she remembers about an account on X (mem0 only; [] otherwise). */
  aboutPerson(handle: string, query: string): Promise<string[]>
  /** Keeps an exchange with an account on X under that account. */
  notePerson(handle: string, theirs: string, hers: string): Promise<void>
}

export const personId = (handle: string) => `x:${handle.replace(/^@/, '').toLowerCase()}`

export function memory(body: Body, opts: { mem0?: Mem0 | null } = {}): MemoryOrgan {
  const store = body.store('memory')
  const mem0 = opts.mem0 ?? null
  const key = () => `memories:${body.personaId()}`
  const list = () => store.get<Memory[]>(key(), [])
  const agent = () => body.personaId()
  const name = () => ((body.has('identity') ? (body.organ('identity').view?.() as any)?.active?.name : null) ?? 'the agent') as string
  const inFlight = new Set<Promise<unknown>>()
  const track = (job: Promise<unknown>) => {
    const j = job.catch(err => { body.bus.emit('organ.error', 'memory', String(err).slice(0, 200)) })
    inFlight.add(j)
    void j.finally(() => inFlight.delete(j))
  }
  const lines = (hits: Mem0Hit[]) => hits.map(h => `- (${h.id}) ${h.memory}`).join('\n')

  /** Pulls the newest memories for the dashboard, and moves local memories into mem0 once. */
  async function sync(): Promise<void> {
    if (!mem0) return
    store.set('syncAt', Date.now())
    const migrated = store.get<Record<string, boolean>>('migrated', {})
    if (!migrated[agent()] && list().length) {
      for (const m of list()) await mem0.add(m.text, { agent_id: agent() }, { infer: false, metadata: { kind: m.kind, about: m.about, migrated: true } })
      store.set('migrated', { ...migrated, [agent()]: true })
      body.bus.emit('memory.migrated', 'memory', { count: list().length })
    }
    store.set('mem0Recent', (await mem0.list({ agent_id: agent() }, 40)).map(h => ({ id: h.id, text: h.memory, at: Date.parse(h.created_at ?? '') || 0, user: h.user_id ?? null })))
  }

  const organ: MemoryOrgan = {
    name: 'memory',
    role: mem0 ? 'Long-term memory in mem0: every turn is kept, recall is semantic, people have their own memories.' : 'Long-term memory: extracted after every turn, recalled by words and shared entities.',
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
        run: async input => {
          const m = normalize(input)
          if (!m) return 'not kept: too short, or it looks like a secret'
          if (mem0) {
            await mem0.add(m.text, { agent_id: agent() }, { infer: false, metadata: { kind: m.kind, about: m.about } })
            return 'kept'
          }
          const { list: next, added } = addMemories(list(), [m], Date.now())
          store.set(key(), next)
          return added ? 'kept' : 'already known: refreshed it'
        },
      },
      {
        name: 'recall',
        description: 'Search long-term memory.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        run: async ({ query }) => {
          if (mem0) {
            const hits = await mem0.search(String(query ?? ''), { agent_id: agent() }, 10)
            return hits.length ? lines(hits) : 'nothing comes to mind'
          }
          const hits = recall(list(), String(query ?? ''), 10)
          return hits.length ? hits.map(m => `- (${m.id}) ${m.text}`).join('\n') : 'nothing comes to mind'
        },
      },
      {
        name: 'forget',
        description: 'Drop one memory by id.',
        input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        run: async ({ id }) => {
          if (mem0) {
            await mem0.remove(String(id))
            store.update<{ id: string }[]>('mem0Recent', [], l => l.filter(m => m.id !== id))
            return 'forgotten'
          }
          const before = list()
          const after = before.filter(m => m.id !== id)
          store.set(key(), after)
          return after.length < before.length ? 'forgotten' : `no memory ${id}`
        },
      },
    ],
    sense: async turn => {
      if (mem0) {
        try {
          const hits = await mem0.search(turn.stimulus.text, { agent_id: agent() }, 6)
          return hits.length ? `# What you remember that may bear on this\n${hits.map(h => `- ${h.memory}`).join('\n')}` : undefined
        } catch (err) {
          body.bus.emit('organ.error', 'memory', `mem0 recall: ${String(err).slice(0, 160)}`)
          return undefined
        }
      }
      const all = list()
      const hits = recall(all, turn.stimulus.text)
      if (!hits.length) return undefined
      const ids = new Set(hits.map(m => m.id))
      store.set(key(), all.map(m => (ids.has(m.id) ? { ...m, hits: m.hits + 1 } : m)))
      return `# What you remember that may bear on this\n${hits.map(m => `- ${m.text}`).join('\n')}`
    },
    // Keeping runs beside the queue, not in it: the next thought (often the person's chat) never waits on it.
    after: (turn, result) => {
      if (!result.text && !result.tools.length) return
      track(mem0 ? keepInMem0(turn, result) : extract(turn, result))
    },
    rhythms: mem0 ? [{ name: 'mem0-sync', due: now => now - store.get<number>('syncAt', 0) >= SYNC_EVERY_MS, run: sync }] : [],
    view: () => {
      if (mem0) {
        const recent = store.get<{ id: string; text: string; at: number }[]>('mem0Recent', [])
        return { backend: 'mem0', count: recent.length, recent: recent.map(m => ({ id: m.id, text: m.text, at: m.at, kind: 'mem0', about: [], hits: 0 })) }
      }
      const all = list()
      return { backend: 'local', count: all.length, recent: [...all].sort((a, b) => b.at - a.at).slice(0, 40) }
    },
    actions: {
      search: async ({ query }) => (mem0 ? (await mem0.search(String(query ?? ''), { agent_id: agent() }, 20)).map(h => ({ id: h.id, text: h.memory })) : recall(list(), String(query ?? ''), 20)),
      forget: async ({ id }) => {
        if (mem0) { await mem0.remove(String(id)); store.update<{ id: string }[]>('mem0Recent', [], l => l.filter(m => m.id !== id)) } else store.set(key(), list().filter(m => m.id !== id))
        return { ok: true }
      },
      sync: async () => { await sync(); return { ok: true } },
    },
    settled: () => Promise.all([...inFlight]).then(() => undefined),
    async aboutPerson(handle, query) {
      if (!mem0) return []
      return (await mem0.search(query || handle, { agent_id: agent(), user_id: personId(handle) }, 5)).map(h => h.memory)
    },
    async notePerson(handle, theirs, hers) {
      if (!mem0 || SECRET.test(theirs) || SECRET.test(hers)) return
      track(mem0.add([{ role: 'user', content: `@${handle.replace(/^@/, '')} on X: ${theirs.slice(0, 1500)}` }, { role: 'assistant', content: hers.slice(0, 1500) }], { agent_id: agent(), user_id: personId(handle) }))
    },
  }
  return organ

  async function keepInMem0(turn: Turn, result: TurnResult) {
    const said = [result.text, ...result.tools.map(t => `[${t.name}] ${t.result.slice(0, 200)}`)].filter(Boolean).join('\n')
    if (SECRET.test(turn.stimulus.text) || SECRET.test(said)) return
    await mem0!.add([
      { role: 'user', content: `(${turn.stimulus.kind}${turn.stimulus.from ? ` from ${turn.stimulus.from}` : ''}) ${turn.stimulus.text.slice(0, 3000)}` },
      { role: 'assistant', content: said.slice(0, 3000) },
    ], { agent_id: turn.personaId })
  }

  async function extract(turn: Turn, result: TurnResult) {
      // Kept under the persona the thought belonged to, even if the person switches persona meanwhile.
      const owner = `memories:${turn.personaId}`
      const exchange = [
        `STIMULUS (${turn.stimulus.kind}${turn.stimulus.from ? ` from ${turn.stimulus.from}` : ''}):\n${turn.stimulus.text.slice(0, 3000)}`,
        result.tools.length ? `TOOLS USED: ${result.tools.map(t => `${t.name} → ${t.result.slice(0, 160)}`).join(' | ')}` : '',
        `${name().toUpperCase()}:\n${result.text.slice(0, 3000)}`,
      ].filter(Boolean).join('\n\n')
      const raw = await body.brain.quick(extractionSystem(name()), `<exchange>\n${exchange}\n</exchange>`)
      const incoming = parseExtraction(raw).map(normalize).filter((m): m is NonNullable<typeof m> => !!m)
      if (!incoming.length) return
      const { list: next, added } = addMemories(store.get<Memory[]>(owner, []), incoming, Date.now())
      store.set(owner, next)
      if (added) body.bus.emit('memory.added', 'memory', { added, texts: incoming.map(m => m.text) })
  }
}
