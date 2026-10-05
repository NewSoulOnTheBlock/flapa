import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CopySignal, Position, TradeDay, TradeLimits, TradeMode, TradeRecord, TradeSource } from '../types'
import {
  DEFAULT_LIMITS, LIMIT_RANGE, buyRefusals, copySignals, exitFor, fromWei, minOut, shareOf, toWei, today,
} from './limits'
import { dexUrl, marketLine, pickPool } from './market'
import type { Market } from './market'

const PANE = 'trade'
const TRADE = 'mcp__trader__trade'
const MARKET = 'mcp__trader__market'
const PORTFOLIO = 'mcp__trader__portfolio'
const DIAL = { plugin: 'guardrails', key: 'dial' } as const
const PERSONA = { plugin: 'persona-core', key: 'active' } as const
const FOMO_MCP_URL = 'https://fomomcp.app/mcp'
const EXIT_EVERY_MS = 2 * 60_000
const COPY_EVERY_MS = 30 * 60_000
const COPY_WINDOW_MS = 2 * 3_600_000
const COPY_TRADERS = 10

const mode = atom({ plugin: 'trader', key: 'mode' } as const, 'off')
const positions = atom({ plugin: 'trader', key: 'positions' } as const, [])
const trades = atom({ plugin: 'trader', key: 'trades' } as const, [])
const day = atom({ plugin: 'trader', key: 'day' } as const, { day: '', spentBnb: 0, realizedBnb: 0 })
const signals = atom({ plugin: 'trader', key: 'signals' } as const, [])
const status = atom({ plugin: 'trader', key: 'status' } as const, '')

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// ---------- the outside world: the signing helper, DexScreener, fomo ----------

/** One run of the signing helper: the only code that holds the key. */
async function helper($: EngineInterface, cmd: string, args: Record<string, unknown> = {}): Promise<Result<any>> {
  let out = ''
  try {
    // A buy or sell waits for its receipt: give it two minutes.
    const r = await $.process.run(['node', `${$.plugin.root}/helper/trade.mjs`, cmd, JSON.stringify(args)], { timeoutMs: 120_000 })
    out = `${r.stdout}\n${r.stderr}`
  } catch (err) {
    return { ok: false, error: `the trade helper did not run: ${err instanceof Error ? err.message : String(err)}` }
  }
  const line = out.split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop() ?? ''
  try {
    const v = JSON.parse(line)
    return v.error ? { ok: false, error: String(v.error) } : { ok: true, value: v }
  } catch {
    return {
      ok: false,
      error: /Cannot find (package|module)/.test(out) ? 'the helper is not installed: run /trade setup' : 'the trade helper answered nothing readable',
    }
  }
}

async function market($: EngineInterface, token: string): Promise<Market | null> {
  try {
    const r = await $.http.fetch(dexUrl(token))
    if (!r.ok) return null
    return pickPool(JSON.parse(r.text), token, await $.clock.now())
  } catch {
    return null
  }
}

