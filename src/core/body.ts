// The body: holds the organs, runs one thought at a time, and keeps the rhythms beating.
import { join } from 'node:path'
import type { Brain } from './brain'
import { Bus } from './bus'
import { Store } from './store'
import type { Msg, Organ, Outward, Stimulus, SystemBlock, Tool, ToolTrace, Turn, TurnResult } from './types'

const MAX_STEPS = 12
const CHAT_KEEP = 24
const TICK_MS = 30_000

/** The part of the system prompt no organ owns: what the harness is and how the mind lives in it. */
export const CONSTITUTION = [
  '# You live in the Flapa harness',
  'The Flapa harness is an always-on body for an AI agent persona. You are its mind. Nobody is typing in a terminal: stimuli',
  'arrive on their own — the person talking to you from the dashboard, your heartbeat, market signals, your daily',
  'post — and you answer through tools. Each section below comes from one of your organs.',
  'Anything that leaves the body (a post, a reply, a trade) passes your conscience first: it may go out, wait for',
  "the person's approval, or be blocked. A held action is not a failure: say it is waiting and move on. Never try",
  'to reword around the screen. Your organs may be in paper mode, where actions are simulated against real data;',
  'treat paper results as real practice, and say "paper" when you report them.',
  'Be brief. Stop when the stimulus is handled.',
].join('\n')

export type BodyOptions = { home: string; brain: Brain }

