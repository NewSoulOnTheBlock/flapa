// Flapa: grow the organs, wake the body, open the skin.
import { join, resolve } from 'node:path'
import { Body } from './core/body'
import { pickBrain } from './core/brain'
import { startPublishing } from './core/publish'
import { serve } from './core/server'
import { affect } from './organs/affect'
import { agenda } from './organs/agenda'
import { beliefs } from './organs/beliefs'
import { conscience } from './organs/conscience'
import { eyes } from './organs/eyes'
import { hands, nodeHelper } from './organs/hands'
import { identity } from './organs/identity'
import { memory } from './organs/memory'
import { voice } from './organs/voice'

const root = resolve(import.meta.dir, '..')
const body = new Body({ home: resolve(process.env.FLAPA_HOME || join(root, 'data')), brain: pickBrain() })

// Order is prompt order: who you are first (cached), then the slow-changing, then the moment.
body.grow(
  identity(body, join(root, 'personas')),
  conscience(body),
  beliefs(body),
  agenda(body),
  affect(body),
  memory(body),
  eyes(body),
  voice(body),
  hands(body, nodeHelper(root)),
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
if (process.env.BLOB_READ_WRITE_TOKEN) {
  startPublishing(body, process.env.BLOB_READ_WRITE_TOKEN)
  console.log('Publishing a public read-only snapshot every minute.')
}
console.log(`Flapa is awake · brain: ${body.brain.kind} · ${body.organs.length} organs · ${url}`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { body.sleep(); process.exit(0) })
