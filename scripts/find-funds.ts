// Read-only: where did the trading wallet's funds land? BNB on two BSC RPCs, common BSC tokens, and the same
// address on other EVM chains people send to by mistake. Prints balances only.
const addr = process.argv[2] ?? '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'

async function rpc(url: string, method: string, params: unknown[]): Promise<string | null> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
    const j: any = await r.json()
    return j.result ?? null
  } catch { return null }
}
const eth = (hex: string | null, dec = 18) => (hex == null ? 'unreachable' : (Number(BigInt(hex)) / 10 ** dec).toFixed(6))
const balanceOf = (token: string) => ({ to: token, data: `0x70a08231${addr.slice(2).toLowerCase().padStart(64, '0')}` })

const native: [string, string][] = [
  ['BNB Chain (bsc-dataseed)', 'https://bsc-dataseed.bnbchain.org'],
  ['BNB Chain (publicnode)', 'https://bsc-rpc.publicnode.com'],
  ['opBNB', 'https://opbnb-mainnet-rpc.bnbchain.org'],
  ['Ethereum', 'https://ethereum-rpc.publicnode.com'],
  ['Base', 'https://mainnet.base.org'],
  ['Arbitrum', 'https://arb1.arbitrum.io/rpc'],
  ['Polygon', 'https://polygon-bor-rpc.publicnode.com'],
  ['Robinhood Chain', 'https://rpc.mainnet.chain.robinhood.com'],
]
for (const [name, url] of native) console.log(`${name.padEnd(26)} native ${eth(await rpc(url, 'eth_getBalance', [addr, 'latest']))}`)

const bscTokens: [string, string, number][] = [
  ['WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 18],
  ['USDT (BSC)', '0x55d398326f99059fF775485246999027B3197955', 18],
  ['USDC (BSC)', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18],
  ['$Flapa', '0xFe59B933944B4d267A14c59020C0eB19a97d7777', 18],
]
for (const [name, token, dec] of bscTokens) console.log(`BNB Chain ${name.padEnd(16)} ${eth(await rpc('https://bsc-rpc.publicnode.com', 'eth_call', [balanceOf(token), 'latest']), dec)}`)
