// The window: a public, read-only snapshot of Flapa for the Vercel page.
//
// Built as an allow-list. Nothing is copied wholesale from an organ's view: every published field is
// named here. What never leaves: chats with the person, memories (they are about the person), held or
// blocked actions, tool results, the approval queue, any control, any key. A last pass redacts anything
// shaped like a key, in case one ever slips into a string.
import { put } from '@vercel/blob'
import type { Body } from './body'
import type { Signal } from './bus'

export const SNAPSHOT_PATH = 'flapa/snapshot.json'
const PUBLISH_EVERY_MS = 60_000
/** The page calls her offline after 5 minutes of silence; a heartbeat upload comes before that. */
const ALIVE_EVERY_MS = 4 * 60_000
const KEEP_THOUGHTS = 40

export type PublicThought = { at: number; kind: string; text: string }

const KEYLIKE = [
  /(?<!\/tx\/)\b(?:0x)?[0-9a-f]{64}\b/gi, // EVM private keys; a BscScan tx link is public and stays
  /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g, // base58 secret keys
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, // API keys
  /\bvercel_blob_rw_[A-Za-z0-9_]+/g,
]

/** Every string in the snapshot passes this last. */
export function redact<T>(v: T): T {
  if (typeof v === 'string') return KEYLIKE.reduce((s, re) => s.replace(re, '[redacted]'), v as string) as T
  if (Array.isArray(v)) return v.map(redact) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)])) as T
  return v
}

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

/** Watches the nervous system and keeps only what she did on her own: never a chat with the person. */
export class ThoughtLog {
  private kinds = new Map<string, string>()
  readonly items: PublicThought[] = []

  see(s: Signal): void {
    const d = (s.data ?? {}) as any
    if (s.type === 'turn.start') {
      this.kinds.set(d.id, d.kind)
      if (this.kinds.size > 200) this.kinds.delete(this.kinds.keys().next().value!)
      if (d.kind !== 'chat') this.push(s.at, 'wake', `woke up for a ${d.kind}`)
      return
    }
    const turnKind = d.id ? this.kinds.get(d.id) : undefined
    if (turnKind === 'chat') return // her talks with the person are theirs
    switch (s.type) {
      case 'turn.text': if (turnKind) this.push(s.at, 'thought', clip(d.text, 600)); break
      case 'tool.call': if (turnKind) this.push(s.at, 'tool', `using ${clip(d.name, 40)}…`); break
      case 'mood': this.push(s.at, 'mood', `${d.emoji ?? ''} feeling ${clip(d.label, 20)}: ${clip(d.what, 140)}`); break
      case 'stance': this.push(s.at, 'stance', `${clip(d.change, 12)} a stance on ${clip(d.topic, 60)}: ${clip(d.stance, 200)}`); break
      case 'research': this.push(s.at, 'research', `looked at $${clip(d.symbol, 16)}: ${clip(d.line, 220)}`); break
      case 'trade': this.push(s.at, 'trade', `${d.paper ? 'paper' : 'LIVE'} ${d.side} $${clip(d.symbol, 16)} · ${Number(d.bnb).toFixed(4)} BNB`); break
      case 'posted': this.push(s.at, 'post', `${d.mode} post: ${clip(d.text, 300)}`); break
    }
  }

  private push(at: number, kind: string, text: string) {
    this.items.push({ at, kind, text })
    if (this.items.length > KEEP_THOUGHTS) this.items.splice(0, this.items.length - KEEP_THOUGHTS)
  }
}

const view = (body: Body, organ: string): any => (body.has(organ) ? body.organ(organ).view?.() ?? null : null)

