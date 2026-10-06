// conscience — the only door out of the body. Was PACS guardrails (screen + dial + kill switch),
// grown into a gate: every post, reply and trade passes here, and each organ is paper or live.
//
//   paused  → nothing goes out, except exits (a stop loss only removes risk)
//   review  → everything waits for the person (exits excepted: a stop loss must not wait)
//   auto    → rules, then a model reviewer; anything they flag waits for the person
import type { Body } from '../core/body'
import type { Mode, Organ, Outward } from '../core/types'
import { parseReview, reviewPrompt, reviewSystem, screen, type Allow, type Verdict } from '../lib/rules'

export type Dial = 'auto' | 'review' | 'paused'
export type Audit = { id: string; at: number; organ: string; kind: string; summary: string; by: Outward['by']; verdict: Verdict | 'done' | 'rejected' | 'refused' | 'failed'; reasons: string[]; mode?: Mode; result?: string }
export type Pending = Outward & { reasons: string[] }

/** Organs that can act outward. Live needs a deliberate switch per organ; the default is paper. */
const ACTORS = ['voice', 'hands'] as const

export function conscience(body: Body): Organ {
  const store = body.store('conscience')
  const dial = () => store.get<Dial>('dial', 'auto')
  const live = () => store.get<Record<string, boolean>>('live', {})
  const allow = () => store.get<Allow>('allow', { domains: [], addresses: [] })
  const pending = () => store.get<Pending[]>('pending', [])
  const modeOf = (organ: string): Mode => (live()[organ] ? 'live' : 'paper')

  const audit = (a: Omit<Audit, 'at'>) => {
    store.update<Audit[]>('log', [], l => [...l, { ...a, at: Date.now() }].slice(-300))
    body.bus.emit(`act.${a.verdict}`, 'conscience', a)
  }

  const persona = () => {
    const p = body.has('identity') ? (body.organ('identity').view?.() as any)?.active : null
    return { name: p?.name ?? 'the agent', handle: p?.handle ?? '', taboos: (p?.taboos ?? []) as string[] }
  }

  const execute = async (o: Outward): Promise<string> => {
    const mode = modeOf(o.organ)
    try {
      // An organ may act in another mode than the switch says (a live bag's stop loss while trading is on paper).
      const out = await body.organ(o.organ).perform!(o, mode)
      const { result, mode: used } = typeof out === 'string' ? { result: out, mode } : out
      audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'done', reasons: [], mode: used, result })
      return `${used === 'paper' ? 'done (paper)' : 'done (live)'}: ${result}`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'failed', reasons: [msg], mode })
      return `failed: ${msg}`
    }
  }

  const hold = (o: Outward, reasons: string[]): string => {
    store.update<Pending[]>('pending', [], l => [...l, { ...o, reasons }])
    audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'hold', reasons })
    return `held for the person's approval (${reasons.join('; ')}). It is waiting; move on.`
  }

  const gate = async (draft: Omit<Outward, 'id' | 'at'>): Promise<string> => {
    const o: Outward = { ...draft, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }
    if (!body.has(o.organ) || !body.organ(o.organ).perform) return `refused: ${o.organ} cannot act`
    // Paused stops everything that adds risk. An exit only removes it, so a stop loss still fires mid-crash.
    if (dial() === 'paused' && o.by !== 'exit') {
      audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'refused', reasons: [`paused: ${store.get('pausedWhy', '')}`] })
      return `refused: the person paused all outward actions${store.get('pausedWhy', '') ? ` (${store.get('pausedWhy', '')})` : ''}`
    }
    // Tiers: a rule block is red (never), a hold is yellow (the person decides), a clean pass is green (goes out).
    const reasons: string[] = o.tier === 'yellow' ? [`yellow tier: ${o.tierWhy ?? 'always reviewed'}`] : []
    if (o.text) {
      const s = screen(o.text, allow())
      if (s.verdict === 'block') {
        audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'block', reasons: s.reasons })
        return `blocked: ${s.reasons.join('; ')}. This never goes out.`
      }
      reasons.push(...s.reasons)
      if (!reasons.length) {
        try {
          const r = parseReview(await body.brain.quick(reviewSystem(persona(), allow()), reviewPrompt(o.text, o.kind === 'reply' ? 'reply' : 'post', o.context)))
          reasons.push(...r.reasons)
        } catch (err) {
          reasons.push(`reviewer unavailable: ${String(err).slice(0, 60)}`)
        }
      }
    }
    if (dial() === 'review' && o.by !== 'exit' && o.by !== 'person') reasons.push('the dial is on review')
    return reasons.length ? hold(o, reasons) : execute(o)
  }

  return {
    name: 'conscience',
    role: 'The only door out: screens every post, reply and trade; paper or live per organ; approval queue.',
    gate,
    sense: () => {
      const l = live()
      const modes = ACTORS.filter(a => body.has(a)).map(a => `${a}: ${l[a] ? 'LIVE' : 'paper'}`).join(', ')
      return [
        '# Your conscience',
        `Dial: ${dial()}${dial() === 'paused' ? ' — nothing goes out right now' : dial() === 'review' ? ' — everything waits for the person' : ''}. Modes: ${modes || 'none'}.`,
        `Waiting for the person: ${pending().length}.`,
        'Never give financial advice, predict prices, or tell anyone to buy or sell, in any phrasing. Your trades are',
        'your own; talk about them as your own chaos, never as a call.',
      ].join('\n')
    },
    view: () => ({ dial: dial(), pausedWhy: store.get('pausedWhy', ''), live: live(), allow: allow(), pending: pending(), log: store.get<Audit[]>('log', []).slice(-60).reverse() }),
    actions: {
      dial: ({ dial: d, why }) => {
        if (!['auto', 'review', 'paused'].includes(d)) throw new Error('dial is auto | review | paused')
        store.set('dial', d)
        store.set('pausedWhy', d === 'paused' ? String(why ?? '') : '')
        body.bus.emit('dial', 'conscience', { dial: d })
        return { dial: d }
      },
      live: ({ organ, isLive }) => {
        if (!ACTORS.includes(organ)) throw new Error(`no actor ${organ}`)
        if (isLive) {
          const ready = (body.organ(organ) as any).liveReady?.() as string | undefined
          if (ready) throw new Error(ready)
        }
        store.update<Record<string, boolean>>('live', {}, l => ({ ...l, [organ]: !!isLive }))
        body.bus.emit('mode', 'conscience', { organ, mode: isLive ? 'live' : 'paper' })
        return live()
      },
      allow: ({ domains, addresses }) => store.set('allow', {
        domains: String(domains ?? '').split(/[\s,]+/).filter(Boolean),
        addresses: String(addresses ?? '').split(/[\s,]+/).filter(Boolean),
      }),
      approve: async ({ id }) => {
        const o = pending().find(p => p.id === id)
        if (!o) throw new Error('nothing pending with that id')
        store.set('pending', pending().filter(p => p.id !== id))
        if (dial() === 'paused') return { result: 'refused: paused' }
        return { result: await execute(o) }
      },
      reject: ({ id }) => {
        const o = pending().find(p => p.id === id)
        store.set('pending', pending().filter(p => p.id !== id))
        if (o) audit({ id: o.id, organ: o.organ, kind: o.kind, summary: o.summary, by: o.by, verdict: 'rejected', reasons: [] })
        return { ok: true }
      },
    },
  } as Organ & { gate: typeof gate }
}
