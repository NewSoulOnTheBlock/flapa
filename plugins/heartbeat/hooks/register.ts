import type { EngineInterface, Register } from 'claude-code'

const MINUTE = 60_000
const DEFAULT_EVERY_MIN = 60
const LOG_FILE = '.claude/heartbeat.md'
// The to-do pane's list, read from its session state (its owner alone writes it).
const TODOS = { plugin: 'todo-pane', key: 'items' } as const

type Config = { isOn: boolean; everyMin: number; lastBeatAt: number; beats: number; goals: string }
type Goal = { text: string; isDone: boolean }

const DEFAULTS: Config = { isOn: true, everyMin: DEFAULT_EVERY_MIN, lastBeatAt: 0, beats: 0, goals: '' }

async function readGoals($: EngineInterface): Promise<Goal[]> {
  try {
    const { value = [] } = await $.state.get(TODOS)
    return value
  } catch {
    // todo-pane not loaded: the beat falls back to the log file and notes.
    return []
  }
}

export function beatPrompt(config: Config, todos: readonly Goal[]): string {
  const open = todos.filter(t => !t.isDone)
  const done = todos.filter(t => t.isDone)
  const goals = open.length
    ? [
        "Goals: the open items on the person's to-do list (the To-do pane), in their order:",
        ...open.map(t => `- ${t.text}`),
      ].join('\n')
    : `The to-do list has no open items: take goals from ${LOG_FILE}, the project, and this conversation.`
  const checked = done.length
    ? ['Already checked off on the to-do list (count these under step 4):', ...done.map(t => `- ${t.text}`)].join('\n')
    : ''
  const notes = config.goals ? `Notes from /heartbeat goals:\n${config.goals}` : ''
  return [
    `Heartbeat #${config.beats + 1}. Run the loop, in order, briefly:`,
    '1. What are my goals?',
    '2. What is my plan?',
    '3. What are the steps?',
    '4. What have I done? (check the work itself: files, git log, test output, not only memory)',
    '5. What should I do next? (the single most valuable next step)',
    '6. Do it.',
    '',
    [goals, checked, notes].filter(Boolean).join('\n\n'),
    '',
    `Keep ${LOG_FILE} as the loop's record: sections Goals, Plan, Steps, Done (dated), Next. ` +
      'Read it first and update it last.',
    'You cannot tick the to-do list yourself: when an item is finished, say which one so the person can check it off.',
    'Stay inside what the person has already asked for. Ask before anything destructive, ' +
      'irreversible or outward-facing (pushes, deploys, purchases, messages, transactions). ' +
      'If nothing is left to do or you are blocked, say so in one line and stop.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Check once a minute; beat once `everyMin` has passed since the last one.
    // The last beat is in $.store, so a reload or a restart keeps the rhythm.
    $.clock.every(MINUTE, () => {
      void (async () => {
        const config = { ...DEFAULTS, ...((await $.store.get('config')) as Partial<Config> | undefined) }
        const now = await $.clock.now()
        if (!config.isOn) return void $.ui.status('♡ heartbeat off')
        if (config.lastBeatAt === 0) {
          // First run: start the clock now instead of beating at once.
          await $.store.set('config', { ...config, lastBeatAt: now })
          return
        }
        const dueIn = config.lastBeatAt + config.everyMin * MINUTE - now
        if (dueIn > 0) return void $.ui.status(`♥ beat in ${Math.ceil(dueIn / MINUTE)}m`)
        await $.store.set('config', { ...config, lastBeatAt: now, beats: config.beats + 1 })
        $.ui.status('♥ beating')
        await $.prompt.submit({ text: beatPrompt(config, await readGoals($)) })
      })()
    })

    // Registered after the timer starts, so a refused command never stops the beat.
    await $.command.register({
      name: 'heartbeat',
      description: 'Hourly loop over your To-do goals: /heartbeat [on|off|now|every <min>|goals <notes>]',
    })

    return next(e)
  })

  on('command.run', { command: 'heartbeat' }, async ($, e) => {
    const config = { ...DEFAULTS, ...((await $.store.get('config')) as Partial<Config> | undefined) }
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = e.args.trim().slice(verb.length).trim()
    const now = await $.clock.now()

    switch (verb) {
      case 'on':
        await $.store.set('config', { ...config, isOn: true, lastBeatAt: now })
        return { text: `Heartbeat on: every ${config.everyMin} min, first beat in ${config.everyMin} min.` }
      case 'off':
        await $.store.set('config', { ...config, isOn: false })
        $.ui.status('♡ heartbeat off')
        return { text: 'Heartbeat off.' }
      case 'now':
        await $.store.set('config', { ...config, lastBeatAt: now, beats: config.beats + 1 })
        // A submit from inside command.run would wait on the turn this hook holds:
        // hand it to a timer, which submits once the session is idle.
        $.clock.after(1, () => {
          void (async () => $.prompt.submit({ text: beatPrompt(config, await readGoals($)) }))()
        })
        return { text: 'Beating now; the timer restarts from here.' }
      case 'every': {
        const minutes = Number(rest[0])
        if (!Number.isFinite(minutes) || minutes < 1) return { text: 'Usage: /heartbeat every <minutes ≥ 1>' }
        await $.store.set('config', { ...config, everyMin: minutes })
        return { text: `Heartbeat every ${minutes} min.` }
      }
      case 'goals':
        await $.store.set('config', { ...config, goals: arg })
        return { text: arg ? `Goals set:\n${arg}` : 'Goals cleared; beats will read them from the project.' }
      default: {
        const todos = await readGoals($)
        const open = todos.filter(t => !t.isDone)
        const goalSummary = open.length
          ? `${open.length} open (${open.map(t => t.text).join('; ')}), ${todos.length - open.length} done`
          : `none open (falls back to ${LOG_FILE})`
        const nextIn = Math.max(0, Math.ceil((config.lastBeatAt + config.everyMin * MINUTE - now) / MINUTE))
        return {
          text: [
            `Heartbeat ${config.isOn ? 'on' : 'off'}, every ${config.everyMin} min, ${config.beats} beats so far.`,
            config.isOn ? `Next beat in ~${nextIn} min.` : '',
            `Goals from the To-do pane: ${goalSummary}`,
            config.goals ? `Notes: ${config.goals}` : '',
            'Commands: /heartbeat on | off | now | every <min> | goals <notes>',
          ].filter(Boolean).join('\n'),
        }
      }
    }
  })
}
