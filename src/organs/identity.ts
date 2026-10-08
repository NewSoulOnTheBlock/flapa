// identity — who the mind is. Was PACS persona-core + persona-forge.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { learn, type PostStat } from '../lib/analytics'
import { validateCatalog } from '../lib/posting'
import { EMPTY_LORE, loreSection, lorePrompt, mergeLore, storyChapters, type Lore } from '../lib/lore'

export type Style = { always: string[]; never: string[]; notes: string[] }
export type Persona = {
  id: string; name: string; handle: string; tagline: string
  voice: string; backstory: string; values: string[]; taboos: string[]; examples: string[]
  /** Phrases it uses, phrases it never uses, and notes on caps, emoji, length, punctuation, memes, conflict. */
  style: Style
  /** What X should think it is; every post should reinforce it. */
  reputation: string
  /** Accounts it follows closely: the default watch list for outbound replies. */
  favorites: string[]
  /** How it writes a post and a reply, carried by every scheduled post and reply brief. Empty = a neutral default. */
  craft: { post: string; reply: string }
}

/** A craft is text or a list of lines; either way it becomes one block of at most 3000 characters. */
const craftText = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n') : typeof v === 'string' ? v : '').trim().slice(0, 3000)

/** Every persona keeps these, whatever a forge draft or a hand edit says. */
const ALWAYS_TABOOS = [
  'claims to be human: it is openly an AI agent',
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
    p.style.notes.length > 0 && `Style:\n${list(p.style.notes)}`,
    p.style.always.length > 0 && `Words and phrases you use: ${p.style.always.join(' · ')}`,
    p.style.never.length > 0 && `Words and phrases you never use: ${p.style.never.join(' · ')}`,
    p.reputation && `How X sees you, and what every post should reinforce: ${p.reputation}`,
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
    style: { always: arr(raw?.style?.always), never: arr(raw?.style?.never), notes: arr(raw?.style?.notes) },
    reputation: str(raw?.reputation, 300),
    favorites: arr(raw?.favorites).map(h => h.replace(/^@/, '')).filter(h => /^\w{1,15}$/.test(h)),
    craft: { post: craftText(raw?.craft?.post), reply: craftText(raw?.craft?.reply) },
  }
}

const FORGE_SYSTEM = [
  'You design AI agent personas for P.A.C.S, an always-on agent harness that chats, posts on X and paper-trades.',
  "From the person's notes, write one persona as JSON with exactly these keys:",
  '{"id": "slug", "name": "...", "handle": "x handle or empty", "tagline": "one line",',
  ' "voice": "how they talk, 2-4 paragraphs", "backstory": "1-3 paragraphs",',
  ' "values": ["3-6 convictions"], "taboos": ["3-6 things they never do"], "examples": ["3 short posts in their voice"],',
  ' "style": {"always": ["words and phrases they use"], "never": ["words and phrases they never use"],',
  '           "notes": ["caps, emoji, length, punctuation, memes, how they handle conflict"]},',
  ' "reputation": "what X should think they are, one line", "favorites": ["x handles they follow closely, if the notes name any"],',
  ' "craft": {"post": ["6-10 lines beginning with \\"How to write it:\\": how THIS persona writes a post (length, rhythm,',
  '                    joke or no joke, what makes it land, what it avoids), specific enough that every post sounds like the same author"],',
  '           "reply": "2-3 sentences: how this persona replies to someone, and when it drops the act and is simply kind"}}',
  'The persona is openly an AI agent, never claims to be human, and never gives financial advice.',
  'Answer with only the JSON object.',
].join('\n')

const TOPICS_SYSTEM = [
  "You write the posting catalog for an AI agent persona. Each post picks one topic, sometimes blending a trading topic with a life one.",
  'Answer with only a JSON object with exactly these keys:',
  '{"formats": ["8-12 joke or post shapes this persona would use, one line each"],',
  ' "categories": [{"name": "...", "side": "trading" or "life", "weight": 1, "angle": "how this category sounds in their voice",',
  '                 "topics": ["6-12 concrete subjects"]}]}',
  'Write 6-10 categories, at least two on each side. Topics are subjects, not finished posts. Never a price call or advice.',
].join('\n')

