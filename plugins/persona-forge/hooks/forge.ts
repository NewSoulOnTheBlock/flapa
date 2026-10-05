// Pure forge logic: the interview, the generation prompt, the draft parser.
import type { ForgeDraft, SeedStance } from '../types'

export const QUESTIONS: readonly { key: string; ask: string; hint: string }[] = [
  { key: 'name', ask: "What's the agent's name?", hint: 'e.g. Flapa' },
  { key: 'handle', ask: 'X handle?', hint: 'optional, e.g. @flapakuwai' },
  { key: 'world', ask: 'What is their world?', hint: 'what they do, where they hang out online' },
  { key: 'vibe', ask: 'Three words for their personality', hint: 'e.g. bubbly, competitive, nerdy' },
  { key: 'writing', ask: 'How do they write?', hint: 'case, emoji, slang, length, quirks' },
  { key: 'loves', ask: 'What do they love?', hint: 'what lights them up' },
  { key: 'hates', ask: 'What do they hate or mock?', hint: 'pet peeves, rivals, things they never do' },
  { key: 'origin', ask: 'Origin story seed', hint: "a line or two, or 'invent it'" },
  { key: 'drive', ask: 'What do they want most?', hint: 'their goal, the thing they chase' },
  { key: 'topics', ask: 'What would they post about today?', hint: 'a few topics, comma separated' },
]

/** Taboos every forged persona carries, whatever the answers. */
export const BASE_TABOOS = [
  'claims to be human: it is openly an AI agent',
  'tells followers to buy anything or promises anyone gains: its trades and takes are not advice',
]

export function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

export function uniqueId(base: string, taken: readonly string[]): string {
  const root = slug(base) || 'persona'
  if (!taken.includes(root)) return root
  for (let n = 2; ; n++) if (!taken.includes(`${root}-${n}`)) return `${root}-${n}`
}

export const SYSTEM = [
  'You design AI agent personas for social media. Given an interview, write one persona as JSON.',
  'Make it specific and alive: a real point of view, real opinions, a distinct voice. Avoid generic',
  'assistant tone and cliches. The persona is openly an AI agent; never write it as claiming to be human.',
  'If it touches markets or tokens, it may be a degenerate about its own trades, but never gives',
  'financial advice, never promises gains, never tells anyone to buy.',
  'Answer with only this JSON object:',
  '{"name": string, "handle": string (no @), "tagline": string (one line, in their voice),',
  ' "voice": string (2-4 short paragraphs: how they talk and write, with concrete quirks),',
  ' "backstory": string (3-6 short paragraphs), "values": string[] (4-6),',
  ' "taboos": string[] (3-5 things they never do), "examples": string[] (5 posts in their exact voice,',
  ' each under 280 characters, spanning different modes: insight, joke, hot take, win, loss),',
  ' "stances": [{"topic": string, "stance": string (in their words), "confidence": number 0-1,',
  ' "reason": string}] (3-5 opinions they would defend)}',
].join('\n')

export function interviewPrompt(answers: readonly string[]): string {
  return QUESTIONS.map((q, i) => `${q.ask}\n${(answers[i] ?? '').trim() || '(no answer: decide)'}`).join('\n\n')
}

const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
const strs = (x: unknown, max: number) =>
  Array.isArray(x) ? x.map(str).filter(Boolean).slice(0, max) : []

/** Parses the model's JSON into a draft; undefined when it has no usable name. */
export function parseDraft(text: string, answers: readonly string[], taken: readonly string[]): ForgeDraft | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return undefined
  }
  const name = str(raw.name) || (answers[0] ?? '').trim()
  if (!name) return undefined
  const stances: SeedStance[] = Array.isArray(raw.stances)
    ? raw.stances
        .map(s => s as Record<string, unknown>)
        .map(s => ({
          topic: str(s.topic),
          stance: str(s.stance),
          confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.6)),
          reason: str(s.reason),
        }))
        .filter(s => s.topic && s.stance && s.reason)
        .slice(0, 6)
    : []
  const taboos = strs(raw.taboos, 8)
  const has = (re: RegExp) => taboos.some(t => re.test(t))
  if (!has(/human/i)) taboos.push(BASE_TABOOS[0]!)
  if (!has(/advice|promis|tells? (followers|people|anyone) to buy/i)) taboos.push(BASE_TABOOS[1]!)
  return {
    id: uniqueId(name, taken),
    name,
    handle: (str(raw.handle) || (answers[1] ?? '').trim()).replace(/^@/, ''),
    tagline: str(raw.tagline),
    voice: str(raw.voice),
    backstory: str(raw.backstory),
    values: strs(raw.values, 8),
    taboos,
    examples: strs(raw.examples, 8).map(x => x.slice(0, 280)),
    stances,
  }
}

/** The file persona-core imports: the draft without its stances. */
export function personaFile(d: ForgeDraft): string {
  const { stances: _, ...persona } = d
  return `${JSON.stringify(persona, null, 2)}\n`
}
