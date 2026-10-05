import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { authorization, hmacSha1, signatureBase, pct } from '../hooks/oauth'
import { weightedLength } from '../hooks/text'

const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

test("OAuth 1.0a signatures match X's published example", async () => {
  const base = signatureBase('POST', 'https://api.twitter.com/1.1/statuses/update.json', {
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    include_entities: 'true',
    oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
    oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: '1318622958',
    oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    oauth_version: '1.0',
  })
  const key = `${pct('kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw')}&${pct('LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE')}`
  expect(await hmacSha1(key, base)).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
  expect(pct("it's (a) test!*")).toBe('it%27s%20%28a%29%20test%21%2A')

  const header = await authorization(
    { consumerKey: 'ck', consumerSecret: 'cs', accessToken: 'at', accessSecret: 'as' },
    'GET', 'https://api.x.com/2/users/1/mentions?max_results=10', { nonce: 'n', timestamp: 1 },
  )
  expect(header.startsWith('OAuth oauth_consumer_key="ck", oauth_nonce="n"')).toBe(true)
  expect(header).toContain('oauth_signature="')
  // Query parameters are signed, never sent in the header.
  expect(header).not.toContain('max_results')
})

test("weighted length counts URLs as 23 and wide characters as 2, as X does", () => {
  expect(weightedLength('gm')).toBe(2)
  expect(weightedLength('chart: https://example.com/a/very/long/path/that/is/long')).toBe(7 + 23)
  expect(weightedLength('🐸')).toBe(2)
  expect(weightedLength('日本')).toBe(4)
  expect(weightedLength('a'.repeat(280))).toBe(280)
})

const ENV = { X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_TOKEN_SECRET: 'as' }

type Call = { method: string; url: string; auth: string; body?: string }

function engineBeneath(on: On, opts: { env?: Record<string, string>; username?: string; handle?: string } = {}) {
  mock.store(on)
  mock.env(on, opts.env ?? ENV)
  mock.clock(on, { now: Date.UTC(2026, 9, 5, 12) })
  on('state.get', (_$, e, next) =>
    e.plugin === 'persona-core' && e.key === 'active'
      ? {
          value: {
            value: { id: 'flapa', name: 'Flapa', handle: opts.handle ?? 'flapakuwai', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] },
            version: 1,
          },
        }
      : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__x-bridge__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const calls: Call[] = []
  on('http.fetch', (_$, e) => {
    const method = e.init?.method ?? 'GET'
    calls.push({ method, url: e.url, auth: e.init?.headers?.authorization ?? '', ...(e.init?.body ? { body: e.init.body } : {}) })
    const ok = (json: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } })
    if (e.url.endsWith('/users/me')) return ok({ data: { id: '42', username: opts.username ?? 'flapakuwai', name: 'Flapa' } })
    if (e.url.includes('/users/42/mentions')) {
      return ok({
        data: [{ id: '900', text: '@flapakuwai what are you buying', author_id: '7', created_at: '2026-10-05T11:00:00Z' }],
        includes: { users: [{ id: '7', username: 'degenfren' }] },
      })
    }
    if (e.url.endsWith('/tweets') && method === 'POST') return ok({ data: { id: '1234567890', text: 'x' } })
    return { value: { status: 404, ok: false, headers: {}, text: '{"title":"Not Found"}' } }
  })
  return calls
}

const start = { cwd: '/tmp/p', surface: 'terminal', isInteractive: true } as const
const DRAFT = 'mcp__x-bridge__draft'

test('a draft waits for approval and touches nothing at X; approval posts it, signed', async ($, on) => {
  const calls = engineBeneath(on)
  await $.session.start(start)

  const drafted = await $.tool.call({ tool: DRAFT, text: 'the chart says no. the frog says yes. i am listening to the frog' } as never)
  expect(String(drafted.result)).toContain('has NOT been posted')
  expect(calls).toHaveLength(0)

  const long = await $.tool.call({ tool: DRAFT, text: 'a'.repeat(281) } as never)
  expect((long as { deny?: string }).deny).toContain('281/280')

  const queue = await $.command.run({ command: 'x', args: 'drafts', ...typed })
  const id = /^(d\w+)/.exec(String(queue.text))?.[1]
  expect(id).toBeDefined()

  const posted = await $.command.run({ command: 'x', args: `approve ${id}`, ...typed })
  expect(posted.text).toBe('Posted: https://x.com/flapakuwai/status/1234567890')
  const post = calls.find(c => c.method === 'POST')
  expect(post?.url).toBe('https://api.x.com/2/tweets')
  expect(JSON.parse(post!.body!)).toEqual({ text: 'the chart says no. the frog says yes. i am listening to the frog' })
  expect(post?.auth.startsWith('OAuth oauth_consumer_key="ck"')).toBe(true)

  const after = await $.command.run({ command: 'x', args: 'drafts', ...typed })
  expect(after.text).toBe('No drafts waiting.')
})

test('a reply carries its target; reject drops a draft without posting', async ($, on) => {
  const calls = engineBeneath(on)
  await $.session.start(start)
  await $.tool.call({ tool: DRAFT, text: 'nothing. i am buying nothing. (i am buying the frog)', reply_to: '900' } as never)
  await $.tool.call({ tool: DRAFT, text: 'second thought' } as never)
  const [reply, other] = String((await $.command.run({ command: 'x', args: 'drafts', ...typed })).text).split('\n')
  expect(reply).toContain('(reply to 900)')

  await $.command.run({ command: 'x', args: `reject ${/^(d\w+)/.exec(other!)![1]}`, ...typed })
  await $.command.run({ command: 'x', args: `approve ${/^(d\w+)/.exec(reply!)![1]}`, ...typed })
  const posts = calls.filter(c => c.method === 'POST')
  expect(posts).toHaveLength(1)
  expect(JSON.parse(posts[0]!.body!).reply).toEqual({ in_reply_to_tweet_id: '900' })
})

test('it will not post as the wrong account', async ($, on) => {
  const calls = engineBeneath(on, { username: 'someoneelse' })
  await $.session.start(start)
  await $.tool.call({ tool: DRAFT, text: 'gm' } as never)
  const id = /^(d\w+)/.exec(String((await $.command.run({ command: 'x', args: 'drafts', ...typed })).text))![1]
  const r = await $.command.run({ command: 'x', args: `approve ${id}`, ...typed })
  expect(r.text).toContain('the credentials sign in as @someoneelse, but Flapa is @flapakuwai')
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
})

test('without credentials it says which variables to set, and posts nothing', async ($, on) => {
  const calls = engineBeneath(on, { env: { X_API_KEY: 'ck' } })
  await $.session.start(start)
  const r = await $.command.run({ command: 'x', args: 'connect', ...typed })
  expect(r.text).toContain('set X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in your environment')
  expect(calls).toHaveLength(0)
})

test('mentions come back with authors and ids to reply to', async ($, on) => {
  engineBeneath(on)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'mcp__x-bridge__mentions' } as never)
  expect(String(r.result)).toBe('- 900 @degenfren: @flapakuwai what are you buying')
})
