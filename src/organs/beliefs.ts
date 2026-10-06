// beliefs — what the mind holds and why. Was PACS opinion-ledger.
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { applyStance, describe, ledgerSection, type Opinion } from '../lib/opinions'

export function beliefs(body: Body): Organ {
  const store = body.store('beliefs')
  const key = () => `ledger:${body.personaId()}`
  const ledger = () => store.get<Opinion[]>(key(), [])
  const name = () => ((body.has('identity') ? (body.organ('identity').view?.() as any)?.active?.name : null) ?? 'You') as string

  return {
    name: 'beliefs',
    role: 'Stances with reasons; a change of mind keeps what it was before.',
    tools: [
      {
        name: 'stance',
        description: 'Take, reaffirm or revise a stance. A reason is required: convictions are deliberate and remembered.',
        input_schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Short topic name, e.g. "memecoins", "L2 fees"' },
            stance: { type: 'string', description: 'The view, one or two sentences in your own words' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string', description: 'Why you hold or changed this view' },
          },
          required: ['topic', 'stance', 'confidence', 'reason'],
        },
        run: ({ topic, stance, confidence, reason }) => {
          if (!String(topic ?? '').trim() || !String(stance ?? '').trim()) return 'error: topic and stance are required'
          if (String(reason ?? '').trim().length < 4) return 'error: give a real reason'
          const { list, change } = applyStance(ledger(), { topic, stance, confidence: Number(confidence), reason }, Date.now())
          store.set(key(), list)
          body.bus.emit('stance', 'beliefs', { topic, stance, change })
          return `${change}: ${topic}`
        },
      },
      {
        name: 'stances',
        description: 'Search your opinion ledger, history included. An empty query lists all.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        run: ({ query }) => {
          const q = String(query ?? '').toLowerCase().trim()
          const hits = ledger().filter(o => !q || `${o.topic} ${o.stance} ${o.reason}`.toLowerCase().includes(q))
          return hits.length ? hits.map(describe).join('\n') : 'no stances match'
        },
      },
    ],
    sense: () => ledgerSection(name(), ledger()),
    view: () => ({ ledger: [...ledger()].sort((a, b) => b.updated - a.updated) }),
  }
}
