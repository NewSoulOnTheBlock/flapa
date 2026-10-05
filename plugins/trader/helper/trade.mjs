// The only code that touches the trading wallet's key. One command per run:
//
//   node trade.mjs <command> '<json args>'   →  one line of JSON on stdout
//
//   address                                 the wallet's address
//   balance  {token?}                       BNB (and token) balance
//   quote    {side, token, amountWei}       PancakeSwap v2 quote, no key needed
//   buy      {token, bnbWei, minOutWei}     swap BNB → token
//   sell     {token, amountWei, minBnbWei}  swap token → BNB (approves exactly that amount)
//
// Hard-coded on purpose: BNB Chain (56), PancakeSwap v2's router, WBNB. The key
// comes from FLAPA_TRADER_KEY in the environment and nowhere else; it is never
// printed. FLAPA_TRADER_MAX_BNB (default 0.1) caps one buy here, below the mod,
// so no bug or prompt upstream can spend more in one go.
import {
  createPublicClient, createWalletClient, formatEther, getAddress, http, isAddress, parseAbi, parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bsc } from 'viem/chains'

const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org'
const MAX_BUY = parseEther(process.env.FLAPA_TRADER_MAX_BNB || '0.1')
const DEADLINE_S = 120n

const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const out = v => process.stdout.write(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)) + '\n')
// A refusal is thrown to main and printed there: process.exit() mid-flight trips
// a libuv assertion on Windows.
class Refusal extends Error {}
const fail = msg => { throw new Refusal(msg) }

const [cmd, raw = '{}'] = process.argv.slice(2)
let args = {}

const pub = createPublicClient({ chain: bsc, transport: http(RPC) })

function token() {
  if (!isAddress(args.token ?? '')) fail('token must be a 0x address')
  const t = getAddress(args.token)
  if (t === getAddress(WBNB)) fail('that is WBNB itself')
  return t
}

function wallet() {
  const key = process.env.FLAPA_TRADER_KEY
  if (!key) fail('FLAPA_TRADER_KEY is not set in the environment')
  let account
  try { account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`) } catch { fail('FLAPA_TRADER_KEY is not a valid private key') }
  return { account, client: createWalletClient({ account, chain: bsc, transport: http(RPC) }) }
}

const big = (v, name) => {
  try { const b = BigInt(v); if (b <= 0n) throw 0; return b } catch { fail(`${name} must be a positive integer string`) }
}
const deadline = async () => (await pub.getBlock()).timestamp + DEADLINE_S

async function bnbOf(a) { return pub.getBalance({ address: a }) }
async function tokOf(t, a) { return pub.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [a] }) }

async function main() {
  try { args = JSON.parse(raw) } catch { fail('arguments are not JSON') }
  const chainId = await pub.getChainId()
  if (chainId !== 56) fail(`RPC is on chain ${chainId}, not BNB Chain (56)`)

  switch (cmd) {
    case 'address': {
      return out({ address: wallet().account.address })
    }
    case 'balance': {
      const { account } = wallet()
      const r = { address: account.address, bnbWei: await bnbOf(account.address) }
      if (args.token) {
        const t = token()
        r.tokenWei = await tokOf(t, account.address)
        r.decimals = await pub.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' })
      }
      return out(r)
    }
    case 'quote': {
      const t = token()
      const amountIn = big(args.amountWei, 'amountWei')
      const path = args.side === 'sell' ? [t, WBNB] : [WBNB, t]
      const amounts = await pub.readContract({ address: ROUTER, abi: routerAbi, functionName: 'getAmountsOut', args: [amountIn, path] })
      const [decimals, symbol] = await Promise.all([
        pub.readContract({ address: t, abi: erc20Abi, functionName: 'decimals' }),
        pub.readContract({ address: t, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?'),
      ])
      return out({ amountOutWei: amounts[1], decimals, symbol })
    }
    case 'buy': {
      const t = token()
      const value = big(args.bnbWei, 'bnbWei')
      if (value > MAX_BUY) fail(`refused: ${formatEther(value)} BNB is over the helper's cap of ${formatEther(MAX_BUY)} BNB (FLAPA_TRADER_MAX_BNB)`)
      const minOut = big(args.minOutWei, 'minOutWei')
      const { account, client } = wallet()
      if ((await bnbOf(account.address)) < value + parseEther('0.002')) fail('not enough BNB for the trade plus gas')
      const before = await tokOf(t, account.address)
      const { request } = await pub.simulateContract({
        account, address: ROUTER, abi: routerAbi, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [minOut, [WBNB, t], account.address, await deadline()], value,
      })
      const hash = await client.writeContract(request)
      const receipt = await pub.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') fail(`buy reverted: ${hash}`)
      const after = await tokOf(t, account.address)
      return out({ hash, tokensWei: after - before, gasWei: receipt.gasUsed * receipt.effectiveGasPrice })
    }
    case 'sell': {
      const t = token()
      const amount = big(args.amountWei, 'amountWei')
      const minBnb = BigInt(args.minBnbWei ?? '0')
      const { account, client } = wallet()
      const held = await tokOf(t, account.address)
      if (held < amount) fail(`holds ${held} of that token, asked to sell ${amount}`)
      let gas = 0n
      const allowance = await pub.readContract({ address: t, abi: erc20Abi, functionName: 'allowance', args: [account.address, ROUTER] })
      if (allowance < amount) {
        // Exactly this sale's amount: never an unlimited approval.
        const { request } = await pub.simulateContract({ account, address: t, abi: erc20Abi, functionName: 'approve', args: [ROUTER, amount] })
        const ah = await client.writeContract(request)
        const ar = await pub.waitForTransactionReceipt({ hash: ah })
        if (ar.status !== 'success') fail(`approve reverted: ${ah}`)
        gas += ar.gasUsed * ar.effectiveGasPrice
      }
      const before = await bnbOf(account.address)
      const { request } = await pub.simulateContract({
        account, address: ROUTER, abi: routerAbi, functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
        args: [amount, minBnb, [t, WBNB], account.address, await deadline()],
      })
      const hash = await client.writeContract(request)
      const receipt = await pub.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') fail(`sell reverted: ${hash}`)
      const swapGas = receipt.gasUsed * receipt.effectiveGasPrice
      const after = await bnbOf(account.address)
      return out({ hash, bnbWei: after - before + swapGas, gasWei: gas + swapGas })
    }
    default:
      fail(`unknown command ${cmd}`)
  }
}

main().catch(err => out({ error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 300) }))
