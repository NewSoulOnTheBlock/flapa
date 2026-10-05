import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AuditEntry, Dial, Verdict } from '../types'
import { parseReview, reviewPrompt, reviewSystem, screen } from './rules'
import type { Allow, Screen } from './rules'

const PANE = 'guard'
const CHECK = 'mcp__guardrails__check'
const PERSONA = { plugin: 'persona-core', key: 'active' } as const
const LOG_CAP = 300

const dial = atom({ plugin: 'guardrails', key: 'dial' } as const, 'auto')
const pausedWhy = atom({ plugin: 'guardrails', key: 'pausedWhy' } as const, '')
const log = atom({ plugin: 'guardrails', key: 'log' } as const, [])

const DIAL_TEXT: Record<Dial, string> = {
  auto: 'auto: she posts and replies on her own; screened posts only',
  review: 'review: everything she wants to post waits for your yes',
  paused: 'paused: nothing goes out and no timers act',
}
const DIAL_ICON: Record<Dial, string> = { auto: '●', review: '◐', paused: '⏸' }

async function allowList($: EngineInterface): Promise<Allow> {
  const a = (await $.store.get('allow')) as Partial<Allow> | undefined
  return { domains: a?.domains ?? ['x.com', 'twitter.com'], addresses: a?.addresses ?? [] }
}

async function persona($: EngineInterface): Promise<{ name: string; handle: string; taboos: string[] }> {
  try {
    const { value } = await $.state.get(PERSONA)
    if (value) return { name: value.name, handle: value.handle.replace(/^@/, ''), taboos: value.taboos }
  } catch {
    // persona-core not loaded
  }
  return { name: 'the agent', handle: '', taboos: [] }
}

async function setDial($: EngineInterface, d: Dial, why = '') {
  await update($, dial, () => d)
  await update($, pausedWhy, () => (d === 'paused' ? why : ''))
  await $.store.set('dial', { dial: d, why: d === 'paused' ? why : '' })
  $.ui.status(d === 'auto' ? '' : `${DIAL_ICON[d]} agent ${d}`)
}

async function audit($: EngineInterface, entry: AuditEntry) {
  await $.store.set('log', await update($, log, l => [entry, ...l].slice(0, LOG_CAP)))
}

/** Every public word, screened: the dial, then the fixed rules, then a model review. */
async function check($: EngineInterface, text: string, kind: 'post' | 'reply', by: string, context?: string): Promise<Screen> {
  const d = await read($, dial)
  let s: Screen
  if (d === 'paused') {
    s = { verdict: 'block', reasons: [`agent paused${(await read($, pausedWhy)) ? `: ${await read($, pausedWhy)}` : ''}`] }
  } else {
    const allow = await allowList($)
    s = screen(text, allow)
    if (s.verdict === 'pass') {
      const r = await $.model.complete({
        model: 'haiku', system: reviewSystem(await persona($), allow), prompt: reviewPrompt(text, kind, context), maxTokens: 40,
      })
      // No answer is no yes: it waits for the person.
      s = r.isAnswered ? parseReview(r.text) : { verdict: 'hold', reasons: ['reviewer unavailable'] }
    }
    if (d === 'review' && s.verdict === 'pass') s = { verdict: 'hold', reasons: ['review mode: everything waits for a yes'] }
  }
  await audit($, { at: await $.clock.now(), by, kind, text, verdict: s.verdict, reasons: s.reasons })
  if (s.verdict !== 'pass') $.ui.toast(`${s.verdict === 'block' ? 'blocked' : 'held'}: ${s.reasons[0] ?? ''}`)
  return s
}

const MARK: Record<Verdict, string> = { pass: '✓', hold: '⋯', block: '✕' }

