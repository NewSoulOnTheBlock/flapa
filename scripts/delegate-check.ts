// Read-only: is a contract a cross-chain deployment (same address and code on many chains, typical of wallet
// vendors' smart accounts) or a one-off? Also checks the 7702 authorization in the set-code tx.
const delegate = process.argv[2] ?? '0xe6cae83bde06e4c305530e199d7217f42808555b'
const setCodeTx = process.argv[3] ?? '0x98afd182caddf120e62a7ecc1e4cb485337116dbb08f526d74b12f61694e5c56'
const chains: [string, string][] = [
  ['BNB Chain', process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'],
  ['Ethereum', 'https://ethereum-rpc.publicnode.com'],
  ['Base', 'https://mainnet.base.org'],
  ['Arbitrum', 'https://arb1.arbitrum.io/rpc'],
  ['Polygon', 'https://polygon-bor-rpc.publicnode.com'],
  ['Optimism', 'https://mainnet.optimism.io'],
]
async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
    return (await r.json() as any).result ?? null
  } catch { return null }
}
let bsc = ''
for (const [name, url] of chains) {
  const code: string | null = await rpc(url, 'eth_getCode', [delegate, 'latest'])
  if (name === 'BNB Chain') bsc = code ?? ''
  console.log(`${name.padEnd(10)} ${code == null ? 'unreachable' : code === '0x' ? 'no code' : `${(code.length - 2) / 2} bytes${code === bsc ? ' (identical to BNB Chain)' : ''}`}`)
}
const tx = await rpc(chains[0]![1], 'eth_getTransactionByHash', [setCodeTx])
console.log('authorizations in the set-code tx:', JSON.stringify(tx?.authorizationList?.map((a: any) => ({ delegate: a.address, chainId: parseInt(a.chainId, 16), nonce: parseInt(a.nonce, 16) })) ?? null))
