// voice — the mind's presence on X. Was PACS x-bridge (API transport; the Chrome transports
// depended on Claude Code's browser extension and stay behind). Paper mode keeps posts in a local feed.
import type { Body } from '../core/body'
import type { Mode, Organ, Outward } from '../core/types'
import { cleanReply, newerId, nextSinceId, pickNew, replySystem, CHECK_EVERY_MS, type XMention } from '../lib/autoreply'
import { checkCrisis, statementPrompt } from '../lib/crisis'
import { neverHits } from '../lib/lore'
import { notePerson, opportunityQuery, pickOpportunities, planMention, replyBrief, strength, YELLOW_FOLLOWERS, type Candidate as ReplyCandidate, type Person } from '../lib/social'
import type { MemoryOrgan } from './memory'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { authorization, credentialsFromEnv, nonce, pct } from '../lib/oauth'
import { bestHours, learn, learningNote, statFromTweet, weightNudges, type Learning, type PostStat } from '../lib/analytics'
import { engineBrief, nudged, parseScore, pickTopic, validateCatalog, type Catalog, type Pick as TopicPick, type PostRecord } from '../lib/posting'
import { nextSlots, slotDue, slotHours } from '../lib/calendar'
import { MAX_WEIGHT, weightedLength } from '../lib/xtext'

const API = 'https://api.x.com/2'

/** `topic` is what the posting engine picked for it, for the feed and the dashboard; category and format feed the learning. */
export type Posted = {
  id: string; text: string; at: number; mode: Mode; url?: string; replyTo?: string; topic?: string; category?: string; format?: string
  objective?: string; kind?: string; score?: number
}
/** Her own posts' numbers are read this often (X reads cost money: four times a day is plenty). */
const METRICS_EVERY_MS = 6 * 3_600_000
export type FollowerPoint = { at: number; followers: number }
type Reply = { mode: 'post' | 'off'; sinceId?: string; handled: string[]; lastCheckAt?: number }

/** Her own posts on a clock. 'slots' (the default) posts perDay times at her best hours; 'every' keeps a fixed
 *  period and is armed by its first post (lastPostAt stays 0 until then, so nothing fires early). */
export type Schedule = { isOn: boolean; everyHours: number; lastPostAt: number; lastTryAt: number; themes: string; mode?: 'slots' | 'every'; perDay?: number }
/** What the person wants her posts about right now (set from the dashboard; 2026-10-06's ask is the default). */
export const DEFAULT_THEMES = 'your new harness (your body) is being built, and you are about to start trading'
const SCHEDULE: Schedule = { isOn: false, everyHours: 8, lastPostAt: 0, lastTryAt: 0, themes: DEFAULT_THEMES }
/** When she tried and nothing went out (the brain stumbled), she tries again this much later, not every tick. */
const RETRY_MS = 30 * 60_000

export function scheduleDue(s: Pick<Schedule, 'isOn' | 'everyHours' | 'lastPostAt' | 'lastTryAt'>, now: number): boolean {
  return s.isOn && s.lastPostAt > 0 && now - s.lastPostAt >= s.everyHours * 3_600_000 && now - s.lastTryAt >= RETRY_MS
}

export function postBrief(everyHours: number, themes = DEFAULT_THEMES): string {
  return [
    `Time for your regular post (every ${everyHours} hours). Write ONE post for X, in your own voice, and publish it with`,
    'your post tool.',
    themes.trim() ? `What to post about for now, as the person asked: ${themes.trim()}. Find a fresh angle each time.` : '',
    'You may also weave in your mood, a goal on your agenda, a stance you hold, or a chart you looked at.',
    'Never mention a site, tool or data feed being down, broken or not loading (fomo included), and never the',
    'mechanics of how your accounts are connected. Show the excitement, not the plumbing.',
    "Don't repeat your recent posts (the feed tool shows them). Under 260 characters. No buy calls, no price",
    'predictions, no links. If your conscience holds it, that is fine: it waits for the person.',
  ].filter(Boolean).join('\n')
}

