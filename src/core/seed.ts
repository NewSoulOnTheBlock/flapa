// One-time state seeding for a fresh host. FLAPA_SEED is base64 JSON {"organs/voice.json": "<file text>", ...},
// made by scripts/pack-state.ts. It is applied only when the home has no organ files yet, so a restart
// with the variable still set never overwrites state the daemon has written since.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'

export function packState(files: Record<string, string>): string {
  return Buffer.from(JSON.stringify(files), 'utf8').toString('base64')
}

export function applySeed(home: string, seed: string | undefined): string[] {
  if (!seed) return []
  const organs = join(home, 'organs')
  if (existsSync(organs) && readdirSync(organs).some(f => f.endsWith('.json'))) return []
  const files = JSON.parse(Buffer.from(seed, 'base64').toString('utf8')) as Record<string, string>
  const written: string[] = []
  for (const [rel, text] of Object.entries(files)) {
    const clean = normalize(rel)
    if (clean.startsWith('..') || clean.startsWith(sep) || !clean.endsWith('.json')) throw new Error(`bad seed path: ${rel}`)
    JSON.parse(text)
    const path = join(home, clean)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    written.push(clean)
  }
  return written
}
