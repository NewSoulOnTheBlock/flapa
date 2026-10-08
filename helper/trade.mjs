// The only code that touches the trading wallet's key. One command per run:
//
//   node trade.mjs <command> '<json args>'   →  one line of JSON on stdout
//
//   address                                       the wallet's address (and the gas wallet's, in fomo mode)
//   balance  {token?}                             trading balance (BNB, or WBNB in fomo mode), token balance
//   quote    {side, token, amountWei}             PancakeSwap v2 quote, no key needed
//   buy      {token, bnbWei, minOutWei, dryRun?}  swap BNB (or WBNB) → token
//   sell     {token, amountWei, minBnbWei, dryRun?}  swap token → BNB (or WBNB); approves exactly that amount
//   send     {to, amountWei | all, dryRun?}       send funds out to `to` (fomo mode unwraps WBNB in the same operation)
//   holdings {tokens}                             funds, gas, the named tokens' balances, and any others the RPC can list
//
// Two wallet modes:
//   plain (default)        a normal wallet that holds native BNB and pays its own gas.
//   fomo (FLAPA_WALLET_MODE=fomo)  the person's fomo.family wallet: an EIP-7702 Simple7702Account on
//       EntryPoint v0.8 that holds WBNB (fomo wraps incoming BNB) and no native BNB. Trades are user operations
//       signed with FLAPA_TRADER_KEY on Flapa's own nonce lane, with a gas price of 0 inside, submitted through
//       EntryPoint by a separate gas wallet (FLAPA_GAS_KEY) that pays the outer transaction's few cents of gas.
//       Every operation but a buy is simulated as the wallet itself first; its success flag is checked after.
//
// Hard-coded on purpose: BNB Chain (56), PancakeSwap v2's router, WBNB, EntryPoint v0.8 and the Simple7702
// implementation. Keys come from the environment only and are never printed. FLAPA_TRADER_MAX_BNB (default
// 0.1) caps one buy here, below the mod, so no bug or prompt upstream can spend more in one go.
import {
  createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatEther, getAddress, http, isAddress,
  parseAbi, parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { entryPoint08Abi, entryPoint08Address, toPackedUserOperation, toSimple7702SmartAccount } from 'viem/account-abstraction'
import { bsc } from 'viem/chains'

const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
const SIMPLE7702 = '0xe6Cae83BdE06E4c305530e199D7217f42808555B'
const RPC = process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org'
const MAX_BUY = parseEther(process.env.FLAPA_TRADER_MAX_BNB || '0.1')
const SMART = process.env.FLAPA_WALLET_MODE === 'fomo'
/** The harness's own EntryPoint nonce lane, so its operations never collide with fomo's. The value spells "FLAPA"
 * (the harness's first name): changing it would move every operation to a fresh lane, so it stays. */
const LANE = 0x464c415041n
const MIN_GAS_WEI = parseEther('0.0003')
const DEADLINE_S = 120n

const routerAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const wbnbAbi = parseAbi(['function withdraw(uint256 wad)'])

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

function keyAccount(name) {
  const key = process.env[name]
  if (!key) fail(`${name} is not set in the environment`)
  try { return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`) } catch { fail(`${name} is not a valid private key`) }
}

function wallet() {
  const account = keyAccount('FLAPA_TRADER_KEY')
  return { account, client: createWalletClient({ account, chain: bsc, transport: http(RPC) }) }
}

function gasWallet() {
  const account = keyAccount('FLAPA_GAS_KEY')
  return { account, client: createWalletClient({ account, chain: bsc, transport: http(RPC) }) }
}

const big = (v, name) => {
  try { const b = BigInt(v); if (b <= 0n) throw 0; return b } catch { fail(`${name} must be a positive integer string`) }
}
const deadline = async () => (await pub.getBlock()).timestamp + DEADLINE_S

async function bnbOf(a) { return pub.getBalance({ address: a }) }
async function tokOf(t, a) { return pub.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [a] }) }

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/**
 * What `to` received of token `t` in a receipt, summed from its Transfer logs. A balance read right
 * after the receipt can come from a node a block behind and say 0 (it did, 2026-10-06, on a $BOB buy).
 */
function receivedIn(receipt, t, to) {
  const want = `0x${to.toLowerCase().slice(2).padStart(64, '0')}`
  let sum = 0n
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== t.toLowerCase() || l.topics[0] !== TRANSFER || l.topics[2]?.toLowerCase() !== want) continue
    sum += BigInt(l.data)
  }
  return sum
}
/** Logs first; the balance difference only when the logs show nothing (a token with odd events). */
async function gained(receipt, t, to, before) {
  const fromLogs = receivedIn(receipt, t, to)
  return fromLogs > 0n ? fromLogs : (await tokOf(t, to)) - before
}
/** What the wallet trades with: native BNB, or WBNB in fomo mode. */
async function fundsOf(a) { return SMART ? tokOf(WBNB, a) : bnbOf(a) }

const call = (to, abi, functionName, fnArgs) => ({ to, value: 0n, data: encodeFunctionData({ abi, functionName, args: fnArgs }) })

/** The calls for an exact-amount approval, when the current allowance is short. Never unlimited. */
async function approveIfNeeded(tok, owner, amount) {
  const allowance = await pub.readContract({ address: tok, abi: erc20Abi, functionName: 'allowance', args: [owner, ROUTER] })
  return allowance < amount ? [call(tok, erc20Abi, 'approve', [ROUTER, amount])] : []
}

/**
 * Runs calls as the fomo smart account: simulate as the wallet, sign a user operation (gas price 0) on
 * the harness's lane, submit it through EntryPoint from the gas wallet, and check the operation's own success flag.
 */
async function smartExec(calls, dryRun, { precheck = true } = {}) {
  const owner = keyAccount('FLAPA_TRADER_KEY')
  const code = (await pub.getCode({ address: owner.address })) ?? '0x'
  if (code.toLowerCase() !== `0xef0100${SIMPLE7702.slice(2).toLowerCase()}`) {
    fail('fomo mode: the wallet is not a Simple7702 smart account (expected the fomo.family delegation)')
  }
  const sa = await toSimple7702SmartAccount({ client: pub, owner })
  const callData = await sa.encodeCalls(calls)

  // 1. The whole batch, as the wallet itself (the account allows calls from itself): a revert stops here.
  // Buys skip it at the person's request (2026-10-06): they go straight out, and a failing swap shows up
  // as success=false in step 4, after the gas is paid.
  if (precheck || dryRun) {
    try { await pub.call({ account: owner.address, to: owner.address, data: callData }) } catch (err) {
      fail(`simulation reverted: ${String(err?.shortMessage ?? err?.message ?? err).slice(0, 200)}`)
    }
  }

  // 2. Sign, on the harness's own nonce lane. Gas price 0 inside: the wallet needs no native BNB and prefunds nothing.
  const nonce = await sa.getNonce({ key: LANE })
  const userOp = {
    sender: owner.address, nonce, callData,
    callGasLimit: 900_000n, verificationGasLimit: 200_000n, preVerificationGas: 60_000n,
    maxFeePerGas: 0n, maxPriorityFeePerGas: 0n, signature: '0x',
  }
  userOp.signature = await sa.signUserOperation(userOp)
  const packed = toPackedUserOperation(userOp)

  // 3. Through EntryPoint, from the gas wallet; simulated again there, which also checks the signature.
  const gas = gasWallet()
  const gasBal = await bnbOf(gas.account.address)
  // A dry run simulates even with an empty gas wallet (a simulation costs nothing); a real one needs the gas.
  if (!dryRun && gasBal < MIN_GAS_WEI) fail(`the gas wallet ${gas.account.address} holds ${formatEther(gasBal)} BNB; send it at least ${formatEther(MIN_GAS_WEI)} BNB`)
  let request
  try {
    ;({ request } = await pub.simulateContract({
      account: gas.account, address: entryPoint08Address, abi: entryPoint08Abi,
      functionName: 'handleOps', args: [[packed], gas.account.address],
    }))
  } catch (err) {
    fail(`EntryPoint simulation failed (signature, nonce or gas): ${String(err?.shortMessage ?? err?.message ?? err).slice(0, 200)}`)
  }
  if (dryRun) return { dryRun: true, simulated: true, calls: calls.length, gasReady: gasBal >= MIN_GAS_WEI }
  const hash = await gas.client.writeContract(request)
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') fail(`handleOps reverted: ${hash}`)

  // 4. handleOps succeeds even when the operation inside fails: its own event says which.
  let ok = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== entryPoint08Address.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: entryPoint08Abi, data: log.data, topics: log.topics })
      if (ev.eventName === 'UserOperationEvent' && ev.args.sender.toLowerCase() === owner.address.toLowerCase()) ok = ev.args.success
    } catch { /* another event */ }
  }
  if (ok !== true) fail(`the operation inside failed (${ok === null ? 'no UserOperationEvent' : 'success=false'}): ${hash}`)
  return { hash, receipt, gasWei: receipt.gasUsed * receipt.effectiveGasPrice }
}

async function main() {
  try { args = JSON.parse(raw) } catch { fail('arguments are not JSON') }
  const chainId = await pub.getChainId()
  if (chainId !== 56) fail(`RPC is on chain ${chainId}, not BNB Chain (56)`)

  switch (cmd) {
    case 'address': {
      const r = { address: wallet().account.address, mode: SMART ? 'fomo' : 'plain' }
      if (SMART && process.env.FLAPA_GAS_KEY) r.gasWallet = gasWallet().account.address
      return out(r)
    }
    case 'balance': {
      const { account } = wallet()
      const r = { address: account.address, mode: SMART ? 'fomo' : 'plain', bnbWei: await fundsOf(account.address), nativeWei: await bnbOf(account.address) }
      if (SMART && process.env.FLAPA_GAS_KEY) {
        const g = gasWallet().account.address
        r.gasWallet = g
        r.gasWei = await bnbOf(g)
      }
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
      if (SMART) {
        const owner = keyAccount('FLAPA_TRADER_KEY').address
        const have = await tokOf(WBNB, owner)
        if (have < value) fail(`the fomo wallet holds ${formatEther(have)} WBNB, under the ${formatEther(value)} this buy needs`)
        const before = await tokOf(t, owner)
        const calls = [
          ...(await approveIfNeeded(WBNB, owner, value)),
          call(ROUTER, routerAbi, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [value, minOut, [WBNB, t], owner, await deadline()]),
        ]
        const r = await smartExec(calls, args.dryRun === true, { precheck: false })
        if (r.dryRun) return out(r)
        return out({ hash: r.hash, tokensWei: await gained(r.receipt, t, owner, before), gasWei: r.gasWei })
      }
      const { account, client } = wallet()
      if ((await bnbOf(account.address)) < value + parseEther('0.002')) fail('not enough BNB for the trade plus gas')
      const before = await tokOf(t, account.address)
      const buyCall = {
        account, address: ROUTER, abi: routerAbi, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
        args: [minOut, [WBNB, t], account.address, await deadline()], value,
      }
      if (args.dryRun === true) { await pub.simulateContract(buyCall); return out({ dryRun: true, simulated: true }) }
      // No simulation and a fixed gas limit (estimating would simulate): the buy goes straight out.
      const hash = await client.writeContract({ ...buyCall, gas: 500_000n })
      const receipt = await pub.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') fail(`buy reverted: ${hash}`)
      return out({ hash, tokensWei: await gained(receipt, t, account.address, before), gasWei: receipt.gasUsed * receipt.effectiveGasPrice })
    }
    case 'sell': {
      const t = token()
      const amount = big(args.amountWei, 'amountWei')
      const minBnb = BigInt(args.minBnbWei ?? '0')
      if (SMART) {
        const owner = keyAccount('FLAPA_TRADER_KEY').address
        const held = await tokOf(t, owner)
        if (held < amount) fail(`holds ${held} of that token, asked to sell ${amount}`)
        const before = await tokOf(WBNB, owner)
        const calls = [
          ...(await approveIfNeeded(t, owner, amount)),
          call(ROUTER, routerAbi, 'swapExactTokensForTokensSupportingFeeOnTransferTokens', [amount, minBnb, [t, WBNB], owner, await deadline()]),
        ]
        const r = await smartExec(calls, args.dryRun === true)
        if (r.dryRun) return out(r)
        return out({ hash: r.hash, bnbWei: await gained(r.receipt, WBNB, owner, before), gasWei: r.gasWei })
      }
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
    case 'send': {
      // Funds out of the wallet, to an address the person gave. `all` lets the helper read the exact balance.
      if (!isAddress(args.to ?? '')) fail('to must be a 0x address')
      const to = getAddress(args.to)
      if (SMART) {
        // Unwrap WBNB and send native BNB in one operation, so fomo's backend can't re-wrap it in between.
        const owner = keyAccount('FLAPA_TRADER_KEY').address
        const have = await tokOf(WBNB, owner)
        const amount = args.all === true ? have : big(args.amountWei, 'amountWei')
        if (amount <= 0n) fail('the fomo wallet holds no WBNB to send')
        if (have < amount) fail(`the fomo wallet holds ${formatEther(have)} WBNB, under the ${formatEther(amount)} asked`)
        const calls = [call(WBNB, wbnbAbi, 'withdraw', [amount]), { to, value: amount, data: '0x' }]
        const before = await bnbOf(to)
        const r = await smartExec(calls, args.dryRun === true)
        if (r.dryRun) return out({ ...r, amountWei: amount })
        return out({ hash: r.hash, to, sentWei: (await bnbOf(to)) - before, gasWei: r.gasWei })
      }
      // A plain wallet pays its own gas: `all` keeps back twice the estimated cost of this transfer.
      const { account, client } = wallet()
      const have = await bnbOf(account.address)
      const gasPrice = await pub.getGasPrice()
      const gas = await pub.estimateGas({ account, to, value: 1n })
      const reserve = gas * gasPrice * 2n
      const amount = args.all === true ? have - reserve : big(args.amountWei, 'amountWei')
      if (amount <= 0n) fail(`the wallet holds ${formatEther(have)} BNB, not more than the gas it needs`)
      if (have < amount + reserve) fail(`the wallet holds ${formatEther(have)} BNB, under ${formatEther(amount)} plus gas`)
      if (args.dryRun === true) return out({ dryRun: true, simulated: true, amountWei: amount })
      const hash = await client.sendTransaction({ to, value: amount, gas, gasPrice })
      const receipt = await pub.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') fail(`send reverted: ${hash}`)
      return out({ hash, to, sentWei: amount, gasWei: receipt.gasUsed * receipt.effectiveGasPrice })
    }
    case 'holdings': {
      // What the wallet really holds: trading funds, gas, each named token, and (when the RPC is Alchemy's)
      // every other token it can see, so records that drifted from the chain get caught.
      const owner = SMART ? keyAccount('FLAPA_TRADER_KEY').address : wallet().account.address
      const tokens = {}
      for (const raw of Array.isArray(args.tokens) ? args.tokens.slice(0, 50) : []) {
        if (!isAddress(raw)) continue
        tokens[getAddress(raw).toLowerCase()] = await tokOf(getAddress(raw), owner)
      }
      const r = { address: owner, mode: SMART ? 'fomo' : 'plain', fundsWei: await fundsOf(owner), tokens, minGasWei: MIN_GAS_WEI }
      if (SMART && process.env.FLAPA_GAS_KEY) r.gasWei = await bnbOf(gasWallet().account.address)
      try {
        const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [owner, 'erc20'] }) })
        const j = await res.json()
        if (Array.isArray(j?.result?.tokenBalances)) {
          r.discovered = {}
          for (const b of j.result.tokenBalances) {
            const a = String(b.contractAddress).toLowerCase()
            const v = BigInt(b.tokenBalance ?? '0x0')
            if (v > 0n && a !== WBNB.toLowerCase()) r.discovered[a] = v
          }
        }
      } catch { /* not an Alchemy RPC: only the named tokens are checked */ }
      return out(r)
    }
    default:
      fail(`unknown command ${cmd}`)
  }
}

main().catch(err => out({ error: String(err?.shortMessage ?? err?.message ?? err).slice(0, 300) }))
