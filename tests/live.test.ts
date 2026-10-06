import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { startLive } from '../src/core/live'
import { affect } from '../src/organs/affect'
import { identity } from '../src/organs/identity'
import { tempBody } from './helpers'

function client(url: string) {
  const ws = new WebSocket(url)
  const got: any[] = []
  const waiters: [(m: any) => boolean, (m: any) => void][] = []
  ws.onmessage = e => {
    const m = JSON.parse(String(e.data))
    got.push(m)
    for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m) }
  }
  const next = (pred: (m: any) => boolean, ms = 3000) => new Promise<any>((res, rej) => {
    const hit = got.find(pred)
    if (hit) return res(hit)
    waiters.push([pred, res])
    setTimeout(() => rej(new Error('timed out waiting for a live message')), ms)
  })
  return { ws, got, next }
}

test('the live window pushes the snapshot on connect, thoughts instantly, and changes within a second', async () => {
  const body = tempBody()
  body.grow(identity(body, join(import.meta.dir, '..', 'personas')), affect(body))
  const live = startLive(body, { port: 0, hostname: '127.0.0.1', stream: 'wss://example/public/ws' })
  const base = `127.0.0.1:${live.server.port}`
  try {
    const c = client(`ws://${base}/public/ws`)
    const first = await c.next(m => m.type === 'snapshot')
    expect(first.data.persona.name).toBe('Flapa')
    expect(first.data.stream).toBe('wss://example/public/ws')
    expect(live.clients()).toBe(1)

    body.bus.emit('trigger', 'eyes', { text: 'BNB up 6.2% today: reacting' })
    const t = await c.next(m => m.type === 'thought')
    expect(t.data).toMatchObject({ kind: 'trigger', text: 'BNB up 6.2% today: reacting' })
    const updated = await c.next(m => m.type === 'snapshot' && m.data.thoughts.some((x: any) => x.kind === 'trigger'))
    expect(updated.data.thoughts[0].text).toContain('BNB up')

    // A chat with the person never reaches the window.
    body.bus.emit('turn.start', 'cortex', { id: 'c1', kind: 'chat' })
    body.bus.emit('turn.text', 'cortex', { id: 'c1', text: 'a private chat line' })
    await Bun.sleep(1300)
    expect(JSON.stringify(c.got)).not.toContain('a private chat line')

    // Plain HTTP: the snapshot (CORS open) and health; nothing else exists here.
    const r = await fetch(`http://${base}/public/snapshot`)
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
    expect((await r.json()).persona.name).toBe('Flapa')
    expect(await (await fetch(`http://${base}/public/health`)).text()).toBe('ok')
    expect((await fetch(`http://${base}/api/view`)).status).toBe(404)
    c.ws.close()
  } finally {
    live.stop()
  }
})
