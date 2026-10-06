// Read-only: every transfer INTO the trading wallet (native and BEP-20; Alchemy has no internal ones on BNB), via Alchemy's transfers API
// on the person's RPC (BSC_RPC_URL). Prints asset, amount, sender and a BscScan link per transfer.
const addr = process.argv[2] ?? '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'
const RPC = process.env.BSC_RPC_URL
if (!RPC) throw new Error('BSC_RPC_URL is not set')

const r = await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers',
    params: [{ toAddress: addr, category: ['external', 'erc20'], withMetadata: true, order: 'desc', maxCount: '0x14' }],
  }),
})
const j: any = await r.json()
if (j.error) { console.log('error:', String(j.error.message).replace(/alch_[A-Za-z0-9]+/g, 'alch_…').slice(0, 200)); process.exit(0) }
const list = j.result?.transfers ?? []
if (!list.length) console.log('no incoming transfers found')
for (const t of list) {
  console.log(`${t.metadata?.blockTimestamp ?? '?'}  ${t.category.padEnd(8)} ${String(t.value ?? '?').padEnd(10)} ${t.asset ?? '?'}${t.rawContract?.address ? ` (${t.rawContract.address})` : ''}`)
  console.log(`  from ${t.from}  https://bscscan.com/tx/${t.hash}`)
}
