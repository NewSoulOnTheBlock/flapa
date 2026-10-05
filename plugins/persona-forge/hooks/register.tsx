import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { QUESTIONS, SYSTEM, interviewPrompt, parseDraft, personaFile } from './forge'

const PANE = 'forge'
const PROFILES = { plugin: 'persona-core', key: 'profiles' } as const
const STANCE_TOOL = 'mcp__opinion-ledger__stance'

const step = atom({ plugin: 'persona-forge', key: 'step' } as const, 0)
const answers = atom({ plugin: 'persona-forge', key: 'answers' } as const, [])
const draft = atom({ plugin: 'persona-forge', key: 'draft' } as const, null)
const status = atom({ plugin: 'persona-forge', key: 'status' } as const, '')

async function takenIds($: EngineInterface): Promise<string[]> {
  try {
    const { value = [] } = await $.state.get(PROFILES)
    return value.map(p => p.id)
  } catch {
    return []
  }
}

async function restart($: EngineInterface, name = '') {
  await update($, step, () => (name ? 1 : 0))
  await update($, answers, () => (name ? [name] : []))
  await update($, draft, () => null)
  await update($, status, () => '')
}

async function answer($: EngineInterface, text: string) {
  const at = await read($, step)
  await update($, answers, list => {
    const next = [...list]
    next[at] = text.trim()
    return next
  })
  await update($, step, s => Math.min(QUESTIONS.length, s + 1))
}

/** One generation pass over the answers; the draft lands in state for review. */
async function forge($: EngineInterface) {
  await update($, status, () => 'forging… (about 20 to 40 seconds)')
  const r = await $.model.complete({
    model: 'sonnet',
    system: SYSTEM,
    prompt: interviewPrompt(await read($, answers)),
    maxTokens: 3000,
    timeoutMs: 120_000,
  })
  if (!r.isAnswered) {
    await update($, status, () => `forge failed: ${r.reason}; press forge to retry`)
    return
  }
  const d = parseDraft(r.text, await read($, answers), await takenIds($))
  if (!d) {
    await update($, status, () => 'the model answered with no usable persona; press forge to retry')
    return
  }
  await update($, draft, () => d)
  await update($, status, () => 'draft ready: review it, then save, or forge again')
}

/** Writes the persona file, imports it through persona-core, seeds its stances. */
async function adopt($: EngineInterface): Promise<string> {
  const d = await read($, draft)
  if (!d) return 'Nothing forged yet.'
  const path = `.claude/personas/${d.id}.json`
  await $.fs.write(path, personaFile(d))
  await $.command.run({ command: 'persona', args: `import ${path}` })
  let seeded = 0
  for (const s of d.stances) {
    try {
      await $.tool.call({ tool: STANCE_TOOL, ...s } as never)
      seeded++
    } catch {
      // opinion-ledger not loaded: the stances stay in the draft only.
    }
  }
  const note = `${d.name} saved to ${path} and active` + (d.stances.length ? `; ${seeded}/${d.stances.length} stances seeded` : '')
  await update($, status, () => note)
  return note
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'forge',
      description: 'Forge a new agent persona by interview: /forge [name]',
    })
    return next(e)
  })

  on('command.run', { command: 'forge' }, async ($, e) => {
    await restart($, e.args.trim())
    await $.ui.open({ id: PANE, title: 'Forge', focus: true })
    return { text: `Persona forge opened: ${QUESTIONS.length} questions, then a draft to review.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const at = await read($, step)
    const given = await read($, answers)
    const d = await read($, draft)
    const note = await read($, status)

    if (!Input) return <Text dimColor>The forge needs a text field: open it in the terminal or desktop app.</Text>

    const progress = (
      <Text dimColor>
        {'●'.repeat(Math.min(at, QUESTIONS.length))}
        {'○'.repeat(Math.max(0, QUESTIONS.length - at))} {Math.min(at, QUESTIONS.length)}/{QUESTIONS.length}
      </Text>
    )

    if (at < QUESTIONS.length) {
      const q = QUESTIONS[at]!
      return (
        <Box flexDirection="column">
          {progress}
          <Text bold>{q.ask}</Text>
          <Input
            key={`q-${at}`}
            placeholder={q.hint}
            submitLabel="next"
            value={given[at] ?? ''}
            autoFocus
            onSubmit={(value: string) => void answer($, value)}
          />
          <Box flexDirection="row" columnGap={1}>
            {at > 0 && (
              <Button key="back" plain dimColor onPress={() => void update($, step, s => Math.max(0, s - 1))}>
                ◀ back
              </Button>
            )}
            <Button key="skip" plain dimColor onPress={() => void answer($, '')}>
              skip ▶
            </Button>
          </Box>
          {given.slice(0, at).map((a, i) => (
            <Text key={`a-${i}`} dimColor>
              {QUESTIONS[i]!.key}: {a || '(forge decides)'}
            </Text>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {progress}
        <Box flexDirection="row" columnGap={1}>
          <Button key="forge" variant="primary" hotkey="f" onPress={() => $.clock.after(1, () => void forge($))}>
            {d ? 'forge again' : 'forge'}
          </Button>
          {d && (
            <Button key="save" hotkey="s" onPress={() => $.clock.after(1, () => void adopt($))}>
              save & use
            </Button>
          )}
          <Button key="edit" plain dimColor onPress={() => void update($, step, () => 0)}>
            edit answers
          </Button>
        </Box>
        {note && <Text dimColor>{note}</Text>}
        {d && (
          <Box flexDirection="column">
            <Text bold>
              {d.name}
              {d.handle ? ` @${d.handle}` : ''} — {d.tagline}
            </Text>
            <Text dimColor>voice</Text>
            <Text>{d.voice}</Text>
            <Text dimColor>values: {d.values.join(' · ')}</Text>
            <Text dimColor>never: {d.taboos.join(' · ')}</Text>
            <Text dimColor>example posts</Text>
            {d.examples.map((x, i) => (
              <Text key={`x-${i}`}>  {x}</Text>
            ))}
            {d.stances.length > 0 && <Text dimColor>starting stances</Text>}
            {d.stances.map((s, i) => (
              <Text key={`s-${i}`}>
                {'  '}
                {s.topic}: {s.stance}
              </Text>
            ))}
            <Text dimColor>backstory</Text>
            <Text>{d.backstory}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
