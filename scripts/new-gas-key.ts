// Makes Flapa's gas wallet for fomo mode: a brand-new key written straight into .env (git-ignored), never
// printed. Also sets FLAPA_WALLET_MODE=fomo. Prints only the new address, which is what gets funded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const file = new URL('../.env', import.meta.url)
const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : []
if (lines.some(l => l.startsWith('FLAPA_GAS_KEY='))) {
  const key = lines.find(l => l.startsWith('FLAPA_GAS_KEY='))!.slice('FLAPA_GAS_KEY='.length).trim()
  console.log(`a gas wallet already exists: ${privateKeyToAccount(key as `0x${string}`).address} (left unchanged)`)
} else {
  const key = generatePrivateKey()
  const kept = lines.filter(l => !l.startsWith('FLAPA_WALLET_MODE='))
  writeFileSync(file, [...kept, `FLAPA_GAS_KEY=${key}`, 'FLAPA_WALLET_MODE=fomo', ''].join('\n'))
  console.log(`gas wallet created: ${privateKeyToAccount(key).address}`)
}
console.log('fund it with a little native BNB on BNB Chain (0.005 BNB covers well over 100 trades).')
