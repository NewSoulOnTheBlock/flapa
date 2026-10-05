import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Opinion } from '../types'

const PANE = 'opinions'
const STANCE_TOOL = 'mcp__opinion-ledger__stance'
const LIST_TOOL = 'mcp__opinion-ledger__stances'
const IN_PROMPT = 40
const PERSONA = { plugin: 'persona-core', key: 'active' } as const

const ledger = atom({ plugin: 'opinion-ledger', key: 'ledger' } as const, [])
const owner = atom({ plugin: 'opinion-ledger', key: 'owner' } as const, 'default')

export function topicKey(topic: string): string {
  return topic.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

async function personaId($: EngineInterface): Promise<{ id: string; name: string }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) return { id: value.id, name: value.name }
  } catch {
    // persona-core not loaded: one shared ledger.
  }
  return { id: 'default', name: 'You' }
}

/** Loads the active persona's ledger into state when the persona changed. */
async function sync($: EngineInterface): Promise<{ id: string; name: string; list: Opinion[] }> {
  const who = await personaId($)
  if ((await read($, owner)) !== who.id) {
    const saved = ((await $.store.get(`ledger:${who.id}`)) as Opinion[] | undefined) ?? []
    await update($, ledger, () => saved)
    await update($, owner, () => who.id)
  }
  return { ...who, list: await read($, ledger) }
}

/** sync without writing, for drawing: state writes are refused mid-render. */
async function peek($: EngineInterface): Promise<{ id: string; name: string; list: Opinion[] }> {
  const who = await personaId($)
  const list = (await read($, owner)) === who.id
    ? await read($, ledger)
    : ((await $.store.get(`ledger:${who.id}`)) as Opinion[] | undefined) ?? []
  return { ...who, list }
}

async function save($: EngineInterface, id: string, list: Opinion[]) {
  await $.store.set(`ledger:${id}`, list)
  await update($, ledger, () => list)
  await update($, owner, () => id)
}

/**
 * Takes or revises a stance. A revision keeps the old stance in history; the
 * same stance again only moves confidence and the reason.
 */
export function applyStance(
  list: readonly Opinion[],
  input: { topic: string; stance: string; confidence: number; reason: string },
  now: number,
): { list: Opinion[]; change: 'new' | 'revised' | 'reaffirmed' } {
  const id = topicKey(input.topic)
  const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0.6))
  const found = list.find(o => o.id === id)
  if (!found) {
    const fresh: Opinion = {
      id, topic: input.topic.trim(), stance: input.stance.trim(), confidence,
      reason: input.reason.trim(), since: now, updated: now, history: [],
    }
    return { list: [...list, fresh], change: 'new' }
  }
  const isSame = found.stance.trim().toLowerCase() === input.stance.trim().toLowerCase()
  const next: Opinion = isSame
    ? { ...found, confidence, reason: input.reason.trim(), updated: now }
    : {
        ...found,
        stance: input.stance.trim(),
        confidence,
        reason: input.reason.trim(),
        since: now,
        updated: now,
        history: [
          ...found.history,
          { stance: found.stance, confidence: found.confidence, reason: found.reason, at: found.since },
        ].slice(-20),
      }
  return { list: list.map(o => (o.id === id ? next : o)), change: isSame ? 'reaffirmed' : 'revised' }
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function ledgerSection(name: string, list: readonly Opinion[]): string {
  const held = [...list].sort((a, b) => b.updated - a.updated).slice(0, IN_PROMPT)
  return [
    `# ${name}'s stances (opinion ledger)`,
    held.length
      ? held.map(o => `- ${o.topic}: ${o.stance} (confidence ${o.confidence.toFixed(1)}, since ${day(o.since)})`).join('\n')
      : '(none recorded yet)',
    `When speaking as ${name}, stay consistent with these. Holding a view on a new topic, or changing one, ` +
      `goes through the stance tool with the reason, so ${name}'s convictions are deliberate and remembered. ` +
      'Revise when there is a real reason (new evidence, an argument that landed); never just to agree.',
    list.length > IN_PROMPT ? `${list.length - IN_PROMPT} older stances are in the ledger; the stances tool searches them.` : '',
  ].filter(Boolean).join('\n\n')
}

