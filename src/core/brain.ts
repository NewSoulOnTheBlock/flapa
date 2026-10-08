// The brain: one step of thought at a time. Two backends behind one shape —
//   api: the Anthropic SDK, native tool use (an Anthropic API key)
//   cli: `claude -p` on the person's Claude subscription (an OAuth token from `claude setup-token`), tools as text
// Which one is the person's choice at setup: the credential they give decides it. With none there is no brain yet.
// The cortex owns the loop; the brain only answers "given this, what next?".
import Anthropic from '@anthropic-ai/sdk'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Msg, SystemBlock, Tool } from './types'

export type Call = { id: string; name: string; input: unknown }
export type Step = {
  /** Appended to the transcript as-is: on the API this keeps thinking blocks intact, as preserved thinking requires. */
  assistant: Msg['content']
  text: string
  calls: Call[]
  stop: 'done' | 'tools' | 'refused' | 'cut'
}
export type StepRequest = { system: SystemBlock[]; messages: Msg[]; tools: Tool[] }

export interface Brain {
  readonly kind: 'api' | 'cli' | 'fake' | 'none'
  /** One step of the main mind: may call tools. */
  step(req: StepRequest): Promise<Step>
  /** A quick reflex with no tools: reviews, replies, memory extraction. */
  quick(system: string, prompt: string): Promise<string>
}

