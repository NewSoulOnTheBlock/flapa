// A cycle buy that fails blocks its token for a day and the cycle moves on to the next option.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { affect } from '../src/organs/affect'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands, type Helper } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import { FakeBrain, fakeMarket, tempBody, TOKEN } from './helpers'

const personas = join(import.meta.dir, '..', 'examples', 'personas')
const TAXED = '0x2222222222222222222222222222222222222222'

const candidate = (token: string, symbol: string, change1hPct: number) => ({
  token, symbol, liquidityUsd: 500_000, volume24hUsd: 1_000_000, change1hPct, change6hPct: 5,
  buys1h: 80, sells1h: 30, ageDays: 30,
})

let savedKey: string | undefined
beforeEach(() => { savedKey = process.env.FLAPA_TRADER_KEY; process.env.FLAPA_TRADER_KEY = 'test-only-not-a-key' })
afterEach(() => { if (savedKey === undefined) delete process.env.FLAPA_TRADER_KEY; else process.env.FLAPA_TRADER_KEY = savedKey })

test('a failed cycle buy blocks the token and buys the next option instead', async () => {
  const price = { bnb: 0.0001 }
  const bought: string[] = []
  const helper: Helper = async (cmd, a: any) => {
    if (cmd === 'quote') {
      const amt = BigInt(a.amountWei)
      return { amountOutWei: ((amt * 10n ** 9n) / BigInt(Math.round(price.bnb * 1e9))).toString(), decimals: 18, symbol: 'TEST' }
    }
    if (cmd === 'buy') {
      bought.push(a.token.toLowerCase())
      if (a.token.toLowerCase() === TAXED) throw new Error('the operation inside failed (success=false): 0xdead')
      return { hash: '0xbuy', tokensWei: '1000000000000000000', gasWei: '0' }
    }
    throw new Error(`unexpected ${cmd}`)
  }
  const body = tempBody(new FakeBrain())
  body.grow(identity(body, personas), conscience(body), affect(body), eyes(body, fakeMarket(price)), hands(body, helper))
  ;(body.organ('conscience') as any).actions.live({ organ: 'hands', isLive: true })
  const e = body.organ('eyes') as any
  // The taxed token ranks first; the plain one second.
  e.candidates = async () => [candidate(TAXED, 'TAX', 20), candidate(TOKEN, 'OK', 5)]
  const market = e.market
  e.market = async (t: string) => ({ ...(await market(TOKEN)), token: t.toLowerCase(), symbol: t.toLowerCase() === TAXED ? 'TAX' : 'OK' })
  const run = (body.organ('hands') as any).actions.cycleNow

  const first = await run()
  expect(first.did).toBe('buy')
  expect(first.summary).toContain('$OK')
  expect(first.result).toContain('$TAX')
  expect(bought).toEqual([TAXED, TOKEN])

  // The next cycle does not try the taxed token again.
  bought.length = 0
  await run()
  expect(bought).not.toContain(TAXED)
})
