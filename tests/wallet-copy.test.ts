import { expect, test } from 'bun:test'
import { copyExit, copySize, scoreSignal, type CopyMeta, type SignalContext } from '../src/lib/wallets/copy'

const NOW = Date.parse('2026-10-06T20:00:00Z')
const ctx = (o: Partial<SignalContext> = {}, p: Partial<SignalContext['profile']> = {}): SignalContext => ({
  profile: { wallet: 'w', tier: 'known', score: 90, isLeader: false, bestBucket: { name: 'under $100k mcap', n: 8, excess1h: 0.3 }, reasons: [], ...p },
  buyUsd: 600, walletMedianBuyUsd: 200, confluence: 0, signalAt: NOW - 3 * 60_000, now: NOW, priceAtSignal: 1, priceNow: 1.05, tokenMcap: 80_000, tokenAgeMin: 40, held: false, ...o,
})

test('a known wallet sizing up in its specialty, with company, is a strong signal', () => {
  const s = scoreSignal(ctx({ confluence: 2 }, { isLeader: true }))
  expect(s.skip).toBeUndefined()
  expect(s.score).toBeGreaterThanOrEqual(90)
  expect(s.reasons.join(' | ')).toContain('high conviction')
  expect(s.reasons.join(' | ')).toContain('in its specialty')
})

test('skips: off-radar, already held, stale, already ran', () => {
  expect(scoreSignal(ctx({}, { tier: 'watch' })).skip).toContain('not on the radar')
  expect(scoreSignal(ctx({ held: true })).skip).toBe('already holding it')
  expect(scoreSignal(ctx({ signalAt: NOW - 45 * 60_000 })).skip).toContain('stale')
  expect(scoreSignal(ctx({ priceNow: 1.5 })).skip).toContain('already ran +50%')
})

test('size scales with the signal, within limits', () => {
  expect(copySize(70, 0.0083, 0.02)).toBe(0.0083)
  expect(copySize(100, 0.0083, 0.02)).toBe(0.0118)
  expect(copySize(30, 0.0083, 0.02)).toBe(0.0041)
  expect(copySize(100, 0.05, 0.02)).toBe(0.02)
})

const meta = (o: Partial<CopyMeta> = {}): CopyMeta => ({ wallets: ['w'], score: 80, leaderEntryUsd: 1, leaderHoldMin: 120, entryLiquidityUsd: 50_000, stage: 0, ...o })
const pos = { entryPrice: 1, peakPrice: 1, openedAt: NOW - 30 * 60_000 }
const mk = (priceBnb: number, priceUsd = priceBnb, liquidityUsd = 50_000) => ({ priceBnb, priceUsd, liquidityUsd })

test('controls: leader exit, pulled liquidity, broken thesis, ladder, trailing, time stop', () => {
  expect(copyExit(pos, meta({ leaderSoldPct: 70 }), mk(1.1), NOW)).toMatchObject({ pct: 70 })
  expect(copyExit(pos, meta(), mk(1.1, 1.1, 20_000), NOW)!.why).toContain('liquidity pulled')
  expect(copyExit(pos, meta(), mk(0.8, 0.8), NOW)!.why).toContain('thesis broken')
  expect(copyExit(pos, meta(), mk(1.45, 1.45), NOW)).toMatchObject({ pct: 33, stage: 1 })
  expect(copyExit(pos, meta({ stage: 1 }), mk(2.1, 2.1), NOW)).toMatchObject({ pct: 50, stage: 2 })
  expect(copyExit({ ...pos, peakPrice: 2 }, meta({ stage: 1 }), mk(1.4, 1.4), NOW)!.why).toContain('trailing stop')
  expect(copyExit({ ...pos, openedAt: NOW - 5 * 3_600_000 }, meta(), mk(1.01, 1.01), NOW)!.why).toContain('time stop')
  expect(copyExit(pos, meta(), mk(1.1, 1.1), NOW)).toBeNull()
})
