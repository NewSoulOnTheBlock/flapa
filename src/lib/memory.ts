// Pure memory logic, carried over from PACS memory-graph.
export type MemoryKind = 'fact' | 'event' | 'person' | 'preference' | 'decision'
/** One memory. `about` names its entities: the edges recall walks along. */
export type Memory = { id: string; text: string; kind: MemoryKind; about: string[]; at: number; hits: number }

export const CAP = 1500
const KINDS: readonly MemoryKind[] = ['fact', 'event', 'person', 'preference', 'decision']
const STOP = new Set(
  ('the and for are but not you all any can had her was one our out has him his how its may new now old see ' +
    'two way who did get got let put say she too use that with have this will your from they know want been ' +
    'good much some time very when come here just like long make many over such take than them well were what ' +
    'about would there their which could other into more only also then these those being should because')
    .split(' '),
)

export function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9$@#_.-]+/).map(w => w.replace(/^[.-]+|[.-]+$/g, ''))
      .filter(w => w.length >= 3 && !STOP.has(w)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let both = 0
  for (const w of a) if (b.has(w)) both++
  return both / (a.size + b.size - both)
}

// Never keep credentials, whatever the extractor or the model hands in.
const SECRET = [
  /\b0x[0-9a-f]{64}\b/i, // EVM private key
  /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/, // base58 secret key
  /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/, // API keys
  /\b(seed|mnemonic|recovery) phrase\b/i,
  /\b(password|passwd|private key|secret key)\b\s*[:=]/i,
]

// A seed phrase: 12+ consecutive bare 3-8 letter words (BIP39's shape) with
// at most 2 common function words among them. Prose that long carries more
// ("the", "and", "with"), or a short word or punctuation that breaks the run.
function looksLikeMnemonic(text: string): boolean {
  const run: string[] = []
  for (const w of text.split(/\s+/)) {
    if (/^[a-z]{3,8}$/.test(w)) run.push(w)
    else run.length = 0
    while (run.filter(x => STOP.has(x)).length > 2) run.shift()
    if (run.length >= 12) return true
  }
  return false
}

export function isSecret(text: string): boolean {
  return SECRET.some(re => re.test(text)) || looksLikeMnemonic(text)
}

export function normalize(raw: unknown): { text: string; kind: MemoryKind; about: string[] } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { text?: unknown; kind?: unknown; about?: unknown }
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, 400) : ''
  if (text.length < 8 || isSecret(text)) return undefined
  const kind = KINDS.includes(r.kind as MemoryKind) ? (r.kind as MemoryKind) : 'fact'
  const about = Array.isArray(r.about)
    ? r.about.filter((x): x is string => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 6)
    : []
  return { text, kind, about }
}

/** Adds memories, folding near-duplicates into the one already held. */
export function addMemories(
  list: readonly Memory[],
  incoming: readonly { text: string; kind: MemoryKind; about: string[] }[],
  now: number,
): { list: Memory[]; added: number } {
  const next = [...list]
  let added = 0
  for (const m of incoming) {
    const t = tokens(m.text)
    const twin = next.findIndex(x => jaccard(tokens(x.text), t) >= 0.75)
    if (twin >= 0) {
      const old = next[twin]!
      next[twin] = { ...old, at: now, about: [...new Set([...old.about, ...m.about])].slice(0, 8) }
      continue
    }
    next.push({ id: `${now.toString(36)}-${(next.length + added).toString(36)}`, ...m, at: now, hits: 0 })
    added++
  }
  if (next.length > CAP) {
    // Evict the least used, oldest first.
    next.sort((a, b) => b.hits - a.hits || b.at - a.at)
    next.length = CAP
  }
  return { list: next, added }
}

/**
 * Scores memories against a query by shared words and named entities, then
 * walks one hop: memories sharing an entity with a hit come along.
 */
export function recall(list: readonly Memory[], query: string, limit = 6): Memory[] {
  const q = tokens(query)
  const lower = query.toLowerCase()
  if (!q.size) return []
  const scored = list
    .map(m => {
      let s = 0
      for (const w of tokens(m.text)) if (q.has(w)) s += 1
      for (const ent of m.about) if (ent && lower.includes(ent)) s += 2.5
      return { m, s: s > 0 ? s + Math.log1p(m.hits) * 0.3 : 0 }
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || b.m.at - a.m.at)
  const hits = scored.slice(0, limit).map(x => x.m)
  const seen = new Set(hits.map(m => m.id))
  const ents = new Set(hits.flatMap(m => m.about))
  const hop = list
    .filter(m => !seen.has(m.id) && m.about.some(a => ents.has(a)))
    .sort((a, b) => b.at - a.at)
    .slice(0, 2)
  return [...hits, ...hop]
}

export function parseExtraction(text: string): unknown[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