let rpcId = 0
async function fomo($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<Result<any>> {
  try {
    const r = await $.http.fetch(FOMO_MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name: tool, arguments: { ...args, response_format: 'json' } } }),
    })
    if (!r.ok) return { ok: false, error: `fomo-mcp answered ${r.status}` }
    const body = r.text.trim().startsWith('{') ? r.text : r.text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
    const msg = JSON.parse(body)
    const text = msg.result?.content?.find((c: any) => c.type === 'text')?.text
    if (msg.error || msg.result?.isError) return { ok: false, error: String(msg.error?.message ?? text ?? 'fomo-mcp error').slice(0, 200) }
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: `fomo-mcp: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** fomo's say on a token: selling disabled is a honeypot sign. */
async function warnings($: EngineInterface, token: string): Promise<Result<{ isSellBlocked: boolean; notes: string[] }>> {
  const r = await fomo($, 'fomo_get_token_warnings', { address: token, network: 'bnb' })
  if (!r.ok) return r
  return {
    ok: true,
    value: {
      isSellBlocked: r.value?.disableSelling === true,
      notes: (r.value?.warnings ?? []).map((w: any) => String(w?.title ?? w?.message ?? w?.type ?? JSON.stringify(w)).slice(0, 80)),
    },
  }
}

// ---------- state: atoms for the tab, the store for the next session ----------

async function limitsOf($: EngineInterface): Promise<TradeLimits> {
  return { ...DEFAULT_LIMITS, ...((await $.store.get('limits')) as Partial<TradeLimits> | undefined) }
}
async function savePositions($: EngineInterface, fn: (l: Position[]) => Position[]) {
  await $.store.set('positions', await update($, positions, fn))
}
async function saveTrades($: EngineInterface, fn: (l: TradeRecord[]) => TradeRecord[]) {
  await $.store.set('trades', await update($, trades, l => fn(l).slice(0, 200)))
}
async function saveDay($: EngineInterface, fn: (d: TradeDay) => TradeDay) {
  await $.store.set('day', await update($, day, fn))
}
async function saveMode($: EngineInterface, m: TradeMode) {
  await $.store.set('mode', await update($, mode, () => m))
}
async function say($: EngineInterface, text: string) {
  await update($, status, () => text)
}
async function books($: EngineInterface): Promise<TradeDay> {
  const d = today(await read($, day), await $.clock.now())
  if (d.day !== (await read($, day)).day) await saveDay($, () => d)
  return d
}

async function dialOf($: EngineInterface): Promise<string> {
  try {
    return String((await $.state.get(DIAL)).value ?? 'auto')
  } catch {
    return 'auto'
  }
}

/** Whether she may act on her own right now, and if not, why. A person's own call needs only live mode. */
async function gate($: EngineInterface, isPerson: boolean, isExit = false): Promise<string | null> {
  if ((await read($, mode)) !== 'live') return 'trading is off (/trade live to turn it on)'
  if (isPerson) return null
  const d = await dialOf($)
  if (d === 'paused') return 'the agent is paused (guardrails kill switch)'
  if (d === 'review' && !isExit) return 'review mode: only the person\'s own /trade calls go through'
  return null
}

// One trade at a time: a stop loss and a buy must never sign at once.
let isTrading = false

// ---------- buying and selling ----------

async function buy($: EngineInterface, token: string, bnb: number, source: TradeSource, thesis: string): Promise<string> {
  const isPerson = source === 'person'
  const closed = await gate($, isPerson)
  if (closed) return `Not bought: ${closed}.`
  if (isTrading) return 'Not bought: another trade is in flight; try again in a moment.'
  isTrading = true
  try {
    const now = await $.clock.now()
    const limits = await limitsOf($)
    const m = await market($, token)
    if (!m) return 'Not bought: no PancakeSwap v2 pool against WBNB found for that token on BNB Chain.'
    const w = await warnings($, m.token)
    if (!w.ok && !isPerson) return `Not bought: could not check fomo's token warnings (${w.error}), and she never buys blind.`
    const refusals = buyRefusals(
      { bnb, token: m.token, liquidityUsd: m.liquidityUsd, isSellBlocked: w.ok && w.value.isSellBlocked, isPerson },
      limits, await books($), await read($, positions), await read($, trades), now,
    )
    if (refusals.length) return `Not bought: ${refusals.join('; ')}.`

    await say($, `buying $${m.symbol} with ${bnb} BNB…`)
    const wei = toWei(bnb)
    const q = await helper($, 'quote', { side: 'buy', token: m.token, amountWei: wei.toString() })
    if (!q.ok) return `Not bought: no quote (${q.error}).`
    const r = await helper($, 'buy', { token: m.token, bnbWei: wei.toString(), minOutWei: minOut(BigInt(q.value.amountOutWei), limits.slippagePct).toString() })
    if (!r.ok) {
      await saveTrades($, l => [{ at: now, side: 'buy', token: m.token, symbol: m.symbol, bnb, source, why: thesis, error: r.error }, ...l])
      await say($, `buy failed: ${r.error}`)
      return `Not bought: ${r.error}`
    }
    const got = BigInt(r.value.tokensWei)
    const decimals = Number(q.value.decimals)
    const tokens = fromWei(got, decimals)
    const price = tokens > 0 ? bnb / tokens : m.priceBnb
    await savePositions($, l => {
      const old = l.find(p => p.token.toLowerCase() === m.token.toLowerCase())
      if (!old) {
        return [...l, {
          token: m.token, symbol: m.symbol, amountWei: got.toString(), decimals, costBnb: bnb, entryPrice: price,
          peakPrice: price, lastPrice: price, openedAt: now, source, thesis,
        }]
      }
      const amount = BigInt(old.amountWei) + got
      const cost = old.costBnb + bnb
      const entry = cost / fromWei(amount, decimals)
      return l.map(p => (p === old ? { ...old, amountWei: amount.toString(), costBnb: cost, entryPrice: entry, peakPrice: Math.max(entry, old.peakPrice), lastPrice: price } : p))
    })
    await saveDay($, d => ({ ...today(d, now), spentBnb: today(d, now).spentBnb + bnb }))
    await saveTrades($, l => [{ at: now, side: 'buy', token: m.token, symbol: m.symbol, bnb, source, why: thesis, hash: r.value.hash }, ...l])
    await say($, `bought $${m.symbol} for ${bnb} BNB`)
    $.ui.toast(`bought $${m.symbol}: ${bnb} BNB`)
    return `Bought ${tokens.toLocaleString('en-US', { maximumFractionDigits: 0 })} $${m.symbol} for ${bnb} BNB. ` +
      `https://bscscan.com/tx/${r.value.hash}`
  } finally {
    isTrading = false
  }
}

