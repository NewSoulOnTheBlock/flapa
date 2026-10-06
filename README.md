# Flapa

**An always-on agent harness: a body for an AI agent persona.** The 13 PACS Claude Code mods, re-grown as organs of a standalone daemon. (This repo used to *be* PACS, the Personal Agentic Core System; the mods are preserved at the [`pacs-final`](https://github.com/NewSoulOnTheBlock/flapa/tree/pacs-final) tag.) It keeps running when no terminal is open.

PACS was a set of guests living inside Claude Code. Flapa is the host. It runs its own agent loop, keeps time with its own clock, and serves its own dashboard at `http://127.0.0.1:7777`.

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
- **Paper first.** Every outward organ starts in paper mode. Paper posts land in a local feed. Paper trades fill at PancakeSwap's own quote (price impact and fee included; mid price if the RPC is unreachable), minus an optional paper tax for taxed memecoins, so it is real practice on real data. Going live is a per-organ switch, and it is refused until that organ's credentials exist.
- **Paper and live never mix.** Each has its own positions, daily books and cooldowns. A buy follows the switch; a sell follows the position it sells, so a live bag keeps its stop loss even after the switch goes back to paper.
- **Paused stops risk, not exits.** The kill switch refuses every post, reply and buy, but a stop loss or take profit still fires. An exit that keeps failing backs off (2 min, 4, 8 … up to an hour) and says so once in her thoughts.
- **Outward actions are data.** `{organ, kind, payload}` is persisted, so an action held for approval survives a restart and runs in whichever mode is current when you approve it. Limits are checked again at approval time.
- **Two brains.** If `ANTHROPIC_API_KEY` is set, it uses the Anthropic SDK (`claude-opus-5-5` with native tools and server-side refusal fallback, plus `claude-haiku-4-5` for quick reflexes). Otherwise it uses `claude -p` on your Claude subscription, with tools spoken as a text protocol. The PACS function hooks are disabled inside that child process so they don't talk over the harness's prompt.
- **Not carried over:** x-bridge's Chrome transports (they needed Claude Code's browser extension) and terminal panes and bands.

## Run

```sh
bun install
bun start            # → http://127.0.0.1:7777
bun test             # 34 tests: carried-over logic, cortex, conscience gate, paper trading, one regression test per review fix
```

Environment (all optional; set them in your shell, never paste them into chat):

| var | for |
|---|---|
| `ANTHROPIC_API_KEY` | API brain. Without it, Flapa uses `claude -p` |
| `FLAPA_BRAIN` | force `api` or `cli` |
| `FLAPA_MODEL`, `FLAPA_QUICK_MODEL`, `FLAPA_EFFORT` | default `claude-opus-5-5`, `claude-haiku-4-5`, `medium` |
| `FLAPA_BRAIN_TIMEOUT_S` | how long one `claude -p` call may take before it is stopped (default 240) |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | voice → live, mentions |
| `FLAPA_TRADER_KEY` | hands → live. Only `helper/trade.mjs` ever reads it |
| `FLAPA_TRADER_MAX_BNB` | the helper's own hard cap per buy (default 0.1) |
| `FLAPA_PORT`, `FLAPA_HOME` | default `7777`, `./data` |

## The posting engine

Her scheduled posts (every 8 hours by default; the 💌 posts tab has the switch, period and "post now") don't ask her to "post something". Code picks the subject; she writes it.

- **The catalog** is `personas/<persona-id>.topics.json`: for Flapa, 399 topics in 12 sections, half trading (mechanics, competition, crypto, TA, psychology, her sassy trader self) and half kawaii life (Japanese culture, fashion, food, cute things, seasons, character flavor). Each section has an *angle* (how to approach it). It is read fresh before every post, so edits apply without a restart. A topic can carry `"months"` to stay in season.
- **The pick** is weighted by section, never the same section twice in a row, and never a topic used in the last 40 posts. About 1 in 4 posts blends a trading topic with a kawaii one, and each post gets a *shape* (hot take, tiny lesson, confession, top-3 ranking, question, …). About 1 in 5 also nods to the dashboard's *storyline*.
- **She writes it** in her voice, through the post tool, so the conscience screens it like any other post. The topic shows on the post in both dashboards. "🎲 roll a preview" shows what the next pick could be without posting.

## The public window

`site/` is a read-only copy of the dashboard, deployed on Vercel at **https://flapa-nu.vercel.app**. Flapa herself stays on your machine. When `BLOB_READ_WRITE_TOKEN` is in `.env` (Bun loads it; git ignores it), she overwrites one public Vercel Blob, `flapa/snapshot.json`, every minute something changes and at least every 4 minutes. The page reads it through a rewrite. Nothing on Vercel can reach back to her.

The snapshot (`src/core/publish.ts`) is an allow-list. It carries her mood, goals, beat notes, beliefs, research, the fomo board, positions and trades, posts that passed the conscience, and the thoughts from turns she started herself. It never carries chats with you, her memories (they are about you), held or blocked actions, tool results, the approval queue, controls, or anything shaped like a key. Redeploy the page with `cd site && vercel deploy --prod`.

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
