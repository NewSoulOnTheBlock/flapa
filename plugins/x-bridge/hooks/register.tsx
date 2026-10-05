import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { XAccount, XDraft, XMention, XPosted } from '../types'
import { authorization, nonce } from './oauth'
import type { XCredentials } from './oauth'
import { MAX_WEIGHT, weightedLength } from './text'
import { EXT, MENTIONS_JS, POST_JS, STATUS_JS, firstTabId, intentUrl, parseExtJson } from './extension'
import {
  CHECK_EVERY_MS, DEFAULT_CONFIG, cleanReply, newerId, pickNew, replyPrompt, replySystem, riskOf,
} from './autoreply'
import type { AutoReplyConfig, ReplyPersona } from './autoreply'

const PANE = 'x'
const API = 'https://api.x.com/2'
const POST = 'mcp__x-bridge__post'
const MENTIONS = 'mcp__x-bridge__mentions'
const QUEUE = 'mcp__x-bridge__queue'
const CHECK = 'mcp__guardrails__check'
const DIAL = { plugin: 'guardrails', key: 'dial' } as const
const PERSONA = { plugin: 'persona-core', key: 'active' } as const
const ENV_NAMES = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const

const account = atom({ plugin: 'x-bridge', key: 'account' } as const, null)
const drafts = atom({ plugin: 'x-bridge', key: 'drafts' } as const, [])
const posted = atom({ plugin: 'x-bridge', key: 'posted' } as const, [])
const mentions = atom({ plugin: 'x-bridge', key: 'mentions' } as const, [])
const status = atom({ plugin: 'x-bridge', key: 'status' } as const, '')

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The four OAuth 1.0a secrets, from the environment only: never from chat. */
async function credentials($: EngineInterface): Promise<Result<XCredentials>> {
  const values = {
    X_API_KEY: await $.env.get('X_API_KEY'),
    X_API_SECRET: await $.env.get('X_API_SECRET'),
    X_ACCESS_TOKEN: await $.env.get('X_ACCESS_TOKEN'),
    X_ACCESS_TOKEN_SECRET: await $.env.get('X_ACCESS_TOKEN_SECRET'),
  }
  const missing = ENV_NAMES.filter(n => !values[n])
  if (missing.length) return { ok: false, error: `not connected: set ${missing.join(', ')} in your environment` }
  return {
    ok: true,
    value: {
      consumerKey: values.X_API_KEY!,
      consumerSecret: values.X_API_SECRET!,
      accessToken: values.X_ACCESS_TOKEN!,
      accessSecret: values.X_ACCESS_TOKEN_SECRET!,
    },
  }
}