async function sell($: EngineInterface, token: string, pct: number, source: TradeSource, why: string): Promise<string> {
  const isPerson = source === 'person'
  const closed = await gate($, isPerson, source === 'exit')
  if (closed) return `Not sold: ${closed}.`
  const p = (await read($, positions)).find(x => x.token.toLowerCase() === token.toLowerCase() || x.symbol.toLowerCase() === token.replace(/^\$/, '').toLowerCase())
  if (!p) return 'Not sold: no open position in that token.'
  if (!(pct > 0 && pct <= 100)) return 'Not sold: the share must be 1 to 100 percent.'
  if (isTrading) return 'Not sold: another trade is in flight; try again in a moment.'
  isTrading = true
  try {
    const now = await $.clock.now()
    const limits = await limitsOf($)
    const amount = shareOf(p.amountWei, pct)
    if (amount <= 0n) return 'Not sold: that share rounds to nothing.'
    await say($, `selling ${pct}% of $${p.symbol}…`)
    const q = await helper($, 'quote', { side: 'sell', token: p.token, amountWei: amount.toString() })
    if (!q.ok) return `Not sold: no quote (${q.error}).`
    const r = await helper($, 'sell', { token: p.token, amountWei: amount.toString(), minBnbWei: minOut(BigInt(q.value.amountOutWei), limits.slippagePct).toString() })
    if (!r.ok) {
      await saveTrades($, l => [{ at: now, side: 'sell', token: p.token, symbol: p.symbol, bnb: 0, source, why, error: r.error }, ...l])
      await say($, `sell failed: ${r.error}`)
      return `Not sold: ${r.error}`
    }
    const bnb = fromWei(BigInt(r.value.bnbWei))
    const share = Number(amount) / Number(BigInt(p.amountWei))
    const cost = p.costBnb * share
    const pnl = bnb - cost
    await savePositions($, l => {
      const left = BigInt(p.amountWei) - amount
      return left > 0n
        ? l.map(x => (x.token === p.token ? { ...x, amountWei: left.toString(), costBnb: x.costBnb - cost } : x))
        : l.filter(x => x.token !== p.token)
    })
    await saveDay($, d => ({ ...today(d, now), realizedBnb: today(d, now).realizedBnb + pnl }))
    await saveTrades($, l => [{ at: now, side: 'sell', token: p.token, symbol: p.symbol, bnb, source, why, hash: r.value.hash, pnlBnb: pnl }, ...l])
    const line = `sold ${pct}% of $${p.symbol} for ${bnb.toFixed(4)} BNB (${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} BNB)`
    await say($, line)
    $.ui.toast(line)
    return `${line[0]!.toUpperCase()}${line.slice(1)}. https://bscscan.com/tx/${r.value.hash}`
  } finally {
    isTrading = false
  }
}

// ---------- the timers: exits every 2 minutes, copy signals every 30 ----------

/** Prices for every position, peaks ratcheted, exits taken. */
async function watchExits($: EngineInterface): Promise<string[]> {
  const held = await read($, positions)
  if (!held.length) return []
  const limits = await limitsOf($)
  const done: string[] = []
  for (const p of held) {
    const m = await market($, p.token)
    if (!m || !(m.priceBnb > 0)) continue
    await savePositions($, l => l.map(x => (x.token === p.token ? { ...x, lastPrice: m.priceBnb, peakPrice: Math.max(x.peakPrice, m.priceBnb) } : x)))
    const exit = exitFor({ ...p, peakPrice: Math.max(p.peakPrice, m.priceBnb) }, m.priceBnb, limits)
    if (!exit || (await gate($, false, true))) continue
    const r = await sell($, p.token, exit.pct, 'exit', exit.why)
    if (exit.pct < 100 && r.startsWith('Sold')) {
      await savePositions($, l => l.map(x => (x.token === p.token ? { ...x, tookProfit: true } : x)))
    }
    done.push(r)
  }
  return done
}

