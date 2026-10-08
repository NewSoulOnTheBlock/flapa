// Money safety: the chain is the truth, empty wallets pause buys, and only the person moves funds out.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { affect } from '../src/organs/affect'
import { agenda } from '../src/organs/agenda'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands, type Helper } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import type { Position } from '../src/lib/limits'
import { FakeBrain, fakeMarket, tempBody, TOKEN } from './helpers'

const personas = join(import.meta.dir, '..', 'examples', 'personas')
const OTHER = '0x3333333333333333333333333333333333333333'
const STRAY = '0x4444444444444444444444444444444444444444'
const TO = '0x793a5e8b8Ff431cC2D8eE41e8ec2D9ad70247E60'
const E18 = 10n ** 18n

let savedKey: string | undefined
beforeEach(() => { savedKey = process.env.FLAPA_TRADER_KEY; process.env.FLAPA_TRADER_KEY = 'test-only-not-a-key' })
afterEach(() => { if (savedKey === undefined) delete process.env.FLAPA_TRADER_KEY; else process.env.FLAPA_TRADER_KEY = savedKey })

const pos = (token: string, symbol: string, tokens: bigint, costBnb: number, paper = false): Position => ({
  token, symbol, amountWei: (tokens * E18).toString(), decimals: 18, costBnb, entryPrice: costBnb / Number(tokens),
  peakPrice: costBnb / Number(tokens), lastPrice: costBnb / Number(tokens), openedAt: 0, paper,
})

/** A wallet on paper: holdings, quotes, sells and sends all answer from this state. */
function chain(state: { funds: bigint; gas?: bigint; tokens: Record<string, bigint>; discovered?: Record<string, bigint> }) {
  const calls: { cmd: string; args: any }[] = []
  const helper: Helper = async (cmd, a: any) => {
    calls.push({ cmd, args: a })
    if (cmd === 'holdings') {
      const tokens = Object.fromEntries((a.tokens as string[]).map(t => [t.toLowerCase(), String(state.tokens[t.toLowerCase()] ?? 0n)]))
      return {
        fundsWei: String(state.funds), minGasWei: String(3n * 10n ** 14n), tokens,
        ...(state.gas !== undefined ? { gasWei: String(state.gas) } : {}),
        ...(state.discovered ? { discovered: Object.fromEntries(Object.entries(state.discovered).map(([k, v]) => [k, String(v)])) } : {}),
      }
    }
    if (cmd === 'quote') return { amountOutWei: String(BigInt(a.amountWei) / 1000n), decimals: 18, symbol: a.token.toLowerCase() === STRAY ? 'STRAY' : 'TEST' }
    if (cmd === 'sell') {
      const t = a.token.toLowerCase()
      state.tokens[t] = (state.tokens[t] ?? 0n) - BigInt(a.amountWei)
      if (state.discovered?.[t] !== undefined) delete state.discovered[t]
      const out = BigInt(a.amountWei) / 1000n
      state.funds += out
      return { hash: `0xsell${t.slice(2, 6)}`, bnbWei: String(out), gasWei: '0' }
    }
    if (cmd === 'send') {
      const amount = a.all ? state.funds : BigInt(a.amountWei)
      state.funds -= amount
      return { hash: '0xsend', to: a.to, sentWei: String(amount), gasWei: '0' }
    }
    if (cmd === 'buy') return { hash: '0xbuy', tokensWei: String(E18), gasWei: '0' }
    throw new Error(`unexpected ${cmd}`)
  }
  return { helper, calls, state }
}

function grow(helper: Helper) {
  const body = tempBody(new FakeBrain())
  body.grow(identity(body, personas), conscience(body), agenda(body), affect(body), eyes(body, fakeMarket({ bnb: 0.001 })), hands(body, helper))
  return { body, h: body.organ('hands') as any, store: body.store('hands') }
}

test('reconcile closes a bag the wallet no longer holds, shrinks a partial one, and lists untracked tokens', async () => {
  const c = chain({ funds: E18, tokens: { [TOKEN]: 0n, [OTHER]: 50n * E18 }, discovered: { [OTHER]: 50n * E18, [STRAY]: 7n * E18 } })
  const { h, store } = grow(c.helper)
  store.set('positions', [pos(TOKEN, 'GONE', 100n, 0.01), pos(OTHER, 'HALF', 100n, 0.02), pos(STRAY, 'PAPER', 5n, 0.01, true)])
  const r = await h.actions.reconcile()
  expect(r.drift).toHaveLength(2)
  expect(r.drift[0]).toContain('closed')
  const left = store.get<Position[]>('positions', [])
  expect(left.find(p => p.symbol === 'GONE')).toBeUndefined()
  const half = left.find(p => p.symbol === 'HALF')!
  expect(half.amountWei).toBe((50n * E18).toString())
  expect(half.costBnb).toBeCloseTo(0.01)
  // Paper bags are never touched by the chain, and a paper bag in the same token does not hide a real stray.
  expect(left.find(p => p.symbol === 'PAPER')).toBeDefined()
  expect(r.untracked.map((u: any) => u.token)).toEqual([STRAY])
  expect(r.fundsBnb).toBe(1)
})

