import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Persona } from '../types'

const PANE = 'persona'
const active = atom({ plugin: 'persona-core', key: 'active' } as const, null)
const profiles = atom({ plugin: 'persona-core', key: 'profiles' } as const, [])

type ListField = 'values' | 'taboos' | 'examples'
type TextField = 'name' | 'handle' | 'tagline' | 'backstory' | 'voice'
const TEXT_FIELDS: readonly TextField[] = ['name', 'handle', 'tagline', 'voice', 'backstory']
const LIST_FIELDS: readonly ListField[] = ['values', 'taboos', 'examples']

export function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

export function blank(id: string, name = id): Persona {
  return { id, name, handle: '', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] }
}

/** A persona from loose JSON (an import, a tool call): known fields only, trimmed. */
export function toPersona(raw: unknown, base?: Persona): Persona | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : base?.name
  const id = slug(typeof r.id === 'string' && r.id ? r.id : base?.id ?? name ?? '')
  if (!id || !name) return undefined
  const text = (k: TextField) => (typeof r[k] === 'string' ? (r[k] as string).trim() : base?.[k] ?? '')
  const list = (k: ListField) =>
    Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : base?.[k] ?? []
  return {
    id, name,
    handle: text('handle').replace(/^@/, ''), tagline: text('tagline'), backstory: text('backstory'), voice: text('voice'),
    values: list('values'), taboos: list('taboos'), examples: list('examples'),
  }
}

/** The system-prompt section that makes Claude this persona. */
export function personaSection(p: Persona): string {
  const list = (items: string[]) => items.map(i => `- ${i}`).join('\n')
  return [
    `# Agent persona: ${p.name}${p.handle ? ` (@${p.handle.replace(/^@/, '')})` : ''}`,
    `This session hosts ${p.name}, an AI agent persona the person is developing. When the person talks to ` +
      `${p.name}, asks what ${p.name} thinks, or asks for ${p.name}'s posts or replies, answer as ${p.name}: ` +
      `first person, in this voice, holding these values. For ordinary engineering work stay yourself, with ` +
      `${p.name}'s context in mind.`,
    `${p.name} is openly an AI agent: it never claims to be human, and your own principles still apply ` +
      'beneath the persona.',
    p.tagline && `Tagline: ${p.tagline}`,
    p.backstory && `Backstory:\n${p.backstory}`,
    p.voice && `Voice:\n${p.voice}`,
    p.values.length > 0 && `Values and convictions:\n${list(p.values)}`,
    p.taboos.length > 0 && `${p.name} never:\n${list(p.taboos)}`,
    p.examples.length > 0 && `Examples of ${p.name}'s voice (match the style, do not repeat them):\n` +
      p.examples.map(x => `> ${x}`).join('\n'),
  ].filter(Boolean).join('\n\n')
}

async function load($: EngineInterface) {
  const saved = ((await $.store.get('profiles')) as Persona[] | undefined) ?? []
  const activeId = (await $.store.get('activeId')) as string | undefined
  await update($, profiles, () => saved)
  await update($, active, () => saved.find(p => p.id === activeId) ?? null)
}

/** Writes the profile list and the active choice to state and the store together. */
async function save($: EngineInterface, list: Persona[], activeId: string | null) {
  await $.store.set('profiles', list)
  await $.store.set('activeId', activeId ?? '')
  await update($, profiles, () => list)
  await update($, active, () => list.find(p => p.id === activeId) ?? null)
}

async function edit($: EngineInterface, id: string, change: (p: Persona) => Persona) {
  const list = (await read($, profiles)).map(p => (p.id === id ? change(p) : p))
  const current = await read($, active)
  await save($, list, current?.id ?? null)
}

