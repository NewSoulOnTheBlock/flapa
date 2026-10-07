// Lore and story, pure. Lore (catchphrases, running jokes, recurring characters) grows slowly: at most two
// additions a week, so her character evolves without lurching. Story chapters are written from what really
// happened (trades, follower milestones, a post that blew up), so her timeline is true.

export type Chapter = { key: string; at: number; title: string }
export type Lore = { catchphrases: string[]; jokes: string[]; characters: string[]; chapters: Chapter[] }
export const EMPTY_LORE: Lore = { catchphrases: [], jokes: [], characters: [], chapters: [] }
const CAP = { catchphrases: 12, jokes: 12, characters: 10, chapters: 40 }
export const MAX_NEW_PER_RUN = 2

const clean = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 160) : '')
const known = (list: readonly string[], s: string) => list.some(x => x.toLowerCase() === s.toLowerCase())

/** Adds at most MAX_NEW_PER_RUN new entries across all lists, newest kept when a list is full. */
export function mergeLore(lore: Lore, proposal: any): { lore: Lore; added: string[] } {
  const next: Lore = { ...lore, catchphrases: [...lore.catchphrases], jokes: [...lore.jokes], characters: [...lore.characters] }
  const added: string[] = []
  for (const k of ['catchphrases', 'jokes', 'characters'] as const) {
    for (const raw of Array.isArray(proposal?.[k]) ? proposal[k] : []) {
      const s = clean(raw)
      if (added.length >= MAX_NEW_PER_RUN || s.length < 3 || known(next[k], s)) continue
      next[k] = [...next[k], s].slice(-CAP[k])
      added.push(`${k}: ${s}`)
    }
  }
  return { lore: next, added }
}

export function lorePrompt(lore: Lore, recentPosts: readonly string[]): string {
  return [
    'Your recent posts (data):', ...recentPosts.slice(0, 20).map(p => `- ${p.slice(0, 200)}`), '',
    `Your lore so far: catchphrases ${JSON.stringify(lore.catchphrases)}, running jokes ${JSON.stringify(lore.jokes)}, recurring characters ${JSON.stringify(lore.characters)}.`,
    '',
    'Did anything in these posts become (or deserve to become) a catchphrase, a running joke, or a recurring character',
    '(an object, a rival archetype, a pet, a place, an imaginary financial advisor or lawyer)? Propose at most two NEW',
    'items that grew out of what you actually posted. A running joke should be able to evolve (the advisor resigns, the',
    'new advisor bought the top), not just repeat. Nothing about real named people.',
    'Answer with only JSON: {"catchphrases": [], "jokes": [], "characters": []}',
  ].join('\n')
}

export type StoryInput = {
  bornAt: number
  trades: readonly { at: number; side: string; symbol: string; pnlBnb?: number; paper: boolean }[]
  followers: readonly { at: number; followers: number }[]
  bigPosts: readonly { at: number; ratio: number; text: string }[]
}

const MILESTONES = [100, 150, 200, 250, 500, 750, 1000, 2000, 5000, 10000]

/** Chapters from real events, keyed so each one is written once. */
export function storyChapters(s: StoryInput, have: ReadonlySet<string>): Chapter[] {
  const out: Chapter[] = []
  const add = (key: string, at: number, title: string) => { if (!have.has(key) && !out.some(c => c.key === key)) out.push({ key, at, title }) }
  const byTime = [...s.trades].sort((a, b) => a.at - b.at)
  const first = byTime.find(t => t.side === 'buy')
  if (first) add('first-trade', first.at, `first trade${first.paper ? ' (paper)' : ''}: $${first.symbol}`)
  const firstLive = byTime.find(t => t.side === 'buy' && !t.paper)
  if (firstLive) add('first-live-trade', firstLive.at, `first REAL trade: $${firstLive.symbol}`)
  const wins = byTime.filter(t => t.side === 'sell' && (t.pnlBnb ?? 0) > 0)
  if (wins[0]) add('first-win', wins[0].at, `first win: $${wins[0].symbol} (+${wins[0].pnlBnb!.toFixed(4)} BNB${wins[0].paper ? ', paper' : ''})`)
  for (const t of byTime) {
    if (t.side === 'sell' && (t.pnlBnb ?? 0) <= -0.005) add(`loss-${t.at}`, t.at, `got wrecked on $${t.symbol} (${t.pnlBnb!.toFixed(4)} BNB${t.paper ? ', paper' : ''})`)
  }
  let streak = 0
  for (const t of byTime.filter(t => t.side === 'sell')) {
    streak = (t.pnlBnb ?? 0) > 0 ? streak + 1 : 0
    if (streak === 3) add(`streak-${t.at}`, t.at, `three wins in a row, ending on $${t.symbol}`)
  }
  for (const m of MILESTONES) {
    const hit = s.followers.find(f => f.followers >= m)
    if (hit) add(`followers-${m}`, hit.at, `hit ${m} followers`)
  }
  for (const p of s.bigPosts.filter(p => p.ratio >= 3)) add(`viral-${p.at}`, p.at, `a post blew up (${p.ratio}x her usual): "${p.text.slice(0, 60)}"`)
  return out.sort((a, b) => a.at - b.at)
}

export const dayOf = (bornAt: number, at: number) => Math.max(1, Math.floor((at - bornAt) / 86_400_000) + 1)

export function loreSection(lore: Lore, bornAt: number): string {
  const lines = [
    lore.catchphrases.length ? `Your catchphrases (use one now and then, never forced): ${lore.catchphrases.join(' · ')}` : '',
    lore.jokes.length ? `Running jokes your followers know: ${lore.jokes.join(' · ')}` : '',
    lore.characters.length ? `Recurring characters in your world: ${lore.characters.join(' · ')}` : '',
    lore.chapters.length ? `Your story so far (true events):\n${lore.chapters.slice(-6).map(c => `- Day ${dayOf(bornAt, c.at)}: ${c.title}`).join('\n')}` : '',
  ].filter(Boolean)
  return lines.length ? `# Your lore\n${lines.join('\n')}` : ''
}

/** Phrases she never says, found in a draft (case-insensitive). */
export function neverHits(text: string, never: readonly string[]): string[] {
  return never.filter(n => {
    const p = n.trim()
    if (!p) return false
    // Whole words only where the phrase starts or ends with a letter: "nfa" must not catch "unfair".
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`${/^\w/.test(p) ? '\\b' : ''}${esc}${/\w$/.test(p) ? '\\b' : ''}`, 'i').test(text)
  })
}
