import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Body } from '../src/core/body'
import type { Brain, Step, StepRequest } from '../src/core/brain'

/** A brain that follows a script: each step returns the next scripted answer. */
export class FakeBrain implements Brain {
  readonly kind = 'fake'
  steps: StepRequest[] = []
  quicks: { system: string; prompt: string }[] = []
  constructor(
    private script: ((req: StepRequest) => Partial<Step>)[] = [],
    private reflex: (system: string, prompt: string) => string = () => 'PASS',
  ) {}

  async step(req: StepRequest): Promise<Step> {
    this.steps.push(structuredClone({ ...req, tools: [] }) as StepRequest)
    const next = this.script.shift()?.(req) ?? { text: 'ok' }
    const calls = next.calls ?? []
    return {
      text: next.text ?? '',
      calls,
      stop: next.stop ?? (calls.length ? 'tools' : 'done'),
      assistant: [
        ...(next.text ? [{ type: 'text' as const, text: next.text }] : []),
        ...calls.map(c => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
      ] as any,
    }
  }

  async quick(system: string, prompt: string): Promise<string> {
    this.quicks.push({ system, prompt })
    return this.reflex(system, prompt)
  }
}

export function tempBody(brain: Brain = new FakeBrain()): Body {
  return new Body({ home: mkdtempSync(join(tmpdir(), 'flapa-test-')), brain })
}

export const TOKEN = '0x1111111111111111111111111111111111111111'
export const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

/** A fetch that answers DexScreener with one PancakeSwap v2 pool at a price we control, and fomo with an error. */
export function fakeMarket(price: { bnb: number; liq?: number }): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('dexscreener')) {
      return new Response(JSON.stringify({
        pairs: [{
          chainId: 'bsc', dexId: 'pancakeswap', labels: ['v2'], pairAddress: '0xpair',
          baseToken: { address: TOKEN, symbol: 'TEST', name: 'Test' }, quoteToken: { address: WBNB },
          priceNative: String(price.bnb), priceUsd: String(price.bnb * 600), liquidity: { usd: price.liq ?? 50_000 },
          volume: { h24: 1000 }, priceChange: { h1: 0, h24: 0 }, txns: { h24: { buys: 1, sells: 1 } }, marketCap: 1e6, pairCreatedAt: Date.now() - 86_400_000,
        }],
      }))
    }
    return new Response('nope', { status: 503 })
  }) as typeof fetch
}