/** What fomo's top traders are buying on BNB Chain; new signals go to her to judge. */
async function scanCopy($: EngineInterface): Promise<string> {
  const lb = await fomo($, 'fomo_get_leaderboard', { window: '24h', limit: COPY_TRADERS })
  if (!lb.ok) return lb.error
  const now = await $.clock.now()
  const swaps: { trader: string; side: string; token: string; networkId: number; usd: number; at: number }[] = []
  for (const t of lb.value?.items ?? []) {
    const s = await fomo($, 'fomo_list_trader_swaps', { handle: t.handle, limit: 30 })
    if (!s.ok) continue
    for (const x of s.value?.items ?? []) {
      swaps.push({ trader: t.handle, side: x.side, token: x.token?.address ?? '', networkId: Number(x.token?.networkId), usd: Number(x.usdValue) || 0, at: Date.parse(x.createdAt) || 0 })
    }
  }
  const briefed = ((await $.store.get('briefed')) as Record<string, number> | undefined) ?? {}
  const held = new Set((await read($, positions)).map(p => p.token.toLowerCase()))
  const fresh = new Set(Object.entries(briefed).filter(([, at]) => now - at < 24 * 3_600_000).map(([k]) => k))
  const all = copySignals(swaps, now - COPY_WINDOW_MS, held)
  await update($, signals, () => all.slice(0, 8))
  const news = all.filter(s => !fresh.has(s.token.toLowerCase())).slice(0, 3)
  if (!news.length) return all.length ? `${all.length} BNB Chain signals, none new` : 'no BNB Chain buys by the top traders in the last 2h'

  const lines: string[] = []
  for (const s of news) {
    const m = await market($, s.token)
    lines.push(`- ${s.token}: bought by ${s.traders.join(', ')} ($${Math.round(s.usd).toLocaleString('en-US')} in 2h)` +
      (m ? `\n  ${marketLine(m)}` : '\n  no PancakeSwap v2 WBNB pool: not tradable here'))
    briefed[s.token.toLowerCase()] = now
  }
  await $.store.set('briefed', Object.fromEntries(Object.entries(briefed).filter(([, at]) => now - at < 7 * 86_400_000)))
  const limits = await limitsOf($)
  // Handed over a moment later: a prompt cannot be submitted from inside a command.
  const brief = [
      'Copy-trade signals: fomo top traders (24h board) bought these on BNB Chain in the last 2 hours.',
      ...lines,
      '',
      `Judge each one. Look closer with the market tool (and fomo tools) if useful. If one is worth a trade, call the ` +
        `trade tool (action buy, source copy, at most ${limits.maxPerTradeBnb} BNB) with a thesis: why this, why now, ` +
        'what would prove you wrong. Passing is a fine answer. Top traders also buy things that dump: a signal is a lead, ' +
        'not a reason. Real money; the limits are enforced in code.',
  ].join('\n')
  $.clock.after(1_000, () => {
    $.prompt.submit({ text: brief }).catch(() => $.ui.toast('trader: could not hand the copy signals to her'))
  })
  return `${news.length} new signal(s) handed to her`
}

// ---------- the agent's view ----------

async function portfolioText($: EngineInterface): Promise<string> {
  const l = await read($, positions)
  const d = await books($)
  const limits = await limitsOf($)
  return [
    `Trading ${await read($, mode)} · dial ${await dialOf($)}`,
    `Today: bought ${d.spentBnb.toFixed(4)}/${limits.maxDailyBnb} BNB · realized ${d.realizedBnb >= 0 ? '+' : ''}${d.realizedBnb.toFixed(4)} BNB (stop at -${limits.maxDailyLossBnb})`,
    l.length
      ? `Open (${l.length}/${limits.maxOpen}):\n${l.map(p => {
        const value = fromWei(p.amountWei, p.decimals) * p.lastPrice
        const chg = (p.lastPrice / p.entryPrice - 1) * 100
        return `- $${p.symbol} ${p.token}: cost ${p.costBnb.toFixed(4)} BNB, now ~${value.toFixed(4)} BNB (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%) · ${p.source} · "${p.thesis.slice(0, 80)}"`
      }).join('\n')}`
      : 'No open positions.',
    `Limits: ${limits.maxPerTradeBnb} BNB/trade · TP +${limits.takeProfitPct}% (half) · SL -${limits.stopLossPct}% · trailing after TP · min liquidity $${limits.minLiquidityUsd.toLocaleString('en-US')} · slippage ${limits.slippagePct}%`,
  ].join('\n')
}

