// Runs the wallet scout against live data in a throwaway body: collect (twice), score, show the radar.
// No trades: hands is not grown, so nothing can be copied.   bun scripts/scout-preview.ts [rounds]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eyes } from '../src/organs/eyes'
import { scout } from '../src/organs/scout'
import { tempBody } from '../tests/helpers'

const rounds = Number(process.argv[2] ?? 1)
const body = tempBody()
const dbPath = join(mkdtempSync(join(tmpdir(), 'scout-')), 'wallets.db')
body.grow(eyes(body), scout(body, { dbPath }))
const s = body.organ('scout') as any
for (let i = 0; i < rounds; i++) console.log('collect:', (await s.actions.collectNow()).result)
console.log('score:', s.actions.scoreNow().result)
const v = s.view()
for (const [tier, list] of Object.entries(v.radar) as [string, any[]][]) {
  for (const p of list.slice(0, 3)) console.log(`\n[${tier}] ${p.short} score ${p.score} ${p.labels.join(', ')}${p.isLeader ? ` · leads cluster #${p.cluster}` : ''}\n  ${p.reasons.join('\n  ')}`)
}
console.log('\nsummary:', JSON.stringify(v.summary))
