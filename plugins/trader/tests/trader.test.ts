import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_LIMITS, buyRefusals, copySignals, exitFor, fromWei, minOut, shareOf, toWei } from '../hooks/limits'
import { pickPool } from '../hooks/market'
import type { Position } from '../types'

const FLAPA = '0xFe59B933944B4d267A14c59020C0eB19a97d7777'
const OTHER = '0x1111111111111111111111111111111111111111'
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const NOW = Date.UTC(2026, 9, 5, 12)
const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const day0 = { day: '2026-10-05', spentBnb: 0, realizedBnb: 0 }
const check = { bnb: 0.02, token: FLAPA, liquidityUsd: 22_000, isSellBlocked: false, isPerson: false }

test('limits: size, day, loss, open count, liquidity, honeypot, cooldown', () => {
  expect(buyRefusals(check, DEFAULT_LIMITS, day0, [], [], NOW)).toEqual([])
  expect(buyRefusals({ ...check, bnb: 0.5 }, DEFAULT_LIMITS, day0, [], [], NOW)[0]).toContain('over the per-trade limit')
  expect(buyRefusals(check, DEFAULT_LIMITS, { ...day0, spentBnb: 0.09 }, [], [], NOW)[0]).toContain('over the daily limit')
  expect(buyRefusals(check, DEFAULT_LIMITS, { ...day0, realizedBnb: -0.05 }, [], [], NOW)[0]).toContain('realized loss')
  expect(buyRefusals({ ...check, liquidityUsd: 5_000 }, DEFAULT_LIMITS, day0, [], [], NOW)[0]).toContain('under the $20,000 minimum')
  expect(buyRefusals({ ...check, isSellBlocked: true }, DEFAULT_LIMITS, day0, [], [], NOW)[0]).toContain('honeypot')
  const open = [1, 2, 3].map(i => ({ token: `0x${String(i).repeat(40)}` }) as Position)
  expect(buyRefusals(check, DEFAULT_LIMITS, day0, open, [], NOW)[0]).toContain('3 open positions')
  const bought = [{ at: NOW - 60_000, side: 'buy' as const, token: FLAPA.toLowerCase(), symbol: 'Flapa', bnb: 0.02, source: 'own' as const, why: '' }]
  expect(buyRefusals(check, DEFAULT_LIMITS, day0, [], bought, NOW)[0]).toContain('cooldown')
  // The person's own call skips the cooldown, and nothing else.
  expect(buyRefusals({ ...check, isPerson: true }, DEFAULT_LIMITS, day0, [], bought, NOW)).toEqual([])
  expect(buyRefusals({ ...check, isPerson: true, bnb: 1 }, DEFAULT_LIMITS, day0, [], bought, NOW)).toHaveLength(2)
})

test('wei math is exact', () => {
  expect(toWei(0.1)).toBe(100_000_000_000_000_000n)
  expect(toWei(0.02)).toBe(20_000_000_000_000_000n)
  expect(minOut(1000n, 12)).toBe(880n)
  expect(shareOf('1001', 50)).toBe(500n)
  expect(shareOf('1001', 100)).toBe(1001n)
  expect(fromWei('159863154786632923126227')).toBeGreaterThan(159_863)
  expect(fromWei(-5n * 10n ** 17n)).toBe(-0.5)
})

test('exits: stop loss, half at take profit, then a trailing stop', () => {
  const p: Position = {
    token: FLAPA, symbol: 'Flapa', amountWei: '1', decimals: 18, costBnb: 0.02, entryPrice: 1, peakPrice: 1, lastPrice: 1,
    openedAt: NOW, source: 'own', thesis: '',
  }
  expect(exitFor(p, 1.1, DEFAULT_LIMITS)).toBeNull()
  expect(exitFor(p, 0.75, DEFAULT_LIMITS)).toEqual({ pct: 100, why: 'stop loss: -25.0% from entry' })
  expect(exitFor(p, 1.6, DEFAULT_LIMITS)).toEqual({ pct: 50, why: 'take profit: +60.0%, selling half' })
  // Jumped past the target between checks (peak already there): still half, not a trailing stop.
  expect(exitFor({ ...p, peakPrice: 1.7 }, 1.7, DEFAULT_LIMITS)?.pct).toBe(50)
  // After the take profit (peak 2.0), no second half-sale; the rest trails 25% off the peak.
  const after = { ...p, peakPrice: 2, tookProfit: true }
  expect(exitFor(after, 1.9, DEFAULT_LIMITS)).toBeNull()
  expect(exitFor(after, 1.5, DEFAULT_LIMITS)?.why).toBe('trailing stop: -25.0% off the peak')
})

