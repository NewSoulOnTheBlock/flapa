// The brain: one step of thought at a time. Two backends behind one shape —
//   api: the Anthropic SDK, native tool use (ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN)
//   cli: `claude -p` on the person's Claude subscription, tools spoken as a text protocol
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
  readonly kind: 'api' | 'cli' | 'fake'
  /** One step of the main mind: may call tools. */
  step(req: StepRequest): Promise<Step>
  /** A quick reflex with no tools: reviews, replies, memory extraction. */
  quick(system: string, prompt: string): Promise<string>
}

export const DEEP_MODEL = process.env.SOMA_MODEL || 'claude-opus-5-5'
export const QUICK_MODEL = process.env.SOMA_QUICK_MODEL || 'claude-haiku-4-5'
const EFFORT = (process.env.SOMA_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const textOf = (blocks: readonly { type: string; text?: string }[]) =>
  blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()

export class ApiBrain implements Brain {
  readonly kind = 'api'
  private client = new Anthropic()

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

  private async run(system: string, prompt: string, model: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'soma-'))
    const sysFile = join(dir, 'system.md')
    writeFileSync(sysFile, system)
    try {
      const p = Bun.spawn(
        ['claude', '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
          '--model', model, '--system-prompt-file', sysFile],
        {
          stdin: new TextEncoder().encode(prompt),
          stdout: 'pipe',
          stderr: 'pipe',
          // The PACS mods must not wake inside the brain: persona-core would talk over SOMA's own prompt.
          env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '0' },
        },
      )
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
      let json: any
      try { json = JSON.parse(out) } catch { throw new Error(`claude -p exited ${code}: ${(err || out).slice(0, 300)}`) }
      if (json.is_error) throw new Error(`claude -p: ${String(json.result ?? json.subtype).slice(0, 300)}`)
      return String(json.result ?? '')
    } finally {
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

export function pickBrain(): Brain {
  const want = process.env.SOMA_BRAIN
  if (want === 'cli') return new CliBrain()
  if (want === 'api' || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return new ApiBrain()
  return new CliBrain()
}
