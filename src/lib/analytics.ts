// Measure and learn, pure. Every post becomes a row; rows become a baseline; tags (topic section, shape,
// hour) that beat the baseline get a little more weight next time. Small samples are shrunk toward
// "no effect", so one lucky post never rewrites her whole content mix.

export type PostStat = {
  id: string; at: number; text: string
  category?: string; format?: string; objective?: string
  impressions: number; likes: number; replies: number; reposts: number; quotes: number; bookmarks: number
  profileClicks?: number
}

export type TagResult = { tag: string; n: number; ratio: number }
export type Outlier = { id: string; text: string; ratio: number; why: string[] }
export type Learning = {
  posts: number
  baseline: { impressions: number; engagementRate: number }
  categories: TagResult[]; formats: TagResult[]; hours: TagResult[]; objectives: TagResult[]
  winners: Outlier[]; losers: Outlier[]
}

/** Hours are grouped into four-hour blocks of her local day: 0-3, 4-7, ... 20-23. */
export const hourBlock = (at: number) => { const h = new Date(at).getHours(); const s = h - (h % 4); return `${String(s).padStart(2, '0')}-${String(s + 3).padStart(2, '0')}h` }

export const engagements = (p: PostStat) => p.likes + p.replies + p.reposts + p.quotes + p.bookmarks
export const engagementRate = (p: PostStat) => engagements(p) / Math.max(1, p.impressions)

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** One number per post: reach, with engagement as a bonus. 1.0 is a baseline post. */
export function performance(p: PostStat, base: Learning['baseline']): number {
  const reach = p.impressions / Math.max(1, base.impressions)
  const engage = engagementRate(p) / Math.max(1e-6, base.engagementRate || 1e-6)
  return 0.6 * reach + 0.4 * Math.min(engage, 5)
}

/** Shrinks a tag's average toward 1.0 (no effect) when it has few posts behind it. */
const shrink = (ratio: number, n: number, k = 3) => 1 + (ratio - 1) * (n / (n + k))

function byTag(rows: { tag: string | undefined; perf: number }[]): TagResult[] {
  const groups = new Map<string, number[]>()
  for (const r of rows) if (r.tag) groups.set(r.tag, [...(groups.get(r.tag) ?? []), r.perf])
  return [...groups.entries()]
    .map(([tag, xs]) => ({ tag, n: xs.length, ratio: shrink(xs.reduce((a, b) => a + b, 0) / xs.length, xs.length) }))
    .sort((a, b) => b.ratio - a.ratio)
}

/** Plain reasons a post stood out, from things code can see. */
export function autopsy(p: PostStat, base: Learning['baseline']): string[] {
  const why: string[] = []
  const first = p.text.split(/[.!?\n]/)[0] ?? ''
  if (first.length <= 60) why.push('short, punchy opening')
  if (/\?/.test(p.text)) why.push('asks a question')
  if (/\b[A-Z]{3,}\b/.test(p.text)) why.push('ALL-CAPS moment')
  if (p.text.length < 120) why.push('very short'); else if (p.text.length > 220) why.push('long')
  if (/\$[A-Za-z]{2,}/.test(p.text)) why.push('names a ticker')
  if (p.replies > Math.max(2, (p.likes + 1) / 3)) why.push('started a conversation (many replies)')
  if (p.quotes + p.reposts > p.likes / 4 && p.quotes + p.reposts >= 2) why.push('got shared (reposts and quotes)')
  if (p.bookmarks >= 2) why.push('worth saving (bookmarks)')
  if ((p.profileClicks ?? 0) >= Math.max(3, p.impressions * 0.01)) why.push('sent people to her profile')
  why.push(`posted ${hourBlock(p.at)}`)
  if (p.category) why.push(`section: ${p.category}`)
  if (engagementRate(p) > base.engagementRate * 2) why.push('engagement rate over twice her usual')
  return why
}