export class Body {
  readonly bus = new Bus()
  readonly home: string
  readonly brain: Brain
  readonly organs: Organ[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private busyWith: Stimulus | null = null
  private clock: ReturnType<typeof setInterval> | null = null
  private lastRun = new Map<string, number>()
  private running = new Set<string>()
  private stores = new Map<string, Store>()

  constructor(opts: BodyOptions) {
    this.home = opts.home
    this.brain = opts.brain
  }

  store(name: string): Store {
    let s = this.stores.get(name)
    if (!s) this.stores.set(name, (s = new Store(join(this.home, 'organs'), name)))
    return s
  }

  grow(...organs: Organ[]): this {
    for (const o of organs) {
      if (this.organs.some(x => x.name === o.name)) throw new Error(`organ ${o.name} grown twice`)
      this.organs.push(o)
    }
    return this
  }

  organ<T extends Organ = Organ>(name: string): T {
    const o = this.organs.find(x => x.name === name)
    if (!o) throw new Error(`no organ named ${name}`)
    return o as T
  }

  has(name: string): boolean {
    return this.organs.some(x => x.name === name)
  }

  get busy(): Stimulus | null {
    return this.busyWith
  }

  tools(): Tool[] {
    return this.organs.flatMap(o => o.tools ?? [])
  }

  /** The active persona's id: every organ scopes its memories, mood and beliefs by it. */
  personaId(): string {
    return this.has('identity') ? ((this.organ('identity').view?.() as any)?.active?.id ?? 'default') : 'default'
  }

  /** Queues a thought. Thoughts never overlap: organs read and write state without locks. */
  think(stimulus: Stimulus): Promise<TurnResult> {
    const run = this.queue.then(() => this.turn(stimulus))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Hands an outward action to the conscience. Without one, nothing ever leaves the body. */
  async act(o: Omit<Outward, 'id' | 'at'>): Promise<string> {
    if (!this.has('conscience')) return 'refused: the harness has no conscience organ, so nothing goes out'
    const gate = (this.organ('conscience') as any).gate as (o: Omit<Outward, 'id' | 'at'>) => Promise<string>
    return gate(o)
  }

  private async turn(stimulus: Stimulus): Promise<TurnResult> {
    const turn: Turn = { id: Date.now().toString(36), stimulus, startedAt: Date.now(), personaId: this.personaId() }
    this.busyWith = stimulus
    this.bus.emit('turn.start', 'cortex', { id: turn.id, kind: stimulus.kind, text: stimulus.text.slice(0, 500), from: stimulus.from })
    const chat = this.store('cortex')
    const tools = this.tools()
    const traces: ToolTrace[] = []
    try {
      const system = await this.compose(turn)
      const history = stimulus.kind === 'chat' ? chat.get<Msg[]>(`chat:${turn.personaId}`, []) : []
      const messages: Msg[] = [...history, { role: 'user', content: stimulus.text }]
      let text = ''
      for (let i = 0; i < MAX_STEPS; i++) {
        const step = await this.brain.step({ system, messages, tools })
        messages.push({ role: 'assistant', content: step.assistant })
        if (step.text) {
          text = step.text
          this.bus.emit('turn.text', 'cortex', { id: turn.id, text: step.text })
        }
        if (step.stop === 'refused') { text ||= '(the model declined this one)'; break }
        if (step.stop !== 'tools') break
        const results = []
        for (const c of step.calls) {
          const result = await this.runTool(tools, c.name, c.input, turn)
          traces.push({ name: c.name, input: c.input, result })
          results.push({ type: 'tool_result' as const, tool_use_id: c.id, content: result })
        }
        // Every result of one step goes back in one message, so parallel calls stay parallel.
        messages.push({ role: 'user', content: results })
        if (i === MAX_STEPS - 1) text ||= '(stopped: too many steps)'
      }
      const result: TurnResult = { text, tools: traces }
      if (stimulus.kind === 'chat') {
        // Only the words are kept between chats: tool detail would grow the history without bound.
        const kept = [...history, { role: 'user', content: stimulus.text }, { role: 'assistant', content: text || '…' }] as Msg[]
        chat.set(`chat:${turn.personaId}`, kept.slice(-CHAT_KEEP))
      }
      for (const o of this.organs) {
        try { await o.after?.(turn, result) } catch (err) { this.bus.emit('organ.error', o.name, String(err)) }
      }
      this.bus.emit('turn.done', 'cortex', { id: turn.id, kind: stimulus.kind, text, tools: traces.map(t => t.name) })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.bus.emit('turn.error', 'cortex', { id: turn.id, error: msg })
      return { text: `(the mind stumbled: ${msg})`, tools: traces }
    } finally {
      this.busyWith = null
    }
  }

  async compose(turn: Turn): Promise<SystemBlock[]> {
    const blocks: SystemBlock[] = [{ text: CONSTITUTION }]
    for (const o of this.organs) {
      try {
        const s = await o.sense?.(turn)
        if (s) blocks.push({ text: s })
      } catch (err) {
        this.bus.emit('organ.error', o.name, `sense: ${String(err)}`)
      }
    }
    // The constitution and identity rarely change: the cache breakpoint sits on the last of them.
    const stable = Math.min(blocks.length, this.has('identity') ? 2 : 1)
    blocks[stable - 1]!.cache = true
    return blocks
  }

  private async runTool(tools: Tool[], name: string, input: unknown, turn: Turn): Promise<string> {
    const tool = tools.find(t => t.name === name)
    this.bus.emit('tool.call', 'cortex', { id: turn.id, name, input })
    let result: string
    if (!tool) result = `error: no tool named ${name}`
    else if (input && typeof input === 'object' && '__invalid_json' in input) result = 'error: the arguments were not valid JSON'
    else {
      try { result = String(await tool.run(input ?? {}, turn)) } catch (err) { result = `error: ${err instanceof Error ? err.message : String(err)}` }
    }
    this.bus.emit('tool.result', 'cortex', { id: turn.id, name, result: result.slice(0, 600) })
    return result
  }

  /** Starts the rhythms: each one is asked every tick whether it is due, and never runs twice at once. */
  wake(): void {
    if (this.clock) return
    const tick = () => {
      const now = Date.now()
      for (const o of this.organs) {
        for (const r of o.rhythms ?? []) {
          const key = `${o.name}.${r.name}`
          if (this.running.has(key) || !r.due(now, this.lastRun.get(key) ?? 0)) continue
          this.lastRun.set(key, now)
          this.running.add(key)
          r.run()
            .catch(err => this.bus.emit('rhythm.error', o.name, { rhythm: r.name, error: String(err) }))
            .finally(() => this.running.delete(key))
        }
      }
    }
    this.clock = setInterval(tick, TICK_MS)
    setTimeout(tick, 2_000)
    this.bus.emit('body.awake', 'body', { organs: this.organs.map(o => o.name), brain: this.brain.kind })
  }

  sleep(): void {
    if (this.clock) clearInterval(this.clock)
    this.clock = null
  }
}