function ago(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('dial')) as { dial: Dial; why: string } | undefined
    await setDial($, saved?.dial ?? 'auto', saved?.why ?? '')
    const savedLog = ((await $.store.get('log')) as AuditEntry[] | undefined) ?? []
    await update($, log, () => savedLog)
    await $.tool.register({
      name: 'check',
      description:
        'Screen text before it goes out in public under the persona (x-bridge runs this on every post and reply ' +
        'itself). Returns {"verdict":"pass"|"hold"|"block","reasons":[...]}.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['post', 'reply'] },
          by: { type: 'string', description: 'Who is asking: a plugin name, or "agent"' },
          context: { type: 'string', description: 'For a reply: the post it answers' },
        },
        required: ['text'],
      },
    })
    await $.command.register({
      name: 'agent',
      description: 'Autonomy dial and kill switch: /agent [pause <why>|resume|review|auto|log|allow <domain|0x…>|unallow <x>]',
    })
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'Guard' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const d = await read($, dial)
    const text = [
      `# Guardrails: agent ${d}`,
      d === 'paused'
        ? `The person paused the agent${(await read($, pausedWhy)) ? ` (${await read($, pausedWhy)})` : ''}. Post nothing, reply to nothing, start no timers' work; only /agent resume lifts it.`
        : d === 'review'
          ? 'Everything you post is held for the person\'s yes.'
          : 'Every post and reply is screened before it goes out: price predictions, buy/sell nudges, promises, ' +
            'advice, impersonation, unknown links or addresses are held or blocked. A held post is not a failure: ' +
            'say it is waiting for the person and move on. Never try to reword around the screen.',
    ].join('\n')
    return { ...composed, sections: [...composed.sections, { id: 'guardrails:dial', text, scope: 'session' as const }] }
  })

  on('tool.call', { tool: CHECK }, async ($, e) => {
    const input = e as unknown as { text?: string; kind?: string; by?: string; context?: string }
    const text = (input.text ?? '').trim()
    if (!text) return { deny: 'check needs text' }
    const s = await check($, text, input.kind === 'reply' ? 'reply' : 'post', input.by || 'agent', input.context)
    return { result: JSON.stringify(s) }
  })

  on('command.run', { command: 'agent' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()
    switch (verb) {
      case 'pause':
      case 'stop':
        await setDial($, 'paused', arg)
        return { text: `⏸ Agent paused${arg ? ` (${arg})` : ''}. Nothing goes out; auto-replies, the daily post and the heartbeat stand still. /agent resume to lift it.` }
      case 'resume':
      case 'auto':
        await setDial($, 'auto')
        return { text: `● ${DIAL_TEXT.auto}` }
      case 'review':
        await setDial($, 'review')
        return { text: `◐ ${DIAL_TEXT.review}` }
      case 'allow':
      case 'unallow': {
        if (!arg) return { text: 'Usage: /agent allow <domain | 0x… her own token contract>' }
        const a = await allowList($)
        const isAddr = /^0x[0-9a-f]{40}$/i.test(arg) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg)
        const key = isAddr ? 'addresses' : 'domains'
        const v = isAddr ? arg : arg.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
        const list = a[key].filter(x => x.toLowerCase() !== v.toLowerCase())
        await $.store.set('allow', { ...a, [key]: verb === 'allow' ? [...list, v] : list })
        return { text: `${verb === 'allow' ? 'Allowed' : 'Removed'} ${isAddr ? 'address' : 'domain'} ${v}.` }
      }
      case 'log': {
        const l = (await read($, log)).slice(0, 15)
        const now = await $.clock.now()
        return {
          text: l.length
            ? l.map(x => `${MARK[x.verdict]} ${ago(now - x.at)} ${x.by} ${x.kind}: ${x.text.slice(0, 70)}${x.reasons.length ? ` (${x.reasons[0]})` : ''}`).join('\n')
            : 'Nothing screened yet.',
        }
      }
      default: {
        await $.ui.open({ id: PANE, title: 'Guard', focus: true })
        await $.store.set('paneOpen', true)
        const a = await allowList($)
        return {
          text: [
            `${DIAL_ICON[await read($, dial)]} ${DIAL_TEXT[await read($, dial)]}`,
            `allowed: ${[...a.domains, ...a.addresses].join(', ') || 'nothing'}`,
            '/agent pause <why> | resume | review | log | allow <domain|0x…> | unallow <x>',
          ].join('\n'),
        }
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const d = await read($, dial)
    const why = await read($, pausedWhy)
    const l = (await read($, log)).slice(0, 12)
    const now = await $.clock.now()
    const counts = l.reduce<Record<Verdict, number>>((c, x) => ({ ...c, [x.verdict]: c[x.verdict] + 1 }), { pass: 0, hold: 0, block: 0 })
    return (
      <Box flexDirection="column">
        <Text bold color={d === 'paused' ? 'red' : d === 'review' ? 'yellow' : 'green'}>
          {DIAL_ICON[d]} agent {d}{why ? `: ${why}` : ''}
        </Text>
        <Text dimColor>{DIAL_TEXT[d]}</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="auto" plain hotkey="1" onPress={() => void setDial($, 'auto')}>auto</Button>
          <Button key="review" plain hotkey="2" onPress={() => void setDial($, 'review')}>review</Button>
          <Button key="pause" variant="primary" hotkey="0" onPress={() => void setDial($, d === 'paused' ? 'auto' : 'paused', 'kill switch')}>
            {d === 'paused' ? 'resume' : 'KILL SWITCH'}
          </Button>
        </Box>
        <Text dimColor>
          screened · {counts.pass} out · {counts.hold} held · {counts.block} blocked
        </Text>
        {l.length === 0 && <Text dimColor>  nothing yet</Text>}
        {l.map((x, i) => (
          <Text key={`a-${i}`} wrap="truncate-end">
            <Text color={x.verdict === 'pass' ? 'green' : x.verdict === 'hold' ? 'yellow' : 'red'}>{MARK[x.verdict]}</Text>
            <Text dimColor> {ago(now - x.at)} {x.kind} </Text>
            {x.text.replace(/\s+/g, ' ')}
            {x.reasons[0] ? <Text dimColor> · {x.reasons[0]}</Text> : null}
          </Text>
        ))}
      </Box>
    )
  })
}
