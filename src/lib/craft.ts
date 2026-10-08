// How the persona writes, pure: the craft each post and reply carries, plus what is actually happening to it right now
// (its live bags and last trades), because context comes before the line. The craft itself belongs to the persona
// (persona.craft, drafted by the forge); these defaults only defer to the persona's own voice and style notes.
import type { Position, TradeRecord } from './limits'

/** For a persona with no craft of its own. Voice-neutral on purpose: tone, caps and humor come from the persona. */
export const DEFAULT_POST_CRAFT = [
  'How to write it:',
  '- Start from what is actually happening (to you, your bags, the market), then say it the way only you would.',
  '- Short and specific beats long and general: a precise number, a named thing, one clear image.',
  '- Your voice and style notes decide everything else: length, caps, punctuation, emoji, humor or none.',
  '- Never explain yourself, never announce the point, no engagement bait ("like if", "retweet", "who is still holding").',
  '- Test before posting: does it work as a screenshot with no context? Does it leave an opening to answer or argue?',
  '- Your decisions are yours alone: "I bought" is a story, "you should buy" is a call. Never the second.',
].join('\n')

/** The same, for a reply: relevance to the conversation beats standalone polish. */
export const DEFAULT_REPLY_CRAFT = [
  'Reply craft: fit the conversation and add something new, in your voice; never just agree or restate. To a big',
  'account: no flattery, no "notice me". If they are sharing something genuinely sad or serious, be kind and short.',
].join(' ')

const pct = (p: Position) => (p.entryPrice > 0 ? (p.lastPrice / p.entryPrice - 1) * 100 : 0)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
const ago = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m ago` : `${Math.round(ms / 3_600_000)}h ago`)

/**
 * What is happening to the persona, as lines a brief can carry: open live bags with their change, and her last few trades.
 * Paper positions are left out (they are practice, not its story). Empty when nothing is going on.
 */
export function happening(positions: readonly Position[], trades: readonly TradeRecord[], now: number): string {
  const live = positions.filter(p => !p.paper)
  const recent = trades.filter(t => !t.paper && !t.error && now - t.at < 24 * 3_600_000).slice(0, 4)
  if (!live.length && !recent.length) return ''
  const lines = ['What is actually happening to you right now (real, use it if it fits; never invent numbers):']
  if (live.length) lines.push(`- your bags: ${live.map(p => `$${p.symbol} ${signed(pct(p))}`).join(', ')}`)
  for (const t of recent) {
    const pnl = t.side === 'sell' && typeof t.pnlBnb === 'number' ? ` (${t.pnlBnb >= 0 ? 'won' : 'lost'} ${Math.abs(t.pnlBnb).toFixed(4)} BNB)` : ''
    lines.push(`- ${ago(now - t.at)}: you ${t.side === 'buy' ? 'bought' : 'sold'} $${t.symbol}${pnl}`)
  }
  return lines.join('\n')
}
