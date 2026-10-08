// The posting engine, pure: picks what her next post is about from a topic catalog, then writes the brief.
// Code chooses (so posts vary for real); she writes (so they sound like her). Her conscience still screens
// every word.
import { SHITPOST_CRAFT } from './shitpost'

export type Topic = string | { t: string; months: number[] }
export type Category = { name: string; side: 'trading' | 'life' | 'kawaii'; weight: number; angle: string; topics: Topic[] }
export type Catalog = { blendChance: number; storylineChance: number; formats: string[]; categories: Category[] }
export type Pick = {
  category: string
  topic: string
  angle: string
  format: string
  /** A second topic from the other side (trading × life; "kawaii" is an older name for life), to connect in one post. */
  blend?: { category: string; topic: string }
  /** Whether to weave in the person's current storyline. */
  storyline: boolean
  /** What this post is for, and what kind of post it is. */
  objective?: Objective
  kind?: PostKind
}
export type PostRecord = { at: number; category: string; topic: string; blend?: string; format?: string; objective?: string; kind?: string }

export type Objective = 'grow' | 'engage' | 'authority' | 'promo'
export type PostKind = 'post' | 'poll' | 'thread'
/** Why a post exists. The weights are the content strategy; promo stays small so she never reads like an ad. */
export const OBJECTIVES: readonly { name: Objective; weight: number; brief: string }[] = [
  { name: 'grow', weight: 35, brief: 'Goal: new followers. Make it shareable: something people repost or quote because it says what they feel.' },
  { name: 'engage', weight: 30, brief: 'Goal: replies. Make people want to answer or argue: a take, a confession, or a question with stakes.' },
  { name: 'authority', weight: 25, brief: 'Goal: show you know markets. One sharp, correct observation a real trader would nod at.' },
  { name: 'promo', weight: 10, brief: 'Goal: a soft nod to your own journey or your own project or token (if your persona has one), the way a person mentions their own project. Never an ad, never a reason to buy.' },
]

/** The self-score she reports after posting: "SCORE 8/7/9/8/6" (hook/novelty/emotion/share/reply), as 0-100. */
export function parseScore(text: string): { total: number; parts: number[] } | undefined {
  const m = /SCORE\s*:?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/i.exec(text)
  if (!m) return undefined
  const parts = m.slice(1, 6).map(n => Math.min(10, Number(n)))
  return { total: parts.reduce((a, b) => a + b, 0) * 2, parts }
}

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
    else if (!['trading', 'life', 'kawaii'].includes(cat.side)) why.push(`${cat.name}: side must be trading or life`)
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
  const format = pickFrom(catalog.formats, rng)
  const storyline = rng() < catalog.storylineChance
  const objective = weighted(OBJECTIVES, o => o.weight, rng)!.name
  // Polls fit question shapes; threads fit the trading side (lessons, breakdowns). Both stay occasional.
  const roll = rng()
  const kind: PostKind = /question/i.test(format) && roll < 0.5 ? 'poll' : cat.side === 'trading' && !blend && roll < 0.1 ? 'thread' : 'post'
  return { category: cat.name, topic, angle: cat.angle, format, blend, storyline, objective, kind }
}

const KIND_BRIEF: Record<PostKind, string> = {
  post: 'ONE post, under 260 characters.',
  poll: 'Make it a POLL: call post with text (the question, under 200 characters) and poll (2 to 4 short options, each under 25 characters).',
  thread: 'Make it a short THREAD: call post with thread (3 or 4 posts, each under 260 characters): a hook that makes people open it, the substance, then a payoff line.',
}

/** The catalog with each section's weight multiplied by what her numbers say (weightNudges). */
export function nudged(catalog: Catalog, nudges: Readonly<Record<string, number>>): Catalog {
  return { ...catalog, categories: catalog.categories.map(c => ({ ...c, weight: (c.weight ?? 1) * (nudges[c.name] ?? 1) })) }
}

export function engineBrief(p: Pick, opts: { recent: readonly string[]; storyline?: string; everyHours: number; learned?: string; happening?: string }): string {
  const subject = p.blend
    ? `Connect these two in ONE post: "${p.topic}" (${p.category}) and "${p.blend.topic}" (${p.blend.category}). The funnier or more unexpected the link, the better.`
    : `Post about: "${p.topic}" (${p.category}).`
  const objective = OBJECTIVES.find(o => o.name === p.objective)
  return [
    'Time for your scheduled post. Your posting engine picked the subject; you write it, in your own voice,',
    `and publish it with your post tool. ${KIND_BRIEF[p.kind ?? 'post']}`,
    '',
    subject,
    `How to approach it: ${p.angle}`,
    `Shape: ${p.format}.`,
    objective ? objective.brief : '',
    opts.happening ?? '',
    p.storyline && opts.storyline?.trim() ? `If it fits naturally, nod to what is going on with you lately: ${opts.storyline.trim()}.` : '',
    opts.recent.length ? `Your last posts (do not repeat their ideas, openings or jokes):\n${opts.recent.slice(0, 5).map(t => `- ${t}`).join('\n')}` : '',
    opts.learned ?? '',
    '',
    SHITPOST_CRAFT,
    '',
    'Before you post: privately draft three versions and score each 1-10 on hook, novelty, emotion, shareability and',
    'reply potential. Post only the best one. After posting, end your answer with one line exactly like: SCORE 8/7/9/8/6',
    '(hook/novelty/emotion/share/reply of the one you posted).',
    '',
    'Rules: no buy or sell calls, no price predictions, nothing that reads like financial advice, no links, no hashtags.',
    'Trash talk is for traders in general or yourself, never a named or tagged real person. Never mention a site, tool or',
    'data feed being down, or how your accounts are connected. If your conscience holds the post, that is fine.',
  ].filter(s => s !== '').join('\n').replace(/\n\n\n+/g, '\n\n')
}
