// The skin: a localhost dashboard and its API. Every /api call carries the per-boot token
// baked into the page, so no other website the person visits can drive the body.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Body } from './body'

export function serve(body: Body, opts: { port: number; page: string }) {
  const token = randomBytes(24).toString('hex')
  const ok = (given: string | null) => {
    if (!given || given.length !== token.length) return false
    return timingSafeEqual(Buffer.from(given), Buffer.from(token))
  }
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

  const state = () => ({
    brain: body.brain.kind,
    busy: body.busy,
    chat: body.store('cortex').get(`chat:${body.personaId()}`, []),
    organs: Object.fromEntries(body.organs.map(o => [o.name, { role: o.role, tools: (o.tools ?? []).map(t => t.name), view: o.view?.() ?? null }])),
  })

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/' && req.method === 'GET') {
        // Read on each load so the page can be edited while the body runs.
        return new Response(readFileSync(opts.page, 'utf8').replace('__SOMA_TOKEN__', token), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        })
      }
      if (!url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 })
      if (!ok(req.headers.get('x-soma-token') ?? url.searchParams.get('token'))) return json({ error: 'bad token' }, 401)

      if (url.pathname === '/api/state') return json(state())

      if (url.pathname === '/api/events') {
        let stop = () => {}
        const stream = new ReadableStream({
          start(c) {
            const send = (s: unknown) => c.enqueue(`data: ${JSON.stringify(s)}\n\n`)
            for (const s of body.bus.recent(80)) send(s)
            stop = body.bus.listen(send)
            const ping = setInterval(() => c.enqueue(': ping\n\n'), 25_000)
            const prev = stop
            stop = () => { prev(); clearInterval(ping) }
          },
          cancel() { stop() },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
      }

      if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
      const input = await req.json().catch(() => ({}))

      if (url.pathname === '/api/chat') {
        const text = String(input.text ?? '').trim()
        if (!text) return json({ error: 'say something' }, 400)
        return json(await body.think({ kind: 'chat', text: text.slice(0, 8000), from: 'person' }))
      }

      const [, , organ, action] = url.pathname.split('/')
      const fn = body.has(organ!) ? body.organ(organ!).actions?.[action!] : undefined
      if (!fn) return json({ error: `no action ${organ}/${action}` }, 404)
      try {
        return json({ ok: true, value: await fn(input) })
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 400)
      }
    },
  })
  return { server, token, url: `http://127.0.0.1:${server.port}/` }
}