test('copy signals: BNB Chain buys only, grouped by token, strongest first', () => {
  const s = (trader: string, token: string, over: object = {}) => ({ trader, side: 'buy', token, networkId: 56, usd: 100, at: NOW, ...over })
  const out = copySignals([
    s('a', OTHER), s('b', OTHER), s('a', OTHER, { usd: 50 }),
    s('c', FLAPA),
    s('d', '0x2222222222222222222222222222222222222222', { networkId: 8453 }),
    s('e', '0x3333333333333333333333333333333333333333', { side: 'sell' }),
    s('f', '0x4444444444444444444444444444444444444444', { at: NOW - 3 * 3_600_000 }),
  ], NOW - 2 * 3_600_000, new Set([FLAPA.toLowerCase()]))
  expect(out).toEqual([{ token: OTHER, traders: ['a', 'b'], usd: 250, lastAt: NOW }])
})

const DEX = (token: string, liquidity = 22_728, priceNative = '0.00000006234') => ({
  pairs: [
    {
      chainId: 'bsc', dexId: 'pancakeswap', labels: ['v3'], pairAddress: '0x9661', baseToken: { address: token, symbol: 'Flapa', name: 'x' },
      quoteToken: { address: '0x55d398326f99059fF775485246999027B3197955' }, priceNative: '0.00004654', liquidity: { usd: 14 },
    },
    {
      chainId: 'bsc', dexId: 'pancakeswap', labels: ['v2'], pairAddress: '0x74F4', baseToken: { address: token, symbol: 'Flapa', name: '芙拉葩' },
      quoteToken: { address: WBNB }, priceNative, priceUsd: '0.00004911', liquidity: { usd: liquidity },
      volume: { h24: 40137 }, priceChange: { h1: 2.04, h24: 27.89 }, txns: { h24: { buys: 341, sells: 345 } }, marketCap: 49119, pairCreatedAt: NOW - 86_400_000,
    },
  ],
})

test('the pool: PancakeSwap v2 against WBNB, never the dust USDT pool', () => {
  const m = pickPool(DEX(FLAPA), FLAPA, NOW)
  expect(m?.pair).toBe('0x74F4')
  expect(m?.priceBnb).toBe(0.00000006234)
  expect(m?.ageHours).toBe(24)
  expect(pickPool({ pairs: [] }, FLAPA, NOW)).toBeNull()
})

// ---------- the whole loop, with a fake signing helper ----------

