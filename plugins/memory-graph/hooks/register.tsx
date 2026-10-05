import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memory, MemoryKind } from '../types'
import { addMemories, extractionSystem, isSecret, normalize, parseExtraction, recall } from './memory'

const PANE = 'memory'
const REMEMBER = 'mcp__memory-graph__remember'
const RECALL = 'mcp__memory-graph__recall'
const FORGET = 'mcp__memory-graph__forget'
const PERSONA = { plugin: 'persona-core', key: 'active' } as const

const memories = atom({ plugin: 'memory-graph', key: 'memories' } as const, [])
const owner = atom({ plugin: 'memory-graph', key: 'owner' } as const, 'default')
const query = atom({ plugin: 'memory-graph', key: 'query' } as const, '')

// The prompt of the turn in flight, for extraction once it answers, and how
// many tools it ran: a turn that ran tools was engineering work, not the persona.
let lastPrompt = ''
let toolsThisTurn = 0

const ENGINEERING_NOTE =
  'THIS TURN WAS ENGINEERING WORK: the assistant ran tools (edited files, ran commands). Extract only what the ' +
  'PERSON stated about themselves, their projects or their decisions, phrased as "the person ...". Extract ' +
  'nothing about the persona: it was not in character and did none of this. When unsure, answer [].'

async function personaId($: EngineInterface): Promise<{ id: string; name: string }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) return { id: value.id, name: value.name }
  } catch {
    // persona-core not loaded: one shared memory.
  }
  return { id: 'default', name: 'the assistant' }
}

async function sync($: EngineInterface): Promise<{ id: string; name: string; list: Memory[] }> {
  const who = await personaId($)
  if ((await read($, owner)) !== who.id) {
    const saved = ((await $.store.get(`mem:${who.id}`)) as Memory[] | undefined) ?? []
    await update($, memories, () => saved)
    await update($, owner, () => who.id)
  }
  return { ...who, list: await read($, memories) }
}

/** sync without writing, for drawing. */
async function peek($: EngineInterface): Promise<{ id: string; name: string; list: Memory[] }> {
  const who = await personaId($)
  const list = (await read($, owner)) === who.id
    ? await read($, memories)
    : ((await $.store.get(`mem:${who.id}`)) as Memory[] | undefined) ?? []
  return { ...who, list }
}

async function save($: EngineInterface, id: string, list: Memory[]) {
  await $.store.set(`mem:${id}`, list)
  await update($, memories, () => list)
  await update($, owner, () => id)
}

async function isAuto($: EngineInterface): Promise<boolean> {
  return (await $.store.get('auto')) !== false
}

