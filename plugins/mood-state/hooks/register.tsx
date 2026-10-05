import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mood } from '../types'
import { decay, fresh, label, moodSection, nudge } from './mood'

const PANE = 'mood'
const TOOL = 'mcp__mood-state__mood'
const TICK_MS = 5 * 60_000
const PERSONA = { plugin: 'persona-core', key: 'active' } as const

const mood = atom({ plugin: 'mood-state', key: 'mood' } as const, fresh(0))
const owner = atom({ plugin: 'mood-state', key: 'owner' } as const, '')

async function persona($: EngineInterface): Promise<{ id: string; name: string }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) return { id: value.id, name: value.name }
  } catch {
    // persona-core not loaded: one shared mood.
  }
  return { id: 'default', name: 'You' }
}

/** Loads the active persona's mood (decayed to now) into state. */
async function sync($: EngineInterface): Promise<{ id: string; name: string; mood: Mood }> {
  const who = await persona($)
  const now = await $.clock.now()
  let m: Mood
  if ((await read($, owner)) === who.id) {
    m = await read($, mood)
  } else {
    m = ((await $.store.get(`mood:${who.id}`)) as Mood | undefined) ?? fresh(now)
    await update($, owner, () => who.id)
  }
  m = decay(m, now)
  await update($, mood, () => m)
  return { ...who, mood: m }
}

async function save($: EngineInterface, id: string, m: Mood) {
  await $.store.set(`mood:${id}`, m)
  await update($, mood, () => m)
  await update($, owner, () => id)
  const { label: l, emoji } = label(m)
  $.ui.status(`${emoji} ${l}`)
}

async function apply($: EngineInterface, what: string, dv: number, de: number): Promise<string> {
  const { id, name, mood: m } = await sync($)
  const next = nudge(m, await $.clock.now(), what, dv, de)
  await save($, id, next)
  return `${name} is now ${label(next).label} (valence ${next.valence.toFixed(2)}, energy ${next.energy.toFixed(2)}).`
}

const PRESETS: Record<string, { what: string; v: number; e: number }> = {
  win: { what: 'a big win', v: 0.5, e: 0.3 },
  loss: { what: 'a painful loss', v: -0.5, e: 0.2 },
  rest: { what: 'a long rest', v: 0.1, e: -0.4 },
  grind: { what: 'a long grind', v: -0.1, e: -0.3 },
  hype: { what: 'something exciting', v: 0.3, e: 0.4 },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Keep the status line honest as moods fade.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const { id, mood: m } = await sync($)
        await save($, id, m)
      })()
    })
    await $.tool.register({
      name: 'mood',
      description:
        "Move the active persona's mood when something happens that would really move it: a win, a loss, " +
        'a rival passing them, praise, a grind. valence -0.6..0.6 (bad..good), energy -0.6..0.6 (drained..wired).',
      inputSchema: {
        type: 'object',
        properties: {
          what: { type: 'string', description: 'What happened, a few words' },
          valence: { type: 'number', minimum: -0.6, maximum: 0.6 },
          energy: { type: 'number', minimum: -0.6, maximum: 0.6 },
        },
        required: ['what', 'valence', 'energy'],
      },
    })
    await $.command.register({
      name: 'mood',
      description: 'Persona mood: /mood [win|loss|rest|grind|hype|reset|baseline <valence> <energy>]',
    })
    const { id, mood: m } = await sync($)
    await save($, id, m)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const { id, name, mood: m } = await sync($)
    if (id === 'default') return composed
    return {
      ...composed,
      sections: [
        ...composed.sections,
        { id: 'mood-state:mood', text: moodSection(name, m, await $.clock.now()), scope: 'session' as const },
      ],
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { what?: string; valence?: number; energy?: number }
    if (!input.what?.trim()) return { deny: 'mood needs what happened' }
    return { result: await apply($, input.what, Number(input.valence), Number(input.energy)) }
  })

  on('command.run', { command: 'mood' }, async ($, e) => {
    const [verb = '', a = '', b = ''] = e.args.trim().split(/\s+/)
    const preset = PRESETS[verb]
    if (preset) return { text: await apply($, preset.what, preset.v, preset.e) }
    if (verb === 'reset' || verb === 'baseline') {
      const { id, mood: m } = await sync($)
      const now = await $.clock.now()
      const bv = verb === 'baseline' ? Math.max(-1, Math.min(1, Number(a))) : m.baseValence
      const be = verb === 'baseline' ? Math.max(0, Math.min(1, Number(b))) : m.baseEnergy
      if (!Number.isFinite(bv) || !Number.isFinite(be)) return { text: 'Usage: /mood baseline <valence -1..1> <energy 0..1>' }
      await save($, id, fresh(now, bv, be))
      return { text: `Mood ${verb === 'reset' ? 'reset' : 'baseline set'}: valence ${bv.toFixed(2)}, energy ${be.toFixed(2)}.` }
    }
    const { name, mood: m } = await sync($)
    await $.ui.open({ id: PANE, title: 'Mood', focus: true })
    const { label: l, emoji } = label(m)
    return { text: `${name}: ${emoji} ${l}. /mood win | loss | rest | grind | hype | reset | baseline <v> <e>` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Drawing may not write state: read, and decay locally for display.
    const who = await persona($)
    const now = await $.clock.now()
    const held = (await read($, owner)) === who.id
      ? await read($, mood)
      : ((await $.store.get(`mood:${who.id}`)) as Mood | undefined) ?? fresh(now)
    const m = decay(held, now)
    const { label: l, emoji } = label(m)
    const bar = (x: number) => '█'.repeat(Math.round(x * 10)).padEnd(10, '░')

    return (
      <Box flexDirection="column">
        <Text bold>
          {emoji} {who.name} is {l}
        </Text>
        <Text>
          <Text dimColor>valence </Text>
          {bar((m.valence + 1) / 2)} {m.valence.toFixed(2)}
        </Text>
        <Text>
          <Text dimColor>energy  </Text>
          {bar(m.energy)} {m.energy.toFixed(2)}
        </Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          {Object.entries(PRESETS).map(([k, p], i) => (
            <Button key={`p-${k}`} plain hotkey={String(i + 1)} onPress={() => void apply($, p.what, p.v, p.e)}>
              {k}
            </Button>
          ))}
          <Button
            key="reset"
            plain
            dimColor
            onPress={() => void (async () => {
              const { id, mood: cur } = await sync($)
              await save($, id, fresh(await $.clock.now(), cur.baseValence, cur.baseEnergy))
            })()}
          >
            reset
          </Button>
        </Box>
        <Text dimColor>recent</Text>
        {m.events.length === 0 && <Text dimColor>  nothing yet</Text>}
        {[...m.events].reverse().map((ev, i) => (
          <Text key={`ev-${i}`}>
            {'  '}
            {ev.valence >= 0 ? '▲' : '▼'} {ev.what}
          </Text>
        ))}
      </Box>
    )
  })
}