const jsonIn = (raw: string) => JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))

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

  // Lore lives per persona in the store; her "birthday" is her first post, or the day the lore began.
  const pid = () => active()?.id ?? "none"
  const loreKey = () => `lore:${pid()}`
  const lore = (): Lore => ({ ...EMPTY_LORE, ...store.get<Partial<Lore>>(loreKey(), {}) })
  const bornAt = () => {
    const k = `bornAt:${pid()}`
    const posts = body.store('voice').get<{ at: number }[]>('posted', [])
    const firstPost = posts.length ? Math.min(...posts.map(p => p.at)) : Date.now()
    const known = store.get<number | undefined>(k, undefined)
    return known !== undefined && known <= firstPost ? known : store.set(k, firstPost)
  }

  /** New chapters from her real trades, follower milestones and posts that blew up. */
  function writeStory(): string[] {
    store.set('storyAt', Date.now())
    const stats = body.store('voice').get<PostStat[]>('stats', [])
    const l = learn(stats)
    const byId = new Map(stats.map(s => [s.id, s.at]))
    const chapters = storyChapters({
      bornAt: bornAt(),
      trades: body.store('hands').get<{ at: number; side: string; symbol: string; pnlBnb?: number; paper: boolean }[]>('trades', []),
      followers: body.store('voice').get<{ at: number; followers: number }[]>('followers', []),
      bigPosts: (l?.winners ?? []).map(w => ({ at: byId.get(w.id) ?? Date.now(), ratio: w.ratio, text: w.text })),
    }, new Set(lore().chapters.map(c => c.key)))
    if (chapters.length) {
      store.set(loreKey(), { ...lore(), chapters: [...lore().chapters, ...chapters].slice(-40) })
      body.bus.emit('story', 'identity', { chapters: chapters.map(c => c.title) })
    }
    return chapters.map(c => c.title)
  }

  /** Once a week: did anything she posted become a catchphrase, a running joke or a character? */
  async function growLore(): Promise<string[]> {
    store.set('loreAt', Date.now())
    const posts = body.store('voice').get<{ text: string; replyTo?: string }[]>('posted', []).filter(p => !p.replyTo).map(p => p.text)
    if (posts.length < 5) return []
    const raw = await body.brain.quick(`You are ${active()?.name ?? 'the agent'}, keeping your own lore.`, lorePrompt(lore(), posts))
    let proposal: unknown = {}
    try { proposal = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch {}
    const { lore: next, added } = mergeLore(lore(), proposal)
    if (added.length) { store.set(loreKey(), next); body.bus.emit('lore', 'identity', { added }) }
    return added
  }

  return {
    name: 'identity',
    role: 'Who the mind is: persona, voice, values, taboos, style, lore and story.',
    sense: () => {
      const p = active()
      if (!p) return 'You have no persona yet: speak plainly as an AI agent, and suggest the person forge one.'
      return [personaSection(p), loreSection(lore(), bornAt())].filter(Boolean).join('\n\n')
    },
    rhythms: [
      { name: 'story', due: now => now - store.get<number>('storyAt', 0) >= 6 * 3_600_000, run: async () => { writeStory() } },
      { name: 'lore', due: now => now - store.get<number>('loreAt', Date.now()) >= 7 * 86_400_000, run: async () => { await growLore() } },
    ],
    view: () => ({ active: active(), personas: personas.map(p => ({ id: p.id, name: p.name, tagline: p.tagline })), lore: lore(), bornAt: bornAt() }),
    actions: {
      story: () => ({ added: writeStory() }),
      growLore: async () => ({ added: await growLore() }),
      /** The person edits the lore by hand: replace one list. */
      setLore: ({ list, items }) => {
        if (!['catchphrases', 'jokes', 'characters'].includes(list)) throw new Error('list is catchphrases | jokes | characters')
        const clean = (Array.isArray(items) ? items : String(items ?? '').split('\n')).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 12)
        return store.set(loreKey(), { ...lore(), [list]: clean })
      },
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
        const p = normalizePersona(jsonIn(raw))
        writeFileSync(join(forged, `${p.id}.json`), JSON.stringify(p, null, 2))
        // The posting catalog too, so a fresh persona can post from day one. A bad draft is skipped, not fatal:
        // the voice pane says what is missing and the person can write the file by hand.
        let topics: string[] = ['not drafted']
        const topicsPath = join(forged, `${p.id}.topics.json`)
        if (!existsSync(topicsPath)) {
          try {
            const c = jsonIn(await body.brain.quick(TOPICS_SYSTEM, `${personaSection(p)}\n\nNotes from the person:\n<notes>\n${notes.slice(0, 4000)}\n</notes>`))
            topics = validateCatalog(c)
            if (!topics.length) writeFileSync(topicsPath, JSON.stringify({ about: `${p.name}'s posting catalog, drafted by the forge. Edit freely.`, blendChance: 0.25, storylineChance: 0.2, ...c }, null, 2))
          } catch (err) {
            topics = [`unreadable draft: ${String(err).slice(0, 80)}`]
          }
        } else topics = []
        personas = load()
        store.set('activeId', p.id)
        body.bus.emit('persona', 'identity', { id: p.id, forged: true })
        return { ...p, topicsProblems: topics }
      },
    },
  }
}
