import { expect, test } from 'bun:test'
import { DEFAULT_LIMITS, type Position, type TradeDay } from '../src/lib/limits'
import { WBNB } from '../src/lib/market'
import { cycleSize, parseGeckoPools, planCycle, rejectReason, type Candidate } from '../src/lib/strategy'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const day = (d: Partial<TradeDay> = {}): TradeDay => ({ day: '2026-10-06', spentBnb: 0, realizedBnb: 0, ...d }) as TradeDay
const cand = (c: Partial<Candidate> = {}): Candidate => ({
  token: '0x' + '1'.repeat(40), symbol: 'GOOD', liquidityUsd: 100_000, volume24hUsd: 200_000,
  change1hPct: 6, change6hPct: 12, buys1h: 80, sells1h: 40, ageDays: 30, ...c,
})
const pos = (token: string, entry: number, last: number): Position => ({
  token, symbol: token.slice(2, 6), amountWei: '1000', decimals: 18, costBnb: 0.008, entryPrice: entry, peakPrice: last, lastPrice: last, openedAt: NOW, paper: true,
})

const pool = (o: { dex?: string; quote?: string; base: string; name?: string; liq?: number; h1?: number; created?: string }) => ({
  attributes: {
    name: o.name ?? 'TOK / WBNB', reserve_in_usd: String(o.liq ?? 50_000), volume_usd: { h24: '90000' },
    price_change_percentage: { h1: String(o.h1 ?? 4), h6: '10' }, transactions: { h1: { buys: 50, sells: 20 } },
    pool_created_at: o.created ?? '2026-09-01T00:00:00Z',
  },
  relationships: {
    dex: { data: { id: o.dex ?? 'pancakeswap_v2' } },
    base_token: { data: { id: `bsc_${o.base}` } },
    quote_token: { data: { id: `bsc_${o.quote ?? WBNB}` } },
  },
})

test('parses only PancakeSwap v2 pools against WBNB, deepest pool per token', () => {
  const a = '0x' + 'a'.repeat(40), b = '0x' + 'b'.repeat(40)
  const got = parseGeckoPools({ data: [
    pool({ base: a, liq: 30_000 }),
    pool({ base: a, liq: 90_000 }),
    pool({ base: b, dex: 'pancakeswap-v3-bsc' }),
    pool({ base: b, quote: '0x55d398326f99059ff775485246999027b3197955' }),
    pool({ base: '0x55d398326f99059ff775485246999027b3197955' }),
  ] }, NOW)
  expect(got.map(c => [c.token, c.liquidityUsd])).toEqual([[a, 90_000]])
  expect(got[0]!.symbol).toBe('TOK')
  expect(Math.round(got[0]!.ageDays)).toBe(36)
})

test('filters out thin, new, falling, parabolic and sell-heavy pools', () => {
  const L = DEFAULT_LIMITS
  expect(rejectReason(cand(), L)).toBeNull()
  expect(rejectReason(cand({ liquidityUsd: 5_000 }), L)).toBe('thin pool')
  expect(rejectReason(cand({ ageDays: 1 }), L)).toBe('under 3 days old')
  expect(rejectReason(cand({ change1hPct: -2 }), L)).toBe('not rising this hour')
  expect(rejectReason(cand({ change1hPct: 45 }), L)).toBe('already parabolic')
  expect(rejectReason(cand({ change6hPct: -30 }), L)).toBe('still falling over 6h')
  expect(rejectReason(cand({ buys1h: 10, sells1h: 30 }), L)).toBe('more sellers than buyers')
  expect(rejectReason(cand({ volume24hUsd: 1_000 }), L)).toBe('barely traded')
})

test('a buy is the daily budget spread over the cycles, capped per trade', () => {
  expect(cycleSize(DEFAULT_LIMITS, 2)).toBe(0.0083)
  expect(cycleSize({ ...DEFAULT_LIMITS, maxDailyBnb: 5 }, 2)).toBe(DEFAULT_LIMITS.maxPerTradeBnb)
})

test('buys the best candidate, skipping ones already held', () => {
  const held = '0x' + '2'.repeat(40)
  const d = planCycle({
    candidates: [cand({ token: held, change1hPct: 25 }), cand({ symbol: 'OK', change1hPct: 3 }), cand({ token: '0x' + '3'.repeat(40), symbol: 'BEST', change1hPct: 12 })],
    positions: [pos(held, 1, 1.1)], limits: DEFAULT_LIMITS, day: day(), everyHours: 2,
  })
  expect(d.kind).toBe('buy')
  if (d.kind === 'buy') expect(d.options.map(o => o.symbol)).toEqual(['BEST', 'OK'])
})

test('rotates out the weakest bag when the slots are full', () => {
  const ps = [pos('0x' + 'a'.repeat(40), 1, 1.2), pos('0x' + 'b'.repeat(40), 1, 0.85), pos('0x' + 'c'.repeat(40), 1, 1.0)]
  const d = planCycle({ candidates: [cand()], positions: ps, limits: DEFAULT_LIMITS, day: day(), everyHours: 2 })
  expect(d).toMatchObject({ kind: 'sell', token: '0x' + 'b'.repeat(40), pct: 100, paper: true })
})

test('rotates when the budget is spent, skips when there is nothing to rotate', () => {
  const spent = day({ spentBnb: 0.095 })
  expect(planCycle({ candidates: [cand()], positions: [pos('0x' + 'a'.repeat(40), 1, 1)], limits: DEFAULT_LIMITS, day: spent, everyHours: 2 }).kind).toBe('sell')
  expect(planCycle({ candidates: [cand()], positions: [], limits: DEFAULT_LIMITS, day: spent, everyHours: 2 }).kind).toBe('skip')
})

test('stops for the day at the loss limit, and skips when nothing passes', () => {
  expect(planCycle({ candidates: [cand()], positions: [], limits: DEFAULT_LIMITS, day: day({ realizedBnb: -0.06 }), everyHours: 2 }))
    .toMatchObject({ kind: 'skip' })
  expect(planCycle({ candidates: [cand({ ageDays: 0 })], positions: [], limits: DEFAULT_LIMITS, day: day(), everyHours: 2 }))
    .toEqual({ kind: 'skip', why: 'no pool passed the filter this cycle' })
})
