# SOMA

**An always-on body for an AI agent persona.** The 13 [PACS](https://github.com/NewSoulOnTheBlock/personal-agentic-core) Claude Code mods, re-grown as organs of a standalone daemon. It keeps running when no terminal is open.

PACS was a set of guests living inside Claude Code. SOMA is the host. It runs its own agent loop, keeps time with its own clock, and serves its own dashboard at `http://127.0.0.1:7777`.

```
            ┌──────────── stimuli ─────────────┐
 person (chat) · heartbeat · copy signals · daily post
            └───────────────┬──────────────────┘
                         CORTEX  (one thought at a time; tools from every organ)
     ┌─────────┬─────────┬──┴──────┬─────────┬──────────┐
  identity  beliefs   agenda    affect    memory      eyes          ← the mind (sense → system prompt)
                                                      │
                                CONSCIENCE ── the only door out ──┐
                                  rules → reviewer → hold/pass     │
                                  dial: auto | review | paused     │
                                  paper | live per organ           │
                                         ├── voice  (X)            │
                                         └── hands  (BNB trades) ──┘
```

## Organs, and the mods they came from

| organ | was | does |
|---|---|---|
| **identity** | persona-core, persona-forge | Who the mind is. Personas live in `personas/` (Flapa included) plus `data/personas/`. The Forge tab drafts new ones |
| **affect** | mood-state, idle-buddy | Valence and energy that fade 25%/h toward baseline. Trades move the mood. The cat lives on the dashboard now |
| **beliefs** | opinion-ledger | Stances with reasons; a revision keeps its history |
| **memory** | memory-graph | A quick model extracts memories after every turn. Recall uses words, entities, and a one-hop walk. A secret filter guards all of it |
| **agenda** | todo-pane, heartbeat | Goals you and she share. The heartbeat runs the goals → plan → steps → done → next → do-it loop |
| **conscience** | guardrails | Fixed rules, then a model reviewer. It runs the autonomy dial, the kill switch, the approval queue, the audit log, and **paper/live per organ** |
| **eyes** | fomo, trader's DexScreener | Market sight (read-only) and the fomo leaderboard. Daily top-3 post |
| **voice** | x-bridge | Posts and mention auto-replies on X (API transport). Paper mode keeps a local feed |
| **hands** | trader | PancakeSwap v2 trades inside hard limits. Exits run as a rhythm (TP half, SL, trailing). Copy-scan of fomo top traders |
| *(dashboard)* | pacs-welcome | The opening screen became the whole skin |

## What's different from PACS

- **Always on.** Rhythms (heartbeat, exits, auto-reply, copy-scan, daily post) run on the body's clock, not on a terminal session.
- **Paper first.** Every outward organ starts in paper mode. Paper posts land in a local feed. Paper trades fill at the live pool price minus the 0.25% fee, so it is real practice on real data. Going live is a per-organ switch, and it is refused until that organ's credentials exist.
- **Outward actions are data.** `{organ, kind, payload}` is persisted, so an action held for approval survives a restart and runs in whichever mode is current when you approve it. Limits are checked again at approval time.
- **Two brains.** If `ANTHROPIC_API_KEY` is set, it uses the Anthropic SDK (`claude-opus-5-5` with native tools and server-side refusal fallback, plus `claude-haiku-4-5` for quick reflexes). Otherwise it uses `claude -p` on your Claude subscription, with tools spoken as a text protocol. The PACS function hooks are disabled inside that child process so they don't talk over SOMA's prompt.
- **Not carried over:** x-bridge's Chrome transports (they needed Claude Code's browser extension) and terminal panes and bands.

## Run

```sh
bun install
bun start            # → http://127.0.0.1:7777
bun test             # 20 tests: carried-over logic + cortex, conscience gate, paper trading
```

Environment (all optional; set them in your shell, never paste them into chat):

| var | for |
|---|---|
| `ANTHROPIC_API_KEY` | API brain. Without it, SOMA uses `claude -p` |
| `SOMA_BRAIN` | force `api` or `cli` |
| `SOMA_MODEL`, `SOMA_QUICK_MODEL`, `SOMA_EFFORT` | default `claude-opus-5-5`, `claude-haiku-4-5`, `medium` |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | voice → live, mentions |
| `SOMA_TRADER_KEY` (or `FLAPA_TRADER_KEY`) | hands → live. Only `helper/trade.mjs` ever reads it |
| `SOMA_TRADER_MAX_BNB` | the helper's own hard cap per buy (default 0.1) |
| `SOMA_PORT`, `SOMA_HOME` | default `7777`, `./data` |

The dashboard only listens on 127.0.0.1. Every API call carries a per-boot token baked into the page, so other websites you visit can't drive the body.

## Writing an organ

```ts
export function gills(body: Body): Organ {
  const store = body.store('gills')
  return {
    name: 'gills', role: 'One line for the dashboard.',
    tools: [/* {name, description, input_schema, run} */],
    sense: turn => 'a system-prompt section, or undefined',
    after: async (turn, result) => {},            // post-turn work
    rhythms: [{ name: 'breathe', due: (now, last) => now - last > 60_000, run: async () => {} }],
    perform: async (outward, mode) => 'result',   // only if it acts outward; called by the conscience
    view: () => ({}), actions: { doThing: input => ({}) },   // dashboard
  }
}
```
Grow it in `src/main.ts`. Its tools, prompt section, rhythms and dashboard data are then wired in automatically.
