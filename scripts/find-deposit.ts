// Read-only: finds the transfers that funded the trading wallet on BNB Chain (WBNB Transfer logs in recent
// blocks), and shows each transaction's sender, target contract and native value, with a BscScan link.
const addr = (process.argv[2] ?? '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8').toLowerCase()
// The person's own RPC (BSC_RPC_URL in .env, which Bun loads) can search history; the public one cannot.
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const DEPOSIT = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c' // WBNB Deposit(address dst, uint wad)

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}
const topicOf = (a: string) => `0x${a.slice(2).padStart(64, '0')}`
const bnb = (hex: string) => (Number(BigInt(hex)) / 1e18).toFixed(6)

console.log('native BNB now:', bnb(await rpc('eth_getBalance', [addr, 'latest'])))
const head = parseInt(await rpc('eth_blockNumber', []), 16)
const found: any[] = []
// ~1 day of blocks (3s → ~0.75s blocks now), in chunks the public RPC accepts.
for (let to = head; to > head - 120_000 && found.length === 0; to -= 5_000) {
  const from = Math.max(0, to - 4_999)
  for (const [topic0, label] of [[TRANSFER, 'WBNB transfer'], [DEPOSIT, 'WBNB deposit (wrap)']] as const) {
    const topics = topic0 === TRANSFER ? [topic0, null, topicOf(addr)] : [topic0, topicOf(addr)]
    try {
      const logs = await rpc('eth_getLogs', [{ address: WBNB, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }])
      for (const l of logs) found.push({ label, tx: l.transactionHash, block: parseInt(l.blockNumber, 16), amount: bnb(l.data) })
    } catch (err) { console.log(`blocks ${from}-${to}: ${String(err).slice(0, 80)}`) }
  }
}
for (const f of found) {
  const tx = await rpc('eth_getTransactionByHash', [f.tx])
  console.log(`${f.label}: ${f.amount} WBNB · block ${f.block}\n  from ${tx.from} → contract ${tx.to} · native value sent ${bnb(tx.value)} BNB\n  https://bscscan.com/tx/${f.tx}`)
}
if (!found.length) console.log('no WBNB transfers to this wallet in the last ~120k blocks')
