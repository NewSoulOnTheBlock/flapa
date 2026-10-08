// The window: a public, read-only snapshot of the agent for the Vercel page.
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
      case 'topic': this.push(s.at, 'wake', `picked a topic: ${clip(d.topic, 80)}${d.blend ? ` × ${clip(d.blend, 80)}` : ''}`); break
      case 'trigger': this.push(s.at, 'trigger', clip(d.text, 200)); break
      case 'newsjack': this.push(s.at, 'news', `breaking: ${clip(d.title, 160)}`); break
      case 'story': this.push(s.at, 'story', `new chapter: ${clip((d.chapters ?? []).join('; '), 200)}`); break
      case 'lore': this.push(s.at, 'lore', `lore grew: ${clip((d.added ?? []).join('; '), 200)}`); break
      case 'scout.signal': if (d.copy) this.push(s.at, 'copy', `copied radar wallet ${clip(d.wallet, 14)} into $${clip(d.symbol, 16)} (signal ${d.score})`); break
    }
  }

  private push(at: number, kind: string, text: string) {
    this.items.push({ at, kind, text })
    if (this.items.length > KEEP_THOUGHTS) this.items.splice(0, this.items.length - KEEP_THOUGHTS)
  }
}

const view = (body: Body, organ: string): any => (body.has(organ) ? body.organ(organ).view?.() ?? null : null)

