// Packs the local state (data/organs/*.json) into state-seed.txt for the FLAPA_SEED variable on a new host.
//   bun scripts/pack-state.ts      -> writes state-seed.txt (git-ignored); paste its contents into Render yourself
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { packState } from '../src/core/seed'

const home = resolve(process.env.FLAPA_HOME || join(import.meta.dir, '..', 'data'))
const files: Record<string, string> = {}
for (const f of readdirSync(join(home, 'organs')).filter(f => f.endsWith('.json'))) files[`organs/${f}`] = readFileSync(join(home, 'organs', f), 'utf8')
const out = join(import.meta.dir, '..', 'state-seed.txt')
const packed = packState(files)
writeFileSync(out, packed)
console.log(`packed ${Object.keys(files).length} files (${packed.length} chars) into state-seed.txt`)
