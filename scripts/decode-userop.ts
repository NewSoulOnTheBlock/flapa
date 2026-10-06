// Read-only: decodes a 4337 bundle's logs (UserOperationEvent sender/paymaster, every token transfer's from/to/
// amount) and the wallet's native + WBNB balances before and after that block.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const [hash, wallet = '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'] = process.argv.slice(2) as [string, string?]
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  if (j.error) throw new Error(String(j.error.message).replace(/alch_[A-Za-z0-9]+/g, 'alch_…'))
  return j.result
}
const addrOf = (topic: string) => `0x${topic.slice(26)}`
const amt = (hex: string) => Number(BigInt(hex)) / 1e18

const rc = await rpc('eth_getTransactionReceipt', [hash])
for (const l of rc.logs) {
  if (l.topics[0].startsWith('0xddf252ad')) console.log(`Transfer on ${l.address}: ${addrOf(l.topics[1])} → ${addrOf(l.topics[2])}, ${amt(l.data)}`)
  else if (l.topics[0].startsWith('0x49628fd1')) {
    const data = l.data.slice(2)
    const words = Array.from({ length: data.length / 64 }, (_, i) => `0x${data.slice(i * 64, i * 64 + 64)}`)
    console.log(`UserOperationEvent: sender ${addrOf(l.topics[2])}, paymaster ${addrOf(l.topics[3])}, success ${BigInt(words[1]!) === 1n}, gas cost ${amt(words[2]!)} BNB`)
  } else console.log(`other log on ${l.address}: ${l.topics[0].slice(0, 10)}`)
}
const block = parseInt(rc.blockNumber, 16)
const balanceOf = { to: WBNB, data: `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, '0')}` }
for (const [label, b] of [['before', block - 1], ['after', block]] as const) {
  const tag = `0x${b.toString(16)}`
  try {
    const nat = amt(await rpc('eth_getBalance', [wallet, tag]))
    const wb = amt(await rpc('eth_call', [balanceOf, tag]))
    console.log(`${label} (block ${b}): native ${nat} BNB, WBNB ${wb}`)
  } catch (err) { console.log(`${label}: ${String(err).slice(0, 100)}`) }
}
const delegate = '0x' + (await rpc('eth_getCode', [wallet, 'latest'])).slice(8)
const dcode = await rpc('eth_getCode', [delegate, 'latest'])
console.log(`delegate ${delegate}: ${(dcode.length - 2) / 2} bytes of code`)