export function learn(stats: readonly PostStat[], now = Date.now()): Learning | null {
  // Fresh posts are still collecting views; judge them once they are six hours old.
  const rows = stats.filter(p => now - p.at >= 6 * 3_600_000)
  if (rows.length < 3) return null
  const baseline = { impressions: median(rows.map(p => p.impressions)), engagementRate: median(rows.map(engagementRate)) }
  const scored = rows.map(p => ({ p, perf: performance(p, baseline) }))
  const outlier = (x: { p: PostStat; perf: number }): Outlier => ({ id: x.p.id, text: x.p.text.slice(0, 140), ratio: Math.round(x.perf * 10) / 10, why: autopsy(x.p, baseline) })
  const sorted = [...scored].sort((a, b) => b.perf - a.perf)
  return {
    posts: rows.length,
    baseline,
    categories: byTag(scored.map(x => ({ tag: x.p.category, perf: x.perf }))),
    formats: byTag(scored.map(x => ({ tag: x.p.format, perf: x.perf }))),
    hours: byTag(scored.map(x => ({ tag: hourBlock(x.p.at), perf: x.perf }))),
    objectives: byTag(scored.map(x => ({ tag: x.p.objective, perf: x.perf }))),
    winners: sorted.filter(x => x.perf >= 1.8).slice(0, 3).map(outlier),
    losers: sorted.reverse().filter(x => x.perf <= 0.5).slice(0, 2).map(outlier),
  }
}

/** Topic-section weight multipliers: winners up to 1.6x, losers down to 0.6x, unknown sections untouched. */
export function weightNudges(l: Learning | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of l?.categories ?? []) out[c.tag] = Math.min(1.6, Math.max(0.6, c.ratio))
  return out
}

/** The best hour blocks to post in, once each has a couple of posts behind it. */
export function bestHours(l: Learning | null, top = 3): string[] {
  return (l?.hours ?? []).filter(h => h.n >= 2 && h.ratio > 1).slice(0, top).map(h => h.tag)
}

/** A few lines for her post brief: what has worked, what has not. Empty until there is enough data. */
export function learningNote(l: Learning | null): string {
  if (!l) return ''
  const up = l.categories.filter(c => c.n >= 2 && c.ratio >= 1.2).slice(0, 2).map(c => c.tag)
  const down = l.categories.filter(c => c.n >= 2 && c.ratio <= 0.8).slice(-2).map(c => c.tag)
  const shapes = l.formats.filter(f => f.n >= 2 && f.ratio >= 1.2).slice(0, 2).map(f => f.tag)
  const traits = l.winners.flatMap(w => w.why).filter(w => !/^(posted|section)/.test(w))
  const common = [...new Set(traits)].filter(t => traits.filter(x => x === t).length >= 2).slice(0, 3)
  const lines = [
    up.length ? `Your posts about ${up.join(' and ')} beat your usual.` : '',
    down.length ? `Posts about ${down.join(' and ')} have landed below your usual; give them a fresh angle.` : '',
    shapes.length ? `Shapes that work for you: ${shapes.join(', ')}.` : '',
    common.length ? `Your best posts tend to have: ${common.join(', ')}.` : '',
  ].filter(Boolean)
  return lines.length ? `What your numbers say (${l.posts} posts measured):\n${lines.map(s => `- ${s}`).join('\n')}` : ''
}

/** X's tweet object -> a row, keeping the tags the engine recorded when it posted. */
export function statFromTweet(t: any, tags: { category?: string; format?: string; objective?: string } = {}): PostStat {
  const m = t?.public_metrics ?? {}, np = t?.non_public_metrics ?? {}
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return {
    id: String(t.id), at: Date.parse(t.created_at) || 0, text: String(t.text ?? ''), ...tags,
    impressions: n(np.impression_count ?? m.impression_count), likes: n(m.like_count), replies: n(m.reply_count),
    reposts: n(m.retweet_count), quotes: n(m.quote_count), bookmarks: n(m.bookmark_count),
    profileClicks: np.user_profile_clicks !== undefined ? n(np.user_profile_clicks) : undefined,
  }
}
