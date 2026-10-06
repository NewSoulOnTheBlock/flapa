// Her posts on a clock: armed by the first post, then every N hours; a failed try retries later, not every tick.
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { conscience } from '../src/organs/conscience'
import { identity } from '../src/organs/identity'
import { scheduleDue, voice } from '../src/organs/voice'
import { FakeBrain, fakeMarket, tempBody } from './helpers'

const H = 3_600_000
const call = (name: string, input: unknown) => ({ id: `c_${Math.random()}`, name, input })

test('the clock is armed by the first post, then due every N hours', () => {
  const s = { isOn: true, everyHours: 8, lastPostAt: 0, lastTryAt: 0 }
  expect(scheduleDue(s, 10 * H)).toBe(false) // never posted: waits for the first, by hand
  expect(scheduleDue({ ...s, lastPostAt: 1 * H, lastTryAt: 1 * H }, 8 * H)).toBe(false)
  expect(scheduleDue({ ...s, lastPostAt: 1 * H, lastTryAt: 1 * H }, 9 * H)).toBe(true)
  expect(scheduleDue({ ...s, lastPostAt: 1 * H, lastTryAt: 9 * H }, 9.2 * H)).toBe(false) // tried just now
  expect(scheduleDue({ ...s, isOn: false, lastPostAt: 1 * H }, 20 * H)).toBe(false)
})

test('post now writes and posts one through the conscience, and starts the clock', async () => {
  const brain = new FakeBrain([
    req => {
      expect(String(req.messages.at(-1)!.content)).toContain('regular post')
      return { calls: [call('post', { text: 'chart staring hour, results: emotional' })] }
    },
    () => ({ text: 'posted!' }),
  ])
  const body = tempBody(brain)
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), voice(body, fakeMarket({ bnb: 1 })))
  const v = body.organ('voice') as any
  v.actions.schedule({ isOn: true, everyHours: 8, mode: 'every' })
  expect(v.view().schedule.nextAt).toBeNull()
  const out = await v.actions.postNow()
  expect(out.result).toContain('done (paper)')
  expect(v.view().posted[0].text).toBe('chart staring hour, results: emotional')
  const next = v.view().schedule.nextAt - Date.now()
  expect(next).toBeGreaterThan(7.9 * H)
  expect(next).toBeLessThanOrEqual(8 * H)
})

test('the brief carries the person\'s themes and bans outage talk', async () => {
  const { postBrief, DEFAULT_THEMES } = await import('../src/organs/voice')
  expect(DEFAULT_THEMES).toContain('harness')
  expect(DEFAULT_THEMES).toContain('about to start trading')
  const b = postBrief(8, 'my new hat')
  expect(b).toContain('my new hat')
  expect(b).toContain('Never mention a site, tool or data feed being down')
})

test('a paper post can be taken back; a live one cannot', async () => {
  const brain = new FakeBrain([() => ({ calls: [call('post', { text: 'gm frens, building something cute' })] }), () => ({ text: 'ok' })])
  const body = tempBody(brain)
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), voice(body, fakeMarket({ bnb: 1 })))
  const v = body.organ('voice') as any
  await v.actions.postNow()
  const id = v.view().posted[0].id
  expect(v.actions.unpost({ id }).removed).toContain('gm frens')
  expect(v.view().posted.length).toBe(0)
  expect(() => v.actions.unpost({ id: 'nope' })).toThrow()
})

test('a turn that posts nothing does not restart the clock', async () => {
  const body = tempBody(new FakeBrain([() => ({ text: 'eh, nothing to say' })]))
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), voice(body, fakeMarket({ bnb: 1 })))
  const v = body.organ('voice') as any
  v.actions.schedule({ isOn: true })
  expect((await v.actions.postNow()).result).toContain('no post went out')
  expect(v.view().schedule.lastPostAt).toBe(0)
  expect(() => v.actions.schedule({ everyHours: 0 })).toThrow()
})

test('calendar mode (the default) shows the day\'s posting hours and the next slot', () => {
  const body = tempBody(new FakeBrain([]))
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), conscience(body), voice(body, fakeMarket({ bnb: 1 })))
  const v = body.organ('voice') as any
  v.actions.schedule({ isOn: true, perDay: 3 })
  const s = v.view().schedule
  expect(s.mode).toBe('slots')
  expect(s.hours).toEqual([9, 13, 20])
  expect(s.nextAt).toBe(s.calendar[0])
  expect(s.calendar.length).toBe(6)
})
