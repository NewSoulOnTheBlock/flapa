// The posting engine, pure: picks what her next post is about from a topic catalog, then writes the brief.
// Code chooses (so posts vary for real); she writes (so they sound like her). Her conscience still screens
// every word.

export type Topic = string | { t: string; months: number[] }
export type Category = { name: string; side: 'trading' | 'kawaii'; weight: number; angle: string; topics: Topic[] }
export type Catalog = { blendChance: number; storylineChance: number; formats: string[]; categories: Category[] }
export type Pick = {
  category: string
  topic: string
  angle: string
  format: string
  /** A second topic from the other side (trading × kawaii), to connect in one post. */
  blend?: { category: string; topic: string }
  /** Whether to weave in the person's current storyline. */
  storyline: boolean
}
export type PostRecord = { at: number; category: string; topic: string; blend?: string; format?: string }

/** How many recent posts' topics are off the table; the same category never runs twice in a row. */
export const TOPIC_MEMORY = 40

const name = (t: Topic) => (typeof t === 'string' ? t : t.t)
const inSeason = (t: Topic, month: number) => typeof t === 'string' || t.months.includes(month)

/** Checks a catalog read from disk; returns the problems, or [] when it is usable. */
export function validateCatalog(c: any): string[] {
  const why: string[] = []
  if (!c || !Array.isArray(c.categories) || !c.categories.length) return ['no categories']
  if (!Array.isArray(c.formats) || !c.formats.length) why.push('no formats')
  for (const cat of c.categories) {
    if (!cat?.name) why.push('a category has no name')
    else if (!Array.isArray(cat.topics) || !cat.topics.length) why.push(`${cat.name}: no topics`)
    else if (cat.side !== 'trading' && cat.side !== 'kawaii') why.push(`${cat.name}: side must be trading or kawaii`)
  }
  return why
}

function weighted<T>(items: readonly T[], weight: (x: T) => number, rng: () => number): T | undefined {
  const total = items.reduce((s, x) => s + Math.max(0, weight(x)), 0)
  if (total <= 0) return undefined
  let r = rng() * total
  for (const x of items) {
    r -= Math.max(0, weight(x))
    if (r < 0) return x
  }
  return items.at(-1)
}

const pickFrom = <T>(items: readonly T[], rng: () => number): T => items[Math.floor(rng() * items.length) % items.length]!

/** Topics of a category that are in season and not used lately; all in-season ones when every one was used. */
function freshTopics(cat: Category, used: ReadonlySet<string>, month: number): string[] {
  const seasonal = cat.topics.filter(t => inSeason(t, month)).map(name)
  const fresh = seasonal.filter(t => !used.has(t.toLowerCase()))
  return fresh.length ? fresh : seasonal
}

export function pickTopic(catalog: Catalog, history: readonly PostRecord[], now: Date, rng: () => number = Math.random): Pick {
  const month = now.getMonth() + 1
  const recent = history.slice(-TOPIC_MEMORY)
  const used = new Set(recent.flatMap(r => [r.topic, r.blend ?? ''].filter(Boolean).map(s => s.toLowerCase())))
  const lastCategory = recent.at(-1)?.category
  const usable = catalog.categories.filter(c => c.topics.some(t => inSeason(t, month)))
  const pool = usable.filter(c => c.name !== lastCategory)
  const cat = weighted(pool.length ? pool : usable, c => c.weight ?? 1, rng)!
  const topic = pickFrom(freshTopics(cat, used, month), rng)

  let blend: Pick['blend']
  if (rng() < catalog.blendChance) {
    const other = usable.filter(c => c.side !== cat.side)
    const oc = weighted(other, c => c.weight ?? 1, rng)
    if (oc) blend = { category: oc.name, topic: pickFrom(freshTopics(oc, used, month), rng) }
  }
  return {
    category: cat.name, topic, angle: cat.angle,
    format: pickFrom(catalog.formats, rng),
    blend,
    storyline: rng() < catalog.storylineChance,
  }
}

/** The catalog with each section's weight multiplied by what her numbers say (weightNudges). */
export function nudged(catalog: Catalog, nudges: Readonly<Record<string, number>>): Catalog {
  return { ...catalog, categories: catalog.categories.map(c => ({ ...c, weight: (c.weight ?? 1) * (nudges[c.name] ?? 1) })) }
}

export function engineBrief(p: Pick, opts: { recent: readonly string[]; storyline?: string; everyHours: number; learned?: string }): string {
  const subject = p.blend
    ? `Connect these two in ONE post: "${p.topic}" (${p.category}) and "${p.blend.topic}" (${p.blend.category}). The funnier or more unexpected the link, the better.`
    : `Post about: "${p.topic}" (${p.category}).`
  return [
    `Time for your regular post (every ${opts.everyHours} hours). Your posting engine picked the subject; you write it, in your own voice,`,
    'and publish it with your post tool. ONE post, under 260 characters.',
    '',
    subject,
    `How to approach it: ${p.angle}`,
    `Shape: ${p.format}.`,
    p.storyline && opts.storyline?.trim() ? `If it fits naturally, nod to what is going on with you lately: ${opts.storyline.trim()}.` : '',
    opts.recent.length ? `Your last posts (do not repeat their ideas, openings or jokes):\n${opts.recent.slice(0, 5).map(t => `- ${t}`).join('\n')}` : '',
    opts.learned ?? '',
    '',
    'Rules: no buy or sell calls, no price predictions, nothing that reads like financial advice, no links, no hashtags.',
    'Trash talk is for traders in general or yourself, never a named or tagged real person. Never mention a site, tool or',
    'data feed being down, or how your accounts are connected. If your conscience holds the post, that is fine.',
  ].filter(s => s !== '').join('\n').replace(/\n\n\n+/g, '\n\n')
}
