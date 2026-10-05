// Talking to fomo-mcp's hosted server (MCP over streamable HTTP), and turning
// its answers into leaderboard rows. Pure: no `$`.
import type { FomoRow, FomoWindow } from '../types'

export const FOMO_MCP_URL = 'https://fomomcp.app/mcp'

export function rpcBody(id: number, tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })
}

/** A tool result from a JSON or server-sent-events reply, parsed from its first text block. */
export function parseToolReply(text: string): { ok: true; value: any } | { ok: false; error: string } {
  const body = text.trim().startsWith('{')
    ? text
    : text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('')
  let msg: any
  try {
    msg = JSON.parse(body)
  } catch {
    return { ok: false, error: 'fomo-mcp answered something that is not JSON' }
  }
  if (msg.error) return { ok: false, error: msg.error.message ?? 'fomo-mcp error' }
  const block = msg.result?.content?.find((c: any) => c.type === 'text')?.text
  if (msg.result?.isError) return { ok: false, error: String(block ?? 'fomo-mcp tool error').slice(0, 200) }
  try {
    return { ok: true, value: JSON.parse(block) }
  } catch {
    return { ok: false, error: String(block ?? 'empty reply').slice(0, 200) }
  }
}

/** Leaderboard items into rows; the biggest winner is the top token by PnL. */
export function toRows(items: readonly any[], names: Readonly<Record<string, string>>): FomoRow[] {
  return items.map(i => {
    const best = [...(i.topTokens ?? [])]
      .filter((t: any) => typeof t.pnlUsd === 'number')
      .sort((a: any, b: any) => b.pnlUsd - a.pnlUsd)[0]
    const address: string = best?.token?.address ?? ''
    return {
      rank: i.rank,
      handle: i.handle,
      pnlUsd: i.pnlUsd ?? 0,
      volumeUsd: i.volumeUsd ?? 0,
      trades: i.trades ?? 0,
      top: best ? { address, symbol: names[address] ?? (address.length <= 8 ? address : `${address.slice(0, 4)}…`), pnlUsd: best.pnlUsd } : null,
    }
  })
}

export function usd(n: number): string {
  const a = Math.abs(n)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${a.toFixed(0)}`
  return n < 0 ? `-${s}` : `+${s}`
}

/** What the agent is handed to write a leaderboard post from: facts, and what they do and don't mean. */
/** How a trader is named on X: @ their linked X handle, or their fomo handle with no @. */
export function xName(r: Pick<FomoRow, 'handle' | 'x'>): string {
  const x = r.x?.replace(/^@/, '').trim()
  return x && /^[A-Za-z0-9_]{1,15}$/.test(x) ? `@${x}` : r.handle
}

export function postBrief(rows: readonly FomoRow[], window: FomoWindow): string {
  const lines = rows.slice(0, 3).map(r =>
    `${r.rank}. ${xName(r)}${xName(r).startsWith('@') ? ` (fomo: ${r.handle})` : ' (fomo handle, no X account linked)'}: ` +
      `${usd(r.pnlUsd)} PnL over ${window} (${r.trades} trades)` +
      (r.top ? `; biggest winner $${r.top.symbol} (${usd(r.top.pnlUsd)} on that position)` : ''))
  return [
    `The fomo.family leaderboard, top 3 by ${window} PnL, fetched just now:`,
    ...lines,
    '',
    `Write ONE post for X about it, in your own voice, and publish it with your post tool. Keep it under 260 ` +
      `characters. The trader PnL is for the last ${window}; the token figure is PnL on that position, not ` +
      'necessarily made in that window, so call it their biggest winner, not what they made today. No buy calls, ' +
      'no price predictions, no links. Use $TICKERS as given. Tag a trader with @ ONLY where an @handle is ' +
      'given above (their own linked X account); name the others by their fomo handle with NO @, because the ' +
      'same name on X may belong to someone else.',
  ].join('\n')
}
