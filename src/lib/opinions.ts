// The opinion ledger, carried over from PACS opinion-ledger: stances with reasons and a history.
export type StanceChange = { stance: string; confidence: number; reason: string; at: number }
export type Opinion = {
  id: string; topic: string; stance: string
  /** 0 to 1. */
  confidence: number
  reason: string; since: number; updated: number
  /** What it was before, newest last. */
  history: StanceChange[]
}

const IN_PROMPT = 12

export function topicKey(topic: string): string {
  return topic.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

/** Takes or revises a stance. A revision keeps the old stance in history; the same stance again only moves confidence and the reason. */
export function applyStance(
  list: readonly Opinion[],
  input: { topic: string; stance: string; confidence: number; reason: string },
  now: number,
): { list: Opinion[]; change: 'new' | 'revised' | 'reaffirmed' } {
  const id = topicKey(input.topic)
  const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0.6))
  const found = list.find(o => o.id === id)
  if (!found) {
    const fresh: Opinion = {
      id, topic: input.topic.trim(), stance: input.stance.trim(), confidence,
      reason: input.reason.trim(), since: now, updated: now, history: [],
    }
    return { list: [...list, fresh], change: 'new' }
  }
  const isSame = found.stance.trim().toLowerCase() === input.stance.trim().toLowerCase()
  const next: Opinion = isSame
    ? { ...found, confidence, reason: input.reason.trim(), updated: now }
    : {
        ...found,
        stance: input.stance.trim(),
        confidence,
        reason: input.reason.trim(),
        since: now,
        updated: now,
        history: [
          ...found.history,
          { stance: found.stance, confidence: found.confidence, reason: found.reason, at: found.since },
        ].slice(-20),
      }
  return { list: list.map(o => (o.id === id ? next : o)), change: isSame ? 'reaffirmed' : 'revised' }
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function ledgerSection(name: string, list: readonly Opinion[]): string {
  const held = [...list].sort((a, b) => b.updated - a.updated).slice(0, IN_PROMPT)
  return [
    `# ${name}'s stances (opinion ledger)`,
    held.length
      ? held.map(o => `- ${o.topic}: ${o.stance} (confidence ${o.confidence.toFixed(1)}, since ${day(o.since)})`).join('\n')
      : '(none recorded yet)',
    `When speaking as ${name}, stay consistent with these. Holding a view on a new topic, or changing one, ` +
      `goes through the stance tool with the reason, so ${name}'s convictions are deliberate and remembered. ` +
      'Revise when there is a real reason (new evidence, an argument that landed); never just to agree.',
    list.length > IN_PROMPT ? `${list.length - IN_PROMPT} older stances are in the ledger; the stances tool searches them.` : '',
  ].filter(Boolean).join('\n\n')
}

export function describe(o: Opinion): string {
  const past = o.history.length
    ? `\n  was: ${o.history.map(h => `"${h.stance}" (${day(h.at)}, ${h.reason})`).join('; ')}`
    : ''
  return `- ${o.topic}: ${o.stance} [${o.confidence.toFixed(1)}] — ${o.reason}${past}`
}

