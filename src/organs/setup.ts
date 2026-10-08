// setup: getting an empty P.A.C.S to a working agent. The brain comes first (the person's Anthropic API key or
// Claude OAuth token, tested before it is kept), then the persona (the forge), then the colors, then a checklist
// of everything else with a read-only test for each. Nothing here sends a post, a trade or a transfer.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Body } from '../core/body'
import { brainFrom, credentialKind, pickBrain, type Brain, type BrainSecret, type SwitchBrain } from '../core/brain'
import type { Organ } from '../core/types'
import type { FomoApi } from '../lib/fomoapi'
import type { Mem0 } from '../lib/mem0'
import { DEFAULT_THEME, THEMES, themeById } from '../lib/themes'
import type { Helper } from './hands'

export type StepId = 'brain' | 'persona' | 'theme' | 'x' | 'wallet' | 'rpc' | 'fomo' | 'mem0' | 'window'
export type TestResult = { ok: boolean; detail: string; at: number }
export type SetupStep = { id: StepId; label: string; required: boolean; ok: boolean; detail: string; how: string; testable: boolean; last?: TestResult }

/** The brain credential lives here, beside the state: git-ignored, never published, never packed into a seed. */
const SECRETS = 'secrets.json'
const DEFAULT_RPC = 'https://bsc-dataseed.bnbchain.org'
const mask = (s: string) => `…${s.slice(-4)}`

export function readSecrets(home: string): BrainSecret {
  try { return JSON.parse(readFileSync(join(home, SECRETS), 'utf8')) as BrainSecret } catch { return {} }
}

export type SetupDeps = {
  brain: SwitchBrain
  helper?: Helper
  fomo?: FomoApi | null
  mem0?: Mem0 | null
  fetcher?: typeof fetch
  env?: Record<string, string | undefined>
  /** Builds a brain from a credential; tests swap it for a fake. */
  makeBrain?: (s: BrainSecret) => Brain | null
}

