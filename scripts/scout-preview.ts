// Runs the wallet scout on live FomoAPI data in a throwaway body: collect, listen to the live stream, score,
// show the radar. No trades: hands is not grown, so nothing can be copied.   bun scripts/scout-preview.ts [listenSec]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fomoApiFromEnv } from '../src/lib/fomoapi'
import { eyes } from '../src/organs/eyes'
import { scout } from '../src/organs/scout'
import { tempBody } from '../tests/helpers'

const listen = Number(process.argv[2] ?? 60)
const api = fomoApiFromEnv(process.env)
if (!api) { console.log('no FOMO_API_KEY in .env'); process.exit(0) }
const body = tempBody()
const dbPath = join(mkdtempSync(join(tmpdir(), 'scout-')), 'wallets.db')
body.grow(eyes(body, fetch, { api }), scout(body, { dbPath, api }))
const s = body.organ('scout') as any
console.log('collect:', (await s.actions.collectNow()).result)
console.log(`listening to the live stream for ${listen}s…`)
await Bun.sleep(listen * 1000)
const v0 = s.view()
console.log('stream:', JSON.stringify(v0.live))
console.log('score:', s.actions.scoreNow().result)
const v = s.view()
for (const [tier, list] of Object.entries(v.radar) as [string, any[]][]) {
  for (const p of list.slice(0, 3)) console.log(`\n[${tier}] ${p.short} score ${p.score} ${p.labels.join(', ')}${p.isLeader ? ` · leads cluster #${p.cluster}` : ''}\n  ${p.reasons.join('\n  ')}`)
}
console.log('\nsummary:', JSON.stringify(v.summary), '\ncounts:', JSON.stringify(v.counts))
s.sleep?.()
process.exit(0)
