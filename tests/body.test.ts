// The new parts: the cortex loop, the conscience gate, paper trading and posting.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { affect } from '../src/organs/affect'
import { agenda } from '../src/organs/agenda'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import { memory } from '../src/organs/memory'
import { voice } from '../src/organs/voice'
import { FakeBrain, fakeMarket, tempBody, TOKEN } from './helpers'

const call = (name: string, input: unknown) => ({ id: `c_${name}_${Math.random()}`, name, input })
const personas = join(import.meta.dir, '..', 'examples', 'personas')

describe('cortex', () => {
  test('runs tools, feeds results back, keeps chat words, extracts memories', async () => {
    const brain = new FakeBrain(
      [
        () => ({ text: 'adding it', calls: [call('todo', { action: 'add', items: ['beat cosmic358'] })] }),
        req => {
          const last = req.messages.at(-1)!.content as any[]
          expect(last[0].type).toBe('tool_result')
          expect(last[0].content).toContain('beat cosmic358')
          return { text: 'on the list!' }
        },
      ],
      () => '[{"text": "The person wants Flapa to beat cosmic358 on the leaderboard", "kind": "decision", "about": ["cosmic358"]}]',
    )
    const body = tempBody(brain)
    body.grow(identity(body, personas), agenda(body), memory(body))
    const r = await body.think({ kind: 'chat', text: 'put beating cosmic358 on your list' })
    expect(r.text).toBe('on the list!')
    expect((body.organ('agenda').view!() as any).todos[0].text).toBe('beat cosmic358')
    expect((body.organ('memory').view!() as any).count).toBe(1)
    // The persona was in the system prompt, with the cache mark on it.
    const sys = brain.steps[0]!.system
    expect(sys[1]!.text).toContain('Flapa')
    expect(sys[1]!.cache).toBe(true)
    // A second chat sees the first as plain words.
    await body.think({ kind: 'chat', text: 'and?' })
    expect(brain.steps.at(-1)!.messages.length).toBe(3)
  })

  test('thoughts never overlap', async () => {
    let inFlight = 0, most = 0
    const slow = () => { inFlight++; most = Math.max(most, inFlight); return { text: 'x' } }
    const brain = new FakeBrain([slow, slow, slow])
    const orig = brain.step.bind(brain)
    brain.step = async req => { const s = await orig(req); await Bun.sleep(5); inFlight--; return s }
    const body = tempBody(brain)
    await Promise.all([1, 2, 3].map(() => body.think({ kind: 'system', text: 'go' })))
    expect(most).toBe(1)
  })
})

function grown(brain = new FakeBrain(), price = { bnb: 0.0001 }) {
  const body = tempBody(brain)
  const f = fakeMarket(price)
  body.grow(identity(body, personas), conscience(body), affect(body), eyes(body, f), voice(body, f), hands(body, async () => { throw new Error('no live helper in tests') }))
  return { body, gate: (body.organ('conscience') as any).actions }
}

describe('conscience gate', () => {
  test('a clean post goes out in paper mode after review', async () => {
    const brain = new FakeBrain([() => ({ calls: [call('post', { text: 'charts hate me today lol' })] }), () => ({ text: 'posted' })])
    const { body } = grown(brain)
    const r = await body.think({ kind: 'chat', text: 'post something' })
    expect(r.tools[0]!.result).toContain('done (paper)')
    expect((body.organ('voice').view!() as any).posted[0].mode).toBe('paper')
    expect(brain.quicks[0]!.system).toContain('You review a post') // the model reviewer ran
  })

  test('blocked never goes out, held waits, approve executes', async () => {
    const { body, gate } = grown(new FakeBrain([], () => 'PASS'))
    expect(await body.act({ organ: 'voice', kind: 'post', summary: 's', text: "i'm a real human", payload: { text: "i'm a real human" }, by: 'agent' })).toStartWith('blocked')
    expect(await body.act({ organ: 'voice', kind: 'post', summary: 's', text: 'ape into $FROG now', payload: { text: 'ape into $FROG now' }, by: 'agent' })).toStartWith('held')
    const pending = (body.organ('conscience').view!() as any).pending
    expect(pending.length).toBe(1)
    const out = await gate.approve({ id: pending[0].id })
    expect(out.result).toContain('done (paper)')
    expect((body.organ('voice').view!() as any).posted.length).toBe(1)
  })

  test('paused refuses everything; review holds all but exits', async () => {
    const { body, gate } = grown()
    gate.dial({ dial: 'paused', why: 'testing' })
    expect(await body.act({ organ: 'voice', kind: 'post', summary: 's', text: 'gm', payload: { text: 'gm' }, by: 'agent' })).toContain('paused')
    gate.dial({ dial: 'review' })
    expect(await body.act({ organ: 'voice', kind: 'post', summary: 's', text: 'gm', payload: { text: 'gm' }, by: 'agent' })).toStartWith('held')
  })

  test('live needs credentials first', () => {
    const { gate } = grown()
    const saved = { ...process.env }
    delete process.env.FLAPA_TRADER_KEY
    delete process.env.FLAPA_TRADER_KEY
    expect(() => gate.live({ organ: 'hands', isLive: true })).toThrow(/FLAPA_TRADER_KEY/)
    Object.assign(process.env, saved)
  })
})

describe('paper hands', () => {
  test('buy fills at the pool price, take-profit sells half and lifts the mood', async () => {
    const price = { bnb: 0.0001 }
    const brain = new FakeBrain([() => ({ calls: [call('trade', { side: 'buy', token: TOKEN, bnb: 0.02, why: 'funny ticker, real volume' })] }), () => ({ text: 'in!' })])
    const { body } = grown(brain, price)
    const r = await body.think({ kind: 'chat', text: 'buy it' })
    expect(r.tools[0]!.result).toContain('done (paper)')
    let view = body.organ('hands').view!() as any
    expect(view.positions.length).toBe(1)
    expect(view.positions[0].paper).toBe(true)
    expect(view.day.paper.spentBnb).toBeCloseTo(0.02)

    const before = (body.organ('affect').view!() as any).valence
    price.bnb = 0.0002 // doubled: take profit
    await body.organs.find(o => o.name === 'hands')!.rhythms!.find(r => r.name === 'exits')!.run()
    view = body.organ('hands').view!() as any
    expect(view.trades[0].side).toBe('sell')
    expect(view.trades[0].pnlBnb).toBeGreaterThan(0)
    expect(view.positions[0].tookProfit).toBe(true)
    expect((body.organ('affect').view!() as any).valence).toBeGreaterThan(before)
  })

  test('limits refuse before the conscience is even asked', async () => {
    const brain = new FakeBrain([() => ({ calls: [call('trade', { side: 'buy', token: TOKEN, bnb: 5, why: 'yolo' })] }), () => ({ text: 'ok' })])
    const { body } = grown(brain, { bnb: 0.0001 })
    const r = await body.think({ kind: 'chat', text: 'buy 5 bnb' })
    expect(r.tools[0]!.result).toStartWith('refused by limits')
  })
})
