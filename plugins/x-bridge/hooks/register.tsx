import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { XAccount, XDraft, XMention, XPosted } from '../types'
import { authorization, nonce } from './oauth'
import type { XCredentials } from './oauth'
import { MAX_WEIGHT, weightedLength } from './text'

const PANE = 'x'
const API = 'https://api.x.com/2'
const DRAFT = 'mcp__x-bridge__draft'
const MENTIONS = 'mcp__x-bridge__mentions'
const QUEUE = 'mcp__x-bridge__queue'
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

async function say($: EngineInterface, text: string) {
  await update($, status, () => text)
}

/** Signs in as the credentials' account and remembers who that is. */
async function connect($: EngineInterface): Promise<Result<XAccount>> {
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

/** The person's yes: the only path by which anything reaches X. */
async function approve($: EngineInterface, id: string): Promise<string> {
  const d = (await read($, drafts)).find(x => x.id === id)
  if (!d) return `No draft ${id}.`
  const acct = (await read($, account)) ?? (await connect($).then(r => (r.ok ? r.value : null)))
  if (!acct) return `Not posted: ${await read($, status)}`
  const who = await persona($)
  if (who.handle && who.handle.toLowerCase() !== acct.username.toLowerCase()) {
    return `Not posted: the credentials sign in as @${acct.username}, but ${who.name} is @${who.handle}. ` +
      'Fix the environment variables or the persona handle first.'
  }
  await say($, `posting ${id}…`)
  const r = await callX($, 'POST', '/tweets', {
    text: d.text,
    ...(d.replyTo ? { reply: { in_reply_to_tweet_id: d.replyTo } } : {}),
  })
  if (!r.ok) {
    await say($, `not posted: ${r.error}`)
    return `Not posted: ${r.error}`
  }
  const postId: string = r.value.data.id
  const entry: XPosted = {
    id: postId, text: d.text, at: await $.clock.now(), url: `https://x.com/${acct.username}/status/${postId}`,
    persona: d.persona, ...(d.replyTo ? { replyTo: d.replyTo } : {}),
  }
  await savePosted($, l => [entry, ...l].slice(0, 200))
  await saveDrafts($, l => l.filter(x => x.id !== id))
  await say($, `posted ${entry.url}`)
  return `Posted: ${entry.url}`
}

async function reject($: EngineInterface, id: string): Promise<string> {
  const d = (await read($, drafts)).find(x => x.id === id)
  if (!d) return `No draft ${id}.`
  await saveDrafts($, l => l.filter(x => x.id !== id))
  await say($, `rejected ${id}`)
  return `Rejected draft ${id}; nothing was posted.`
}

async function fetchMentions($: EngineInterface): Promise<Result<XMention[]>> {
  const acct = (await read($, account)) ?? (await connect($).then(r => (r.ok ? r.value : null)))
  if (!acct) return { ok: false, error: await read($, status) }
  const r = await callX(
    $, 'GET',
    `/users/${acct.id}/mentions?max_results=10&tweet.fields=created_at&expansions=author_id&user.fields=username`,
  )
  if (!r.ok) {
    await say($, r.error)
    return r
  }
  const users = new Map<string, string>((r.value.includes?.users ?? []).map((u: any) => [u.id, u.username]))
  const list: XMention[] = (r.value.data ?? []).map((t: any) => ({
    id: t.id, text: t.text, author: users.get(t.author_id) ?? t.author_id, at: t.created_at ?? '',
  }))
  await saveMentions($, () => list)
  await say($, `${list.length} recent mentions`)
  return { ok: true, value: list }
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
    const creds = await credentials($)
    await say($, creds.ok ? (acct ? `connected as @${acct.username}` : 'credentials found; /x connect to sign in') : creds.error)

    await $.tool.register({
      name: 'draft',
      description:
        "Write a post (or a reply) for the active persona's X account. It is NOT posted: it waits in the person's " +
        'X tab until they approve it. Max 280 weighted characters (URLs count 23, emoji 2). Write in the persona\'s voice.',
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
      description: 'List drafts waiting for approval and the latest posts that went out.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.command.register({
      name: 'x',
      description: "The agent's X account: /x [status|connect|drafts|approve <id>|reject <id>|mentions]",
    })
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'X' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== DRAFT && e.tool !== MENTIONS && e.tool !== QUEUE) return next(e)
    const input = e as unknown as { text?: string; reply_to?: string }

    if (e.tool === DRAFT) {
      const text = (input.text ?? '').trim()
      if (!text) return { deny: 'draft needs text' }
      const weighted = weightedLength(text)
      if (weighted > MAX_WEIGHT) return { deny: `too long: ${weighted}/${MAX_WEIGHT} weighted characters; shorten it` }
      const who = await persona($)
      const now = await $.clock.now()
      // Short ids to type in /x approve; two drafts in one millisecond must still differ.
      const taken = new Set((await read($, drafts)).map(x => x.id))
      let n = now % 1_679_616
      while (taken.has(`d${n.toString(36).padStart(4, '0')}`)) n = (n + 1) % 1_679_616
      const d: XDraft = {
        id: `d${n.toString(36).padStart(4, '0')}`,
        text, persona: who.id, createdAt: now, weighted,
        ...(input.reply_to ? { replyTo: String(input.reply_to) } : {}),
      }
      await saveDrafts($, l => [...l, d])
      await say($, `draft ${d.id} waiting for approval`)
      void $.ui.open({ id: PANE, title: 'X' })
      return {
        result: `Draft ${d.id} is queued in the person's X tab. It has NOT been posted; it goes out only if they ` +
          `approve it. (${weighted}/280)`,
      }
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
        return { text: arg ? await reject($, arg) : 'Usage: /x reject <draft id>' }
      case 'mentions': {
        const r = await fetchMentions($)
        return { text: r.ok ? (r.value.map(m => `@${m.author}: ${m.text}`).join('\n') || 'No recent mentions.') : r.error }
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
            `${(await read($, drafts)).length} drafts waiting · ${(await read($, posted)).length} posted`,
            'Commands: /x connect | drafts | approve <id> | reject <id> | mentions',
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
          waiting for you ({ds.length})
        </Text>
        {ds.length === 0 && <Text dimColor>  no drafts. the agent writes them with its draft tool.</Text>}
        {ds.map(d => (
          <Box key={`d-${d.id}`} flexDirection="column" marginBottom={1}>
            <Text>{d.replyTo ? `↳ reply to ${d.replyTo}: ` : ''}{d.text}</Text>
            <Box flexDirection="row" columnGap={1}>
              <Button key={`approve-${d.id}`} variant="primary" onPress={() => void approve($, d.id)}>
                post it
              </Button>
              <Button key={`reject-${d.id}`} plain dimColor onPress={() => void reject($, d.id)}>
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
