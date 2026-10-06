import { expect, test } from 'bun:test'
import { join } from 'node:path'
import type { FomoApi } from '../src/lib/fomoapi'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import { scout, type ScoutOrgan } from '../src/organs/scout'
import { fakeMarket, tempBody, TOKEN } from './helpers'

const OTHER = '0x' + '9'.repeat(40)
const fakeApi = (over: Partial<FomoApi> = {}): FomoApi => ({
  get: async () => ({}),
  leaderboard: async w => [{ rank: 1, handle: 'Onepeterrr', pnlUsd: w === '7d' ? 84_000 : 12_000 }, { rank: 2, handle: 'boosteryting', pnlUsd: 9_000 }],
  positions: async h => [
    { id: `${h}1`, side: 'buy', token: { address: TOKEN, networkId: 56 }, usdValue: 100, out: { humanAmount: 1000 }, createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString() },
    { id: `${h}2`, side: 'sell', token: { address: TOKEN, networkId: 56 }, usdValue: 180, in: { humanAmount: 1000 }, createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
  ],
  rank: async () => null, profile: async () => null,
  warnings: async () => ({ disableSelling: false, disableBuying: false, warnings: [] }),
  stats: async () => ({ windows: { '5m': { buySellRatio: 1.6, uniqueBuyers: 14 } } }),
  ohlcv: async (_a, _n, interval) => Array.from({ length: 12 }, (_, i) => ({ time: Date.now() - (12 - i) * (interval === '1h' ? 3_600_000 : 300_000), open: 0.1, high: 0.2, low: 0.09, close: 0.1 + i * 0.01, volume: 100 })),
  ...over,
})

function grown(api: FomoApi) {
  const body = tempBody()
  const f = fakeMarket({ bnb: 1, liq: 80_000 })
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), eyes(body, f, { api }), hands(body, async () => { throw new Error('no live helper in tests') }), scout(body, { dbPath: ':memory:', api, stream: false, pause: async () => {} }))
  const s = body.organ('scout') as ScoutOrgan
  s.warehouse.saveProfiles([{
    wallet: '@onepeterrr', score: 92, tier: 'known', cls: 'insider-like',
    profile: { wallet: '@onepeterrr', tier: 'known', score: 92, isLeader: true, reasons: ['#1 on fomo\'s 7d board (+$84,000)'], labels: ['insider-like'], pct: { early: 90 }, medianBuyUsd: 200, medianHoldMin: 120, firstSeen: Date.now() - 20 * 86_400_000 },
  }])
  return { body, s }
}
const alert = (o: Record<string, unknown>) => ({ type: 'alert', alertType: 'swap_buy', eventId: String(Math.random()), trader: 'Onepeterrr', token: 'TEST', tokenAddress: TOKEN, chainId: 56, usdValue: 900, priceUsd: 600, ts: new Date().toISOString(), tradeId: String(Math.random()), ...o })

test('live: a known fomo trader buys on BNB Chain, she copies them; they sell, she follows them out', async () => {
  const { body, s } = grown(fakeApi())
  await s.ingest(alert({}))
  const pos = (body.organ('hands').view!() as any).positions
  expect(pos).toHaveLength(1)
  expect(pos[0]).toMatchObject({ token: TOKEN, paper: true, copy: { wallets: ['@onepeterrr'], stage: 0 } })
  const sig = (s.view!() as any).signals[0]
  expect(sig).toMatchObject({ copied: true, wallet: '@onepeterrr' })
  expect(sig.score).toBeGreaterThanOrEqual(65)

  await s.ingest(alert({ alertType: 'swap_sell', usdValue: 720 }))
  expect((body.organ('hands').view!() as any).positions[0].copy.leaderSoldPct).toBe(80)
  await (body.organ('hands') as any).rhythms.find((r: any) => r.name === 'exits').run()
  const h = body.organ('hands').view!() as any
  expect(h.trades[0]).toMatchObject({ side: 'sell', by: 'exit' })
  expect(h.trades[0].why).toContain('the wallet she copied sold 80%')
})

test('a buy with no WBNB pool is scored and logged, not copied; a sell-blocked token is skipped', async () => {
  const { body, s } = grown(fakeApi())
  await s.ingest(alert({ tokenAddress: OTHER, token: 'ELSEWHERE' }))
  expect((s.view!() as any).signals[0].skip).toContain('2-hop route')
  expect((body.organ('hands').view!() as any).positions).toHaveLength(0)

  const b = grown(fakeApi({ warnings: async () => ({ disableSelling: true }) }))
  await b.s.ingest(alert({}))
  expect((b.s.view!() as any).signals[0].skip).toContain('selling is restricted')
  expect((b.body.organ('hands').view!() as any).positions).toHaveLength(0)
})

test('collect: boards, positions and candles fill the warehouse; other chains count toward scoring', async () => {
  const { s } = grown(fakeApi())
  const r = await (s.actions as any).collectNow()
  expect(r.result).toContain('from 2 traders')
  const c = s.warehouse.counts()
  expect(c.trades).toBe(4)
  expect(c.candles).toBeGreaterThan(0)
  expect(s.warehouse.token(`56:${TOKEN}`)).toBeTruthy()
  // an off-radar trader's live buy only lands in the warehouse
  await s.ingest(alert({ trader: 'stranger', chainId: 1399811149, tokenAddress: 'SoMint1111', tradeId: 'x9' }))
  expect(s.warehouse.trades({ wallet: '@stranger' })).toHaveLength(1)
})
