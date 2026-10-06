// Read-only: the wallet's native BNB and WBNB just before and at the block of a given transaction.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const [hash, wallet = '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'] = process.argv.slice(2) as [string, string?]
async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  if (j.error) throw new Error(String(j.error.message).replace(/alch_[A-Za-z0-9]+/g, 'alch_…'))
  return j.result
}
const amt = (hex: string) => Number(BigInt(hex)) / 1e18
const rc = await rpc('eth_getTransactionReceipt', [hash])
const block = parseInt(rc.blockNumber, 16)
const wbnbCall = { to: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', data: `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}` }
console.log(`tx ${hash.slice(0, 10)}… in block ${block}, status ${rc.status}, ${rc.logs.length} log(s):`)
for (const l of rc.logs) console.log(`  log on ${l.address} ${l.topics[0].slice(0, 10)}${l.topics[0].startsWith('0xe1fffcc4') ? ' = WBNB Deposit (a wrap)' : ''}`)
for (const [label, b] of [['before', block - 1], ['after', block]] as const) {
  const tag = `0x${b.toString(16)}`
  console.log(`${label}: native ${amt(await rpc('eth_getBalance', [wallet, tag]))} BNB, WBNB ${amt(await rpc('eth_call', [wbnbCall, tag]))}`)
}
