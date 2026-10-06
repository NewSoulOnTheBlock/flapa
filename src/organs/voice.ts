// voice — the mind's presence on X. Was PACS x-bridge (API transport; the Chrome transports
// depended on Claude Code's browser extension and stay behind). Paper mode keeps posts in a local feed.
import type { Body } from '../core/body'
import type { Mode, Organ, Outward } from '../core/types'
import { cleanReply, nextSinceId, pickNew, replyPrompt, replySystem, CHECK_EVERY_MS, type XMention } from '../lib/autoreply'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { authorization, credentialsFromEnv, nonce } from '../lib/oauth'
import { engineBrief, pickTopic, validateCatalog, type Catalog, type Pick as TopicPick, type PostRecord } from '../lib/posting'
import { MAX_WEIGHT, weightedLength } from '../lib/xtext'

const API = 'https://api.x.com/2'

/** `topic` is what the posting engine picked for it, for the feed and the dashboard. */
export type Posted = { id: string; text: string; at: number; mode: Mode; url?: string; replyTo?: string; topic?: string }
type Reply = { mode: 'post' | 'off'; sinceId?: string; handled: string[]; lastCheckAt?: number }

/** Her own posts on a clock. Armed by its first post: lastPostAt stays 0 until then, so nothing fires early. */
export type Schedule = { isOn: boolean; everyHours: number; lastPostAt: number; lastTryAt: number; themes: string }
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
  const schedule = () => ({ ...SCHEDULE, ...store.get<Partial<Schedule>>('schedule', {}) })
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
      const pick: TopicPick | undefined = cat ? pickTopic(cat, history(), new Date(), rng) : undefined
      const recent = store.get<Posted[]>('posted', []).filter(p => !p.replyTo).slice(0, 5).map(p => p.text)
      const brief = pick
        ? engineBrief(pick, { recent, storyline: schedule().themes, everyHours: schedule().everyHours })
        : postBrief(schedule().everyHours, schedule().themes)
      if (pick) body.bus.emit('topic', 'voice', { topic: pick.topic, category: pick.category, blend: pick.blend?.topic ?? null, format: pick.format })
      const r = await body.think({ kind: 'post', text: brief, from: 'voice' })
      const sent = r.tools.find(t => t.name === 'post' && /^(done|held)/.test(t.result))
      if (sent) {
        setSchedule({ lastPostAt: Date.now() })
        if (pick) {
          store.update<PostRecord[]>('postHistory', [], h => [...h, { at: Date.now(), category: pick.category, topic: pick.topic, blend: pick.blend?.topic, format: pick.format }].slice(-200))
          const label = pick.blend ? `${pick.topic} × ${pick.blend.topic}` : pick.topic
          // A post that went out carries its topic; one held for the person carries it on its approval card's summary.
          if (/^done/.test(sent.result)) store.update<Posted[]>('posted', [], l => (l[0] ? [{ ...l[0], topic: label }, ...l.slice(1)] : l))
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

  async function fetchMentions(): Promise<XMention[]> {
    const { id } = await me()
    const since = reply().sinceId
    const r = await x('GET', `/users/${id}/mentions?max_results=20&expansions=author_id&user.fields=username${since ? `&since_id=${since}` : ''}`)
    const users = new Map<string, string>((r.includes?.users ?? []).map((u: any) => [u.id, u.username]))
    const list: XMention[] = (r.data ?? []).map((t: any) => ({ id: t.id, author: users.get(t.author_id) ?? t.author_id, text: t.text }))
    const seen = new Set(list.map(m => m.id))
    store.set('mentions', [...list, ...store.get<XMention[]>('mentions', []).filter(m => !seen.has(m.id))].slice(0, 50))
    return list
  }

  const persona = () => {
    const p = body.has('identity') ? (body.organ('identity').view?.() as any)?.active : null
    return { name: p?.name ?? 'agent', handle: p?.handle ?? '', tagline: p?.tagline ?? '', voice: p?.voice ?? '', examples: p?.examples ?? [], taboos: p?.taboos ?? [] }
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
        description: 'Publish a post on X in your own voice. It passes your conscience first and may be held for the person.',
        input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        run: async ({ text }, turn) => {
          const t = String(text ?? '').trim()
          if (!t) return 'error: empty post'
          const long = tooLong(t)
          if (long) return long
          return body.act({ organ: 'voice', kind: 'post', summary: `post: ${t}`, text: t, payload: { text: t }, by: turn.stimulus.kind === 'chat' ? 'agent' : 'rhythm' })
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
      let entry: Posted
      if (mode === 'paper') {
        entry = { id: `paper-${o.id}`, text, at: Date.now(), mode, replyTo }
      } else {
        const r = await x('POST', '/tweets', { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) })
        const { username } = await me()
        entry = { id: r.data.id, text, at: Date.now(), mode, replyTo, url: `https://x.com/${username}/status/${r.data.id}` }
      }
      store.update<Posted[]>('posted', [], l => [entry, ...l].slice(0, 100))
      body.bus.emit('posted', 'voice', entry)
      return entry.url ?? `${o.kind} kept in the paper feed`
    },
    rhythms: [{
      name: 'scheduled-post',
      due: now => scheduleDue(schedule(), now),
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
          const text = cleanReply(await body.brain.quick(replySystem(persona()), replyPrompt(m)), m.author)
          if (!text || tooLong(text)) continue
          await body.act({ organ: 'voice', kind: 'reply', summary: `reply to @${m.author}: ${text}`, text, context: m.text, payload: { text, replyTo: m.id }, by: 'rhythm' })
        }
        mark()
      },
    }],
    view: () => ({
      connected: !!creds(), me: store.get('me', null), reply: { ...reply(), handled: reply().handled.length },
      schedule: { ...schedule(), nextAt: schedule().isOn && schedule().lastPostAt ? schedule().lastPostAt + schedule().everyHours * 3_600_000 : null },
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
    }),
    actions: {
      autoreply: ({ isOn }) => store.set('reply', { ...reply(), mode: isOn ? 'post' : 'off' }),
      /** Turns the clock on or off, or changes its period. Turning it on arms nothing: the first post does. */
      schedule: ({ isOn, everyHours, themes }) => {
        const s: Partial<Schedule> = {}
        if (typeof themes === 'string') s.themes = themes.trim().slice(0, 400)
        if (typeof isOn === 'boolean') s.isOn = isOn
        if (everyHours !== undefined) {
          const h = Number(everyHours)
          if (!(h >= 1 && h <= 168)) throw new Error('every 1 to 168 hours')
          s.everyHours = h
        }
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