function engineBeneath(on: On, opts: { dial?: { value: string } } = {}) {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  on('state.get', (_$, e, next) =>
    e.plugin === 'guardrails' && e.key === 'dial'
      ? ({ value: { value: opts.dial?.value ?? 'auto', version: 1 } } as never)
      : e.plugin === 'persona-core' && e.key === 'active'
        ? ({ value: { value: { id: 'flapa', name: 'Flapa', handle: 'flapakuwai', tagline: '', backstory: '', voice: '', values: [], taboos: [], examples: [] }, version: 1 } } as never)
        : next(e),
  )
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__trader__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  const prompts: string[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push(String((e as unknown as { text: string }).text))
    return { value: undefined } as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are Claude.', scope: 'shared' as const }] }))

  // The market: tests move the price; fomo answers warnings, the board and swaps.
  const mkt = { price: '0.00000006234', sellBlocked: false }
  const swapsOf: Record<string, unknown[]> = {}
  on('http.fetch', (_$, e) => {
    const ok = (json: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } })
    if (e.url.startsWith('https://api.dexscreener.com/')) {
      const token = e.url.split('/').pop()!
      return ok(DEX(token, token === OTHER ? 5_000 : 22_728, mkt.price))
    }
    const body = JSON.parse(String(e.init?.body))
    const tool = body.params.name
    const reply = (v: unknown) => ok({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(v) }] } })
    if (tool === 'fomo_get_token_warnings') return reply({ disableBuying: false, disableSelling: mkt.sellBlocked, warnings: [] })
    if (tool === 'fomo_get_leaderboard') return reply({ items: Object.keys(swapsOf).map((handle, i) => ({ rank: i + 1, handle })) })
    if (tool === 'fomo_list_trader_swaps') return reply({ items: swapsOf[body.params.arguments.handle] ?? [] })
    return reply({})
  })

  // The signing helper, faked: fills at the quote, and records every call.
  const helperCalls: { cmd: string; args: any }[] = []
  on('process.run', (_$, e) => {
    const [, , cmd, raw] = (e as unknown as { argv: string[] }).argv
    const args = JSON.parse(raw ?? '{}')
    helperCalls.push({ cmd: cmd!, args })
    const price = Number(mkt.price)
    const r = cmd === 'balance' ? { address: '0xF1a9', bnbWei: '500000000000000000' }
      : cmd === 'quote'
        ? args.side === 'buy'
          ? { amountOutWei: String(BigInt(Math.round(Number(args.amountWei) / price))), decimals: 18, symbol: 'Flapa' }
          : { amountOutWei: String(BigInt(Math.round(Number(args.amountWei) * price))), decimals: 18, symbol: 'Flapa' }
        : cmd === 'buy' ? { hash: '0xb0', tokensWei: String(BigInt(Math.round(Number(args.bnbWei) / price))), gasWei: '1' }
          : cmd === 'sell' ? { hash: '0x5e', bnbWei: String(BigInt(Math.round(Number(args.amountWei) * price))), gasWei: '1' }
            : { error: 'unknown' }
    return { value: { exitCode: 0, stdout: `${JSON.stringify(r)}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  return { clock, mkt, helperCalls, prompts, swapsOf }
}

const start = { cwd: '/tmp/p', surface: 'terminal', isInteractive: true } as const
const trade = async ($: any, input: object) => String((await $.tool.call({ tool: 'mcp__trader__trade', ...input } as never)).result ?? '')
const cmd = async ($: any, args: string) => String((await $.command.run({ command: 'trade', args, ...typed })).text)
const THESIS = 'her own token, volume holding up, wrong if it loses the pool floor'

test('off until /trade live; then buys inside the limits only', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)

  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })).toContain('trading is off')
  expect(engine.helperCalls).toEqual([])

  expect(await cmd($, 'live')).toContain('Trading LIVE from 0xF1a9 (0.5000 BNB)')
  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: 'yes' })).toBe('')
  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.5, thesis: THESIS })).toContain('over the per-trade limit')
  expect(await trade($, { action: 'buy', token: OTHER, bnb: 0.01, thesis: THESIS })).toContain('under the $20,000 minimum')

  const r = await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })
  expect(r).toContain('Bought 320,821 $Flapa for 0.02 BNB')
  const buyCall = engine.helperCalls.find(c => c.cmd === 'buy')!
  expect(buyCall.args.bnbWei).toBe('20000000000000000')
  // The floor sent to the chain is the quote less 12% slippage.
  const quoted = BigInt(Math.round(2e16 / 0.00000006234))
  expect(buyCall.args.minOutWei).toBe(String((quoted * 8800n) / 10_000n))

  // A second buy of the same token waits out the cooldown; the person's own call does not.
  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })).toContain('cooldown')
  expect(await cmd($, `buy ${FLAPA} 0.01`)).toContain('Bought')

  const pf = String((await $.tool.call({ tool: 'mcp__trader__portfolio' } as never)).result)
  expect(pf).toContain('Today: bought 0.0300/0.1 BNB')
  expect(pf).toContain('- $Flapa')
})

test('exits run on their own: a stop loss sells it all and books the loss', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)
  await cmd($, 'live')
  await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })

  engine.mkt.price = String(0.00000006234 * 0.7)
  await engine.clock.advance(2 * 60_000)
  const sells = engine.helperCalls.filter(c => c.cmd === 'sell')
  expect(sells).toHaveLength(1)
  const pf = String((await $.tool.call({ tool: 'mcp__trader__portfolio' } as never)).result)
  expect(pf).toContain('No open positions.')
  expect(pf).toContain('realized -0.0060 BNB')
  expect(pf).toMatch(/sell \$Flapa 0\.0140 BNB \(-0\.0060\)/)
})

test('take profit sells half, once', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)
  await cmd($, 'live')
  await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })
  engine.mkt.price = String(0.00000006234 * 1.7)
  await engine.clock.advance(2 * 60_000)
  await engine.clock.advance(2 * 60_000)
  expect(engine.helperCalls.filter(c => c.cmd === 'sell')).toHaveLength(1)
  expect(String((await $.tool.call({ tool: 'mcp__trader__portfolio' } as never)).result)).toContain('(+70.0%)')
})

test('the kill switch and honeypots stop her; the person still can trade', async ($, on) => {
  const dial = { value: 'paused' }
  const engine = engineBeneath(on, { dial })
  await $.session.start(start)
  await cmd($, 'live')
  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })).toContain('the agent is paused')
  expect(await cmd($, `buy ${FLAPA} 0.01`)).toContain('Bought')

  dial.value = 'auto'
  engine.mkt.sellBlocked = true
  expect(await trade($, { action: 'buy', token: FLAPA, bnb: 0.02, thesis: THESIS })).toContain('honeypot')

  // Paused, exits stand still too: nothing she does on her own.
  dial.value = 'paused'
  engine.mkt.price = String(0.00000006234 * 0.5)
  await engine.clock.advance(2 * 60_000)
  expect(engine.helperCalls.filter(c => c.cmd === 'sell')).toHaveLength(0)
})

test('copy signals: new BNB Chain buys go to her once, to judge', async ($, on) => {
  const engine = engineBeneath(on)
  await $.session.start(start)
  await cmd($, 'live')
  const at = new Date(NOW - 30 * 60_000).toISOString()
  engine.swapsOf.cosmic358 = [
    { side: 'buy', token: { address: FLAPA, networkId: 56 }, usdValue: 900, createdAt: at },
    { side: 'buy', token: { address: '0x71f1e65cd84e07baa1290e40c4f130f9462f1f97', networkId: 8453 }, usdValue: 50, createdAt: at },
  ]
  engine.swapsOf.latentvariable3 = [{ side: 'buy', token: { address: FLAPA, networkId: 56 }, usdValue: 300, createdAt: at }]

  expect(await cmd($, 'copy now')).toBe('Copy scan: 1 new signal(s) handed to her')
  await engine.clock.advance(1_000)
  expect(engine.prompts).toHaveLength(1)
  expect(engine.prompts[0]).toContain(`${FLAPA}: bought by cosmic358, latentvariable3 ($1,200 in 2h)`)
  expect(engine.prompts[0]).toContain('$Flapa: mc $49.1k')
  expect(await cmd($, 'copy now')).toBe('Copy scan: 1 BNB Chain signals, none new')
  expect(engine.prompts).toHaveLength(1)
})

test('limits are set in range only', async ($, on) => {
  engineBeneath(on)
  await $.session.start(start)
  expect(await cmd($, 'limits maxPerTradeBnb 0.05')).toBe('maxPerTradeBnb set to 0.05.')
  expect(await cmd($, 'limits maxPerTradeBnb 50')).toBe('maxPerTradeBnb must be between 0.001 and 1.')
  expect(await cmd($, 'limits yolo 1')).toContain('No limit called yolo')
})