function summary(p: Persona | null, all: Persona[]): string {
  const lines = [
    p ? `Active persona: ${p.name} (${p.id})` : 'No persona active: Claude is itself.',
    `Profiles: ${all.length ? all.map(x => x.id).join(', ') : 'none yet'}`,
  ]
  if (p) {
    lines.push(
      `values ${p.values.length}, taboos ${p.taboos.length}, voice examples ${p.examples.length}`,
    )
  }
  lines.push(
    'Commands: /persona new <name> | use <id> | off | set <name|handle|tagline|voice|backstory> <text>',
    '          | add <values|taboos|examples> <text> | import <file.json> | export [file] | delete <id> | show',
  )
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await load($)
    await $.command.register({
      name: 'persona',
      description: 'Agent personas: /persona [new|use|off|set|add|import|export|delete|show] — opens the Persona pane',
    })
    await $.tool.register({
      name: 'update',
      description:
        "Edit the active persona's profile, only when the person asks you to. `set` replaces text fields; " +
        '`add` appends to lists; `remove` drops list items by exact text. The persona never edits itself unasked.',
      inputSchema: {
        type: 'object',
        properties: {
          set: {
            type: 'object',
            properties: Object.fromEntries(TEXT_FIELDS.map(f => [f, { type: 'string' }])),
          },
          add: {
            type: 'object',
            properties: Object.fromEntries(LIST_FIELDS.map(f => [f, { type: 'array', items: { type: 'string' } }])),
          },
          remove: {
            type: 'object',
            properties: Object.fromEntries(LIST_FIELDS.map(f => [f, { type: 'array', items: { type: 'string' } }])),
          },
        },
      },
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__persona-core__update' }, async ($, e) => {
    const current = await read($, active)
    if (!current) return { deny: 'No active persona: the person creates one with /persona new <name>.' }
    const input = e as unknown as {
      set?: Partial<Record<TextField, string>>
      add?: Partial<Record<ListField, string[]>>
      remove?: Partial<Record<ListField, string[]>>
    }
    const changed: string[] = []
    await edit($, current.id, p => {
      let next: Persona = { ...p }
      for (const f of TEXT_FIELDS) {
        const v = input.set?.[f]
        if (typeof v === 'string') {
          next = { ...next, [f]: f === 'handle' ? v.trim().replace(/^@/, '') : v.trim() }
          changed.push(`set ${f}`)
        }
      }
      for (const f of LIST_FIELDS) {
        const drop = new Set((input.remove?.[f] ?? []).map(x => x.trim()))
        const plus = (input.add?.[f] ?? []).map(x => x.trim()).filter(Boolean)
        if (drop.size) changed.push(`removed ${drop.size} from ${f}`)
        if (plus.length) changed.push(`added ${plus.length} to ${f}`)
        next = { ...next, [f]: [...next[f].filter(x => !drop.has(x)), ...plus] }
      }
      return next
    })
    return { result: changed.length ? `${current.name}: ${changed.join(', ')}.` : 'Nothing to change.' }
  })

  // The persona rides in the system prompt, after the engine's own sections.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const p = await read($, active)
    if (!p) return composed
    return {
      ...composed,
      sections: [...composed.sections, { id: 'persona-core:identity', text: personaSection(p), scope: 'session' as const }],
    }
  })

  on('command.run', { command: 'persona' }, async ($, e) => {
    const all = await read($, profiles)
    const current = await read($, active)
    const [verb = '', field = ''] = e.args.trim().split(/\s+/)
    const tail = e.args.trim().slice(verb.length).trim()
    // What follows the field, line breaks kept: voices and backstories run long.
    const value = tail.slice(field.length).trim()

    switch (verb) {
      case 'new': {
        const id = slug(tail)
        if (!id) return { text: 'Usage: /persona new <name>' }
        if (all.some(p => p.id === id)) return { text: `A persona "${id}" exists; /persona use ${id}` }
        await save($, [...all, blank(id, tail)], id)
        await $.ui.open({ id: PANE, title: 'Persona', focus: true })
        return { text: `Created and switched to ${tail} (${id}). Fill it in the Persona pane or with /persona set.` }
      }
      case 'use': {
        const p = all.find(x => x.id === slug(field))
        if (!p) return { text: `No persona "${field}". Profiles: ${all.map(x => x.id).join(', ') || 'none'}` }
        await save($, all, p.id)
        return { text: `Now speaking as ${p.name}.` }
      }
      case 'off':
        await save($, all, null)
        return { text: 'Persona off: Claude is itself.' }
      case 'delete': {
        const id = slug(field)
        if (!all.some(p => p.id === id)) return { text: `No persona "${field}".` }
        await save($, all.filter(p => p.id !== id), current?.id === id ? null : current?.id ?? null)
        return { text: `Deleted ${id}. Its opinions and memories stay in their own mods until you clear them.` }
      }
      case 'set': {
        if (!current) return { text: 'No active persona: /persona new <name> first.' }
        if (!(TEXT_FIELDS as readonly string[]).includes(field)) return { text: `Fields: ${TEXT_FIELDS.join(', ')}` }
        await edit($, current.id, p => ({ ...p, [field]: field === 'handle' ? value.replace(/^@/, '') : value }))
        return { text: `${current.name}.${field} set (${value.length} chars)` }
      }
      case 'add': {
        if (!current) return { text: 'No active persona: /persona new <name> first.' }
        if (!(LIST_FIELDS as readonly string[]).includes(field)) return { text: `Lists: ${LIST_FIELDS.join(', ')}` }
        if (!value) return { text: `Usage: /persona add ${field} <text>` }
        await edit($, current.id, p => ({ ...p, [field]: [...p[field as ListField], value] }))
        return { text: `Added to ${current.name}'s ${field}.` }
      }
      case 'import': {
        if (!tail) return { text: 'Usage: /persona import <file.json>' }
        let raw: unknown
        try {
          raw = JSON.parse(await $.fs.read(tail))
        } catch (err) {
          return { text: `Could not read ${tail}: ${err instanceof Error ? err.message : String(err)}` }
        }
        const p = toPersona(raw)
        if (!p) return { text: `${tail} needs at least a "name".` }
        await save($, [...all.filter(x => x.id !== p.id), p], p.id)
        await $.ui.open({ id: PANE, title: 'Persona', focus: true })
        const replaced = all.some(x => x.id === p.id)
        return {
          text: `${replaced ? 'Updated' : 'Imported'} ${p.name} (${p.id}) and switched to it: ` +
            `voice ${p.voice.length} chars, backstory ${p.backstory.length} chars, ` +
            `${p.values.length} values, ${p.taboos.length} taboos, ${p.examples.length} examples.`,
        }
      }
      case 'export': {
        if (!current) return { text: 'No active persona to export.' }
        const path = tail || `.claude/personas/${current.id}.json`
        await $.fs.write(path, `${JSON.stringify(current, null, 2)}\n`)
        return { text: `Wrote ${current.name} to ${path}` }
      }
      case 'show':
        return { text: current ? personaSection(current) : 'No persona active.' }
      default:
        await $.ui.open({ id: PANE, title: 'Persona', focus: true })
        return { text: summary(current, all) }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const all = await read($, profiles)
    const p = await read($, active)

    const switcher = (
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {all.map(x => (
          <Button
            key={`use-${x.id}`}
            plain
            dimColor={x.id !== p?.id}
            onPress={() => void save($, all, x.id === p?.id ? null : x.id)}
          >
            {x.id === p?.id ? `● ${x.name}` : x.name}
          </Button>
        ))}
        {Input && (
          <Input
            key="new"
            label="+ "
            placeholder="new persona name"
            submitLabel="create"
            value=""
            onSubmit={(name: string) => {
              const id = slug(name)
              if (id && !all.some(x => x.id === id)) void save($, [...all, blank(id, name.trim())], id)
            }}
          />
        )}
      </Box>
    )

    if (!p) {
      return (
        <Box flexDirection="column">
          {switcher}
          <Text dimColor>
            {all.length ? 'No persona active: pick one above.' : 'No personas yet: name one above, or /persona new <name>.'}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {switcher}
        {TEXT_FIELDS.map(field =>
          Input ? (
            <Input
              key={`f-${field}`}
              label={`${field.padEnd(9)} `}
              placeholder={`set ${field}`}
              value={p[field]}
              onSubmit={(value: string) => void edit($, p.id, x => ({ ...x, [field]: value.trim() }))}
            />
          ) : (
            <Text key={`f-${field}`}>
              <Text dimColor>{field.padEnd(9)} </Text>
              {p[field]}
            </Text>
          ),
        )}
        {LIST_FIELDS.map(field => (
          <Box key={`l-${field}`} flexDirection="column">
            <Text bold>{field}</Text>
            {p[field].map((item, i) => (
              <Box key={`${field}-${i}`} flexDirection="row" columnGap={1}>
                <Button
                  key={`rm-${field}-${i}`}
                  plain
                  dimColor
                  onPress={() => void edit($, p.id, x => ({ ...x, [field]: x[field].filter((_, j) => j !== i) }))}
                >
                  ✕
                </Button>
                <Text>{item}</Text>
              </Box>
            ))}
            {Input && (
              <Input
                key={`add-${field}`}
                label="+ "
                placeholder={`add to ${field}`}
                value=""
                onSubmit={(value: string) => {
                  if (value.trim()) void edit($, p.id, x => ({ ...x, [field]: [...x[field], value.trim()] }))
                }}
              />
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
