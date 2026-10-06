import { expect, test } from 'bun:test'
import { benchmark, buildPositions, evidenceOf, excess, forwardReturns, leadTime, walletMetrics } from '../src/lib/wallets/metrics'
import type { Candle, Token, Trade } from '../src/lib/wallets/warehouse'

const T0 = Date.parse('2026-10-01T00:00:00Z'), MIN = 60_000
const W = '0x' + '1'.repeat(40)
// A token that launches at T0 and climbs 1% per 5 minutes, with a volume spike at +40 minutes.
const candles5 = (pool: string): Candle[] => Array.from({ length: 600 }, (_, i) => ({ ts: T0 + i * 5 * MIN, o: 1, h: 1.01 ** i * 1.02, l: 1.01 ** i * 0.98, c: 1.01 ** i, v: i === 8 ? 500 : 10 }))
const candles1 = (pool: string): Candle[] => Array.from({ length: 200 }, (_, i) => ({ ts: T0 + i * 60 * MIN, o: 1, h: 1.01 ** (i * 12) * 1.02, l: 1, c: 1.01 ** (i * 12), v: 100 }))
const lookup = (pool: string, tf: '5m' | '1h') => (tf === '5m' ? candles5(pool) : candles1(pool))
const tok = (i: number): Token => ({ token: `0x${String(i).padStart(40, '0')}`, pool: `pool${i}`, symbol: `T${i}`, launchedAt: T0, fdvUsd: 50_000, priceUsd: 1.01 ** 100, liquidityUsd: 30_000, updatedAt: T0 })
const trade = (i: number, side: 'buy' | 'sell', min: number, bnb: number, price: number, amount: number, wallet = W): Trade =>
  ({ tx: `${wallet}${i}${side}${min}`, wallet, token: tok(i).token, pool: tok(i).pool, at: T0 + min * MIN, block: min, side, bnb, usd: bnb * 600, priceUsd: price, amount })

test('forward returns read the candle at each horizon; lead time finds the volume spike', () => {
  const f = forwardReturns(1, T0 + 10 * MIN, 'p', lookup, T0 + 3 * 86_400_000)
  expect(f['5m']).toBeCloseTo(1.01 ** 3 - 1, 4)
  expect(f['1h']).toBeCloseTo(1.01 ** 14 - 1, 4)
  expect(f['7d']).toBeUndefined()
  expect(leadTime(T0 + 15 * MIN, 1.0, candles5('p'))).toBe(25)
})

test('positions: FIFO-ish realized PnL, closed, hold, entry timing, pattern', () => {
  const tokens = new Map([[tok(1).token, tok(1)]])
  const ps = buildPositions([trade(1, 'buy', 3, 1, 1.0, 1000), trade(1, 'sell', 63, 1.5, 1.5, 950)], tokens, lookup, 600, T0 + 2 * 86_400_000)
  expect(ps).toHaveLength(1)
  const p = ps[0]!
  expect(p.closed).toBe(true)
  expect(p.realizedBnb).toBeCloseTo(1.5 - 0.95, 6)
  expect(p.holdMin).toBe(60)
  expect(p.minutesSinceLaunch).toBe(3)
  expect(p.pattern).toBe('one-shot')
  expect(p.leadMin).toBe(37)
  expect(p.peak24h).toBeGreaterThan(2)
})

test('wallet metrics: win rate, excess over the day, earlyness, evidence', () => {
  const tokens = new Map<string, Token>()
  const trades: Trade[] = []
  for (let i = 1; i <= 12; i++) {
    tokens.set(tok(i).token, tok(i))
    trades.push(trade(i, 'buy', 2 + i, 0.5, 1.01 ** (i / 5), 100), trade(i, 'sell', 120 + i, 0.8, 1.3, 100))
    // the crowd buys the same tokens late, near the top
    trades.push(trade(i, 'buy', 600 + i, 0.5, 1.01 ** 120, 100, '0x' + '2'.repeat(40)))
  }
  const ps = buildPositions(trades, tokens, lookup, 600, T0 + 3 * 86_400_000)
  const b = benchmark(ps)
  const mine = ps.filter(p => p.wallet === W)
  const m = walletMetrics(W, mine, trades.filter(t => t.wallet === W), b, T0 + 3 * 86_400_000)
  expect(m.positions).toBe(12)
  expect(m.winRate).toBe(1)
  expect(m.earlyEntries).toBe(12)
  expect(m.medianEntryMin).toBeLessThan(10)
  expect(m.evidence).toBe('emerging')
  expect(m.excess['1h']).toBeDefined()
  expect(excess(mine[0]!, '1h', b)).toBeDefined()
  expect(evidenceOf(9)).toBe('insufficient')
  expect(evidenceOf(150)).toBe('meaningful')
})