export const DEEP_MODEL = process.env.FLAPA_MODEL || 'claude-opus-5-5'
export const QUICK_MODEL = process.env.FLAPA_QUICK_MODEL || 'claude-haiku-4-5'
const EFFORT = (process.env.FLAPA_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const textOf = (blocks: readonly { type: string; text?: string }[]) =>
  blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()

export class ApiBrain implements Brain {
  readonly kind = 'api'
  private client: Anthropic

  /** Without a key the SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the environment. */
  constructor(opts: { apiKey?: string; maxRetries?: number } = {}) {
    this.client = new Anthropic({ timeout: 5 * 60_000, maxRetries: opts.maxRetries ?? 2, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
  }

  async step({ system, messages, tools }: StepRequest): Promise<Step> {
    const r = await this.client.beta.messages.create({
      model: DEEP_MODEL,
      max_tokens: 16000,
      // Stable sections carry the cache breakpoint; mood and recall come after it.
      system: system.map(b => ({ type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
      messages,
      tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      output_config: { effort: EFFORT },
      // On a policy decline the API reruns the turn on a fallback model instead of stopping.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    })
    const calls = r.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input }))
    const stop = r.stop_reason === 'refusal' ? 'refused'
      : r.stop_reason === 'max_tokens' ? 'cut'
      : calls.length ? 'tools' : 'done'
    return { assistant: r.content as Msg['content'], text: textOf(r.content), calls, stop }
  }

  async quick(system: string, prompt: string): Promise<string> {
    const r = await this.client.messages.create({
      model: QUICK_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    return r.stop_reason === 'refusal' ? '' : textOf(r.content)
  }
}

// ---- cli: Claude Code headless, tools as text ----

const CALL_RE = /<call\s+name="([a-zA-Z0-9_-]+)">\s*([\s\S]*?)\s*<\/call>/g

export function toolProtocol(tools: readonly Tool[]): string {
  if (!tools.length) return ''
  return [
    '# Tools',
    'You act through these tools. To call one, write exactly:',
    '<call name="TOOL_NAME">{"json": "arguments"}</call>',
    'You may write a short sentence first and make several calls in one answer. Then STOP and wait: results come',
    'back as <result name="TOOL_NAME">…</result>. Never write a <result> yourself. When you need no more tools,',
    'answer in plain text with no <call>.',
    '',
    ...tools.map(t => `## ${t.name}\n${t.description}\nInput schema: ${JSON.stringify(t.input_schema)}`),
  ].join('\n')
}

/** The model's answer as text and calls. Bad JSON becomes a call whose input says so, so the tool can refuse it. */
export function parseCalls(raw: string): { text: string; calls: Call[] } {
  const calls: Call[] = []
  let i = 0
  for (const m of raw.matchAll(CALL_RE)) {
    let input: unknown
    try { input = JSON.parse(m[2] || '{}') } catch { input = { __invalid_json: m[2] } }
    calls.push({ id: `cli_${Date.now().toString(36)}_${i++}`, name: m[1]!, input })
  }
  // A model that wrote a fake result is cut off there: it must wait for the real one.
  const text = raw.replace(CALL_RE, '').split('<result')[0]!.trim()
  return { text, calls }
}

/** The transcript as one prompt: the CLI is one-shot, so every step resends it. */
export function renderTranscript(messages: readonly Msg[]): string {
  const out: string[] = []
  const names = new Map<string, string>()
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as const] : m.content
    for (const b of blocks as any[]) {
      if (b.type === 'text') out.push(m.role === 'user' ? `<input>\n${b.text}\n</input>` : b.text)
      else if (b.type === 'tool_use') {
        names.set(b.id, b.name)
        out.push(`<call name="${b.name}">${JSON.stringify(b.input)}</call>`)
      } else if (b.type === 'tool_result') {
        const body = typeof b.content === 'string' ? b.content : (b.content ?? []).map((c: any) => c.text ?? '').join('')
        out.push(`<result name="${names.get(b.tool_use_id) ?? 'tool'}">\n${body}\n</result>`)
      }
    }
  }
  out.push('\n(Your turn. Continue.)')
  return out.join('\n\n')
}

export class CliBrain implements Brain {
  readonly kind = 'cli'
  private timeoutMs: number
  private command: (model: string, sysFile: string) => string[]
  private env: Record<string, string>

  constructor(opts: { timeoutMs?: number; command?: (model: string, sysFile: string) => string[]; oauthToken?: string } = {}) {
    // The person's OAuth token signs this `claude` in, whatever the machine's own login is.
    this.env = opts.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken } : {}
    // A hung process would freeze the whole mind: thoughts run one at a time.
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.FLAPA_BRAIN_TIMEOUT_S || 240) * 1000
    this.command = opts.command ?? ((model, sysFile) => [
      'claude', '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--model', model, '--system-prompt-file', sysFile,
    ])
  }

  private async run(system: string, prompt: string, model: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'pacs-'))
    const sysFile = join(dir, 'system.md')
    writeFileSync(sysFile, system)
    let timedOut = false
    let killer: ReturnType<typeof setTimeout> | undefined
    try {
      const p = Bun.spawn(
        this.command(model, sysFile),
        {
          stdin: new TextEncoder().encode(prompt),
          stdout: 'pipe',
          stderr: 'pipe',
          // The PACS mods must not wake inside the brain: persona-core would talk over the harness's own prompt.
          env: { ...process.env, ...this.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '0' },
        },
      )
      killer = setTimeout(() => { timedOut = true; p.kill() }, this.timeoutMs)
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
      if (timedOut) throw new Error(`claude -p gave no answer in ${Math.round(this.timeoutMs / 1000)}s and was stopped`)
      let json: any
      try { json = JSON.parse(out) } catch { throw new Error(`claude -p exited ${code}: ${(err || out).slice(0, 300)}`) }
      if (json.is_error) throw new Error(`claude -p: ${String(json.result ?? json.subtype).slice(0, 300)}`)
      return String(json.result ?? '')
    } finally {
      clearTimeout(killer)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async step({ system, messages, tools }: StepRequest): Promise<Step> {
    const sys = [...system.map(b => b.text), toolProtocol(tools)].filter(Boolean).join('\n\n')
    const raw = await this.run(sys, renderTranscript(messages), DEEP_MODEL)
    const { text, calls } = parseCalls(raw)
    const assistant: any[] = []
    if (text) assistant.push({ type: 'text', text })
    for (const c of calls) assistant.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
    if (!assistant.length) assistant.push({ type: 'text', text: '(nothing)' })
    return { assistant, text, calls, stop: calls.length ? 'tools' : 'done' }
  }

  quick(system: string, prompt: string): Promise<string> {
    return this.run(system, prompt, QUICK_MODEL)
  }
}

/** Before setup: every thought is refused with the way out, so nothing pretends to think. */
export class NoBrain implements Brain {
  readonly kind = 'none'
  private fail(): never { throw new Error('no brain yet: add an Anthropic API key or a Claude OAuth token in setup') }
  async step(): Promise<Step> { this.fail() }
  async quick(): Promise<string> { this.fail() }
}

/** The body keeps one brain for life; setup swaps what is inside it, with no restart. */
export class SwitchBrain implements Brain {
  constructor(public current: Brain) {}
  get kind() { return this.current.kind }
  step(req: StepRequest) { return this.current.step(req) }
  quick(system: string, prompt: string) { return this.current.quick(system, prompt) }
}

export type BrainSecret = { anthropicApiKey?: string; claudeOauthToken?: string }

/** Which credential a pasted string is, by its published prefix. */
export function credentialKind(s: string): 'api' | 'oauth' | null {
  const v = s.trim()
  if (/^sk-ant-oat\d{2}-[\w-]{20,}$/.test(v)) return 'oauth'
  if (/^sk-ant-api\d{2}-[\w-]{20,}$/.test(v)) return 'api'
  return null
}

export function brainFrom(secret: BrainSecret): Brain | null {
  if (secret.anthropicApiKey) return new ApiBrain({ apiKey: secret.anthropicApiKey })
  if (secret.claudeOauthToken) return new CliBrain({ oauthToken: secret.claudeOauthToken })
  return null
}

/**
 * The environment wins (servers set it there), then what the person gave at setup. FLAPA_BRAIN=cli keeps the
 * machine's own `claude` login, for development. Nothing at all: no brain until setup.
 */
export function pickBrain(secret: BrainSecret = {}, env: Record<string, string | undefined> = process.env): Brain {
  if (env.FLAPA_BRAIN === 'cli') return new CliBrain()
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return new ApiBrain()
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return new CliBrain({ oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN })
  return brainFrom(secret) ?? new NoBrain()
}