/** One small-model pass over a finished exchange. */
async function extract($: EngineInterface, prompt: string, answer: string, isEngineering: boolean) {
  const { id, name, list } = await sync($)
  const r = await $.model.complete({
    model: 'haiku',
    system: isEngineering ? `${extractionSystem(name)}\n\n${ENGINEERING_NOTE}` : extractionSystem(name),
    prompt: `PERSON:\n${prompt.slice(0, 4000)}\n\nASSISTANT (as ${name} only when in character):\n${answer.slice(0, 4000)}`,
    maxTokens: 700,
  })
  if (!r.isAnswered) return
  const found = parseExtraction(r.text).map(normalize).filter(x => x !== undefined)
  if (!found.length) return
  const { list: next, added } = addMemories(list, found, await $.clock.now())
  await save($, id, next)
  if (added) $.ui.status(`🧠 +${added} ${added === 1 ? 'memory' : 'memories'} (${next.length})`)
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function line(m: Memory): string {
  return `- [${day(m.at)} ${m.kind}] ${m.text}${m.about.length ? ` {${m.about.join(', ')}}` : ''} (id ${m.id})`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await sync($)
    await $.tool.register({
      name: 'remember',
      description:
        'Store a durable memory for the active persona: a fact, event, person, preference or decision worth ' +
        'recalling weeks later. Never store credentials.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One self-contained sentence' },
          kind: { type: 'string', enum: ['fact', 'event', 'person', 'preference', 'decision'] },
          about: { type: 'array', items: { type: 'string' }, description: 'Entities: people, @handles, $tickers' },
        },
        required: ['text'],
      },
    })
    await $.tool.register({
      name: 'recall',
      description: "Search the active persona's long-term memory by words and entities.",
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    })
    await $.tool.register({
      name: 'forget',
      description: 'Delete one memory by id (from recall), when it is wrong or the person asks.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    })
    await $.command.register({
      name: 'memory',
      description: 'Open the memory pane; /memory auto on|off toggles extraction after each turn',
    })
    // Panes are screen state the engine does not restore: reopen this one if it was
    // left open last session. Unasked, it seats from 144 columns (or when widened).
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'Memory' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  // Recall: what this persona remembers about the message rides along as context.
  on('prompt.submit', async ($, e, next) => {
    lastPrompt = e.text
    toolsThisTurn = 0
    const { id, name, list } = await sync($)
    const found = recall(list, e.text)
    if (!found.length) return next(e)
    const ids = new Set(found.map(m => m.id))
    await save($, id, list.map(m => (ids.has(m.id) ? { ...m, hits: m.hits + 1 } : m)))
    const block =
      `Memories ${name} recalls for this message (memory-graph; may be dated, prefer what the person says now):\n` +
      found.map(line).join('\n')
    return next({ ...e, context: [...(e.context ?? []), block] })
  })

  // Extraction: after a main-thread answer, off the turn's own clock.
  on('turn.complete', async ($, e, next) => {
    const prompt = lastPrompt
    const isEngineering = toolsThisTurn > 0
    lastPrompt = ''
    toolsThisTurn = 0
    if (!e.agentId && !e.isAborted && e.answer && prompt && (await isAuto($))) {
      $.clock.after(1, () => void extract($, prompt, e.answer, isEngineering).catch(() => undefined))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== REMEMBER && e.tool !== RECALL && e.tool !== FORGET) {
      // The persona's own tools (stance, mood) are in character; anything else is work.
      if (!e.agentId && !/^mcp__(opinion-ledger|mood-state|persona-core)__/.test(e.tool)) toolsThisTurn++
      return next(e)
    }
    const { id, name, list } = await sync($)
    const input = e as unknown as { text?: string; kind?: MemoryKind; about?: string[]; query?: string; limit?: number; id?: string }

    if (e.tool === REMEMBER) {
      if (input.text && isSecret(input.text)) return { deny: 'That looks like a credential; memory never stores those.' }
      const m = normalize({ text: input.text, kind: input.kind, about: input.about })
      if (!m) return { deny: 'remember needs one self-contained sentence of at least 8 characters' }
      const { list: next_, added } = addMemories(list, [m], await $.clock.now())
      await save($, id, next_)
      return { result: added ? `${name} will remember that.` : 'Already remembered; refreshed it.' }
    }
    if (e.tool === RECALL) {
      const found = recall(list, input.query ?? '', Math.min(20, Math.max(1, Number(input.limit) || 8)))
      return { result: found.length ? found.map(line).join('\n') : `${name} remembers nothing about that.` }
    }
    const gone = list.find(m => m.id === input.id)
    if (!gone) return { deny: `No memory with id ${input.id}` }
    await save($, id, list.filter(m => m.id !== input.id))
    return { result: `Forgot: ${gone.text}` }
  })

  on('command.run', { command: 'memory' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'auto on' || arg === 'auto off') {
      await $.store.set('auto', arg === 'auto on')
      return { text: `Memory extraction after each turn: ${arg === 'auto on' ? 'on' : 'off'}.` }
    }
    const { name, list } = await sync($)
    await $.ui.open({ id: PANE, title: 'Memory', focus: true })
    await $.store.set('paneOpen', true)
    return { text: `${name}: ${list.length} memories. Extraction ${(await isAuto($)) ? 'on' : 'off'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const { id, name, list } = await peek($)
    const q = await read($, query)
    const shown = q ? recall(list, q, 30) : [...list].sort((a, b) => b.at - a.at).slice(0, 30)
    const entities = new Map<string, number>()
    for (const m of list) for (const a of m.about) entities.set(a, (entities.get(a) ?? 0) + 1)
    const top = [...entities].sort((a, b) => b[1] - a[1]).slice(0, 8)

    return (
      <Box flexDirection="column">
        <Text bold>
          {name} · {list.length} memories
        </Text>
        {top.length > 0 && (
          <Text dimColor>linked most: {top.map(([ent, n]) => `${ent} (${n})`).join(' · ')}</Text>
        )}
        {Input && (
          <Input
            key="search"
            label="search: "
            placeholder="words or entities; empty shows the newest"
            value={q}
            onSubmit={(value: string) => void update($, query, () => value.trim())}
          />
        )}
        {shown.length === 0 && (
          <Text dimColor>{q ? 'Nothing matches.' : 'No memories yet: they form as you talk.'}</Text>
        )}
        {shown.map(m => (
          <Box key={`m-${m.id}`} flexDirection="row" columnGap={1}>
            <Button
              key={`forget-${m.id}`}
              plain
              dimColor
              onPress={() => void save($, id, list.filter(x => x.id !== m.id))}
            >
              ✕
            </Button>
            <Text dimColor>{m.kind.padEnd(10)}</Text>
            <Text>{m.text}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