function describe(o: Opinion): string {
  const past = o.history.length
    ? `\n  was: ${o.history.map(h => `"${h.stance}" (${day(h.at)}, ${h.reason})`).join('; ')}`
    : ''
  return `- ${o.topic}: ${o.stance} [${o.confidence.toFixed(1)}] — ${o.reason}${past}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await sync($)
    await $.tool.register({
      name: 'stance',
      description:
        "Record or revise the active persona's opinion on a topic, with the reason. Use it whenever the " +
        'persona forms a view it should keep, or changes one. Revisions keep the old stance in history.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Short topic name, e.g. "memecoins", "L2 fees"' },
          stance: { type: 'string', description: 'The view, one or two sentences in the persona\'s words' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', description: 'Why the persona holds or changed this view' },
        },
        required: ['topic', 'stance', 'confidence', 'reason'],
      },
    })
    await $.tool.register({
      name: 'stances',
      description: "Search the active persona's opinion ledger, history included. Empty query lists all.",
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    })
    await $.command.register({ name: 'opinions', description: "Open the active persona's opinion ledger" })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const { id, name, list } = await sync($)
    if (id === 'default' && list.length === 0) return composed
    return {
      ...composed,
      sections: [...composed.sections, { id: 'opinion-ledger:stances', text: ledgerSection(name, list), scope: 'session' as const }],
    }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== STANCE_TOOL && e.tool !== LIST_TOOL) return next(e)
    const { id, name, list } = await sync($)
    const input = e as unknown as { topic?: string; stance?: string; confidence?: number; reason?: string; query?: string }

    if (e.tool === LIST_TOOL) {
      const q = (input.query ?? '').toLowerCase().trim()
      const hits = q ? list.filter(o => `${o.topic} ${o.stance} ${o.reason}`.toLowerCase().includes(q)) : list
      return { result: hits.length ? `${name}'s stances:\n${hits.map(describe).join('\n')}` : `No stances match "${q}".` }
    }

    if (!input.topic?.trim() || !input.stance?.trim()) return { deny: 'stance needs a topic and a stance' }
    if (!input.reason?.trim()) return { deny: 'stance needs a reason: convictions here are deliberate' }
    const { list: next_, change } = applyStance(
      list,
      { topic: input.topic, stance: input.stance, confidence: Number(input.confidence), reason: input.reason },
      await $.clock.now(),
    )
    await save($, id, next_)
    const verb = { new: "took a new", revised: "revised its", reaffirmed: "reaffirmed its" }[change]
    return { result: `${name} ${verb} stance on "${input.topic.trim()}".` }
  })

  on('command.run', { command: 'opinions' }, async $ => {
    const { name, list } = await sync($)
    await $.ui.open({ id: PANE, title: 'Opinions', focus: true })
    return { text: `${name}: ${list.length} stances.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { id, name, list } = await peek($)
    const sorted = [...list].sort((a, b) => b.updated - a.updated)
    const bar = (c: number) => '█'.repeat(Math.round(c * 5)).padEnd(5, '░')

    return (
      <Box flexDirection="column">
        <Text bold>
          {name} · {list.length} stances
        </Text>
        {sorted.length === 0 && (
          <Text dimColor>No stances yet. They appear as {name} forms views (the stance tool).</Text>
        )}
        {sorted.map(o => (
          <Box key={`o-${o.id}`} flexDirection="column">
            <Box flexDirection="row" columnGap={1}>
              <Button
                key={`drop-${o.id}`}
                plain
                dimColor
                onPress={() => void save($, id, list.filter(x => x.id !== o.id))}
              >
                ✕
              </Button>
              <Text bold>{o.topic}</Text>
              <Text dimColor>
                {bar(o.confidence)} {day(o.since)}
                {o.history.length ? ` · revised ${o.history.length}×` : ''}
              </Text>
            </Box>
            <Text>  {o.stance}</Text>
            <Text dimColor>  because {o.reason}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