export function publicSnapshot(body: Body, thoughts: readonly PublicThought[], now = Date.now(), stream?: string) {
  const id = view(body, 'identity')?.active
  const mood = view(body, 'affect')
  const agenda = view(body, 'agenda')
  const beliefs = view(body, 'beliefs')
  const eyes = view(body, 'eyes')
  const hands = view(body, 'hands')
  const voice = view(body, 'voice')
  const c = view(body, 'conscience')
  const scout = view(body, 'scout')
  const lore = id ? view(body, 'identity')?.lore : null
  const short = (w: unknown) => { const s = String(w ?? ''); return /^0x[0-9a-f]{40}$/i.test(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : clip(s, 14) }
  return redact({
    v: 1,
    // Where the page can connect for live updates (the public WebSocket), when she runs one.
    stream: stream ?? null,
    at: now,
    persona: id ? { name: clip(id.name, 40), handle: clip(id.handle, 20), tagline: clip(id.tagline, 200) } : null,
    // The colors the person chose at setup, so the public window matches the dashboard. Colors only.
    theme: view(body, 'setup')?.theme ?? null,
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
      positions: hands.positions.map((p: any) => ({
        symbol: clip(p.symbol, 16), token: p.token, paper: !!p.paper, costBnb: p.costBnb, entryPrice: p.entryPrice, lastPrice: p.lastPrice, tookProfit: !!p.tookProfit, openedAt: p.openedAt,
        copy: p.copy ? { wallets: (p.copy.wallets ?? []).slice(0, 4).map(short), score: p.copy.score, stage: p.copy.stage, leaderSelling: (p.copy.leaderSoldPct ?? 0) > 0 } : null,
      })),
      trades: hands.trades.slice(0, 20).map((t: any) => ({ at: t.at, side: t.side, symbol: clip(t.symbol, 16), bnb: t.bnb, pnlBnb: t.pnlBnb ?? null, paper: !!t.paper, by: t.by === 'exit' ? 'exit' : 'her', why: clip(t.why, 200), tx: t.hash ? `https://bscscan.com/tx/${t.hash}` : null })),
      cycle: hands.cycle ? { isOn: !!hands.cycle.isOn, everyHours: hands.cycle.everyHours, nextAt: hands.cycle.nextAt ?? null, log: (hands.cycle.log ?? []).slice(0, 4).map((l: any) => ({ at: l.at, did: l.did, summary: clip(l.summary, 160) })) } : null,
    } : null,
    postSchedule: voice?.schedule ? {
      isOn: !!voice.schedule.isOn, everyHours: voice.schedule.everyHours, nextAt: voice.schedule.nextAt ?? null,
      mode: voice.schedule.mode ?? 'every', perDay: voice.schedule.perDay ?? null, calendar: (voice.schedule.calendar ?? []).slice(0, 4),
    } : null,
    posts: voice ? voice.posted.slice(0, 15).map((p: any) => ({ at: p.at, text: clip(p.text, 300), mode: p.mode, reply: !!p.replyTo, url: p.url ?? null, topic: p.topic ? clip(p.topic, 80) : null, kind: p.kind ?? null, objective: p.objective ?? null, score: p.score ?? null })) : [],
    // Her own numbers: follower growth, her usual post, her best hours, her best posts and why.
    numbers: voice?.analytics ? {
      followers: voice.analytics.growth?.followers ?? null, week: voice.analytics.growth?.week ?? null,
      usualViews: voice.analytics.learning ? Math.round(voice.analytics.learning.baseline.impressions) : null,
      bestHours: voice.analytics.bestHours ?? [],
      winners: (voice.analytics.learning?.winners ?? []).slice(0, 2).map((w: any) => ({ ratio: w.ratio, text: clip(w.text, 120), why: (w.why ?? []).slice(0, 3).map((x: unknown) => clip(x, 60)) })),
    } : null,
    story: lore ? {
      chapters: (lore.chapters ?? []).slice(-8).map((c: any) => ({ at: c.at, title: clip(c.title, 140) })), bornAt: view(body, 'identity')?.bornAt ?? null,
      catchphrases: (lore.catchphrases ?? []).slice(0, 6).map((x: unknown) => clip(x, 80)),
    } : null,
    news: eyes ? {
      digest: eyes.digest ? { at: eyes.digest.at, narratives: (eyes.digest.narratives ?? []).slice(0, 3).map((n: any) => ({ name: clip(n.name, 80), why: clip(n.why, 200), sources: (n.sources ?? []).slice(0, 4).map((s: unknown) => clip(s, 30)) })) } : null,
      stories: (eyes.stories ?? []).slice(0, 6).map((s: any) => ({ at: s.at, title: clip(s.title, 200), link: s.link ?? null, sources: (s.sources ?? []).slice(0, 4).map((x: unknown) => clip(x, 30)), confidence: s.confidence })),
    } : null,
    // The wallet radar: short addresses only, and the reasons behind each score.
    radar: scout ? {
      counts: scout.counts, summary: scout.summary ? { wallets: scout.summary.wallets, clusters: scout.summary.clusters } : null,
      copyOn: !!scout.config?.copyOn,
      tiers: Object.fromEntries(Object.entries(scout.radar ?? {}).map(([t, list]: [string, any]) => [t, (list as any[]).slice(0, 4).map(p => ({
        wallet: short(p.wallet), score: p.score, labels: (p.labels ?? []).slice(0, 3), reasons: (p.reasons ?? []).slice(0, 4).map((r: unknown) => clip(r, 120)), leader: !!p.isLeader, cluster: p.cluster ?? null,
      }))])),
      signals: (scout.signals ?? []).slice(0, 6).map((s: any) => ({ at: s.at, wallet: short(s.wallet), symbol: clip(s.symbol, 16), score: s.score, copied: !!s.copied, skip: s.skip ? clip(s.skip, 80) : null, r1h: s.outcome?.r1h ?? null })),
    } : null,
    thoughts: [...thoughts].reverse(),
    dial: c?.dial ?? null,
    live: c ? { voice: !!c.live.voice, hands: !!c.live.hands } : null,
  })
}

/** Overwrites the one public blob every minute, only when something changed. */
export function startPublishing(body: Body, token: string, upload: typeof put = put, stream?: string): { stop: () => void; publishNow: (now?: number) => Promise<string | null> } {
  const log = new ThoughtLog()
  for (const s of body.bus.recent(300)) log.see(s)
  const unlisten = body.bus.listen(s => log.see(s))
  let last = ''
  let lastAt = 0
  const publishNow = async (now = Date.now()): Promise<string | null> => {
    const snap = publicSnapshot(body, log.items, now, stream)
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
