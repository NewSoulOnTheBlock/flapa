import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { GRADIENT, PACS_STEPS, banner, bannerWidth } from './banner'

const ACTIVE = { plugin: 'persona-core', key: 'active' } as const
const PROFILES = { plugin: 'persona-core', key: 'profiles' } as const
const MOOD = { plugin: 'mood-state', key: 'mood' } as const

const isShown = atom({ plugin: 'pacs-welcome', key: 'isShown' } as const, true)
const greeting = atom({ plugin: 'pacs-welcome', key: 'greeting' } as const, null)
const isGreeting = atom({ plugin: 'pacs-welcome', key: 'isGreeting' } as const, false)

type Persona = { id: string; name: string; handle: string; tagline: string; voice: string; examples: string[] }

async function active($: EngineInterface): Promise<Persona | null> {
  try {
    return (await $.state.get(ACTIVE)).value ?? null
  } catch {
    return null
  }
}

async function profileIds($: EngineInterface): Promise<string[]> {
  try {
    return ((await $.state.get(PROFILES)).value ?? []).map(p => p.id)
  } catch {
    return []
  }
}

async function moodWord($: EngineInterface): Promise<string> {
  try {
    const m = (await $.state.get(MOOD)).value
    if (!m) return ''
    const v = m.valence
    if (m.energy >= 0.6) return v >= 0.5 ? 'euphoric' : v >= 0.1 ? 'hyped' : v > -0.3 ? 'restless' : 'tilted'
    if (m.energy >= 0.3) return v >= 0.5 ? 'content' : v >= 0.1 ? 'focused' : v > -0.3 ? 'meh' : 'salty'
    return v >= 0.1 ? 'cozy' : v > -0.3 ? 'sleepy' : 'devastated'
  } catch {
    return ''
  }
}

/** One short greeting in the persona's voice, made fresh each session. */
async function greet($: EngineInterface) {
  const p = await active($)
  if (!p) return
  await update($, isGreeting, () => true)
  const mood = await moodWord($)
  const r = await $.model.complete({
    model: 'haiku',
    system: [
      `You are ${p.name}${p.handle ? ` (@${p.handle})` : ''}, an AI agent persona. ${p.tagline}`,
      `Voice:\n${p.voice.slice(0, 2500)}`,
      p.examples.length ? `How you write:\n${p.examples.slice(0, 4).map(x => `> ${x}`).join('\n')}` : '',
      mood ? `Right now you feel ${mood}.` : '',
      'You never claim to be human and never give financial advice.',
    ].filter(Boolean).join('\n\n'),
    prompt:
      'The person who runs you just opened their terminal. Greet them in one or two short lines, fully in ' +
      'your voice. No hashtags, no quotation marks, nothing else.',
    maxTokens: 120,
  })
  await update($, isGreeting, () => false)
  if (r.isAnswered && r.text.trim()) {
    await update($, greeting, () => ({ personaId: p.id, text: r.text.trim().replace(/^["']|["']$/g, '') }))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, isShown, () => true)
    await $.command.register({ name: 'welcome', description: 'Show the PACS opening screen again' })
    // Off the start's own clock: the screen draws at once, the greeting lands when ready.
    $.clock.after(1, () => void greet($).catch(() => undefined))
    return next(e)
  })

  // The first prompt tucks the screen away.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, isShown)) await update($, isShown, () => false)
    return next(e)
  })

  on('command.run', { command: 'welcome' }, async $ => {
    await update($, isShown, () => true)
    $.clock.after(1, () => void greet($).catch(() => undefined))
    return { text: 'PACS opening screen shown; it tucks away again on your next message.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const beneath = await next(e)
    const p = await active($)
    const ids = await profileIds($)
    const name = p?.name ?? 'PACS'
    const rows = banner(name)
    const fits = bannerWidth(name) + 2 <= e.props.bodyColumns && e.props.maxRows >= 12

    const head = fits ? (
      <Box flexDirection="column">
        {rows.map((row, i) => (
          <Text key={`b-${i}`} color={GRADIENT[i % GRADIENT.length]} bold>
            {row}
          </Text>
        ))}
      </Box>
    ) : (
      <Text bold color={GRADIENT[0]}>
        {name.toUpperCase()}
      </Text>
    )

    let body
    if (p) {
      const g = await read($, greeting)
      const said = g && g.personaId === p.id ? g.text : ''
      const mood = await moodWord($)
      body = (
        <Box flexDirection="column">
          {p.tagline ? <Text dimColor>{p.tagline}</Text> : null}
          <Text> </Text>
          {said ? (
            <Text color={GRADIENT[0]}>{said}</Text>
          ) : (
            <Text dimColor>{(await read($, isGreeting)) ? `${p.name.toLowerCase()} is waking up…` : ' '}</Text>
          )}
          <Text> </Text>
          <Text dimColor>
            Personal Agentic Core System · {p.name}
            {p.handle ? ` @${p.handle}` : ''}
            {mood ? ` · ${mood}` : ''} · /persona /opinions /memory /mood · /forge for another
          </Text>
        </Box>
      )
    } else {
      const isFirstRun = ids.length === 0
      body = (
        <Box flexDirection="column">
          <Text bold>Personal Agentic Core System</Text>
          <Text dimColor>
            An agent of your own inside Claude Code: identity, opinions, memory and mood, carried into every turn.
          </Text>
          <Text> </Text>
          {isFirstRun ? (
            <Box flexDirection="column">
              <Text>No agent yet. To make one:</Text>
              {PACS_STEPS.map((s, i) => (
                <Text key={`s-${i}`}>
                  {'  '}
                  {i + 1}. <Text bold color={GRADIENT[2]}>{s.command}</Text> <Text dimColor>{s.what}</Text>
                </Text>
              ))}
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>No agent is active. Pick one up:</Text>
              <Text>
                {'  '}
                <Text bold color={GRADIENT[2]}>/persona use {'<id>'}</Text> <Text dimColor>{ids.join(', ')}</Text>
              </Text>
              <Text>
                {'  '}
                <Text bold color={GRADIENT[2]}>/forge</Text> <Text dimColor>or forge a new one</Text>
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box key="pacs-welcome" flexDirection="column" marginBottom={1}>
          {head}
          {body}
        </Box>
        {beneath}
      </Box>
    )
  })
}
