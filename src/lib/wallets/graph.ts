// The wallet graph, pure. Two wallets are linked when they keep entering the same tokens close together.
// Direction comes from who moves first; a wallet others reliably follow is a leader. Funding-source links
// (who sent whom gas money) are not traced: co-entry timing alone is what the data supports cheaply.
import type { Position } from './metrics'

export const CO_ENTRY_WINDOW_MS = 10 * 60_000
export const MIN_SHARED = 3

export type Follow = { leader: string; follower: string; shared: number; followRate: number; medianDelaySec: number }
export type Cluster = { id: number; wallets: string[]; leader: string }
export type GraphResult = { follows: Follow[]; clusters: Cluster[]; influence: Map<string, number>; clusterOf: Map<string, number>; leads: Map<string, number> }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }

/** Builds follow edges from first entries per token, for wallets with enough positions to matter. */
export function buildGraph(positions: readonly Position[], minPositions = 5): GraphResult {
  const count = new Map<string, number>()
  for (const p of positions) count.set(p.wallet, (count.get(p.wallet) ?? 0) + 1)
  const eligible = new Set([...count].filter(([, n]) => n >= minPositions).map(([w]) => w))
  const byToken = new Map<string, Position[]>()
  for (const p of positions) if (eligible.has(p.wallet)) byToken.set(p.token, [...(byToken.get(p.token) ?? []), p])
  const pairs = new Map<string, number[]>()
  for (const list of byToken.values()) {
    const s = [...list].sort((a, b) => a.firstBuyAt - b.firstBuyAt)
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length && s[j]!.firstBuyAt - s[i]!.firstBuyAt <= CO_ENTRY_WINDOW_MS; j++) {
        const k = `${s[i]!.wallet}>${s[j]!.wallet}`
        pairs.set(k, [...(pairs.get(k) ?? []), (s[j]!.firstBuyAt - s[i]!.firstBuyAt) / 1000])
      }
    }
  }
  const follows: Follow[] = []
  for (const [k, delays] of pairs) {
    if (delays.length < MIN_SHARED) continue
    const [leader, follower] = k.split('>') as [string, string]
    follows.push({ leader, follower, shared: delays.length, followRate: delays.length / (count.get(follower) ?? 1), medianDelaySec: Math.round(median(delays)) })
  }
  // Clusters: connected components over follow edges.
  const parent = new Map<string, string>()
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  for (const f of follows) { const a = find(f.leader), b = find(f.follower); if (a !== b) parent.set(a, b) }
  const groups = new Map<string, Set<string>>()
  for (const f of follows) for (const w of [f.leader, f.follower]) { const r = find(w); groups.set(r, (groups.get(r) ?? new Set()).add(w)) }
  const leads = new Map<string, number>(), influence = new Map<string, number>()
  for (const f of follows) {
    leads.set(f.leader, (leads.get(f.leader) ?? 0) + f.shared)
    leads.set(f.follower, (leads.get(f.follower) ?? 0) - f.shared)
    influence.set(f.leader, (influence.get(f.leader) ?? 0) + f.followRate)
  }
  const clusters: Cluster[] = [...groups.values()].filter(g => g.size >= 2)
    .map((g, i) => { const wallets = [...g]; return { id: i + 1, wallets, leader: wallets.sort((a, b) => (leads.get(b) ?? 0) - (leads.get(a) ?? 0))[0]! } })
  const clusterOf = new Map<string, number>()
  for (const c of clusters) for (const w of c.wallets) clusterOf.set(w, c.id)
  return { follows, clusters, influence, clusterOf, leads }
}
