import { expect, test } from 'bun:test'
import { alertToTrade, fomoApi, ohlcvToCandles, parseTokenKey, positionsToTrades, tokenFromCandles, tokenKey, traderId } from '../src/lib/fomoapi'

test('keys: traders are @handles, tokens are chain:address (EVM lowercase, Solana as-is)', () => {
  expect(traderId('@PointFarmCap')).toBe('@pointfarmcap')
  expect(tokenKey(56, '0xABcd')).toBe('56:0xabcd')
  expect(tokenKey(1399811149, 'So1Mint')).toBe('1399811149:So1Mint')
  expect(parseTokenKey('56:0xabcd')).toEqual({ networkId: 56, address: '0xabcd' })
})

test('positions become trades with a price; token swaps and junk are skipped', () => {
  const rows = [
    { id: 'a', side: 'buy', token: { address: '0xT', networkId: 56 }, usdValue: 100, in: { humanAmount: 0.16 }, out: { humanAmount: 1000 }, createdAt: '2026-10-06T10:00:00Z' },
    { id: 'b', side: 'sell', token: { address: '0xT', networkId: 56 }, usdValue: 150, in: { humanAmount: 1000 }, out: { humanAmount: 0.24 }, createdAt: '2026-10-06T11:00:00Z' },
    { id: 'c', side: 'swap', token: { address: '0xT', networkId: 56 }, usdValue: 5, in: { humanAmount: 1 }, out: { humanAmount: 1 }, createdAt: '2026-10-06T11:00:00Z' },
    { id: 'd', side: 'buy', token: { address: null, networkId: 56 }, usdValue: 5, out: { humanAmount: 1 }, createdAt: '2026-10-06T11:00:00Z' },
  ]
  const t = positionsToTrades('Bob', rows, 625)
  expect(t.map(x => [x.side, x.wallet, x.token, x.priceUsd, x.bnb])).toEqual([['buy', '@bob', '56:0xt', 0.1, 0.16], ['sell', '@bob', '56:0xt', 0.15, 0.24]])
})

test('live alerts become trades; other frames do not', () => {
  const a = { type: 'alert', alertType: 'swap_buy', trader: 'Onepeterrr', tokenAddress: '0xAA', chainId: 56, usdValue: 300, priceUsd: 0.003, ts: '2026-10-06T21:18:35Z', tradeId: 't1' }
  expect(alertToTrade(a, 600)).toMatchObject({ wallet: '@onepeterrr', token: '56:0xaa', side: 'buy', usd: 300, amount: 100000, bnb: 0.5 })
  expect(alertToTrade({ ...a, alertType: 'thesis' }, 600)).toBeNull()
  expect(alertToTrade({ ...a, priceUsd: null }, 600)).toBeNull()
})

test('candles and token rows: a short history marks the launch', () => {
  const c = ohlcvToCandles([{ time: 2, open: 1, high: 2, low: 1, close: 1.5, volume: 9 }, { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }])
  expect(c.map(x => x.ts)).toEqual([1, 2])
  expect(tokenFromCandles('56:0xt', 'T', c, 500, 99).launchedAt).toBe(1)
  expect(tokenFromCandles('56:0xt', 'T', c, 2, 99).launchedAt).toBe(99)
  expect(tokenFromCandles('56:0xt', 'T', c, 500, 99).priceUsd).toBe(1.5)
})

test('the client sends the bearer key and surfaces API errors', async () => {
  let auth = ''
  const f = (async (url: string, init: any) => {
    auth = init.headers.authorization
    return String(url).includes('/rank') ? new Response(JSON.stringify({ error: 'unknown_handle', message: 'no such trader' }), { status: 404 }) : new Response(JSON.stringify({ data: [{ rank: 1, handle: 'x' }] }))
  }) as unknown as typeof fetch
  const api = fomoApi('fomo_live_x.y', f)
  expect(await api.leaderboard('24h', 5)).toEqual([{ rank: 1, handle: 'x' }])
  expect(auth).toBe('Bearer fomo_live_x.y')
  await expect(api.rank('nobody')).rejects.toThrow('FomoAPI 404: unknown_handle no such trader')
})