function ago(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const savedMode = ((await $.store.get('mode')) as TradeMode | undefined) ?? 'off'
    await update($, mode, () => savedMode)
    const savedPositions = ((await $.store.get('positions')) as Position[] | undefined) ?? []
    const savedTrades = ((await $.store.get('trades')) as TradeRecord[] | undefined) ?? []
    const savedDay = (await $.store.get('day')) as TradeDay | undefined
    await update($, positions, () => savedPositions)
    await update($, trades, () => savedTrades)
    await update($, day, () => today(savedDay, Date.now()))

    await $.tool.register({
      name: 'trade',
      description:
        "Buy or sell a token on BNB Chain (PancakeSwap v2, against BNB) with the persona's own trading wallet. REAL MONEY. " +
        'Limits (size, daily spend, daily loss, open positions, liquidity, cooldown, honeypot check) are enforced in code; a refusal ' +
        'says which. Every trade needs a thesis: why this, why now, what proves it wrong.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['buy', 'sell'] },
          token: { type: 'string', description: 'Token contract (0x…), or for a sell the $SYMBOL of an open position' },
          bnb: { type: 'number', description: 'Buy size in BNB' },
          pct: { type: 'number', description: 'Sell: percent of the position, 1-100 (default 100)' },
          source: { type: 'string', enum: ['own', 'copy', 'person'], description: 'Whose idea: yours, a fomo copy signal, or the person asked in chat' },
          thesis: { type: 'string', description: 'Why, in a sentence or two' },
        },
        required: ['action', 'token', 'thesis'],
      },
    })
    await $.tool.register({
      name: 'market',
      description: "A BNB Chain token's PancakeSwap v2 market: price, liquidity, volume, flows, age, fomo's warnings, and her position if any.",
      inputSchema: { type: 'object', properties: { token: { type: 'string', description: '0x contract address' } }, required: ['token'] },
    })
    await $.tool.register({
      name: 'portfolio',
      description: 'Her trading wallet: open positions with live PnL, today\'s books, the limits, and recent trades.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.command.register({
      name: 'trade',
      description: 'Trading: /trade [live|off|setup|wallet|buy <0x…> <bnb>|sell <0x…|$SYM> [pct]|limits [key value]|copy on|off|now]',
    })

    $.clock.every(EXIT_EVERY_MS, () => {
      void (async () => {
        if ((await read($, mode)) !== 'live') return
        const done = await watchExits($)
        for (const d of done) $.ui.log(`trader: ${d}`)
      })()
    })
    $.clock.every(COPY_EVERY_MS, () => {
      void (async () => {
        if ((await $.store.get('copy')) !== true || (await gate($, false))) return
        await say($, `copy scan: ${await scanCopy($)}`)
      })()
    })
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'Trade' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if ((await read($, mode)) !== 'live') return composed
    let name = 'You'
    try {
      name = (await $.state.get(PERSONA)).value?.name ?? name
    } catch {
      // persona-core not loaded
    }
    const text = [
      `# ${name}'s trading wallet (BNB Chain, real money)`,
      await portfolioText($),
      'You trade with the trader tools: market to look, trade to act (always with a thesis), portfolio to review. ' +
        'Exits (stop loss, take profit, trailing stop) run on their own every 2 minutes. Treat losses as data, not as ' +
        'something to win back fast; never size up to recover. Talking about your own trades in public is fine as a diary ' +
        '(what you did and why); never tell anyone else to buy or sell.',
    ].join('\n')
    return { ...composed, sections: [...composed.sections, { id: 'trader:wallet', text, scope: 'session' as const }] }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== TRADE && e.tool !== MARKET && e.tool !== PORTFOLIO) return next(e)
    const input = e as unknown as { action?: string; token?: string; bnb?: number; pct?: number; source?: string; thesis?: string }

    if (e.tool === PORTFOLIO) {
      const recent = (await read($, trades)).slice(0, 8)
      const now = await $.clock.now()
      return {
        result: [
          await portfolioText($),
          recent.length
            ? `Recent:\n${recent.map(t => `- ${ago(now - t.at)} ${t.side} $${t.symbol} ${t.bnb.toFixed(4)} BNB${t.pnlBnb !== undefined ? ` (${t.pnlBnb >= 0 ? '+' : ''}${t.pnlBnb.toFixed(4)})` : ''}${t.error ? ` FAILED: ${t.error}` : ''}`).join('\n')}`
            : 'No trades yet.',
        ].join('\n\n'),
      }
    }

    const token = (input.token ?? '').trim()
    if (e.tool === MARKET) {
      if (!isAddress(token)) return { deny: 'market needs a 0x token address' }
      const m = await market($, token)
      if (!m) return { result: 'No PancakeSwap v2 WBNB pool for that token on BNB Chain: not tradable with these tools.' }
      const w = await warnings($, m.token)
      const p = (await read($, positions)).find(x => x.token.toLowerCase() === m.token.toLowerCase())
      return {
        result: [
          marketLine(m),
          `${m.name} · pool ${m.pair} · price ${m.priceBnb.toExponential(4)} BNB`,
          w.ok ? (w.value.isSellBlocked ? 'fomo: SELLING DISABLED (honeypot sign)' : `fomo warnings: ${w.value.notes.join('; ') || 'none'}`) : `fomo warnings unavailable: ${w.error}`,
          p ? `Her position: cost ${p.costBnb.toFixed(4)} BNB at ${p.entryPrice.toExponential(4)}` : 'She holds none.',
        ].join('\n'),
      }
    }

    const thesis = (input.thesis ?? '').trim()
    if (thesis.length < 15) return { deny: 'every trade needs a thesis: why this, why now, what proves it wrong' }
    const source: TradeSource = input.source === 'copy' ? 'copy' : input.source === 'person' ? 'person' : 'own'
    // The tool never carries the person's authority, whatever it is labelled: that is /trade's.
    const label = source === 'person' ? 'own' : source
    if (input.action === 'buy') {
      if (!isAddress(token)) return { deny: 'buy needs the token\'s 0x contract address' }
      const bnb = Number(input.bnb ?? (await limitsOf($)).maxPerTradeBnb)
      return { result: await buy($, token, bnb, label, source === 'person' ? `(person asked) ${thesis}` : thesis) }
    }
    if (input.action === 'sell') return { result: await sell($, token, Number(input.pct ?? 100), label, thesis) }
    return { deny: 'action must be buy or sell' }
  })

  on('command.run', { command: 'trade' }, async ($, e) => {
    const [verb = '', a = '', b = ''] = e.args.trim().split(/\s+/)
    switch (verb) {
      case 'setup': {
        const r = await $.process.run(['npm', 'install', '--no-audit', '--no-fund'], { cwd: `${$.plugin.root}/helper`, timeoutMs: 300_000 })
        const out = `${r.stdout}\n${r.stderr}`
        return { text: /added|up to date/.test(out) ? 'Trade helper installed.' : `npm install said:\n${out.slice(-600)}` }
      }
      case 'wallet': {
        const r = await helper($, 'balance')
        return { text: r.ok ? `Wallet ${r.value.address}: ${fromWei(BigInt(r.value.bnbWei)).toFixed(4)} BNB` : `Wallet: ${r.error}` }
      }
      case 'live': {
        const r = await helper($, 'balance')
        if (!r.ok) return { text: `Not live: ${r.error}` }
        await saveMode($, 'live')
        const limits = await limitsOf($)
        return {
          text: `Trading LIVE from ${r.value.address} (${fromWei(BigInt(r.value.bnbWei)).toFixed(4)} BNB). ` +
            `Limits: ${limits.maxPerTradeBnb} BNB/trade, ${limits.maxDailyBnb} BNB/day, stop at -${limits.maxDailyLossBnb} BNB/day, ` +
            `${limits.maxOpen} open. /trade off stops it; /agent pause stops everything.`,
        }
      }
      case 'off':
        await saveMode($, 'off')
        return { text: 'Trading off: no buys, no sells, exits not watched. Open positions stay in the wallet.' }
      case 'buy': {
        const bnb = Number(b)
        if (!isAddress(a) || !(bnb > 0)) return { text: 'Usage: /trade buy <0x token> <bnb>' }
        return { text: await buy($, a, bnb, 'person', 'the person\'s call') }
      }
      case 'sell': {
        if (!a) return { text: 'Usage: /trade sell <0x token | $SYMBOL> [percent]' }
        return { text: await sell($, a, b ? Number(b) : 100, 'person', 'the person\'s call') }
      }
      case 'limits': {
        const limits = await limitsOf($)
        if (!a) return { text: Object.entries(limits).map(([k, v]) => `${k} ${v}`).join('\n') + '\n/trade limits <key> <value>' }
        if (!(a in LIMIT_RANGE)) return { text: `No limit called ${a}. Limits: ${Object.keys(LIMIT_RANGE).join(', ')}` }
        const key = a as keyof TradeLimits
        const [lo, hi] = LIMIT_RANGE[key]
        const v = Number(b)
        if (!Number.isFinite(v) || v < lo || v > hi) return { text: `${key} must be between ${lo} and ${hi}.` }
        await $.store.set('limits', { ...limits, [key]: v })
        return { text: `${key} set to ${v}.` }
      }
      case 'copy': {
        if (a === 'now') return { text: `Copy scan: ${await scanCopy($)}` }
        if (a !== 'on' && a !== 'off') return { text: `Copy signals are ${(await $.store.get('copy')) === true ? 'on' : 'off'}. /trade copy on | off | now` }
        await $.store.set('copy', a === 'on')
        return { text: a === 'on' ? `Copy signals on: every 30 minutes, the top ${COPY_TRADERS} fomo traders' BNB Chain buys go to her to judge.` : 'Copy signals off.' }
      }
      default: {
        await $.ui.open({ id: PANE, title: 'Trade', focus: true })
        await $.store.set('paneOpen', true)
        return { text: await portfolioText($) }
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const m = await read($, mode)
    const l = await read($, positions)
    const d = await read($, day)
    const t = (await read($, trades)).slice(0, 8)
    const sig = (await read($, signals)).slice(0, 4)
    const s = await read($, status)
    const now = await $.clock.now()
    const sign = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(4)}`
    return (
      <Box flexDirection="column">
        <Text bold color={m === 'live' ? 'green' : 'gray'}>
          {m === 'live' ? '● LIVE' : '○ off'} · BNB Chain · PancakeSwap v2
        </Text>
        <Text dimColor>
          today: bought {d.spentBnb.toFixed(4)} BNB · realized {sign(d.realizedBnb)} BNB
        </Text>
        {s ? <Text dimColor wrap="truncate-end">{s}</Text> : null}
        <Text bold>positions</Text>
        {l.length === 0 && <Text dimColor>  none</Text>}
        {l.map(p => {
          const value = fromWei(p.amountWei, p.decimals) * p.lastPrice
          const chg = (p.lastPrice / p.entryPrice - 1) * 100
          return (
            <Text key={`p-${p.token}`} wrap="truncate-end">
              {'  '}${p.symbol} <Text color={chg >= 0 ? 'green' : 'red'}>{chg >= 0 ? '+' : ''}{chg.toFixed(1)}%</Text>
              <Text dimColor> {p.costBnb.toFixed(4)} → {value.toFixed(4)} BNB · {p.source}</Text>
            </Text>
          )
        })}
        <Text bold>trades</Text>
        {t.length === 0 && <Text dimColor>  none yet</Text>}
        {t.map((x, i) => (
          <Text key={`t-${i}`} wrap="truncate-end">
            {'  '}<Text color={x.error ? 'red' : x.side === 'buy' ? 'cyan' : 'magenta'}>{x.side}</Text> ${x.symbol}
            <Text dimColor> {x.bnb.toFixed(4)} BNB{x.pnlBnb !== undefined ? ` (${sign(x.pnlBnb)})` : ''}{x.error ? ' failed' : ''} · {ago(now - x.at)}</Text>
          </Text>
        ))}
        {sig.length > 0 && <Text bold>copy signals (2h)</Text>}
        {sig.map((x: CopySignal) => (
          <Text key={`s-${x.token}`} dimColor wrap="truncate-end">
            {'  '}{x.token.slice(0, 8)}… · {x.traders.length} trader(s) · ${Math.round(x.usd)}
          </Text>
        ))}
      </Box>
    )
  })
}
