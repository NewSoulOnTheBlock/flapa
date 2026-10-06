// Read-only: who sent a transaction, to what, with what call, and who paid its gas. Also the wallet's code
// (an EIP-7702 delegation shows up as 0xef0100 + the delegate's address) and its nonce.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const [hash, wallet = '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'] = process.argv.slice(2) as [string, string?]

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  if (j.error) throw new Error(String(j.error.message).replace(/alch_[A-Za-z0-9]+/g, 'alch_…'))
  return j.result
}

const tx = await rpc('eth_getTransactionByHash', [hash])
const rc = await rpc('eth_getTransactionReceipt', [hash])
console.log({
  type: tx.type, from: tx.from, to: tx.to,
  valueBNB: Number(BigInt(tx.value)) / 1e18,
  selector: tx.input.slice(0, 10), inputBytes: (tx.input.length - 2) / 2,
  authorizationList: tx.authorizationList?.map((a: any) => ({ address: a.address, nonce: a.nonce })) ?? null,
  status: rc.status, gasPaidBNB: Number(BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice)) / 1e18,
  logs: rc.logs.map((l: any) => ({ contract: l.address, topic0: l.topics[0]?.slice(0, 10), topics: l.topics.length })),
})
const code = await rpc('eth_getCode', [wallet, 'latest'])
const nonce = parseInt(await rpc('eth_getTransactionCount', [wallet, 'latest']), 16)
console.log({ wallet, nonce, code: code === '0x' ? 'none (plain wallet)' : code.startsWith('0xef0100') ? `EIP-7702 delegated to 0x${code.slice(8)}` : `contract code (${(code.length - 2) / 2} bytes)` })
