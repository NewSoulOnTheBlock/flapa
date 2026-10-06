// Wallet metrics, pure. A "position" is one wallet's history in one token; a wallet's metrics roll its
// positions up. The questions are not "did it make money" but "what happened after it bought", compared with
// what everyone else's entries did on the same day (excess return), with enough observations to mean something.
import type { Candle, Token, Trade } from './warehouse'

export const HORIZONS = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '6h': 360, '24h': 1440, '7d': 10080 } as const
export type Horizon = keyof typeof HORIZONS
export const tfFor = (h: Horizon) => (HORIZONS[h] <= 60 ? '5m' : '1h')
export type CandleLookup = (pool: string, tf: '5m' | '1h') => readonly Candle[]

export type Pattern = 'one-shot' | 'scale-in' | 'confirm-then-size' | 'snipe-dump'
export type Position = {
  wallet: string; token: string; pool: string; symbol: string
  firstBuyAt: number; entryPrice: number; costBnb: number; proceedsBnb: number; boughtAmt: number; soldAmt: number
  realizedBnb: number; roi: number | null; closed: boolean; holdMin: number | null
  minutesSinceLaunch: number; mcapAtEntry: number
  fwd: Partial<Record<Horizon, number>>; peak24h: number | null; leadMin: number | null
  entrySkill: number | null; exitSkill: number | null
  buyUsd: number; conviction: number; pattern: Pattern; hourBlock: number
}

const median = (xs: readonly number[]) => {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
export const med = median
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const std = (xs: readonly number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) }

/** The first candle at or after ts. */
function at(c: readonly Candle[], ts: number): Candle | undefined {
  let lo = 0, hi = c.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid]!.ts < ts) lo = mid + 1; else hi = mid }
  return c[lo]
}
const within = (c: readonly Candle[], from: number, to: number) => c.filter(x => x.ts >= from && x.ts <= to)

export function forwardReturns(entryPrice: number, t: number, pool: string, candles: CandleLookup, now: number): Partial<Record<Horizon, number>> {
  const out: Partial<Record<Horizon, number>> = {}
  for (const [h, mins] of Object.entries(HORIZONS) as [Horizon, number][]) {
    const target = t + mins * 60_000
    if (target > now) continue
    const c = at(candles(pool, tfFor(h)), target)
    if (c && c.ts - target <= (tfFor(h) === '5m' ? 15 : 180) * 60_000) out[h] = c.c / entryPrice - 1
  }
  return out
}

/** Minutes from the buy to the first big volume candle (4x its trailing median) that also trades above the entry. */
export function leadTime(t: number, entryPrice: number, c5: readonly Candle[]): number | null {
  const before = c5.filter(x => x.ts < t).slice(-12).map(x => x.v)
  const base = median(before)
  if (!(base > 0)) return null
  const spike = c5.find(x => x.ts > t && x.ts <= t + 86_400_000 && x.v >= 4 * base && x.c > entryPrice)
  return spike ? (spike.ts - t) / 60_000 : null
}

function pattern(buys: readonly Trade[], sells: readonly Trade[]): Pattern {
  const first = buys[0]!
  if (sells.length && sells[0]!.at - first.at <= 10 * 60_000 && sells.reduce((s, x) => s + x.amount, 0) >= 0.8 * buys.reduce((s, x) => s + x.amount, 0)) return 'snipe-dump'
  if (buys.length === 1) return 'one-shot'
  const later = buys.slice(1)
  if (later.some(b => b.at - first.at > 10 * 60_000 && b.bnb > first.bnb * 1.5 && b.priceUsd > first.priceUsd)) return 'confirm-then-size'
  return 'scale-in'
}

