// Read-only: in a small block range, finds WBNB Deposits (wraps) for the wallet and 4337 UserOperationEvents it sent.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const [fromB, toB, wallet = '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'] = process.argv.slice(2) as [string, string, string?]
async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  if (j.error) throw new Error(String(j.error.message).replace(/alch_[A-Za-z0-9]+/g, 'alch_…'))
  return j.result
}
const topicOf = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`
const queries: [string, string, (string | null)[]][] = [
  ['WBNB Deposit', '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', ['0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c', topicOf(wallet)]],
  ['UserOperationEvent', '0x4337084d9e255ff0702461cf8895ce9e3b5ff108', ['0x49628fd175a4d8d4ebc4e18c6c3e1e2e1d1e2ff1b8ff38bbf06dd6c1e2c14b9b'.slice(0, 66), null, topicOf(wallet)]],
]
for (let b = Number(fromB); b <= Number(toB); b += 10) {
  const range = { fromBlock: `0x${b.toString(16)}`, toBlock: `0x${Math.min(b + 9, Number(toB)).toString(16)}` }
  for (const [label, address, topics] of queries) {
    try {
      const t = label === 'UserOperationEvent' ? [null, null, topics[2]] : topics
      const logs = await rpc('eth_getLogs', [{ ...range, address, topics: t }])
      for (const l of logs) {
        if (label === 'UserOperationEvent' && !l.topics[0].startsWith('0x49628fd1')) continue
        const tx = await rpc('eth_getTransactionByHash', [l.transactionHash])
        console.log(`${label} in block ${parseInt(l.blockNumber, 16)}: tx from ${tx.from} to ${tx.to}, type ${tx.type}\n  https://bscscan.com/tx/${l.transactionHash}`)
      }
    } catch (err) { console.log(`${label} ${b}: ${String(err).slice(0, 120)}`) }
  }
}