export function publicSnapshot(body: Body, thoughts: readonly PublicThought[], now = Date.now()) {
  const id = view(body, 'identity')?.active
  const mood = view(body, 'affect')
  const agenda = view(body, 'agenda')
  const beliefs = view(body, 'beliefs')
  const eyes = view(body, 'eyes')
  const hands = view(body, 'hands')
  const voice = view(body, 'voice')
  const c = view(body, 'conscience')
  return redact({
    v: 1,
    at: now,
    persona: id ? { name: clip(id.name, 40), handle: clip(id.handle, 20), tagline: clip(id.tagline, 200) } : null,
    busy: body.busy ? body.busy.kind : null,
    mood: mood ? {
      label: mood.label, emoji: mood.emoji, valence: mood.valence, energy: mood.energy,
      events: mood.events.slice(0, 6).map((e: any) => ({ at: e.at, what: clip(e.what, 140), valence: e.valence })),
    } : null,
    agenda: agenda ? {
      todos: agenda.todos.map((t: any) => ({ text: clip(t.text, 200), isDone: !!t.isDone, hers: t.by === 'agent' })),
      heart: { isOn: !!agenda.heart.isOn, beats: agenda.heart.beats, everyMin: agenda.heart.everyMin },
      journal: agenda.journal.slice(0, 3).map((j: any) => ({ at: j.at, n: j.n, text: clip(j.text, 800) })),
    } : null,
    beliefs: beliefs ? beliefs.ledger.slice(0, 8).map((o: any) => ({ topic: clip(o.topic, 60), stance: clip(o.stance, 300), confidence: o.confidence })) : [],
    fomo: eyes ? {
      board: eyes.board ? {
        window: eyes.board.window, at: eyes.board.at,
        rows: eyes.board.rows.slice(0, 10).map((r: any) => ({ rank: r.rank, handle: clip(r.handle, 30), x: r.x ? clip(r.x, 16) : null, pnlUsd: r.pnlUsd, trades: r.trades, top: r.top ? { symbol: clip(r.top.symbol, 16), pnlUsd: r.top.pnlUsd } : null })),
      } : null,
      research: (eyes.research ?? []).slice(0, 10).map((r: any) => ({ at: r.at, by: r.by, token: r.token, symbol: clip(r.symbol, 16), line: clip(r.line, 240), priceUsd: r.priceUsd ?? null, liquidityUsd: r.liquidityUsd ?? null, change24hPct: r.change24hPct ?? null, marketCapUsd: r.marketCapUsd ?? null })),
    } : null,
    trades: hands ? {
      mode: hands.mode,
      day: hands.day,
      limits: { maxPerTradeBnb: hands.limits.maxPerTradeBnb, maxDailyBnb: hands.limits.maxDailyBnb, maxOpen: hands.limits.maxOpen, maxDailyLossBnb: hands.limits.maxDailyLossBnb },
      positions: hands.positions.map((p: any) => ({ symbol: clip(p.symbol, 16), token: p.token, paper: !!p.paper, costBnb: p.costBnb, entryPrice: p.entryPrice, lastPrice: p.lastPrice, tookProfit: !!p.tookProfit, openedAt: p.openedAt })),
      trades: hands.trades.slice(0, 20).map((t: any) => ({ at: t.at, side: t.side, symbol: clip(t.symbol, 16), bnb: t.bnb, pnlBnb: t.pnlBnb ?? null, paper: !!t.paper, by: t.by === 'exit' ? 'exit' : 'her', why: clip(t.why, 200), tx: t.hash ? `https://bscscan.com/tx/${t.hash}` : null })),
    } : null,
    posts: voice ? voice.posted.slice(0, 15).map((p: any) => ({ at: p.at, text: clip(p.text, 300), mode: p.mode, reply: !!p.replyTo, url: p.url ?? null })) : [],
    thoughts: [...thoughts].reverse(),
    dial: c?.dial ?? null,
    live: c ? { voice: !!c.live.voice, hands: !!c.live.hands } : null,
  })
}

/** Overwrites the one public blob every minute, only when something changed. */
export function startPublishing(body: Body, token: string, upload: typeof put = put): { stop: () => void; publishNow: (now?: number) => Promise<string | null> } {
  const log = new ThoughtLog()
  for (const s of body.bus.recent(300)) log.see(s)
  const unlisten = body.bus.listen(s => log.see(s))
  let last = ''
  let lastAt = 0
  const publishNow = async (now = Date.now()): Promise<string | null> => {
    const snap = publicSnapshot(body, log.items, now)
    const { at: _at, ...rest } = snap
    const key = JSON.stringify(rest)
    // Unchanged is skipped, but never for long: the page reads an old `at` as "her body is offline".
    if (key === last && now - lastAt < ALIVE_EVERY_MS) return null
    const r = await upload(SNAPSHOT_PATH, JSON.stringify(snap), {
      access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
      contentType: 'application/json', token,
    })
    last = key
    lastAt = now
    body.bus.emit('published', 'window', { url: r.url })
    return r.url
  }
  const tick = () => { publishNow().catch(err => body.bus.emit('window.error', 'window', String(err).slice(0, 200))) }
  const timer = setInterval(tick, PUBLISH_EVERY_MS)
  setTimeout(tick, 3_000)
  return { stop: () => { clearInterval(timer); unlisten() }, publishNow }
}
