import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import { scout } from '../src/organs/scout'
import { fakeMarket, tempBody, TOKEN } from './helpers'

const W = '0x' + '7'.repeat(40)

test('phase 2 and 3 end to end: a known wallet buys, she copies it, it sells, she follows it out', async () => {
  const body = tempBody()
  const market = fakeMarket({ bnb: 1, liq: 80_000 })
  let sold = 0
  const fetcher = (async (url: string | URL | Request, init?: any) => {
    const u = String(url)
    if (u === 'http://rpc') {
      const req = JSON.parse(init.body)
      if (req.method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x64' }))
      const q = req.params[0]
      if (q.toAddress === W) return new Response(JSON.stringify({ result: { transfers: [{ rawContract: { address: TOKEN }, value: 1000, metadata: { blockTimestamp: new Date(Date.now() - 60_000).toISOString() } }] } }))
      if (q.fromAddress === W) return new Response(JSON.stringify({ result: { transfers: sold ? [{ value: sold }] : [] } }))
      return new Response(JSON.stringify({ result: { transfers: [] } }))
    }
    return market(url as any)
  }) as typeof fetch
  body.grow(
    identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), eyes(body, fetcher),
    hands(body, async () => { throw new Error('no live helper in tests') }),
    scout(body, { dbPath: ':memory:', fetcher, rpcUrl: 'http://rpc', pause: async () => {} }),
  )
  const s = body.organ('scout') as ReturnType<typeof scout>
  s.warehouse.saveProfiles([{
    wallet: W, score: 92, tier: 'known', cls: 'insider-like',
    profile: { wallet: W, tier: 'known', score: 92, isLeader: true, reasons: ['82nd percentile early-entry timing', 'leads wallet cluster #3'], labels: ['insider-like'], pct: { early: 82 }, medianBuyUsd: 100, medianHoldMin: 120, firstSeen: Date.now() - 20 * 86_400_000 },
  }])

  await (s.actions as any).watchNow()
  const pos = (body.organ('hands').view!() as any).positions
  expect(pos).toHaveLength(1)
  expect(pos[0]).toMatchObject({ token: TOKEN, paper: true, copy: { wallets: [W], stage: 0, entryLiquidityUsd: 80_000 } })
  const sig = (s.view!() as any).signals[0]
  expect(sig).toMatchObject({ copied: true })
  expect(sig.score).toBeGreaterThanOrEqual(65)

  // The same buy is never copied twice.
  await (s.actions as any).watchNow()
  expect((body.organ('hands').view!() as any).positions).toHaveLength(1)

  // The wallet sells 80% of what it bought: she follows it out with the same share.
  sold = 800
  await (s.actions as any).watchNow()
  expect((body.organ('hands').view!() as any).positions[0].copy.leaderSoldPct).toBe(80)
  await (body.organ('hands') as any).rhythms.find((r: any) => r.name === 'exits').run()
  const h = body.organ('hands').view!() as any
  expect(h.trades[0]).toMatchObject({ side: 'sell', by: 'exit' })
  expect(h.trades[0].why).toContain('the wallet she copied sold 80%')
  expect(h.positions[0].copy.leaderSoldPct).toBe(0)
})

test('off-radar wallets and a copy switch that is off never trade', async () => {
  const body = tempBody()
  const fetcher = fakeMarket({ bnb: 1 })
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), eyes(body, fetcher), hands(body, async () => { throw new Error('x') }), scout(body, { dbPath: ':memory:', fetcher, rpcUrl: '', pause: async () => {} }))
  const s = body.organ('scout') as ReturnType<typeof scout>
  ;(s.actions as any).config({ copyOn: false })
  expect((s.view!() as any).config.copyOn).toBe(false)
  expect(await (s.actions as any).watchNow()).toMatchObject({ result: expect.stringContaining('no BSC_RPC_URL') })
  expect((body.organ('hands').view!() as any).positions).toHaveLength(0)
})