test('an empty live wallet pauses cycle buys without blocking any token, and tells the person once', async () => {
  const c = chain({ funds: 0n, tokens: {} })
  const { body, h, store } = grow(c.helper)
  ;(body.organ('conscience') as any).actions.live({ organ: 'hands', isLive: true })
  const e = body.organ('eyes') as any
  e.candidates = async () => [{ token: TOKEN, symbol: 'OK', liquidityUsd: 500_000, volume24hUsd: 1e6, change1hPct: 5, change6hPct: 5, buys1h: 80, sells1h: 30, ageDays: 30 }]
  const first = await h.actions.cycleNow()
  expect(first.did).toBe('skip')
  expect(first.summary).toContain('buys paused')
  expect(c.calls.some(x => x.cmd === 'buy')).toBe(false)
  expect(store.get('blocked', {})).toEqual({})
  await h.actions.cycleNow()
  const todos = (body.organ('agenda').view!() as any).todos.filter((t: any) => t.text.includes('live buys pause'))
  expect(todos).toHaveLength(1)
})

test('a gas wallet under its floor pauses live buys; near the floor it warns about stop losses', async () => {
  const c = chain({ funds: E18, gas: 2n * 10n ** 14n, tokens: {} })
  const { body, h } = grow(c.helper)
  ;(body.organ('conscience') as any).actions.live({ organ: 'hands', isLive: true })
  const e = body.organ('eyes') as any
  e.candidates = async () => [{ token: TOKEN, symbol: 'OK', liquidityUsd: 500_000, volume24hUsd: 1e6, change1hPct: 5, change6hPct: 5, buys1h: 80, sells1h: 30, ageDays: 30 }]
  const l = await h.actions.cycleNow()
  expect(l.summary).toContain('gas wallet')
  expect((body.organ('agenda').view!() as any).todos.some((t: any) => t.text.includes('stop losses included'))).toBe(true)
})

test('cash out stops the cycle, sells every live bag and every untracked token, then sends all funds', async () => {
  const c = chain({ funds: 10n ** 17n, tokens: { [TOKEN]: 100n * E18, [STRAY]: 7n * E18 }, discovered: { [TOKEN]: 100n * E18, [STRAY]: 7n * E18 } })
  const { h, store } = grow(c.helper)
  store.set('positions', [pos(TOKEN, 'BAG', 100n, 0.05), pos(OTHER, 'PAPER', 5n, 0.01, true)])
  store.set('cycle', { isOn: true, everyHours: 2 })
  const r = await h.actions.cashOut({ to: TO })
  expect(store.get<any>('cycle', {}).isOn).toBe(false)
  expect(r.steps.some((s: string) => s.startsWith('$BAG: done (live)'))).toBe(true)
  expect(r.steps.some((s: string) => s.includes(STRAY) && s.includes('untracked $STRAY'))).toBe(true)
  expect(r.steps.at(-1)).toContain('withdraw: done (live): sent')
  expect(c.state.funds).toBe(0n)
  // The paper bag is untouched; the live one is gone.
  expect(store.get<Position[]>('positions', []).map(p => p.symbol)).toEqual(['PAPER'])
  expect(h.view().withdrawals[0].to).toBe(TO)
})

test('only the person can move funds out, and only to a real address', async () => {
  const c = chain({ funds: E18, tokens: {} })
  const { body, h } = grow(c.helper)
  await expect(h.actions.withdraw({ to: 'not an address' })).rejects.toThrow('0x address')
  const out = await body.act({ organ: 'hands', kind: 'withdraw', summary: 'sneaky', payload: { to: TO, all: true }, by: 'agent' })
  expect(out).toContain('only the person')
  expect(c.calls.some(x => x.cmd === 'send')).toBe(false)
  // No tool can ask for it either.
  expect(body.tools().some(t => /withdraw|send/.test(t.name))).toBe(false)
  const r = await h.actions.withdraw({ to: TO, bnb: '0.25' })
  expect(r.result).toContain('sent 0.250000 BNB')
})