export type VoiceOptions = { fetcher?: typeof fetch; catalogDir?: string; rng?: () => number }

export function voice(body: Body, opts: VoiceOptions | typeof fetch = {}): Organ {
  const { fetcher = fetch, catalogDir, rng = Math.random } = typeof opts === 'function' ? { fetcher: opts } : opts
  const store = body.store('voice')
  const creds = () => credentialsFromEnv(process.env)
  const reply = () => ({ mode: 'off', handled: [], ...store.get<Partial<Reply>>('reply', {}) }) as Reply
  const schedule = () => ({ mode: 'slots' as const, perDay: 3, ...SCHEDULE, ...store.get<Partial<Schedule>>('schedule', {}) })
  // The day's posting hours follow her best hours; recomputed at most once a minute.
  let slotMemo = { at: 0, hours: [] as number[] }
  const hours = () => {
    if (Date.now() - slotMemo.at > 60_000) slotMemo = { at: Date.now(), hours: slotHours(bestHours(learning()), schedule().perDay ?? 3) }
    return slotMemo.hours
  }
  const due = (now: number) => {
    const s = schedule()
    return s.mode === 'every' ? scheduleDue(s, now) : s.isOn && slotDue(now, hours(), s.lastPostAt, s.lastTryAt, RETRY_MS)
  }
  const nextPostAt = () => {
    const s = schedule()
    if (!s.isOn) return null
    if (s.mode === 'every') return s.lastPostAt ? s.lastPostAt + s.everyHours * 3_600_000 : null
    return nextSlots(Date.now(), hours(), 1)[0] ?? null
  }
  const setSchedule = (s: Partial<Schedule>) => store.set('schedule', { ...schedule(), ...s })
  const history = () => store.get<PostRecord[]>('postHistory', [])

  /** The active persona's topic catalog (personas/<id>.topics.json), read fresh so edits apply on the next post. */
  function catalog(): { catalog?: Catalog; problems: string[]; path?: string } {
    if (!catalogDir) return { problems: ['no catalog folder'] }
    const path = join(catalogDir, `${body.personaId()}.topics.json`)
    if (!existsSync(path)) return { problems: [`no ${body.personaId()}.topics.json`], path }
    try {
      const c = JSON.parse(readFileSync(path, 'utf8'))
      const problems = validateCatalog(c)
      return problems.length ? { problems, path } : { catalog: { blendChance: 0.25, storylineChance: 0.2, ...c }, problems, path }
    } catch (err) {
      return { problems: [`unreadable: ${String(err).slice(0, 120)}`], path }
    }
  }

  /** One scheduled post. The clock only restarts when a post actually went out (or is held for the person). */
  let posting = false
  async function scheduledPost(): Promise<string> {
    if (posting) return 'already writing one'
    posting = true
    try {
      setSchedule({ lastTryAt: Date.now() })
      const { catalog: cat } = catalog()
      const learned = learning()
      const pick: TopicPick | undefined = cat ? pickTopic(nudged(cat, weightNudges(learned)), history(), new Date(), rng) : undefined
      const recent = store.get<Posted[]>('posted', []).filter(p => !p.replyTo).slice(0, 5).map(p => p.text)
      const brief = pick
        ? engineBrief(pick, { recent, storyline: schedule().themes, everyHours: schedule().everyHours, learned: learningNote(learned) })
        : postBrief(schedule().everyHours, schedule().themes)
      if (pick) body.bus.emit('topic', 'voice', { topic: pick.topic, category: pick.category, blend: pick.blend?.topic ?? null, format: pick.format })
      const r = await body.think({ kind: 'post', text: brief, from: 'voice' })
      const sent = r.tools.find(t => t.name === 'post' && /^(done|held)/.test(t.result))
      if (sent) {
        setSchedule({ lastPostAt: Date.now() })
        if (pick) {
          store.update<PostRecord[]>('postHistory', [], h => [...h, { at: Date.now(), category: pick.category, topic: pick.topic, blend: pick.blend?.topic, format: pick.format, objective: pick.objective, kind: pick.kind }].slice(-200))
          const label = pick.blend ? `${pick.topic} × ${pick.blend.topic}` : pick.topic
          // A post that went out carries its topic; one held for the person carries it on its approval card's summary.
          if (/^done/.test(sent.result)) store.update<Posted[]>('posted', [], l => (l[0] ? [{ ...l[0], topic: label, category: pick.category, format: pick.format, objective: pick.objective, kind: pick.kind, score: parseScore(r.text)?.total }, ...l.slice(1)] : l))
        }
      }
      body.bus.emit('schedule', 'voice', { posted: !!sent, topic: pick?.topic ?? null, result: sent?.result.slice(0, 200) ?? r.text.slice(0, 200) })
      return sent ? sent.result : `no post went out: ${r.text.slice(0, 200)}`
    } finally {
      posting = false
    }
  }

  async function x(method: 'GET' | 'POST', path: string, json?: unknown): Promise<any> {
    const c = creds()
    if (!c) throw new Error('X is not connected: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET')
    const url = `${API}${path}`
    const r = await fetcher(url, {
      method,
      headers: {
        authorization: authorization(c, method, url, { nonce: nonce(), timestamp: Math.floor(Date.now() / 1000) }),
        ...(json ? { 'content-type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
    })
    const body_ = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`X answered ${r.status}: ${JSON.stringify(body_?.detail ?? body_?.title ?? body_).slice(0, 200)}`)
    return body_
  }

  async function me(): Promise<{ id: string; username: string }> {
    const cached = store.get<{ id: string; username: string } | null>('me', null)
    if (cached) return cached
    const r = await x('GET', '/users/me')
    return store.set('me', { id: r.data.id, username: r.data.username })
  }

  async function readMentions(since?: string): Promise<XMention[]> {
    const { id } = await me()
    // One read brings the authors (with follower counts) and the post each mention answers, for context.
    const r = await x('GET', `/users/${id}/mentions?max_results=20&tweet.fields=created_at,referenced_tweets&expansions=author_id,referenced_tweets.id&user.fields=username,public_metrics${since ? `&since_id=${since}` : ''}`)
    const users = new Map<string, any>((r.includes?.users ?? []).map((u: any) => [u.id, u]))
    const parents = new Map<string, string>((r.includes?.tweets ?? []).map((t: any) => [t.id, t.text]))
    const list: XMention[] = (r.data ?? []).map((t: any) => {
      const u = users.get(t.author_id)
      const parent = (t.referenced_tweets ?? []).find((x: any) => x.type === 'replied_to' || x.type === 'quoted')
      return { id: t.id, author: u?.username ?? t.author_id, text: t.text, at: Date.parse(t.created_at) || Date.now(), followers: Number(u?.public_metrics?.followers_count) || 0, context: parent ? parents.get(parent.id) : undefined }
    })
    const fresh = list.filter(m => !store.get<XMention[]>('mentions', []).some(o => o.id === m.id))
    store.update<Record<string, Person>>('people', {}, p => fresh.reduce((acc, m) => notePerson(acc, { handle: m.author, at: m.at ?? Date.now(), text: m.text, kind: planMention(m.text, m.followers).kind, followers: m.followers }), p))
    const seen = new Set(list.map(m => m.id))
    store.set('mentions', [...list, ...store.get<XMention[]>('mentions', []).filter(m => !seen.has(m.id))].slice(0, 50))
    if (list[0]) store.set('watchSince', list.reduce((a, m) => (newerId(m.id, a) ? m.id : a), store.get<string>('watchSince', list[0].id)))
    await crisisWatch()
    return list
  }
  const fetchMentions = () => readMentions(reply().sinceId)

  /** A pile-on of hostile mentions pauses everything, drafts a calm statement, and tells the person. */
  async function crisisWatch(): Promise<void> {
    const c = checkCrisis(store.get<XMention[]>('mentions', []), Date.now())
    if (!c.isCrisis || store.get<{ active?: boolean } | null>('crisis', null)?.active) return
    const why = `crisis: ${c.hostile} hostile mentions from ${c.authors} accounts in the last hour`
    if (body.has('conscience')) body.organ('conscience').actions?.dial?.({ dial: 'paused', why })
    let draft = ''
    try { draft = (await body.brain.quick(replySystem(persona()), statementPrompt(c.sample))).trim().replace(/^["']|["']$/g, '').slice(0, 280) } catch {}
    store.set('crisis', { active: true, at: Date.now(), why, sample: c.sample, draft })
    if (body.has('agenda')) body.organ('agenda').actions?.add?.({ text: `Crisis: ${why}. Posting is paused. Read the mentions and her draft statement on the dashboard, then set the dial back to auto.` })
    body.bus.emit('crisis', 'voice', { why })
  }

  const learning = (): Learning | null => learn(store.get<PostStat[]>('stats', []))

  const mem = () => (body.has('memory') ? body.organ<MemoryOrgan>('memory') : null)
  const remembered = async (handle: string, text: string) => { try { return (await mem()?.aboutPerson(handle, text)) ?? [] } catch { return [] } }

  /** Writes and sends one reply (or holds it): through the same gate as every post. Returns the gate's answer. */
  async function answer(o: { replyTo: string; author: string; text: string; context?: string; kind: Parameters<typeof replyBrief>[0]['kind']; yellow?: string }): Promise<string | null> {
    const brief = replyBrief({ author: o.author, text: o.text, context: o.context, remembered: await remembered(o.author, o.text), kind: o.kind })
    const text = cleanReply(await body.brain.quick(replySystem(persona()), brief), o.author)
    if (text && neverHits(text, persona().never).length) return null
    if (!text || tooLong(text)) return null
    const result = await body.act({
      organ: 'voice', kind: 'reply', summary: `reply to @${o.author}: ${text}`, text, context: o.text, payload: { text, replyTo: o.replyTo }, by: 'rhythm',
      ...(o.yellow ? { tier: 'yellow' as const, tierWhy: o.yellow } : {}),
    })
    if (/^done/.test(result)) {
      store.update<Record<string, Person>>('people', {}, p => notePerson(p, { handle: o.author, at: Date.now(), text, replied: true }))
      await mem()?.notePerson(o.author, o.text, text)
    }
    return result
  }

  type Outbound = { isOn: boolean; watch: string[]; perDay: number; lastAt: number }
  const OUTBOUND: Outbound = { isOn: false, watch: [], perDay: 6, lastAt: 0 }
  const outbound = (): Outbound => ({ ...OUTBOUND, ...store.get<Partial<Outbound>>('outbound', {}) })
  type OutLog = { at: number; id: string; author: string; score: number; parts: Record<string, number>; result: string }

  /** One outbound pass: search her watch list (or niche), score the posts, answer the best one. */
  async function seekReplies(): Promise<string> {
    const cfg = outbound()
    store.set('outbound', { ...cfg, lastAt: Date.now() })
    const log = store.get<OutLog[]>('outboundLog', [])
    const today = log.filter(l => Date.now() - l.at < 86_400_000 && /^(done|held)/.test(l.result)).length
    if (today >= cfg.perDay) return `daily cap reached (${cfg.perDay})`
    const q = pct(opportunityQuery(cfg.watch.length ? cfg.watch : persona().favorites))
    const r = await x('GET', `/tweets/search/recent?query=${q}&max_results=20&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,public_metrics`)
    const users = new Map<string, any>((r.includes?.users ?? []).map((u: any) => [u.id, u]))
    const cands: ReplyCandidate[] = (r.data ?? []).map((t: any) => {
      const u = users.get(t.author_id), m = t.public_metrics ?? {}
      return { id: t.id, author: u?.username ?? t.author_id, authorFollowers: Number(u?.public_metrics?.followers_count) || 0, text: t.text, at: Date.parse(t.created_at) || 0, likes: m.like_count ?? 0, replies: m.reply_count ?? 0, reposts: m.retweet_count ?? 0 }
    })
    const { username } = await me()
    const best = pickOpportunities(cands, Date.now(), new Set((cfg.watch.length ? cfg.watch : persona().favorites).map(w => w.replace(/^@/, '').toLowerCase())), { self: username, already: new Set(log.map(l => l.id)) })[0]
    if (!best) return `nothing worth a reply among ${cands.length} posts`
    const big = best.c.authorFollowers >= YELLOW_FOLLOWERS ? `@${best.c.author} has ${best.c.authorFollowers.toLocaleString('en-US')} followers` : undefined
    const result = (await answer({ replyTo: best.c.id, author: best.c.author, text: best.c.text, kind: 'outbound', yellow: big })) ?? 'no reply written'
    store.update<OutLog[]>('outboundLog', [], l => [{ at: Date.now(), id: best.c.id, author: best.c.author, score: best.score, parts: best.parts, result: result.slice(0, 200) }, ...l].slice(0, 100))
    return result
  }

  /** Reads her own recent posts' numbers and her follower count. Tags come from what the engine recorded. */
  async function measure(): Promise<string> {
    store.set('metricsAt', Date.now())
    const { id } = await me()
    const fields = 'created_at,public_metrics,non_public_metrics'
    const path = (f: string) => `/users/${id}/tweets?max_results=40&exclude=replies,retweets&tweet.fields=${f}`
    // Private metrics only exist for the last 30 days; older pages fall back to public numbers.
    const r = await x('GET', path(fields)).catch(() => x('GET', path('created_at,public_metrics')))
    const posted = store.get<Posted[]>('posted', [])
    const tags = new Map(posted.map(p => [p.id, { category: p.category, format: p.format, objective: p.objective }]))
    // Posts made before tagging existed: match the engine's record by time (within ten minutes).
    const records = history()
    const tagFor = (tweetId: string, at: number) => tags.get(tweetId)?.category
      ? tags.get(tweetId)!
      : (() => { const h = records.find(r => Math.abs(r.at - at) < 10 * 60_000); return h ? { category: h.category, format: h.format, objective: h.objective } : {} })()
    const fresh = (r.data ?? []).map((t: any) => statFromTweet(t, tagFor(String(t.id), Date.parse(t.created_at) || 0)))
    const keep = new Map(store.get<PostStat[]>('stats', []).map(s => [s.id, s]))
    for (const s of fresh) keep.set(s.id, s)
    store.set('stats', [...keep.values()].sort((a, b) => b.at - a.at).slice(0, 300))
    const u = await x('GET', '/users/me?user.fields=public_metrics')
    const followers = Number(u.data?.public_metrics?.followers_count)
    if (Number.isFinite(followers)) store.update<FollowerPoint[]>('followers', [], l => [...l, { at: Date.now(), followers }].slice(-400))
    body.bus.emit('measured', 'voice', { posts: fresh.length, followers })
    return `measured ${fresh.length} posts; ${followers} followers`
  }

  const growth = () => {
    const l = store.get<FollowerPoint[]>('followers', [])
    const now = l.at(-1)
    const weekAgo = l.find(p => p.at >= Date.now() - 7 * 86_400_000)
    return now ? { followers: now.followers, week: weekAgo ? now.followers - weekAgo.followers : 0, at: now.at } : null
  }

  const persona = () => {
    const p = body.has('identity') ? (body.organ('identity').view?.() as any)?.active : null
    return { name: p?.name ?? 'agent', handle: p?.handle ?? '', tagline: p?.tagline ?? '', voice: p?.voice ?? '', examples: p?.examples ?? [], taboos: p?.taboos ?? [], never: (p?.style?.never ?? []) as string[], favorites: (p?.favorites ?? []) as string[] }
  }

  const tooLong = (text: string) => {
    const w = weightedLength(text)
    return w > MAX_WEIGHT ? `error: ${w} of ${MAX_WEIGHT} characters (CJK and emoji count 2, links 23); shorten it` : null
  }

  return {
    name: 'voice',
    role: 'Posts and replies on X. Paper mode keeps a local feed; live posts for real.',
    liveReady: () => (creds() ? undefined : 'set the four X_* environment variables before going live'),
    tools: [
      {
        name: 'post',
        description: 'Publish a post on X in your own voice: a single post, a poll (text is the question, plus 2-4 options), or a short thread (3-4 posts). It passes your conscience first and may be held for the person.',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'the post, or the poll question' },
            poll: { type: 'array', items: { type: 'string' }, description: 'poll options, 2 to 4, each under 25 characters' },
            thread: { type: 'array', items: { type: 'string' }, description: 'a thread instead of one post: 3 or 4 posts in order' },
          },
          required: ['text'],
        },
        run: async ({ text, poll, thread }, turn) => {
          const by = turn.stimulus.kind === 'chat' ? 'agent' : 'rhythm'
          const parts = Array.isArray(thread) && thread.length ? thread.map((p: unknown) => String(p ?? '').trim()).filter(Boolean) : [String(text ?? '').trim()]
          const banned = parts.flatMap(p => neverHits(p, persona().never))
          if (banned.length) return `error: uses "${banned[0]}", which you never say; rewrite it in your own words`
          if (!parts[0]) return 'error: empty post'
          if (parts.length > 5) return 'error: a thread is at most 5 posts'
          for (const p of parts) { const long = tooLong(p); if (long) return long }
          const options = Array.isArray(poll) ? poll.map((o: unknown) => String(o ?? '').trim()).filter(Boolean) : []
          if (options.length && (options.length < 2 || options.length > 4 || options.some(o => o.length > 25))) return 'error: a poll has 2 to 4 options, each under 25 characters'
          if (options.length && parts.length > 1) return 'error: a post is a poll or a thread, not both'
          const all = options.length ? `${parts[0]}\n${options.map(o => `◻ ${o}`).join('\n')}` : parts.join('\n\n')
          const label = options.length ? 'poll' : parts.length > 1 ? `thread (${parts.length})` : 'post'
          return body.act({ organ: 'voice', kind: 'post', summary: `${label}: ${all}`, text: all, payload: { text: parts[0], ...(options.length ? { poll: options } : {}), ...(parts.length > 1 ? { thread: parts } : {}) }, by })
        },
      },
      {
        name: 'feed',
        description: 'Your recent posts (paper and live) and the newest mentions of you.',
        input_schema: { type: 'object', properties: {} },
        run: () => {
          const posted = store.get<Posted[]>('posted', []).slice(0, 8)
          const mentions = store.get<XMention[]>('mentions', []).slice(0, 8)
          return [
            'Your posts:', ...(posted.length ? posted.map(p => `- [${p.mode}] ${p.text}`) : ['(none yet)']),
            'Mentions:', ...(mentions.length ? mentions.map(m => `- @${m.author}: ${m.text}`) : ['(none seen)']),
          ].join('\n')
        },
      },
    ],
    perform: async (o: Outward, mode: Mode) => {
      const text = String(o.payload.text)
      const replyTo = o.payload.replyTo ? String(o.payload.replyTo) : undefined
      const poll = Array.isArray(o.payload.poll) ? (o.payload.poll as string[]) : undefined
      const thread = Array.isArray(o.payload.thread) ? (o.payload.thread as string[]) : undefined
      const shown = poll ? `${text}\n${poll.map(p => `◻ ${p}`).join('\n')}` : thread ? thread.join('\n\n') : text
      let entry: Posted
      if (mode === 'paper') {
        entry = { id: `paper-${o.id}`, text: shown, at: Date.now(), mode, replyTo, ...(poll ? { kind: 'poll' } : thread ? { kind: 'thread' } : {}) }
      } else {
        const r = await x('POST', '/tweets', {
          text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
          ...(poll ? { poll: { options: poll, duration_minutes: 1440 } } : {}),
        })
        // A thread: each later post answers the one before it.
        let prev = r.data.id
        for (const next of thread?.slice(1) ?? []) prev = (await x('POST', '/tweets', { text: next, reply: { in_reply_to_tweet_id: prev } })).data.id
        const { username } = await me()
        entry = { id: r.data.id, text: shown, at: Date.now(), mode, replyTo, url: `https://x.com/${username}/status/${r.data.id}`, ...(poll ? { kind: 'poll' } : thread ? { kind: 'thread' } : {}) }
      }
      store.update<Posted[]>('posted', [], l => [entry, ...l].slice(0, 100))
      body.bus.emit('posted', 'voice', entry)
      return entry.url ?? `${o.kind} kept in the paper feed`
    },
    rhythms: [{
      name: 'metrics',
      due: now => !!creds() && now - store.get<number>('metricsAt', 0) >= METRICS_EVERY_MS,
      run: async () => { await measure() },
    }, {
      name: 'outbound-replies',
      due: now => !!creds() && outbound().isOn && now - outbound().lastAt >= 2 * 3_600_000,
      run: async () => { await seekReplies() },
    }, {
      // With auto-reply off, mentions are still read (from the newest one seen) so a pile-on is never missed.
      name: 'watch',
      due: (now, last) => !!creds() && reply().mode !== 'post' && now - last >= CHECK_EVERY_MS,
      run: async () => { await readMentions(store.get<string | undefined>('watchSince', undefined)) },
    }, {
      name: 'scheduled-post',
      due: now => due(now),
      run: scheduledPost,
    }, {
      name: 'autoreply',
      due: (now, last) => reply().mode === 'post' && !!creds() && now - last >= CHECK_EVERY_MS,
      run: async () => {
        const cfg = reply()
        const fresh = await fetchMentions()
        const { username } = await me()
        const handled = new Set(cfg.handled)
        const todo = pickNew(fresh, handled, username)
        // Mentions past the per-check cap wait for the next check: the since_id stops short of them.
        const mark = () => store.set('reply', { ...reply(), handled: [...handled].slice(-500), sinceId: nextSinceId(fresh, handled, username, cfg.sinceId), lastCheckAt: Date.now() })
        for (const m of todo) {
          handled.add(m.id) // Marked before answering: a crash mid-reply must never answer twice.
          mark()
          const plan = planMention(m.text, m.followers)
          store.update<{ id: string; author: string; kind: string; reply: string; why: string; at: number }[]>('triage', [], l => [{ id: m.id, author: m.author, kind: plan.kind, reply: plan.reply, why: plan.why, at: Date.now() }, ...l].slice(0, 60))
          if (plan.reply === 'skip') continue
          await answer({ replyTo: m.id, author: m.author, text: m.text, context: m.context, kind: plan.kind, yellow: plan.reply === 'yellow' ? plan.why : undefined })
        }
        mark()
      },
    }],
    view: () => ({
      connected: !!creds(), me: store.get('me', null), reply: { ...reply(), handled: reply().handled.length },
      schedule: { ...schedule(), nextAt: nextPostAt(), hours: hours(), calendar: schedule().isOn && schedule().mode !== 'every' ? nextSlots(Date.now(), hours(), 6) : [] },
      engine: (() => {
        const { catalog: cat, problems } = catalog()
        return {
          ok: !!cat, problems,
          categories: cat?.categories.length ?? 0,
          topics: cat?.categories.reduce((n, c) => n + c.topics.length, 0) ?? 0,
          recent: history().slice(-8).reverse(),
        }
      })(),
      posted: store.get<Posted[]>('posted', []).slice(0, 30), mentions: store.get<XMention[]>('mentions', []).slice(0, 15),
      crisis: store.get('crisis', null),
      people: Object.values(store.get<Record<string, Person>>('people', {}))
        .map(p => ({ ...p, strength: Math.round(strength(p) * 100) / 100 }))
        .sort((a, b) => b.strength - a.strength || b.lastAt - a.lastAt).slice(0, 20),
      triage: store.get('triage', []).slice(0, 10),
      outbound: { ...outbound(), log: store.get<OutLog[]>('outboundLog', []).slice(0, 8) },
      analytics: (() => {
        const l = learning()
        return { growth: growth(), measuredAt: store.get<number>('metricsAt', 0), learning: l, bestHours: bestHours(l), note: learningNote(l) }
      })(),
    }),
    actions: {
      autoreply: ({ isOn }) => store.set('reply', { ...reply(), mode: isOn ? 'post' : 'off' }),
      /** Outbound replies: on/off, the accounts she watches, and a daily cap. */
      outbound: ({ isOn, watch, perDay }) => {
        const next = { ...outbound() }
        if (typeof isOn === 'boolean') next.isOn = isOn
        if (watch !== undefined) next.watch = String(watch).split(/[\s,]+/).map(h => h.replace(/^@/, '')).filter(h => /^\w{1,15}$/.test(h)).slice(0, 15)
        if (perDay !== undefined) {
          const n = Number(perDay)
          if (!(n >= 1 && n <= 24)) throw new Error('1 to 24 outbound replies a day')
          next.perDay = n
        }
        return store.set('outbound', next)
      },
      seekNow: async () => ({ result: await seekReplies() }),
      /** The person has handled it: the crisis banner goes away (the dial is theirs to set back). */
      clearCrisis: () => store.set('crisis', { ...(store.get<object | null>('crisis', null) ?? {}), active: false }),
      /** Reads her posts' numbers now instead of waiting for the six-hour clock. */
      measureNow: async () => ({ result: await measure() }),
      /** Turns the clock on or off, or changes its period. Turning it on arms nothing: the first post does. */
      schedule: ({ isOn, everyHours, themes, mode, perDay }) => {
        const s: Partial<Schedule> = {}
        if (typeof themes === 'string') s.themes = themes.trim().slice(0, 400)
        if (typeof isOn === 'boolean') s.isOn = isOn
        if (everyHours !== undefined) {
          const h = Number(everyHours)
          if (!(h >= 1 && h <= 168)) throw new Error('every 1 to 168 hours')
          s.everyHours = h
        }
        if (mode === 'slots' || mode === 'every') s.mode = mode
        if (perDay !== undefined) {
          const n = Number(perDay)
          if (!(n >= 1 && n <= 6)) throw new Error('1 to 6 posts a day')
          s.perDay = n
        }
        slotMemo.at = 0
        return setSchedule(s)
      },
      /** Writes and posts one now; when it goes out, the clock starts over from here. */
      postNow: async () => ({ result: await scheduledPost() }),
      /** What the engine would pick next, without posting or remembering it. */
      roll: () => {
        const { catalog: cat, problems } = catalog()
        if (!cat) throw new Error(`no topic catalog: ${problems.join('; ')}`)
        return pickTopic(cat, history(), new Date(), rng)
      },
      /** Takes one paper post back out of the feed (and so off the public page). Live posts live on X. */
      unpost: ({ id }) => {
        const p = store.get<Posted[]>('posted', []).find(x => x.id === id)
        if (!p) throw new Error('no post with that id')
        if (p.mode !== 'paper') throw new Error('that one is on X: delete it there')
        store.set('posted', store.get<Posted[]>('posted', []).filter(x => x.id !== id))
        return { removed: p.text.slice(0, 80) }
      },
    },
  } as Organ & { liveReady: () => string | undefined }
}