/** One signed call to X's v2 API, its JSON, or a readable reason it failed. */
async function callX($: EngineInterface, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<Result<any>> {
  const creds = await credentials($)
  if (!creds.ok) return creds
  const url = `${API}${path}`
  const auth = await authorization(creds.value, method, url, {
    nonce: nonce(),
    timestamp: Math.floor((await $.clock.now()) / 1000),
  })
  let r
  try {
    r = await $.http.fetch(url, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (err) {
    return { ok: false, error: `could not reach X: ${err instanceof Error ? err.message : String(err)}` }
  }
  let json: any = {}
  try {
    json = r.text ? JSON.parse(r.text) : {}
  } catch {
    // Not JSON: the status speaks for itself.
  }
  if (r.ok) return { ok: true, value: json }
  const detail = json?.detail ?? json?.title ?? json?.errors?.[0]?.message ?? r.text.slice(0, 160)
  if (r.status === 401) return { ok: false, error: `X rejected the credentials (401): ${detail}` }
  if (r.status === 403) return { ok: false, error: `X refused (403): ${detail}. Check the app's permissions and API plan.` }
  if (r.status === 429) {
    const reset = Number(r.headers['x-rate-limit-reset'])
    const when = reset ? ` until ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : ''
    return { ok: false, error: `rate limited by X${when}` }
  }
  return { ok: false, error: `X answered ${r.status}: ${detail}` }
}

// ---------- transport: X's API (default), her own Chrome profile, or the person's open Chrome ----------

/** api: X's developer API · browser: her own Chrome profile via a helper · chrome: the person's open Chrome via the Claude in Chrome extension */
type Transport = 'api' | 'browser' | 'chrome'

async function transport($: EngineInterface): Promise<Transport> {
  const t = await $.store.get('transport')
  return t === 'browser' || t === 'chrome' ? t : 'api'
}

// ---------- the person's open Chrome, through the Claude in Chrome extension ----------

let extTabId = 0

async function ext($: EngineInterface, name: string, input: Record<string, unknown>): Promise<Result<string>> {
  try {
    const r = (await $.tool.call({ tool: `${EXT}${name}`, ...input } as never)) as {
      deny?: string; isError?: boolean; text?: string; result?: unknown
    }
    if (r.deny) return { ok: false, error: r.deny }
    const text = String(r.text ?? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? '')))
    if (r.isError) return { ok: false, error: text.slice(0, 200) }
    return { ok: true, value: text }
  } catch (err) {
    return {
      ok: false,
      error: `your Chrome: ${err instanceof Error ? err.message : String(err)} (is the Claude in Chrome extension connected?)`,
    }
  }
}

/** Opens url in the extension's tab and runs a page script there; its JSON answer. */
async function extRun($: EngineInterface, url: string, script: string, retry = true): Promise<Result<any>> {
  if (!extTabId) {
    const ctx = await ext($, 'tabs_context_mcp', { createIfEmpty: true })
    if (!ctx.ok) return ctx
    extTabId = firstTabId(ctx.value) ?? 0
    if (!extTabId) return { ok: false, error: 'your Chrome: no tab to work in' }
  }
  const nav = await ext($, 'navigate', { url, tabId: extTabId })
  if (!nav.ok) {
    // The tab was closed: find a fresh one, once.
    extTabId = 0
    return retry ? extRun($, url, script, false) : nav
  }
  const run = await ext($, 'javascript_tool', { action: 'javascript_exec', tabId: extTabId, text: script })
  if (!run.ok) return run
  try {
    return { ok: true, value: parseExtJson(run.value) }
  } catch {
    return { ok: false, error: `your Chrome: unreadable page answer: ${run.value.slice(0, 120)}` }
  }
}

/** The helper's routes, answered through the person's open Chrome. */
async function viaExtension($: EngineInterface, path: string, body?: any): Promise<Result<any>> {
  if (path === '/status') return extRun($, 'https://x.com/home', STATUS_JS)
  if (path === '/mentions') return extRun($, 'https://x.com/notifications/mentions', MENTIONS_JS)
  if (path === '/post') {
    const r = await extRun($, intentUrl(String(body?.text ?? ''), body?.replyTo), POST_JS)
    if (r.ok && r.value?.error) return { ok: false, error: `your Chrome: ${r.value.error}` }
    return r
  }
  return { ok: false, error: `unknown route ${path}` }
}

let helperPort = 0
let helperIsLogin = false
let helperStarting: Promise<number> | undefined

/** Starts (or reuses) the Chrome helper: headless, or a visible window to sign in. */
function ensureHelper($: EngineInterface, login = false): Promise<number> {
  if (helperPort && helperIsLogin === login) return Promise.resolve(helperPort)
  if (helperStarting) return helperStarting
  const restart = helperPort ? quitHelper($) : Promise.resolve()
  helperStarting = restart.then(() => new Promise<number>((resolve, reject) => {
    void (async () => {
      let out = ''
      try {
        const child = $.process.spawn({
          argv: ['node', `${$.plugin.root}/helper/x-browser.mjs`, ...(login ? ['--login'] : [])],
        })
        for await (const piece of child) {
          out += piece.text
          const ready = /PORT (\d+)/.exec(out)
          if (ready && !helperPort) {
            helperPort = Number(ready[1])
            helperIsLogin = login
            resolve(helperPort)
          }
          const failed = /ERROR (.+)/.exec(out)
          if (failed) reject(new Error(failed[1]))
        }
      } catch (err) {
        reject(err)
      }
      helperPort = 0
      reject(new Error('the X browser helper stopped'))
    })()
  }))
  const started = helperStarting
  started.then(() => { helperStarting = undefined }, () => { helperStarting = undefined })
  return started
}

async function quitHelper($: EngineInterface) {
  if (!helperPort) return
  const port = helperPort
  helperPort = 0
  await $.http.fetch(`http://127.0.0.1:${port}/quit`).catch(() => undefined)
}

/** One call to the Chrome helper, as a Result. */
async function viaBrowser($: EngineInterface, path: string, body?: unknown): Promise<Result<any>> {
  if ((await transport($)) === 'chrome') return viaExtension($, path, body)
  let port: number
  try {
    port = await ensureHelper($)
  } catch (err) {
    return { ok: false, error: `Chrome: ${err instanceof Error ? err.message : String(err)}` }
  }
  try {
    const r = await $.http.fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = r.text ? JSON.parse(r.text) : {}
    return r.ok ? { ok: true, value: json } : { ok: false, error: `Chrome: ${json.error ?? `HTTP ${r.status}`}` }
  } catch (err) {
    return { ok: false, error: `Chrome: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function say($: EngineInterface, text: string) {
  await update($, status, () => text)
}

/** Signs in as the credentials' account and remembers who that is. */
async function connect($: EngineInterface): Promise<Result<XAccount>> {
  if ((await transport($)) !== 'api') {
    const st = await viaBrowser($, '/status')
    if (!st.ok || !st.value.loggedIn) {
      const error = st.ok
        ? ((await transport($)) === 'chrome'
          ? 'not signed in to X in your Chrome'
          : 'not signed in to X in her Chrome profile: run /x browser login')
        : st.error
      await say($, error)
      return { ok: false, error }
    }
    const a: XAccount = { id: st.value.username, username: st.value.username, name: st.value.username }
    await update($, account, () => a)
    await $.store.set('account', a)
    await say($, `connected as @${a.username} (${(await transport($)) === 'chrome' ? 'your Chrome' : 'Chrome'})`)
    return { ok: true, value: a }
  }
  const me = await callX($, 'GET', '/users/me')
  if (!me.ok) {
    await say($, me.error)
    return me
  }
  const a: XAccount = { id: me.value.data.id, username: me.value.data.username, name: me.value.data.name }
  await update($, account, () => a)
  await $.store.set('account', a)
  await say($, `connected as @${a.username}`)
  return { ok: true, value: a }
}

async function persona($: EngineInterface): Promise<{ id: string; name: string; handle: string }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) return { id: value.id, name: value.name, handle: value.handle.replace(/^@/, '') }
  } catch {
    // persona-core not loaded
  }
  return { id: 'default', name: 'The agent', handle: '' }
}

// Each list: state for the pane (redraws at once), store for the next session.
// One function per atom: the scan reads which value each update writes.
async function saveDrafts($: EngineInterface, fn: (l: XDraft[]) => XDraft[]) {
  await $.store.set('drafts', await update($, drafts, fn))
}
async function savePosted($: EngineInterface, fn: (l: XPosted[]) => XPosted[]) {
  await $.store.set('posted', await update($, posted, fn))
}
async function saveMentions($: EngineInterface, fn: (l: XMention[]) => XMention[]) {
  await $.store.set('mentions', await update($, mentions, fn))
}

/** The one path by which anything reaches X: account guard, signed POST, audit entry. */
async function postText($: EngineInterface, text: string, personaId: string, replyTo?: string): Promise<Result<XPosted>> {
  const acct = (await read($, account)) ?? (await connect($).then(r => (r.ok ? r.value : null)))
  if (!acct) return { ok: false, error: await read($, status) }
  const who = await persona($)
  if (who.handle && who.handle.toLowerCase() !== acct.username.toLowerCase()) {
    return {
      ok: false,
      error: `the credentials sign in as @${acct.username}, but ${who.name} is @${who.handle}. ` +
        'Fix the environment variables or the persona handle first.',
    }
  }
  const isBrowser = (await transport($)) !== 'api'
  const r = isBrowser
    ? await viaBrowser($, '/post', { text, ...(replyTo ? { replyTo } : {}) })
    : await callX($, 'POST', '/tweets', { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) })
  if (!r.ok) {
    await say($, `not posted: ${r.error}`)
    return r
  }
  const shownId: string | null = isBrowser ? r.value.id : r.value.data.id
  const postId = shownId ?? `unconfirmed-${await $.clock.now()}`
  const entry: XPosted = {
    id: postId, text, at: await $.clock.now(), url: shownId ? `https://x.com/${acct.username}/status/${shownId}` : `https://x.com/${acct.username}`,
    persona: personaId, ...(replyTo ? { replyTo } : {}),
  }
  await savePosted($, l => [entry, ...l].slice(0, 200))
  await say($, `posted ${entry.url}`)
  return { ok: true, value: entry }
}

type Screen = { verdict: 'pass' | 'hold' | 'block'; reasons: string[] }

/** Every word she sends out, screened by guardrails (its rules and its reviewer). */
async function screenText($: EngineInterface, text: string, kind: 'post' | 'reply', context?: string): Promise<Screen> {
  try {
    const r = (await $.tool.call({ tool: CHECK, text, kind, by: 'x-bridge', ...(context ? { context } : {}) } as never)) as {
      result?: unknown
    }
    const v = JSON.parse(String(r.result)) as Screen
    if (v.verdict === 'pass' || v.verdict === 'hold' || v.verdict === 'block') return v
  } catch {
    // guardrails not loaded: the phrase list below is all there is.
  }
  const risk = riskOf(text)
  return risk ? { verdict: 'hold', reasons: [risk] } : { verdict: 'pass', reasons: [] }
}

/** The kill switch: paused, she does nothing on her own. */
async function isPaused($: EngineInterface): Promise<boolean> {
  try {
    return (await $.state.get(DIAL)).value === 'paused'
  } catch {
    return false
  }
}

/** Holds a post in the X tab for the person to look at. */
async function hold($: EngineInterface, text: string, personaId: string, replyTo?: string): Promise<XDraft> {
  const now = await $.clock.now()
  // Short ids to type in /x approve; two in one millisecond must still differ.
  const taken = new Set((await read($, drafts)).map(x => x.id))
  let n = now % 1_679_616
  while (taken.has(`d${n.toString(36).padStart(4, '0')}`)) n = (n + 1) % 1_679_616
  const d: XDraft = {
    id: `d${n.toString(36).padStart(4, '0')}`, text, persona: personaId, createdAt: now,
    weighted: weightedLength(text), ...(replyTo ? { replyTo } : {}),
  }
  await saveDrafts($, l => [...l, d])
  return d
}

/** The person's yes on a held post. */
async function approve($: EngineInterface, id: string): Promise<string> {
  const d = (await read($, drafts)).find(x => x.id === id)
  if (!d) return `No draft ${id}.`
  await say($, `posting ${id}…`)
  const r = await postText($, d.text, d.persona, d.replyTo)
  if (!r.ok) return `Not posted: ${r.error}`
  await saveDrafts($, l => l.filter(x => x.id !== id))
  return `Posted: ${r.value.url}`
}

/** Her own posts go out directly unless the person turned autopost off. */
async function autopost($: EngineInterface): Promise<boolean> {
  return (await $.store.get('autopost')) !== false
}

async function rejectDraft($: EngineInterface, id: string): Promise<string> {
  const d = (await read($, drafts)).find(x => x.id === id)
  if (!d) return `No draft ${id}.`
  await saveDrafts($, l => l.filter(x => x.id !== id))
  await say($, `rejected ${id}`)
  return `Rejected draft ${id}; nothing was posted.`
}

async function fetchMentions($: EngineInterface, sinceId?: string): Promise<Result<XMention[]>> {
  const acct = (await read($, account)) ?? (await connect($).then(r => (r.ok ? r.value : null)))
  if (!acct) return { ok: false, error: await read($, status) }
  if ((await transport($)) !== 'api') {
    const b = await viaBrowser($, '/mentions')
    if (!b.ok) {
      await say($, b.error)
      return b
    }
    const all: XMention[] = (b.value.mentions ?? []).map((m: any) => ({ id: m.id, text: m.text, author: m.author, at: m.at ?? '' }))
    const list = sinceId ? all.filter(m => newerId(m.id, sinceId)) : all.slice(0, 10)
    await saveMentions($, old => {
      const seen = new Set(list.map(m => m.id))
      return [...list, ...old.filter(m => !seen.has(m.id))].slice(0, 30)
    })
    if (!sinceId) await say($, `${list.length} recent mentions`)
    return { ok: true, value: list }
  }
  const r = await callX(
    $, 'GET',
    `/users/${acct.id}/mentions?max_results=${sinceId ? 50 : 10}` +
      '&tweet.fields=created_at&expansions=author_id&user.fields=username' +
      (sinceId ? `&since_id=${sinceId}` : ''),
  )
  if (!r.ok) {
    await say($, r.error)
    return r
  }
  const users = new Map<string, string>((r.value.includes?.users ?? []).map((u: any) => [u.id, u.username]))
  const list: XMention[] = (r.value.data ?? []).map((t: any) => ({
    id: t.id, text: t.text, author: users.get(t.author_id) ?? t.author_id, at: t.created_at ?? '',
  }))
  await saveMentions($, old => {
    const seen = new Set(list.map(m => m.id))
    return [...list, ...old.filter(m => !seen.has(m.id))].slice(0, 30)
  })
  if (!sinceId) await say($, `${list.length} recent mentions`)
  return { ok: true, value: list }
}

// ---------- auto-reply: every 10 minutes, each new mention answered once ----------

let isChecking = false

async function replyConfig($: EngineInterface): Promise<AutoReplyConfig> {
  return { ...DEFAULT_CONFIG, ...((await $.store.get('autoreply')) as Partial<AutoReplyConfig> | undefined) }
}

async function personaForReply($: EngineInterface): Promise<{ id: string; persona: ReplyPersona }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) {
      return {
        id: value.id,
        persona: {
          name: value.name, handle: value.handle.replace(/^@/, ''), tagline: value.tagline,
          voice: value.voice, examples: value.examples, taboos: value.taboos,
        },
      }
    }
  } catch {
    // persona-core not loaded
  }
  return { id: 'default', persona: { name: 'the agent', handle: '', tagline: '', voice: '', examples: [], taboos: [] } }
}

/** One check: new mentions since the last, each answered (or skipped) exactly once. */
async function checkMentions($: EngineInterface): Promise<string> {
  if (isChecking) return 'a check is already running'
  isChecking = true
  try {
    const config = await replyConfig($)
    if (config.mode === 'off') return 'auto-reply is off'
    if (await isPaused($)) return 'agent paused: mentions wait'
    const acct = await read($, account)
    if (!acct) return 'not connected'
    const save = (c: AutoReplyConfig) => $.store.set('autoreply', { ...c, handled: c.handled.slice(-2000) })
    const now = await $.clock.now()

    // First look: mark where "new" starts. Old mentions are history, not a backlog.
    if (!config.sinceId) {
      const r = await fetchMentions($)
      if (!r.ok) return r.error
      const newest = r.value.reduce<string | undefined>((top, m) => (!top || newerId(m.id, top) ? m.id : top), undefined)
      await save({ ...config, sinceId: newest ?? '1', handled: [...config.handled, ...r.value.map(m => m.id)], lastCheckAt: now })
      await say($, 'auto-reply watching: each new mention gets one reply')
      return 'baseline set'
    }

    const r = await fetchMentions($, config.sinceId)
    if (!r.ok) return r.error
    const handled = new Set(config.handled)
    let since = config.sinceId
    // Her own posts that tag her are handled at once, so they never come back.
    for (const m of r.value) {
      if (m.author.toLowerCase() !== acct.username.toLowerCase() || handled.has(m.id)) continue
      handled.add(m.id)
      if (newerId(m.id, since)) since = m.id
    }
    const todo = pickNew(r.value, handled, acct.username)
    const { id: personaId, persona: who } = await personaForReply($)
    let replied = 0
    let held = 0
    for (const m of todo) {
      const answer = await $.model.complete({
        model: 'sonnet', system: replySystem(who), prompt: replyPrompt(m), maxTokens: 200,
      })
      if (!answer.isAnswered) break // this mention is tried again next check
      const text = cleanReply(answer.text, m.author)
      if (text && weightedLength(text) <= MAX_WEIGHT) {
        const verdict = config.mode === 'draft' ? null : await screenText($, text, 'reply', m.text)
        if (verdict?.verdict === 'block') {
          // Never posted, never drafted: the mention counts as handled.
        } else if (!verdict || verdict.verdict === 'hold') {
          await hold($, text, personaId, m.id)
          held++
        } else {
          const posted = await postText($, text, personaId, m.id)
          if (!posted.ok) break // rate limit or outage: this mention waits for the next check
          replied++
        }
      }
      // Replied, held or skipped: handled, and never answered again.
      handled.add(m.id)
      if (newerId(m.id, since)) since = m.id
      await save({ ...config, sinceId: since, handled: [...handled], lastCheckAt: now })
    }
    if (todo.length === 0) await save({ ...config, sinceId: since, handled: [...handled], lastCheckAt: now })
    const summary = `checked mentions: ${replied} replied${held ? `, ${held} held for a look` : ''}`
    await say($, summary)
    return summary
  } finally {
    isChecking = false
  }
}


function draftLine(d: XDraft): string {
  return `${d.id}${d.replyTo ? ` (reply to ${d.replyTo})` : ''} [${d.weighted}/280]: ${d.text}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const savedDrafts = await $.store.get('drafts')
    if (Array.isArray(savedDrafts)) await update($, drafts, () => savedDrafts as XDraft[])
    const savedPosted = await $.store.get('posted')
    if (Array.isArray(savedPosted)) await update($, posted, () => savedPosted as XPosted[])
    const savedMentions = await $.store.get('mentions')
    if (Array.isArray(savedMentions)) await update($, mentions, () => savedMentions as XMention[])
    const acct = (await $.store.get('account')) as XAccount | undefined
    if (acct) await update($, account, () => acct)
    if ((await transport($)) !== 'api') {
      const how = (await transport($)) === 'chrome' ? 'your Chrome' : 'Chrome'
      await say($, acct ? `connected as @${acct.username} (${how})` : `${how} mode: /x connect`)
    } else {
      const creds = await credentials($)
      await say($, creds.ok ? (acct ? `connected as @${acct.username}` : 'credentials found; /x connect to sign in') : creds.error)
    }

    // Every 10 minutes, once connected: each new mention gets one reply.
    $.clock.every(CHECK_EVERY_MS, () => void checkMentions($).catch(() => undefined))

    await $.tool.register({
      name: 'post',
      description:
        "Post to the active persona's X account (or reply, with reply_to). It goes out at once, in the persona's " +
        'voice. Anything that reads like a buy call, price promise or guarantee, or carries a link or address, is ' +
        "held in the person's X tab instead. Max 280 weighted characters (URLs 23, emoji 2).",
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          reply_to: { type: 'string', description: 'The post id this replies to, from mentions' },
        },
        required: ['text'],
      },
    })
    await $.tool.register({
      name: 'mentions',
      description: "Read the most recent posts that mention the persona's X account, with their ids for replies.",
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'queue',
      description: 'List posts held for the person to look at, and the latest posts that went out.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.command.register({
      name: 'x',
      description: "The agent's X account: /x [connect|drafts|approve|reject|mentions|autoreply|autopost|mode api|browser|browser login]",
    })
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'X' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== POST && e.tool !== MENTIONS && e.tool !== QUEUE) return next(e)
    const input = e as unknown as { text?: string; reply_to?: string }

    if (e.tool === POST) {
      const text = (input.text ?? '').trim()
      if (!text) return { deny: 'post needs text' }
      const weighted = weightedLength(text)
      if (weighted > MAX_WEIGHT) return { deny: `too long: ${weighted}/${MAX_WEIGHT} weighted characters; shorten it` }
      const who = await persona($)
      const replyTo = input.reply_to ? String(input.reply_to) : undefined
      const verdict = await screenText($, text, replyTo ? 'reply' : 'post')
      if (verdict.verdict === 'block') {
        await say($, `blocked: ${verdict.reasons[0] ?? ''}`)
        return { result: `Not posted and not drafted: blocked by guardrails (${verdict.reasons.join('; ')}).` }
      }
      const risk = verdict.verdict === 'hold' ? verdict.reasons.join('; ') : undefined
      if (risk || !(await autopost($))) {
        const d = await hold($, text, who.id, replyTo)
        await say($, `${d.id} held for a look${risk ? `: ${risk}` : ''}`)
        void $.ui.open({ id: PANE, title: 'X' })
        return {
          result: `Not posted: held as ${d.id} in the person's X tab` +
            (risk ? ` (${risk}). The person decides; do not reword it to get around the screen.` : ' (autopost is off).'),
        }
      }
      const r = await postText($, text, who.id, replyTo)
      if (!r.ok) return { deny: `not posted: ${r.error}` }
      return { result: `Posted: ${r.value.url}` }
    }

    if (e.tool === MENTIONS) {
      const r = await fetchMentions($)
      if (!r.ok) return { deny: r.error }
      return {
        result: r.value.length
          ? r.value.map(m => `- ${m.id} @${m.author}: ${m.text}`).join('\n')
          : 'No recent mentions.',
      }
    }

    const ds = await read($, drafts)
    const ps = (await read($, posted)).slice(0, 5)
    return {
      result: [
        ds.length ? `Waiting for approval:\n${ds.map(d => `- ${draftLine(d)}`).join('\n')}` : 'No drafts waiting.',
        ps.length ? `Posted:\n${ps.map(p => `- ${p.url}: ${p.text}`).join('\n')}` : 'Nothing posted yet.',
      ].join('\n\n'),
    }
  })

  on('command.run', { command: 'x' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().split(/\s+/)
    switch (verb) {
      case 'connect': {
        const r = await connect($)
        return { text: r.ok ? `Connected as @${r.value.username} (${r.value.name}).` : `Not connected: ${r.error}` }
      }
      case 'approve':
        return { text: arg ? await approve($, arg) : 'Usage: /x approve <draft id>' }
      case 'reject':
        return { text: arg ? await rejectDraft($, arg) : 'Usage: /x reject <draft id>' }
      case 'mentions': {
        const r = await fetchMentions($)
        return { text: r.ok ? (r.value.map(m => `@${m.author}: ${m.text}`).join('\n') || 'No recent mentions.') : r.error }
      }
      case 'mode': {
        if (arg !== 'api' && arg !== 'browser' && arg !== 'chrome') {
          return { text: `X mode: ${await transport($)}. /x mode api | browser | chrome` }
        }
        await $.store.set('transport', arg)
        await update($, account, () => null)
        await $.store.delete('account')
        if (arg !== 'browser') await quitHelper($)
        extTabId = 0
        return {
          text: arg === 'api'
            ? 'X mode: API. /x connect to sign in with the developer keys.'
            : arg === 'chrome'
              ? 'X mode: your open Chrome, through the Claude in Chrome extension, as whoever is signed in to X ' +
                'there. Heads up: X\'s automation rules prohibit scripting the website, and accounts doing it can be ' +
                'suspended. Chrome must be open with the extension connected. Next: /x connect.'
              : 'X mode: Chrome, through her own Chrome profile (not yours). Heads up: X\'s automation rules ' +
              'prohibit scripting the website, and accounts doing it can be suspended; the API is the sanctioned ' +
              'route. Next: /x browser login, sign in as her in the window, then /x connect.',
        }
      }
      case 'browser': {
        if (arg === 'login') {
          try {
            await ensureHelper($, true)
          } catch (err) {
            return { text: `Could not open Chrome: ${err instanceof Error ? err.message : String(err)}` }
          }
          return { text: 'A Chrome window is open on her own profile. Sign in to X as her there, then run /x browser done.' }
        }
        if (arg === 'done') {
          await quitHelper($)
          const r = await connect($)
          return { text: r.ok ? `Signed in as @${r.value.username}; she now runs in the background.` : `Not signed in yet: ${r.error}` }
        }
        return { text: '/x browser login | done' }
      }
      case 'autoreply': {
        const config = await replyConfig($)
        if (arg === 'post' || arg === 'draft' || arg === 'off') {
          await $.store.set('autoreply', { ...config, mode: arg })
          return {
            text: arg === 'off' ? 'Auto-reply off.'
              : arg === 'post' ? 'Auto-reply on: every 10 minutes, each new mention gets one reply, posted directly.'
              : 'Auto-reply on, held: replies wait in the X tab for you.',
          }
        }
        if (arg === 'now') {
          $.clock.after(1, () => void checkMentions($).catch(() => undefined))
          return { text: 'Checking mentions now; results show in the X tab.' }
        }
        const last = config.lastCheckAt ? ` · last check ${new Date(config.lastCheckAt).toISOString().slice(11, 16)} UTC` : ''
        return {
          text: `Auto-reply: ${config.mode}, every 10 min · ${config.handled.length} mentions handled${last}\n` +
            '/x autoreply post | draft | off | now',
        }
      }
      case 'autopost': {
        if (arg !== 'on' && arg !== 'off') return { text: `Autopost is ${(await autopost($)) ? 'on' : 'off'}. /x autopost on | off` }
        await $.store.set('autopost', arg === 'on')
        return { text: arg === 'on' ? 'Autopost on: her posts go out directly (risky ones are held).' : 'Autopost off: every post waits for you.' }
      }
      case 'drafts': {
        const ds = await read($, drafts)
        return { text: ds.length ? ds.map(draftLine).join('\n') : 'No drafts waiting.' }
      }
      default: {
        await $.ui.open({ id: PANE, title: 'X', focus: true })
        await $.store.set('paneOpen', true)
        const acct = await read($, account)
        return {
          text: [
            acct ? `X: @${acct.username}` : `X: ${await read($, status)}`,
            `${(await read($, drafts)).length} held · ${(await read($, posted)).length} posted · ` +
              `autopost ${(await autopost($)) ? 'on' : 'off'} · auto-reply ${(await replyConfig($)).mode} · via ${await transport($)}`,
            'Commands: /x connect | drafts | approve <id> | reject <id> | mentions | autoreply | autopost | mode | browser',
          ].join('\n'),
        }
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const acct = await read($, account)
    const note = await read($, status)
    const ds = await read($, drafts)
    const ps = (await read($, posted)).slice(0, 5)
    const ms = (await read($, mentions)).slice(0, 5)

    return (
      <Box flexDirection="column">
        <Text bold>{acct ? `@${acct.username}` : 'X: not connected'}</Text>
        {note ? <Text dimColor>{note}</Text> : null}
        <Text> </Text>
        <Text bold>
          held for a look ({ds.length})
        </Text>
        {ds.length === 0 && <Text dimColor>  nothing held. she posts directly; risky posts wait here.</Text>}
        {ds.map(d => (
          <Box key={`d-${d.id}`} flexDirection="column" marginBottom={1}>
            <Text>{d.replyTo ? `↳ reply to ${d.replyTo}: ` : ''}{d.text}</Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key={`approve-${d.id}`} variant="primary" onPress={() => void approve($, d.id)}>
                post it
              </Button>
              <Button key={`reject-${d.id}`} plain dimColor onPress={() => void rejectDraft($, d.id)}>
                reject
              </Button>
              <Text dimColor>
                {d.id} · {d.weighted}/280
              </Text>
            </Box>
          </Box>
        ))}
        <Text bold>posted</Text>
        {ps.length === 0 && <Text dimColor>  nothing yet</Text>}
        {ps.map(p => (
          <Text key={`p-${p.id}`} dimColor>
            {'  '}
            {p.text.slice(0, 80)} · {p.url}
          </Text>
        ))}
        <Box flexDirection="row" columnGap={1}>
          <Text bold>mentions</Text>
          <Button key="refresh" plain dimColor onPress={() => void fetchMentions($)}>
            ↻
          </Button>
        </Box>
        {ms.length === 0 && <Text dimColor>  none loaded</Text>}
        {ms.map(m => (
          <Text key={`m-${m.id}`}>
            {'  '}@{m.author}: {m.text.slice(0, 100)}
          </Text>
        ))}
      </Box>
    )
  })
}