export function setup(body: Body, deps: SetupDeps): Organ {
  const store = body.store('setup')
  const env = deps.env ?? process.env
  const fetcher = deps.fetcher ?? fetch
  const secretsPath = join(body.home, SECRETS)
  const make = deps.makeBrain ?? brainFrom
  const results = () => store.get<Partial<Record<StepId, TestResult>>>('tests', {})
  const theme = () => themeById(store.get('theme', '')) ?? DEFAULT_THEME
  const persona = () => (body.has('identity') ? (body.organ('identity').view?.() as any)?.active : null) as { id: string; name: string } | null
  const hands = () => (body.has('hands') ? body.organ('hands') as Organ & { liveReady?: () => string | undefined } : null)

  /** Where the brain's credential came from, for the checklist. Never the credential itself. */
  const brainSource = (): string => {
    if (env.FLAPA_BRAIN === 'cli') return "this machine's own claude login (FLAPA_BRAIN=cli)"
    if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return 'an API key in the environment'
    if (env.CLAUDE_CODE_OAUTH_TOKEN) return 'an OAuth token in the environment'
    const s = readSecrets(body.home)
    if (s.anthropicApiKey) return `the API key you gave at setup (${mask(s.anthropicApiKey)})`
    if (s.claudeOauthToken) return `the OAuth token you gave at setup (${mask(s.claudeOauthToken)})`
    return 'nothing yet'
  }

  async function ping(): Promise<string> {
    const r = await deps.brain.quick('You are a connection test. Answer with the single word OK.', 'ping')
    if (!r.trim()) throw new Error('the brain answered with nothing')
    return r.trim().slice(0, 40)
  }

  const steps = (): SetupStep[] => {
    const last = results()
    const xKeys = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']
    const xMissing = xKeys.filter(k => !env[k])
    const walletWhy = hands()?.liveReady?.()
    const p = persona()
    const s: Omit<SetupStep, 'last'>[] = [
      { id: 'brain', label: 'brain', required: true, ok: deps.brain.kind !== 'none', testable: deps.brain.kind !== 'none',
        detail: deps.brain.kind === 'none' ? 'no brain yet' : `${deps.brain.kind === 'api' ? 'Anthropic API' : 'claude -p'} · ${brainSource()}`,
        how: 'Paste an Anthropic API key (console.anthropic.com) or a Claude OAuth token (run claude setup-token). It is tested before it is kept.' },
      { id: 'persona', label: 'persona', required: true, ok: !!p, testable: false,
        detail: p ? p.name : 'nobody home yet', how: 'Answer the forge questions; you can edit the file after.' },
      { id: 'theme', label: 'colors', required: true, ok: !!themeById(store.get('theme', '')), testable: false,
        detail: theme().name, how: 'Pick one of eight schemes for the dashboard and the public window.' },
      { id: 'x', label: 'X account', required: false, ok: !xMissing.length, testable: !xMissing.length,
        detail: xMissing.length ? `missing ${xMissing.join(', ')}` : 'keys set',
        how: 'Optional. For posting: put the four X OAuth 1.0a user keys in .env and restart. Posts stay on paper until you switch them live.' },
      { id: 'wallet', label: 'trading wallet', required: false, ok: !walletWhy, testable: !walletWhy,
        detail: walletWhy ?? (env.FLAPA_WALLET_MODE === 'fomo' ? 'fomo smart account + gas wallet' : 'plain wallet'),
        how: 'Optional. For live trades: FLAPA_TRADER_KEY in .env (never paste it anywhere else). Trades stay on paper until you switch them live.' },
      { id: 'rpc', label: 'BNB Chain RPC', required: false, ok: true, testable: true,
        detail: env.BSC_RPC_URL ? 'your own RPC' : 'the public RPC (fine to start; an Alchemy URL also finds untracked tokens)',
        how: 'Optional. BSC_RPC_URL in .env.' },
      { id: 'fomo', label: 'FomoAPI', required: false, ok: !!deps.fomo, testable: !!deps.fomo,
        detail: deps.fomo ? 'key set' : 'not set: no copy trading or trader radar',
        how: 'Optional. FOMO_API_KEY in .env, for the trader radar and copy trading.' },
      { id: 'mem0', label: 'long-term memory', required: false, ok: !!deps.mem0, testable: !!deps.mem0,
        detail: deps.mem0 ? 'mem0' : 'local memory (works; mem0 recalls better)',
        how: 'Optional. MEM0_API_KEY in .env.' },
      { id: 'window', label: 'public window', required: false, ok: !!(env.BLOB_READ_WRITE_TOKEN || env.PORT || env.FLAPA_PUBLIC_PORT), testable: false,
        detail: env.BLOB_READ_WRITE_TOKEN || env.PORT || env.FLAPA_PUBLIC_PORT ? 'publishing' : 'off',
        how: 'Optional. A read-only page others can watch: see the README.' },
    ]
    // Keys that exist but failed their last test are not ok: present is not the same as working.
    return s.map(x => ({ ...x, ok: x.ok && last[x.id]?.ok !== false, ...(last[x.id] ? { last: last[x.id] } : {}) }))
  }

  const tests: Partial<Record<StepId, () => Promise<string>>> = {
    brain: async () => `answered "${await ping()}"`,
    x: async () => {
      const r = await body.organ('voice').actions!.whoami!({}) as { username: string }
      return `signed in as @${r.username}`
    },
    wallet: async () => {
      if (!deps.helper) throw new Error('no trade helper')
      const h = await deps.helper('holdings', { tokens: [] })
      const gas = h.gasWei !== undefined ? ` · gas wallet ${(Number(BigInt(h.gasWei)) / 1e18).toFixed(5)} BNB` : ''
      return `${h.address.slice(0, 6)}…${h.address.slice(-4)} holds ${(Number(BigInt(h.fundsWei)) / 1e18).toFixed(4)} BNB${gas}`
    },
    rpc: async () => {
      const r = await fetcher(env.BSC_RPC_URL || DEFAULT_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) })
      const j = await r.json() as { result?: string }
      if (j.result !== '0x38') throw new Error(`that RPC is on chain ${j.result ?? '?'}, not BNB Chain (0x38)`)
      return 'BNB Chain (56) answers'
    },
    fomo: async () => `leaderboard answers (${(await deps.fomo!.leaderboard('24h', 3)).length} traders)`,
    mem0: async () => `mem0 answers (${(await deps.mem0!.list({ agent_id: persona()?.id ?? 'setup-test' }, 1)).length} memories read)`,
  }

  return {
    name: 'setup',
    role: 'Gets an empty harness to a working agent: brain, persona, colors, and a tested checklist.',
    view: () => {
      const list = steps()
      return {
        steps: list, ready: list.filter(s => s.required).every(s => s.ok), finished: store.get('finished', false),
        theme: theme(), themes: THEMES,
      }
    },
    actions: {
      /** Tests the credential with one real call, and only then keeps it and swaps the brain in. */
      brain: async ({ credential }) => {
        const value = String(credential ?? '').trim()
        const kind = credentialKind(value)
        if (!kind) throw new Error('that is neither an Anthropic API key (sk-ant-api…) nor a Claude OAuth token (sk-ant-oat…)')
        const secret: BrainSecret = kind === 'api' ? { anthropicApiKey: value } : { claudeOauthToken: value }
        const candidate = make(secret)!
        let said: string
        try { said = await candidate.quick('You are a connection test. Answer with the single word OK.', 'ping') } catch (err) {
          throw new Error(`the ${kind === 'api' ? 'API key' : 'OAuth token'} did not work: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`)
        }
        if (!said.trim()) throw new Error('the brain answered with nothing')
        writeFileSync(secretsPath, JSON.stringify(secret, null, 2))
        try { chmodSync(secretsPath, 0o600) } catch { /* not on every filesystem */ }
        // The environment still wins: a key set there is what the body keeps using.
        deps.brain.current = env.FLAPA_BRAIN === 'cli' || env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.CLAUDE_CODE_OAUTH_TOKEN ? pickBrain(secret, env) : candidate
        store.update<Partial<Record<StepId, TestResult>>>('tests', {}, t => ({ ...t, brain: { ok: true, detail: `answered "${said.trim().slice(0, 40)}"`, at: Date.now() } }))
        body.bus.emit('brain', 'setup', { kind: deps.brain.kind })
        return { kind: deps.brain.kind, source: brainSource() }
      },
      /** Forgets the stored credential. A key in the environment is not touched. */
      forgetBrain: () => {
        if (existsSync(secretsPath)) writeFileSync(secretsPath, '{}')
        deps.brain.current = pickBrain({}, env)
        return { kind: deps.brain.kind }
      },
      theme: ({ id }) => {
        const t = themeById(id)
        if (!t) throw new Error(`no theme ${id}: ${THEMES.map(x => x.id).join(', ')}`)
        store.set('theme', t.id)
        body.bus.emit('theme', 'setup', { id: t.id })
        return t
      },
      test: async ({ step }) => {
        const run = tests[step as StepId]
        if (!run) throw new Error(`nothing to test for ${step}`)
        let r: TestResult
        try { r = { ok: true, detail: await run(), at: Date.now() } } catch (err) {
          r = { ok: false, detail: String(err instanceof Error ? err.message : err).slice(0, 240), at: Date.now() }
        }
        store.update<Partial<Record<StepId, TestResult>>>('tests', {}, t => ({ ...t, [step]: r }))
        return r
      },
      finish: () => {
        if (!steps().filter(s => s.required).every(s => s.ok)) throw new Error('the brain, a persona and colors come first')
        return store.set('finished', true)
      },
      reopen: () => store.set('finished', false),
    },
  }
}
