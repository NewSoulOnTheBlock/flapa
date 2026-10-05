import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FomoRow, FomoWindow } from '../types'
import { FOMO_MCP_URL, parseToolReply, postBrief, rpcBody, toRows, usd } from './fomo'
import { DAILY_DEFAULT, dayKey, isDue } from './daily'
import type { DailyConfig } from './daily'

const PANE = 'fomo'
const REFRESH_MS = 30 * 60_000
const DAILY_TICK_MS = 10 * 60_000
const X_CACHE_MS = 7 * 24 * 3_600_000
const WINDOWS: readonly FomoWindow[] = ['24h', '7d', '30d', 'all']

const windowAtom = atom({ plugin: 'fomo', key: 'window' } as const, '24h')
const board = atom({ plugin: 'fomo', key: 'board' } as const, [])
const updatedAt = atom({ plugin: 'fomo', key: 'updatedAt' } as const, 0)
const status = atom({ plugin: 'fomo', key: 'status' } as const, '')

let rpcId = 0

/** One read-only tool call against fomo-mcp's hosted server. */
async function fomoCall($: EngineInterface, tool: string, args: Record<string, unknown>) {
  try {
    const r = await $.http.fetch(FOMO_MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: rpcBody(++rpcId, tool, { ...args, response_format: 'json' }),
    })
    if (!r.ok) return { ok: false as const, error: `fomo-mcp answered ${r.status}` }
    return parseToolReply(r.text)
  } catch (err) {
    return { ok: false as const, error: `could not reach fomo-mcp: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Token symbols for bare addresses, remembered so each costs one lookup ever. */
async function nameTokens($: EngineInterface, addresses: readonly string[]): Promise<Record<string, string>> {
  const names = ((await $.store.get('names')) as Record<string, string> | undefined) ?? {}
  for (const address of addresses) {
    if (!address || names[address] || address.length <= 8) continue
    const r = await fomoCall($, 'fomo_search_tokens', { query: address })
    const symbol = r.ok ? r.value?.items?.[0]?.token?.symbol : undefined
    if (symbol) names[address] = symbol
  }
  await $.store.set('names', names)
  return names
}

/** Each trader's linked X handle from their fomo profile, cached for a week (a profile costs 250). */
async function linkX($: EngineInterface, rows: FomoRow[]): Promise<FomoRow[]> {
  const cache = ((await $.store.get('xHandles')) as Record<string, { x: string | null; at: number }> | undefined) ?? {}
  const now = Date.now()
  for (const r of rows) {
    const hit = cache[r.handle]
    if (hit && now - hit.at < X_CACHE_MS) continue
    const p = await fomoCall($, 'fomo_get_trader', { handle: r.handle })
    if (p.ok) cache[r.handle] = { x: typeof p.value?.twitter === 'string' && p.value.twitter ? p.value.twitter : null, at: now }
  }
  await $.store.set('xHandles', cache)
  return rows.map(r => ({ ...r, x: cache[r.handle]?.x ?? null }))
}

async function dailyConfig($: EngineInterface): Promise<DailyConfig> {
  return { ...DAILY_DEFAULT, ...((await $.store.get('daily')) as Partial<DailyConfig> | undefined) }
}

/** The top 3 with their X handles, handed to the agent to write and post. '' when handed over. */
async function postTop3($: EngineInterface): Promise<string> {
  const rows = await refresh($, 3)
  if (typeof rows === 'string') return rows
  const tagged = await linkX($, rows)
  await $.prompt.submit({ text: postBrief(tagged, await read($, windowAtom)) })
  return ''
}

async function refresh($: EngineInterface, limit = 10): Promise<FomoRow[] | string> {
  const window = await read($, windowAtom)
  await update($, status, () => 'loading…')
  const r = await fomoCall($, 'fomo_get_leaderboard', { window, limit })
  if (!r.ok) {
    await update($, status, () => r.error)
    return r.error
  }
  const items: any[] = r.value?.items ?? []
  const best = items.map(i => [...(i.topTokens ?? [])].sort((a: any, b: any) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0])
  const names = await nameTokens($, best.map(t => t?.token?.address ?? ''))
  const rows = toRows(items, names)
  await update($, board, () => rows)
  await update($, updatedAt, () => Date.now())
  await update($, status, () => '')
  await $.store.set('board', { window, rows, at: Date.now() })
  return rows
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('board')) as { window: FomoWindow; rows: FomoRow[]; at: number } | undefined
    if (saved) {
      await update($, windowAtom, () => saved.window)
      await update($, board, () => saved.rows)
      await update($, updatedAt, () => saved.at)
    }
    await $.command.register({
      name: 'fomo',
      description: 'fomo.family leaderboard tab: /fomo [24h|7d|30d|all] · /fomo post · /fomo daily on|off|at <hour>',
    })
    // Fresh numbers while the tab is up; nothing is fetched when it is closed.
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        const panes = await $.ui.panes()
        if (panes.some(p => p.id === PANE && p.isShown)) await refresh($)
      })()
    })
    // Once a day, from the configured local hour: the 24h top 3, posted by the agent.
    $.clock.every(DAILY_TICK_MS, () => {
      void (async () => {
        const cfg = await dailyConfig($)
        const now = new Date()
        if (!isDue(cfg, now)) return
        await $.store.set('daily', { ...cfg, lastDay: dayKey(now) })
        await update($, windowAtom, () => '24h')
        const failed = await postTop3($)
        if (failed) {
          // Nothing handed over: the next tick tries again today.
          await $.store.set('daily', cfg)
          $.ui.toast(`fomo daily post: ${failed}`)
        }
      })()
    })
    if ((await $.store.get('paneOpen')) === true) void $.ui.open({ id: PANE, title: 'FOMO' })
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set('paneOpen', false)
    return next(e)
  })

  on('command.run', { command: 'fomo' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'post') {
      // A model turn of its own, once the session is idle: the agent writes and posts.
      $.clock.after(1, () => {
        void (async () => {
          const failed = await postTop3($)
          if (failed) $.ui.toast(`fomo: ${failed}`)
        })()
      })
      return { text: 'Pulling the fomo top 3; the agent will write and post about them next.' }
    }
    if (arg === 'daily' || arg.startsWith('daily ')) {
      const [, sub = '', hour = ''] = arg.split(/\s+/)
      const cfg = await dailyConfig($)
      if (sub === 'on') {
        // Starting today could double up with a post made by hand today: begin tomorrow.
        await $.store.set('daily', { ...cfg, isOn: true, lastDay: cfg.lastDay ?? dayKey(new Date()) })
        return { text: `Daily fomo post on: once a day from ${cfg.hour}:00 local, the 24h top 3, written and posted by the agent.` }
      }
      if (sub === 'off') {
        await $.store.set('daily', { ...cfg, isOn: false })
        return { text: 'Daily fomo post off.' }
      }
      if (sub === 'at') {
        const h = Number(hour)
        if (!Number.isInteger(h) || h < 0 || h > 23) return { text: 'Usage: /fomo daily at <hour 0-23>' }
        await $.store.set('daily', { ...cfg, hour: h })
        return { text: `Daily fomo post at ${h}:00 local.` }
      }
      return {
        text: `Daily fomo post: ${cfg.isOn ? `on, from ${cfg.hour}:00 local` : 'off'}` +
          `${cfg.lastDay ? ` · last ${cfg.lastDay}` : ''}\n/fomo daily on | off | at <hour>`,
      }
    }
    if ((WINDOWS as readonly string[]).includes(arg)) await update($, windowAtom, () => arg as FomoWindow)
    await $.ui.open({ id: PANE, title: 'FOMO', focus: true })
    await $.store.set('paneOpen', true)
    $.clock.after(1, () => void refresh($))
    return { text: `fomo leaderboard (${await read($, windowAtom)}) loading in the FOMO tab.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, board)
    const window = await read($, windowAtom)
    const note = await read($, status)
    const at = await read($, updatedAt)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Text bold>fomo top traders</Text>
          {WINDOWS.map(w => (
            <Button
              key={`w-${w}`}
              plain
              dimColor={w !== window}
              onPress={() => void (async () => {
                await update($, windowAtom, () => w)
                await refresh($)
              })()}
            >
              {w === window ? `[${w}]` : w}
            </Button>
          ))}
          <Button key="refresh" plain dimColor onPress={() => void refresh($)}>
            ↻
          </Button>
        </Box>
        <Text dimColor>
          {note || (at ? `updated ${new Date(at).toISOString().slice(11, 16)} UTC · biggest winner = top position PnL` : 'loading…')}
        </Text>
        {rows.map(r => (
          <Box key={`r-${r.handle}`} flexDirection="row" columnGap={1}>
            <Text dimColor>{String(r.rank).padStart(2)}.</Text>
            <Text bold>{r.handle.slice(0, 16).padEnd(16)}</Text>
            <Text color={r.pnlUsd >= 0 ? 'green' : 'red'}>{usd(r.pnlUsd).padStart(9)}</Text>
            {r.top ? (
              <Text dimColor>
                {' '}${r.top.symbol} {usd(r.top.pnlUsd)}
              </Text>
            ) : null}
          </Box>
        ))}
        <Button key="post" variant="primary" onPress={() => void (async () => {
          const top = await read($, board)
          if (top.length) await $.prompt.submit({ text: postBrief(top, await read($, windowAtom)) })
        })()}>
          have the agent post the top 3
        </Button>
      </Box>
    )
  })
}
