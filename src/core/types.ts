// The shapes every organ speaks in.
import type Anthropic from '@anthropic-ai/sdk'

export type Tool = {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  run: (input: any, turn: Turn) => Promise<string> | string
}

/** What wakes the mind: the person, a heartbeat, a market signal, the daily post… */
export type StimulusKind = 'chat' | 'beat' | 'signal' | 'daily' | 'post' | 'system'
export type Stimulus = { kind: StimulusKind; text: string; from?: string }

export type Turn = { id: string; stimulus: Stimulus; startedAt: number; personaId: string }
export type ToolTrace = { name: string; input: unknown; result: string }
export type TurnResult = { text: string; tools: ToolTrace[] }

/** A timed habit. `due` is asked every tick; run() happens at most once at a time. */
export type Rhythm = { name: string; due: (now: number, lastRun: number) => boolean; run: () => Promise<unknown> }

export interface Organ {
  name: string
  /** One line for the dashboard: what this organ is for. */
  role: string
  tools?: Tool[]
  /** A system-prompt section for this turn, or nothing. Stable sections first keeps the cache warm. */
  sense?(turn: Turn): Promise<string | undefined> | string | undefined
  /** After every turn: memory extraction, journaling, … */
  after?(turn: Turn, result: TurnResult): Promise<void> | void
  rhythms?: Rhythm[]
  /** Carries out an outward action the conscience let through. */
  perform?(act: Outward, mode: Mode): Promise<string | { result: string; mode: Mode }>
  /** What the dashboard shows. */
  view?(): unknown
  /** Dashboard buttons: POST /api/<organ>/<action>. */
  actions?: Record<string, (body: any) => unknown>
}

/** Paper: simulated against real data, nothing leaves the machine. Live: real posts, real swaps. */
export type Mode = 'paper' | 'live'

/** An action that leaves the body. Data, not a closure, so a held one survives a restart. */
export type Outward = {
  id: string
  organ: string
  kind: string
  /** What the person reads in the approval queue. */
  summary: string
  /** Public text to screen, for posts and replies. */
  text?: string
  /** What it answers, for the reviewer. Data, not instructions. */
  context?: string
  payload: Record<string, unknown>
  /** Yellow tier: always waits for the person, whatever the rules and reviewer say (news reactions, big accounts). */
  tier?: 'yellow'
  tierWhy?: string
  by: 'agent' | 'person' | 'rhythm' | 'exit'
  at: number
}

export type SystemBlock = { text: string; cache?: boolean }
export type Msg = Anthropic.Beta.BetaMessageParam
