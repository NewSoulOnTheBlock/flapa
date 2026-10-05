import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FomoRow, FomoWindow } from '../types'
import { FOMO_MCP_URL, parseToolReply, postBrief, rpcBody, toRows, usd } from './fomo'

const PANE = 'fomo'
const REFRESH_MS = 30 * 60_000
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
      description: 'fomo.family leaderboard tab: /fomo [24h|7d|30d|all] · /fomo post has the agent post the top 3',
    })
    // Fresh numbers while the tab is up; nothing is fetched when it is closed.
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        const panes = await $.ui.panes()
        if (panes.some(p => p.id === PANE && p.isShown)) await refresh($)
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
          const rows = await refresh($, 3)
          if (typeof rows === 'string') {
            $.ui.toast(`fomo: ${rows}`)
            return
          }
          await $.prompt.submit({ text: postBrief(rows, await read($, windowAtom)) })
        })()
      })
      return { text: 'Pulling the fomo top 3; the agent will write and post about them next.' }
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
