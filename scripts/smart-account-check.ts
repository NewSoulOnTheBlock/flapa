// Read-only: does the fomo wallet behave like eth-infinitism's Simple7702Account on EntryPoint v0.8?
const RPC = process.env.BSC_RPC_URL || 'https://bsc-rpc.publicnode.com'
const wallet = process.argv[2] ?? '0xeEb7E5Ee6B997C2AC72D861a9cccF64Ebae4bED8'
const delegate = '0xe6cae83bde06e4c305530e199d7217f42808555b'
const ep = '0x4337084d9e255ff0702461cf8895ce9e3b5ff108'

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j: any = await r.json()
  return j.error ? `error: ${String(j.error.message).slice(0, 80)}` : j.result
}

console.log('entryPoint() via the wallet:', await rpc('eth_call', [{ to: wallet, data: '0xb0d691fe' }, 'latest']))
const code: string = await rpc('eth_getCode', [delegate, 'latest'])
const selectors: [string, string][] = [
  ['execute(address,uint256,bytes)', 'b61d27f6'],
  ['executeBatch((address,uint256,bytes)[])', '34fcd5be'],
  ['validateUserOp(...)', '19822f7c'],
  ['entryPoint()', 'b0d691fe'],
  ['isValidSignature(bytes32,bytes)', '1626ba7e'],
]
for (const [sig, sel] of selectors) console.log(`${sig.padEnd(42)} ${code.includes(sel) ? 'present' : 'absent'}`)
const word = (hex: string) => hex.padStart(64, '0')
const nonceData = (key: bigint) => `0x35567e1a${word(wallet.slice(2).toLowerCase())}${word(key.toString(16))}`
console.log("EntryPoint nonce, key 0 (fomo's lane):", BigInt(await rpc('eth_call', [{ to: ep, data: nonceData(0n) }, 'latest'])))