export function buildPositions(trades: readonly Trade[], tokens: ReadonlyMap<string, Token>, candles: CandleLookup, bnbUsd: number, now: number): Position[] {
  const byKey = new Map<string, Trade[]>()
  for (const t of trades) { const k = `${t.wallet}|${t.token}`; byKey.set(k, [...(byKey.get(k) ?? []), t]) }
  const buyUsdByWallet = new Map<string, number[]>()
  for (const t of trades) if (t.side === 'buy') buyUsdByWallet.set(t.wallet, [...(buyUsdByWallet.get(t.wallet) ?? []), t.usd])
  const out: Position[] = []
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at)
    const buys = sorted.filter(t => t.side === 'buy'), sells = sorted.filter(t => t.side === 'sell')
    if (!buys.length) continue // sold what it held before we were watching: no entry to judge
    const tk = tokens.get(buys[0]!.token)
    const first = buys[0]!
    const boughtAmt = buys.reduce((s, b) => s + b.amount, 0), soldAmt = Math.min(boughtAmt, sells.filter(s => s.at >= first.at).reduce((s, x) => s + x.amount, 0))
    const costBnb = buys.reduce((s, b) => s + b.bnb, 0), proceedsBnb = sells.filter(s => s.at >= first.at).reduce((s, x) => s + x.bnb, 0)
    const soldFrac = boughtAmt > 0 ? soldAmt / boughtAmt : 0
    const avgPrice = boughtAmt > 0 ? buys.reduce((s, b) => s + b.priceUsd * b.amount, 0) / boughtAmt : first.priceUsd
    const nowPrice = tk?.priceUsd ?? 0
    const remainingBnb = nowPrice > 0 && bnbUsd > 0 ? ((boughtAmt - soldAmt) * nowPrice) / bnbUsd : 0
    const closed = soldFrac >= 0.9
    const c5 = tk ? candles(tk.pool, '5m') : [], c1 = tk ? candles(tk.pool, '1h') : []
    const peakWin = within(c5.length ? c5 : c1, first.at, first.at + 86_400_000)
    const lowWin = within(c5, first.at - 3_600_000, first.at + 3_600_000)
    const exitSkills = sells.filter(s => s.at >= first.at).map(s => { const w = within(c5, s.at - 3_600_000, s.at + 3_600_000); const top = Math.max(...w.map(x => x.h)); return w.length && top > 0 ? s.priceUsd / top : NaN }).filter(Number.isFinite)
    const buyUsd = buys.reduce((s, b) => s + b.usd, 0)
    out.push({
      wallet: first.wallet, token: first.token, pool: first.pool, symbol: tk?.symbol ?? '?',
      firstBuyAt: first.at, entryPrice: first.priceUsd, costBnb, proceedsBnb, boughtAmt, soldAmt,
      realizedBnb: proceedsBnb - costBnb * soldFrac,
      roi: costBnb > 0 && (closed || remainingBnb > 0) ? (proceedsBnb + remainingBnb) / costBnb - 1 : null,
      closed, holdMin: closed && sells.length ? (sells[sells.length - 1]!.at - first.at) / 60_000 : null,
      minutesSinceLaunch: tk ? Math.max(0, (first.at - tk.launchedAt) / 60_000) : NaN,
      mcapAtEntry: tk && nowPrice > 0 && tk.fdvUsd > 0 ? tk.fdvUsd * (avgPrice / nowPrice) : NaN,
      fwd: tk ? forwardReturns(first.priceUsd, first.at, tk.pool, candles, now) : {},
      peak24h: peakWin.length && first.priceUsd > 0 ? Math.max(...peakWin.map(x => x.h)) / first.priceUsd : null,
      leadMin: c5.length ? leadTime(first.at, first.priceUsd, c5) : null,
      entrySkill: lowWin.length && first.priceUsd > 0 ? Math.min(...lowWin.map(x => x.l)) / first.priceUsd : null,
      exitSkill: exitSkills.length ? mean(exitSkills) : null,
      buyUsd, conviction: buyUsd / Math.max(1, median(buyUsdByWallet.get(first.wallet) ?? [buyUsd])),
      pattern: pattern(buys, sells), hourBlock: Math.floor(new Date(first.at).getHours() / 4) * 4,
    })
  }
  return out
}

/** What a typical entry did on each day, per horizon: the bar a wallet must beat. */
export type Benchmark = Partial<Record<Horizon, Record<string, number>>>
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)
export function benchmark(positions: readonly Position[]): Benchmark {
  const out: Benchmark = {}
  for (const h of Object.keys(HORIZONS) as Horizon[]) {
    const byDay = new Map<string, number[]>()
    for (const p of positions) if (p.fwd[h] !== undefined) byDay.set(dayKey(p.firstBuyAt), [...(byDay.get(dayKey(p.firstBuyAt)) ?? []), p.fwd[h]!])
    out[h] = Object.fromEntries([...byDay].filter(([, xs]) => xs.length >= 5).map(([d, xs]) => [d, median(xs)]))
  }
  return out
}
export const excess = (p: Position, h: Horizon, b: Benchmark) => {
  const f = p.fwd[h], base = b[h]?.[dayKey(p.firstBuyAt)]
  return f === undefined ? undefined : f - (base ?? 0)
}

