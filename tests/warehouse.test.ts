import { expect, test } from 'bun:test'
import { WBNB } from '../src/lib/market'
import { parseCandles, parsePools, parseTrades, Warehouse } from '../src/lib/wallets/warehouse'

const TOKEN = '0x' + 'a'.repeat(40), POOL = '0x' + 'b'.repeat(40), W = '0x' + 'c'.repeat(40)

test('parses only v2 WBNB pools, trades with the trader wallet, and candles', () => {
  const pools = parsePools({ data: [
    { attributes: { address: POOL, name: 'CAT / WBNB', pool_created_at: '2026-10-06T10:00:00Z', fdv_usd: '90000', base_token_price_usd: '0.01', reserve_in_usd: '40000' },
      relationships: { dex: { data: { id: 'pancakeswap_v2' } }, base_token: { data: { id: `bsc_${TOKEN}` } }, quote_token: { data: { id: `bsc_${WBNB}` } } } },
    { attributes: { address: POOL }, relationships: { dex: { data: { id: 'pancakeswap-v3-bsc' } }, base_token: { data: { id: `bsc_${TOKEN}` } }, quote_token: { data: { id: `bsc_${WBNB}` } } } },
  ] }, 1)
  expect(pools).toEqual([{ token: TOKEN, pool: POOL, symbol: 'CAT', launchedAt: Date.parse('2026-10-06T10:00:00Z'), fdvUsd: 90000, priceUsd: 0.01, liquidityUsd: 40000, updatedAt: 1 }])
  const trades = parseTrades({ data: [
    { attributes: { kind: 'buy', tx_hash: '0x1', tx_from_address: W.toUpperCase().replace('0X', '0x'), block_timestamp: '2026-10-06T10:05:00Z', block_number: 7, from_token_amount: '0.5', to_token_amount: '50000', volume_in_usd: '390', price_to_in_usd: '0.0078' } },
    { attributes: { kind: 'sell', tx_hash: '0x2', tx_from_address: W, block_timestamp: '2026-10-06T11:00:00Z', block_number: 9, from_token_amount: '50000', to_token_amount: '0.9', volume_in_usd: '700', price_from_in_usd: '0.014' } },
  ] }, { token: TOKEN, pool: POOL })
  expect(trades.map(t => [t.side, t.wallet, t.bnb, t.priceUsd, t.amount])).toEqual([['buy', W, 0.5, 0.0078, 50000], ['sell', W, 0.9, 0.014, 50000]])
  expect(parseCandles({ data: { attributes: { ohlcv_list: [[200, 1, 2, 1, 1.5, 10], [100, 1, 1, 1, 1, 5]] } } }).map(c => c.ts)).toEqual([100_000, 200_000])
})

test('the warehouse stores trades once, tokens, candles, profiles and signals', () => {
  const w = new Warehouse(':memory:')
  w.upsertToken({ token: TOKEN, pool: POOL, symbol: 'CAT', launchedAt: 5, fdvUsd: 1, priceUsd: 1, liquidityUsd: 1, updatedAt: 1 })
  const t = { tx: '0x1', wallet: W, token: TOKEN, pool: POOL, at: 10, block: 1, side: 'buy' as const, bnb: 1, usd: 1, priceUsd: 1, amount: 1 }
  expect(w.addTrades([t, t])).toBe(1)
  expect(w.trades({ wallet: W }).length).toBe(1)
  w.addCandles(POOL, '5m', [{ ts: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }])
  expect(w.counts()).toEqual({ trades: 1, wallets: 1, tokens: 1, candles: 1 })
  w.saveProfiles([{ wallet: W, profile: { wallet: W, x: 1 }, score: 80, tier: 'known', cls: 'smart' }])
  expect(w.profiles('known')[0].x).toBe(1)
  const id = w.addSignal({ at: 1, wallet: W, token: TOKEN, kind: 'buy', score: 70, data: { a: 1 } })
  expect(w.signals(10, true).length).toBe(1)
  w.setOutcome(id, { r1h: 0.2 })
  expect(w.signals(10, true).length).toBe(0)
  w.close()
})
