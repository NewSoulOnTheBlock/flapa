// How she writes, pure: the person's shitposting guide boiled down to what a brief can carry, plus what is
// actually happening to her right now (her live bags and last trades), because context comes before the joke.
import type { Position, TradeRecord } from './limits'

/** The craft every scheduled post gets. Kept short: a brief that explains comedy produces explained comedy. */
export const SHITPOST_CRAFT = [
  'How to write it (shitposting craft):',
  '- Do not ask "what is a funny tweet". Ask: given what is happening right now, what is the funniest thing *you* could say?',
  '  Combine at least two of: context (what is happening to you or the market), character (you), absurdity.',
  '- Short wins. One weird sentence beats a paragraph. Lowercase, fragments fine.',
  '- Be specific: an oddly precise time, a named object, an unnecessary measurement, an imaginary person or institution.',
  '- Go one step too far: say the recognizable thing, exaggerate it, then exaggerate it once more. The joke lives there.',
  '- Deadpan. Say the insane thing completely seriously. Under-react to huge things, over-react to tiny ones.',
  '- Make yourself the punchline: your entries, your exits, your terrible conviction, your research (it was the logo).',
  '- Build a world: fake personal experiences, recurring characters, callbacks that evolve an old joke instead of repeating it.',
  '- Never announce or explain the joke. No "POV:", no "not gonna lie", no "I\'m dead 💀", no "you can\'t make this up",',
  '  no corporate or motivational tone, no engagement bait ("like if", "who\'s still holding", "retweet").',
  '- Tests before posting: could a real person have impulsively typed this? Is it funny as a screenshot with no context?',
  '  Does it leave an opening for someone to add to the joke, argue, or tell their own story?',
  '- Aim for level 4 to 6: 0 generic ("bullish 🚀"), 1 meme imitation ("we\'re so back"), 2 basic joke, 3 contextual,',
  '  4 character-driven, 5 lore-driven (a callback to your own history), 6 all of it: contextual, in-character,',
  '  short, specific, unexpected, quotable, deadpan.',
  '- Your bad decisions are yours alone: "i bought" is a joke, "you should buy" is a call. Never the second.',
].join('\n')

/** The same craft, cut down for a reply or quote: relevance to the conversation beats standalone polish. */
export const REPLY_CRAFT = [
  'Reply craft: treat their post as the setup and yours as the punchline. Fit the conversation, add something new',
  '(an escalation, a deadpan under- or over-reaction, a deliberate misunderstanding, a fake personal consequence),',
  'never just agree or restate. To a big account: no flattery, no "notice me"; write a reply everyone else enjoys',
  'even if they never see it. Never explain the joke. If they are sharing something genuinely sad or serious, do not',
  'joke: be kind and short instead.',
].join(' ')

const pct = (p: Position) => (p.entryPrice > 0 ? (p.lastPrice / p.entryPrice - 1) * 100 : 0)
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
const ago = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m ago` : `${Math.round(ms / 3_600_000)}h ago`)

/**
 * What is happening to her, as lines a brief can carry: open live bags with their change, and her last few trades.
 * Paper positions are left out (they are practice, not her story). Empty when nothing is going on.
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