export type Evidence = 'insufficient' | 'emerging' | 'interesting' | 'meaningful'
/** Observations are positions (independent bets), not raw trades: 30 buys of one token are one opinion. */
export const EVIDENCE: readonly [number, Evidence][] = [[100, 'meaningful'], [30, 'interesting'], [10, 'emerging'], [0, 'insufficient']]
export const evidenceOf = (n: number): Evidence => EVIDENCE.find(([min]) => n >= min)![1]

export type Bucket = { name: string; n: number; excess1h: number }
export type WalletMetrics = {
  wallet: string; firstSeen: number; lastActive: number
  trades: number; buys: number; sells: number; tradesPerDay: number
  positions: number; tokensWon: number; tokensLost: number; winRate: number
  realizedBnb: number; roi: number; largestWinBnb: number; largestLossBnb: number; maxDrawdownBnb: number; sharpeLike: number
  medianHoldMin: number; avgHoldMin: number
  medianEntryMin: number; earlyEntries: number
  fwd: Partial<Record<Horizon, number>>; excess: Partial<Record<Horizon, number>>; positiveFwd1h: number
  leadMin: number; leadCount: number
  highConviction: number; convictionEdge: number
  discoveries: number; entrySkill: number; exitSkill: number
  pattern: Pattern
  bestBucket?: Bucket; bestHourBlock?: number
  alpha7d: number; alpha30d: number; alphaAll: number; currentAlpha: number; alphaTrend: 'improving' | 'steady' | 'fading' | 'unknown'
  evidence: Evidence; consistency: number
  recentTokens: { token: string; symbol: string; at: number; fwd1h?: number }[]
}

const mcapBucket = (m: number) => (!Number.isFinite(m) ? undefined : m < 100_000 ? 'under $100k mcap' : m < 500_000 ? '$100k-500k mcap' : m < 2_000_000 ? '$500k-2M mcap' : 'over $2M mcap')
const ageBucket = (min: number) => (!Number.isFinite(min) ? undefined : min < 60 ? 'tokens under 1h old' : min < 1440 ? 'tokens under a day old' : min < 10080 ? 'tokens under a week old' : 'older tokens')

