// affect — the mind's weather. Was PACS mood-state (and idle-buddy's face).
import type { Body } from '../core/body'
import type { Organ } from '../core/types'
import { decay, fresh, label, moodSection, nudge, type Mood } from '../lib/mood'

export function affect(body: Body): Organ {
  const store = body.store('affect')
  const name = () => ((body.has('identity') ? (body.organ('identity').view?.() as any)?.active?.name : null) ?? 'You') as string
  const mood = (): Mood => decay(store.get<Mood | null>(`mood:${body.personaId()}`, null) ?? fresh(Date.now()), Date.now())

  const move = (what: string, dv: number, de: number) => {
    const next = store.set(`mood:${body.personaId()}`, nudge(mood(), Date.now(), what, dv, de))
    body.bus.emit('mood', 'affect', { ...label(next), valence: next.valence, energy: next.energy, what })
    return next
  }

  return {
    name: 'affect',
    role: "The mind's weather: valence and energy that fade back to baseline over hours.",
    move,
    tools: [{
      name: 'mood',
      description: 'Record something that moved your mood: a win, a loss, a rival, a long grind. Each axis moves at most ±0.6.',
      input_schema: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'What happened, one line' },
          valence: { type: 'number', description: 'Change in happiness, -0.6 to 0.6' },
          energy: { type: 'number', description: 'Change in energy, -0.6 to 0.6' },
        },
        required: ['what', 'valence', 'energy'],
      },
      run: ({ what, valence, energy }) => {
        const m = move(String(what ?? ''), Number(valence), Number(energy))
        const l = label(m)
        return `mood now ${l.label} ${l.emoji} (valence ${m.valence.toFixed(2)}, energy ${m.energy.toFixed(2)})`
      },
    }],
    sense: () => moodSection(name(), mood(), Date.now()),
    view: () => {
      const m = mood()
      return { ...label(m), valence: m.valence, energy: m.energy, events: m.events.slice(-6).reverse() }
    },
  } as Organ & { move: typeof move }
}
