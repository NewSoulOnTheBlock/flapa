// The public window must never show what is the person's: their chats, her memories of them, held posts, keys.
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { publicSnapshot, redact, startPublishing, ThoughtLog } from '../src/core/publish'
import { affect } from '../src/organs/affect'
import { agenda } from '../src/organs/agenda'
import { conscience } from '../src/organs/conscience'
import { eyes } from '../src/organs/eyes'
import { hands } from '../src/organs/hands'
import { identity } from '../src/organs/identity'
import { memory } from '../src/organs/memory'
import { voice } from '../src/organs/voice'
import { FakeBrain, fakeMarket, tempBody } from './helpers'

const call = (name: string, input: unknown) => ({ id: `c_${Math.random()}`, name, input })

function flapa(brain: FakeBrain) {
  const body = tempBody(brain)
  const f = fakeMarket({ bnb: 0.0001 })
  body.grow(identity(body, join(import.meta.dir, '..', 'examples', 'personas')), conscience(body), agenda(body), affect(body), memory(body), eyes(body, f), voice(body, f), hands(body, async () => { throw new Error('no helper') }))
  return body
}

test('chats, memories and held posts stay home; her own beat and a passed post go out', async () => {
  const brain = new FakeBrain(
    [
      () => ({ text: 'my secret plan with you is SECRETCHAT' }),
      () => ({ text: 'beat time! checking charts', calls: [call('post', { text: 'charts hate me today lol' })] }),
      () => ({ text: 'done' }),
    ],
    sys => (sys.includes('long-term memory') ? '[{"text": "The person lives in PRIVATECITY", "kind": "fact", "about": []}]' : 'PASS'),
  )
  const body = flapa(brain)
  const log = new ThoughtLog()
  body.bus.listen(s => log.see(s))
  await body.think({ kind: 'chat', text: 'tell me SECRETCHAT' })
  await body.think({ kind: 'beat', text: 'heartbeat' })
  await body.act({ organ: 'voice', kind: 'post', summary: 's', text: 'ape into $FROG now', payload: { text: 'ape into $FROG now' }, by: 'agent' })
  await (body.organ('memory') as any).settled()

  const json = JSON.stringify(publicSnapshot(body, log.items))
  expect(json).not.toContain('SECRETCHAT')
  expect(json).not.toContain('PRIVATECITY')
  expect(json).not.toContain('FROG') // held, never published
  expect(json).toContain('beat time! checking charts')
  expect(json).toContain('charts hate me today lol')
  expect(json).toContain('"name":"Flapa"')
})

test('anything key-shaped is redacted, a tx link is not', () => {
  const key = '0x' + 'ab'.repeat(32)
  expect(redact({ a: [`oops ${key}`] }).a[0]).toBe('oops [redacted]')
  expect(redact(`https://bscscan.com/tx/${key}`)).toContain(key)
  expect(redact('token vercel_blob_rw_abc123_XYZ')).toBe('token [redacted]')
})

test('publishes only when something changed', async () => {
  const body = flapa(new FakeBrain())
  const uploads: string[] = []
  const fake = (async (path: string, data: string) => { uploads.push(data); return { url: `https://x.public.blob.vercel-storage.com/${path}` } }) as any
  const w = startPublishing(body, 'test-token', fake)
  try {
    const t0 = Date.now()
    expect(await w.publishNow(t0)).toContain('snapshot.json')
    expect(await w.publishNow(t0 + 60_000)).toBeNull() // nothing changed
    ;(body.organ('agenda') as any).actions.add({ text: 'get to #1' })
    expect(await w.publishNow(t0 + 120_000)).not.toBeNull() // something did
    expect(await w.publishNow(t0 + 6 * 60_000)).not.toBeNull() // quiet, but she says she's alive
    expect(uploads.length).toBe(3)
  } finally {
    w.stop()
  }
})

test('the radar goes public with short wallet addresses only, and its reasons', async () => {
  const { scout } = await import('../src/organs/scout')
  const { eyes } = await import('../src/organs/eyes')
  const { publicSnapshot } = await import('../src/core/publish')
  const { tempBody, fakeMarket } = await import('./helpers')
  const body = tempBody()
  const f = fakeMarket({ bnb: 1 })
  body.grow(eyes(body, f), scout(body, { dbPath: ':memory:', stream: false, pause: async () => {} }))
  const W = '0x' + 'ab'.repeat(20)
  ;(body.organ('scout') as any).warehouse.saveProfiles([{ wallet: W, score: 88, tier: 'known', cls: 'insider-like', profile: { wallet: W, tier: 'known', score: 88, labels: ['insider-like'], reasons: ['94th percentile early-entry timing'], isLeader: false } }])
  const snap = JSON.stringify(publicSnapshot(body, []))
  expect(snap).not.toContain(W)
  expect(snap).toContain('0xabab…abab')
  expect(snap).toContain('94th percentile early-entry timing')
})
