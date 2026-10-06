// voice — the mind's presence on X. Was PACS x-bridge (API transport; the Chrome transports
// depended on Claude Code's browser extension and stay behind). Paper mode keeps posts in a local feed.
import type { Body } from '../core/body'
import type { Mode, Organ, Outward } from '../core/types'
import { cleanReply, nextSinceId, pickNew, replyPrompt, replySystem, CHECK_EVERY_MS, type XMention } from '../lib/autoreply'
import { authorization, credentialsFromEnv, nonce } from '../lib/oauth'
import { MAX_WEIGHT, weightedLength } from '../lib/xtext'

const API = 'https://api.x.com/2'

export type Posted = { id: string; text: string; at: number; mode: Mode; url?: string; replyTo?: string }
type Reply = { mode: 'post' | 'off'; sinceId?: string; handled: string[]; lastCheckAt?: number }

export function voice(body: Body, fetcher: typeof fetch = fetch): Organ {
  const store = body.store('voice')
  const creds = () => credentialsFromEnv(process.env)
  const reply = () => ({ mode: 'off', handled: [], ...store.get<Partial<Reply>>('reply', {}) }) as Reply

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
      posted: store.get<Posted[]>('posted', []).slice(0, 30), mentions: store.get<XMention[]>('mentions', []).slice(0, 15),
    }),
    actions: {
      autoreply: ({ isOn }) => store.set('reply', { ...reply(), mode: isOn ? 'post' : 'off' }),
    },
  } as Organ & { liveReady: () => string | undefined }
}