export function walletMetrics(wallet: string, positions: readonly Position[], trades: readonly Trade[], b: Benchmark, now: number): WalletMetrics {
  const ps = [...positions].sort((a, z) => a.firstBuyAt - z.firstBuyAt)
  const ts = trades
  const firstSeen = Math.min(...ts.map(t => t.at)), lastActive = Math.max(...ts.map(t => t.at))
  const days = Math.max(1, (lastActive - firstSeen) / 86_400_000)
  const judged = ps.filter(p => p.roi !== null)
  const won = judged.filter(p => p.roi! > 0).length
  let cum = 0, peak = 0, dd = 0
  for (const p of ps) { cum += p.realizedBnb; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum) }
  const rois = judged.map(p => p.roi!)
  const ex1 = (since: number) => median(ps.filter(p => p.firstBuyAt >= since).map(p => excess(p, '1h', b)).filter((x): x is number => x !== undefined))
  const alpha7d = ex1(now - 7 * 86_400_000), alpha30d = ex1(now - 30 * 86_400_000), alphaAll = ex1(0)
  const n7 = ps.filter(p => p.firstBuyAt >= now - 7 * 86_400_000 && excess(p, '1h', b) !== undefined).length
  const currentAlpha = n7 >= 3 ? alpha7d : Number.isFinite(alpha30d) ? alpha30d : alphaAll
  const alphaTrend = !Number.isFinite(alpha7d) || !Number.isFinite(alpha30d) || n7 < 3 ? 'unknown' : alpha7d > alpha30d + 0.03 ? 'improving' : alpha7d < alpha30d - 0.03 ? 'fading' : 'steady'
  const buckets = new Map<string, number[]>()
  for (const p of ps) {
    const e = excess(p, '1h', b)
    if (e === undefined) continue
    for (const name of [mcapBucket(p.mcapAtEntry), ageBucket(p.minutesSinceLaunch)]) if (name) buckets.set(name, [...(buckets.get(name) ?? []), e])
  }
  const bestBucket = [...buckets].filter(([, xs]) => xs.length >= 3).map(([name, xs]) => ({ name, n: xs.length, excess1h: median(xs) })).sort((a, z) => z.excess1h - a.excess1h)[0]
  const hours = new Map<number, number[]>()
  for (const p of ps) { const e = excess(p, '1h', b); if (e !== undefined) hours.set(p.hourBlock, [...(hours.get(p.hourBlock) ?? []), e]) }
  const bestHour = [...hours].filter(([, xs]) => xs.length >= 3).sort((a, z) => median(z[1]) - median(a[1]))[0]
  const patterns = ps.map(p => p.pattern)
  const fwd: Partial<Record<Horizon, number>> = {}, exc: Partial<Record<Horizon, number>> = {}
  for (const h of Object.keys(HORIZONS) as Horizon[]) {
    const f = ps.map(p => p.fwd[h]).filter((x): x is number => x !== undefined)
    const e = ps.map(p => excess(p, h, b)).filter((x): x is number => x !== undefined)
    if (f.length) fwd[h] = median(f)
    if (e.length) exc[h] = median(e)
  }
  const f1 = ps.map(p => p.fwd['1h']).filter((x): x is number => x !== undefined)
  const leads = ps.map(p => p.leadMin).filter((x): x is number => x !== null)
  const hi = ps.filter(p => p.conviction >= 3), lo = ps.filter(p => p.conviction < 3)
  const convictionEdge = median(hi.map(p => p.fwd['1h']).filter((x): x is number => x !== undefined)) - median(lo.map(p => p.fwd['1h']).filter((x): x is number => x !== undefined))
  const holds = ps.map(p => p.holdMin).filter((x): x is number => x !== null)
  const evidence = evidenceOf(ps.length)
  const positiveFwd1h = f1.length ? f1.filter(x => x > 0).length / f1.length : 0
  // Consistency: repeatable edge, not one lucky run. Sample size scales everything down when thin.
  const sample = Math.min(1, ps.length / 30)
  const consistency = Math.round(100 * sample * (
    0.3 * positiveFwd1h +
    0.25 * (judged.length ? won / judged.length : 0) +
    0.25 * Math.max(0, Math.min(1, 0.5 + (Number.isFinite(exc['1h']!) ? exc['1h']! : 0) * 2)) +
    0.2 * Math.max(0, 1 - dd / Math.max(0.01, ps.reduce((s, p) => s + p.costBnb, 0)))))
  return {
    wallet, firstSeen, lastActive, trades: ts.length, buys: ts.filter(t => t.side === 'buy').length, sells: ts.filter(t => t.side === 'sell').length, tradesPerDay: ts.length / days,
    positions: ps.length, tokensWon: won, tokensLost: judged.length - won, winRate: judged.length ? won / judged.length : 0,
    realizedBnb: ps.reduce((s, p) => s + p.realizedBnb, 0),
    roi: (() => { const cost = ps.reduce((s, p) => s + p.costBnb, 0); return cost > 0 ? ps.reduce((s, p) => s + p.realizedBnb, 0) / cost : 0 })(),
    largestWinBnb: Math.max(0, ...ps.map(p => p.realizedBnb)), largestLossBnb: Math.min(0, ...ps.map(p => p.realizedBnb)),
    maxDrawdownBnb: dd, sharpeLike: rois.length >= 3 && std(rois) > 0 ? mean(rois) / std(rois) : 0,
    medianHoldMin: median(holds), avgHoldMin: mean(holds),
    medianEntryMin: median(ps.map(p => p.minutesSinceLaunch)), earlyEntries: ps.filter(p => p.minutesSinceLaunch <= 30).length,
    fwd, excess: exc, positiveFwd1h,
    leadMin: median(leads), leadCount: leads.length,
    highConviction: hi.length, convictionEdge: Number.isFinite(convictionEdge) ? convictionEdge : 0,
    discoveries: ps.filter(p => (p.peak24h ?? 0) >= 2).length,
    entrySkill: median(ps.map(p => p.entrySkill).filter((x): x is number => x !== null)),
    exitSkill: median(ps.map(p => p.exitSkill).filter((x): x is number => x !== null)),
    pattern: (['scale-in', 'confirm-then-size', 'snipe-dump', 'one-shot'] as Pattern[]).sort((a, z) => patterns.filter(x => x === z).length - patterns.filter(x => x === a).length)[0]!,
    bestBucket, bestHourBlock: bestHour?.[0],
    alpha7d, alpha30d, alphaAll, currentAlpha, alphaTrend,
    evidence, consistency,
    recentTokens: ps.slice(-5).reverse().map(p => ({ token: p.token, symbol: p.symbol, at: p.firstBuyAt, fwd1h: p.fwd['1h'] })),
  }
}
