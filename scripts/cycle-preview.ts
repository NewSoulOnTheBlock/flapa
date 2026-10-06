// Shows what the next trade cycle would do with live market data, without trading.
//   bun scripts/cycle-preview.ts
import { DEFAULT_LIMITS } from '../src/lib/limits'
import { parseGeckoPools, planCycle, rejectReason, score, type Candidate } from '../src/lib/strategy'

const base = 'https://api.geckoterminal.com/api/v2/networks/bsc'
const lists = [`${base}/trending_pools?page=1`, `${base}/dexes/pancakeswap_v2/pools?page=1&sort=h24_volume_usd_desc`, `${base}/dexes/pancakeswap_v2/pools?page=2&sort=h24_volume_usd_desc`]
const all = new Map<string, Candidate>()
for (const u of lists) {
  const r = await fetch(u, { headers: { accept: 'application/json' } })
  if (r.ok) for (const c of parseGeckoPools(await r.json(), Date.now())) all.set(c.token, c)
}
const cands = [...all.values()]
console.log(`${cands.length} v2 WBNB candidates`)
for (const c of cands.sort((a, b) => score(b) - score(a)).slice(0, 12)) {
  console.log(`  ${(rejectReason(c, DEFAULT_LIMITS) ?? 'PASS').padEnd(26)} $${c.symbol.padEnd(12)} 1h ${c.change1hPct.toFixed(1)}% 6h ${c.change6hPct.toFixed(1)}% liq $${Math.round(c.liquidityUsd)} age ${c.ageDays.toFixed(0)}d b/s ${c.buys1h}/${c.sells1h}`)
}
const plan = planCycle({ candidates: cands, positions: [], limits: DEFAULT_LIMITS, day: { day: '', spentBnb: 0, realizedBnb: 0 }, everyHours: 2 })
console.log('\nplan with no open bags:', plan.kind === 'buy' ? `buy ${plan.bnb} BNB, first choice $${plan.options[0]!.symbol} (${plan.options.length} options)` : JSON.stringify(plan))
