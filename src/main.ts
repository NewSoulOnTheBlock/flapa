// P.A.C.S: grow the organs, wake the body, open the skin.
import { join, resolve } from 'node:path'
import { Body } from './core/body'
import { pickBrain } from './core/brain'
import { startLive } from './core/live'
import { startPublishing } from './core/publish'
import { mem0FromEnv } from './lib/mem0'
import { fomoApiFromEnv } from './lib/fomoapi'
import { applySeed } from './core/seed'
import { serve } from './core/server'
import { affect } from './organs/affect'
import { agenda } from './organs/agenda'
import { beliefs } from './organs/beliefs'
import { conscience } from './organs/conscience'
import { eyes } from './organs/eyes'
import { hands, nodeHelper } from './organs/hands'
import { scout } from './organs/scout'
import { identity } from './organs/identity'
import { memory } from './organs/memory'
import { voice } from './organs/voice'

const root = resolve(import.meta.dir, '..')
const home = resolve(process.env.FLAPA_HOME || join(root, 'data'))
const seeded = applySeed(home, process.env.FLAPA_SEED)
if (seeded.length) console.log(`[pacs] seeded ${seeded.length} state files into ${home}`)
const body = new Body({ home, brain: pickBrain() })
const fomo = fomoApiFromEnv(process.env)

// Order is prompt order: who you are first (cached), then the slow-changing, then the moment.
body.grow(
  // Personas live with the state, not the code: P.A.C.S ships blank and the forge writes the first one.
  identity(body, join(home, 'personas')),
  conscience(body),
  beliefs(body),
  agenda(body),
  affect(body),
  memory(body, { mem0: mem0FromEnv(process.env) }),
  eyes(body, fetch, { api: fomo }),
  voice(body, { catalogDir: join(home, 'personas') }),
  hands(body, nodeHelper(root)),
  scout(body, { api: fomo }),
)

body.bus.listen(s => {
  if (s.type === 'turn.start' || s.type === 'turn.done' || s.type.startsWith('act.') || s.type.endsWith('.error')) {
    const d = s.data as any
    console.log(`[${new Date(s.at).toLocaleTimeString()}] ${s.from} ${s.type}`, d?.kind ?? d?.summary ?? d?.error ?? '')
  }
})

const { url } = serve(body, { port: Number(process.env.FLAPA_PORT || 7777), page: join(root, 'web', 'index.html') })
body.wake()

// The public window on Vercel: only when a Blob token is set (in .env, which Bun loads; never committed).
// The live window: a public read-only WebSocket. On Render (a web service) PORT and RENDER_EXTERNAL_URL are set;
// elsewhere set FLAPA_PUBLIC_PORT, and FLAPA_PUBLIC_URL to the address viewers can reach.
const publicPort = Number(process.env.PORT || process.env.FLAPA_PUBLIC_PORT || 0)
const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.FLAPA_PUBLIC_URL || (publicPort ? `http://localhost:${publicPort}` : '')
const stream = publicUrl ? `${publicUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/public/ws` : undefined
if (publicPort) {
  startLive(body, { port: publicPort, stream })
  console.log(`Live window: ${stream}`)
}
if (process.env.BLOB_READ_WRITE_TOKEN) {
  startPublishing(body, process.env.BLOB_READ_WRITE_TOKEN, undefined, stream)
  console.log('Publishing a public read-only snapshot every minute (the page falls back to it when the live window is unreachable).')
}
console.log(`P.A.C.S is awake · brain: ${body.brain.kind} · ${body.organs.length} organs · ${url}`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { body.sleep(); process.exit(0) })
