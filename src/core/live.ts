// The live window: a public, read-only WebSocket that pushes the same allow-listed snapshot the blob carries,
// the moment something changes, plus each public thought as it happens. It is a separate server from the
// dashboard: no controls, no token, no private routes, and it ignores anything a client sends.
//
//   GET /public/ws        WebSocket: {type:'snapshot', data} on connect and on every change (at most ~1/s),
//                         {type:'thought', data} instantly, {type:'alive', at} every 20 s
//   GET /public/snapshot  the current snapshot as JSON (CORS open)
//   GET /public/health    ok
import type { Server } from 'bun'
import type { Body } from './body'
import { publicSnapshot, ThoughtLog } from './publish'

const PUSH_EVERY_MS = 1000
const ALIVE_EVERY_MS = 20_000
const MAX_CLIENTS = 300

export type LiveOptions = { port: number; hostname?: string; stream?: string }

export function startLive(body: Body, opts: LiveOptions): { server: Server<undefined>; stop: () => void; clients: () => number } {
  const log = new ThoughtLog()
  for (const s of body.bus.recent(300)) log.see(s)
  const snapshot = () => publicSnapshot(body, log.items, Date.now(), opts.stream)
  let clients = 0
  let lastKey = ''
  let pending: ReturnType<typeof setTimeout> | null = null
  let lastPush = 0

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.hostname ?? '0.0.0.0',
    fetch(req, srv) {
      const path = new URL(req.url).pathname
      const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
      if (path === '/public/ws') {
        if (clients >= MAX_CLIENTS) return new Response('too many viewers right now', { status: 503 })
        return srv.upgrade(req) ? undefined : new Response('expected a websocket', { status: 400 })
      }
      if (path === '/public/snapshot') return Response.json(snapshot(), { headers: cors })
      if (path === '/public/health') return new Response('ok', { headers: cors })
      return new Response('not found', { status: 404 })
    },
    websocket: {
      open(ws) {
        clients++
        ws.subscribe('public')
        ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() }))
      },
      message() { /* read-only: nothing a viewer sends is ever read */ },
      close(ws) { clients = Math.max(0, clients - 1); ws.unsubscribe('public') },
    },
  })

  const pushSnapshot = () => {
    pending = null
    if (!clients) return
    const snap = snapshot()
    const { at: _at, ...rest } = snap
    const key = JSON.stringify(rest)
    if (key === lastKey) return
    lastKey = key
    lastPush = Date.now()
    server.publish('public', JSON.stringify({ type: 'snapshot', data: snap }))
  }
  // Coalesce bursts: the first change goes out within a second, the rest ride along.
  const schedule = () => {
    if (pending) return
    pending = setTimeout(pushSnapshot, Math.max(0, PUSH_EVERY_MS - (Date.now() - lastPush)))
  }
  const unlisten = body.bus.listen(s => {
    const before = log.items.at(-1)
    log.see(s)
    const after = log.items.at(-1)
    if (after && after !== before && clients) server.publish('public', JSON.stringify({ type: 'thought', data: after }))
    schedule()
  })
  const alive = setInterval(() => { if (clients) server.publish('public', JSON.stringify({ type: 'alive', at: Date.now() })) }, ALIVE_EVERY_MS)

  return {
    server,
    clients: () => clients,
    stop: () => { unlisten(); clearInterval(alive); if (pending) clearTimeout(pending); server.stop(true) },
  }
}
