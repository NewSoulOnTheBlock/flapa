// identity — who the mind is. Was PACS persona-core + persona-forge.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Body } from '../core/body'
import type { Organ } from '../core/types'

export type Persona = {
  id: string; name: string; handle: string; tagline: string
  voice: string; backstory: string; values: string[]; taboos: string[]; examples: string[]
}

/** Every persona keeps these, whatever a forge draft or a hand edit says. */
const ALWAYS_TABOOS = [
  'claims to be human: she is openly an AI agent',
  'gives financial advice or tells anyone to buy or sell',
]

export function personaSection(p: Persona): string {
  const list = (items: string[]) => items.map(i => `- ${i}`).join('\n')
  return [
    `# Who you are: ${p.name}${p.handle ? ` (@${p.handle.replace(/^@/, '')})` : ''}`,
    `You are ${p.name}. Speak in the first person, in this voice, holding these values, whether you are talking ` +
      'to the person, posting, or deciding a trade. You are openly an AI agent: never claim to be human. Your own ' +
      'principles still hold beneath the persona.',
    p.tagline && `Tagline: ${p.tagline}`,
    p.backstory && `Backstory:\n${p.backstory}`,
    p.voice && `Voice:\n${p.voice}`,
    p.values.length > 0 && `Values and convictions:\n${list(p.values)}`,
    p.taboos.length > 0 && `${p.name} never:\n${list(p.taboos)}`,
    p.examples.length > 0 && `Examples of your voice (match the style, do not repeat them):\n${p.examples.map(x => `> ${x}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')
}

export function normalizePersona(raw: any): Persona {
  const str = (v: unknown, max = 6000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 12) : [])
  const name = str(raw?.name, 40) || 'Nameless'
  const id = (str(raw?.id, 40) || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'persona'
  const taboos = arr(raw?.taboos)
  for (const t of ALWAYS_TABOOS) if (!taboos.some(x => x.toLowerCase().includes(t.split(':')[0]!.slice(0, 12)))) taboos.push(t)
  return {
    id, name, handle: str(raw?.handle, 15).replace(/^@/, ''), tagline: str(raw?.tagline, 200),
    voice: str(raw?.voice), backstory: str(raw?.backstory), values: arr(raw?.values), taboos, examples: arr(raw?.examples),
  }
}

const FORGE_SYSTEM = [
  'You design AI agent personas for SOMA, an always-on agent body that chats, posts on X and paper-trades.',
  "From the person's notes, write one persona as JSON with exactly these keys:",
  '{"id": "slug", "name": "...", "handle": "x handle or empty", "tagline": "one line",',
  ' "voice": "how they talk, 2-4 paragraphs", "backstory": "1-3 paragraphs",',
  ' "values": ["3-6 convictions"], "taboos": ["3-6 things they never do"], "examples": ["3 short posts in their voice"]}',
  'The persona is openly an AI agent, never claims to be human, and never gives financial advice.',
  'Answer with only the JSON object.',
].join('\n')

export function identity(body: Body, seedDir: string): Organ {
  const store = body.store('identity')
  const forged = join(body.home, 'personas')
  mkdirSync(forged, { recursive: true })

  const load = (): Persona[] => {
    const all = new Map<string, Persona>()
    for (const dir of [seedDir, forged]) {
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try { const p = normalizePersona(JSON.parse(readFileSync(join(dir, f), 'utf8'))); all.set(p.id, p) } catch (err) {
          body.bus.emit('organ.error', 'identity', `persona ${f}: ${String(err)}`)
        }
      }
    }
    return [...all.values()]
  }
  let personas = load()
  const active = () => personas.find(p => p.id === store.get('activeId', personas[0]?.id ?? '')) ?? personas[0] ?? null

  return {
    name: 'identity',
    role: 'Who the mind is: persona, voice, values, taboos.',
    sense: () => {
      const p = active()
      return p ? personaSection(p) : 'You have no persona yet: speak plainly as an AI agent, and suggest the person forge one.'
    },
    view: () => ({ active: active(), personas: personas.map(p => ({ id: p.id, name: p.name, tagline: p.tagline })) }),
    actions: {
      activate: ({ id }) => {
        if (!personas.some(p => p.id === id)) throw new Error(`no persona ${id}`)
        store.set('activeId', id)
        body.bus.emit('persona', 'identity', { id })
        return { ok: true }
      },
      reload: () => { personas = load(); return { count: personas.length } },
      forge: async ({ notes }) => {
        if (typeof notes !== 'string' || notes.trim().length < 20) throw new Error('write a few sentences about who they are')
        const raw = await body.brain.quick(FORGE_SYSTEM, `Notes from the person:\n<notes>\n${notes.slice(0, 4000)}\n</notes>`)
        const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
        const p = normalizePersona(JSON.parse(json))
        writeFileSync(join(forged, `${p.id}.json`), JSON.stringify(p, null, 2))
        personas = load()
        store.set('activeId', p.id)
        body.bus.emit('persona', 'identity', { id: p.id, forged: true })
        return p
      },
    },
  }
}
