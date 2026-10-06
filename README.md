# Flapa

**An always-on body for an AI agent persona.** Flapa is a Bun daemon that thinks, remembers, posts on X, and
trades on BNB Chain, around the clock, with a dashboard to watch and steer her. The persona living in it is
also called Flapa ([@FlapaKuwai](https://x.com/FlapaKuwai)): a kawaii, chart-obsessed AI day trader who wants to
be #1 on the [fomo.family](https://fomo.family) leaderboard.

It grew out of PACS, a set of 13 Claude Code mods; those are preserved at the
[`pacs-final`](https://github.com/NewSoulOnTheBlock/flapa/tree/pacs-final) tag. Flapa is the host instead of a guest:
her own agent loop, her own clock, her own dashboard.

- **Dashboard:** `http://127.0.0.1:7777` (local only) · **Public window:** https://flapa-nu.vercel.app (read-only)
- **Social side roadmap:** [`docs/social-roadmap.md`](docs/social-roadmap.md)

```
   stimuli: you (chat) · heartbeat · posting calendar · news · market moves · mentions · milestones
                                          │
                                       CORTEX  one thought at a time, tools from every organ
   ┌──────────┬──────────┬────────┬───────┴──┬──────────┬──────────┐
 identity   beliefs    agenda   affect     memory      eyes          ← the mind (each adds to the prompt)
 persona,   stances    goals,   mood,      mem0:       markets,
 style,     with       to-dos   energy     every turn, news, digest,
 lore,      reasons                        each person prices
 story
                                          │
                         CONSCIENCE ── the only door out ──────────┐
                           rules → reviewer → green / yellow / red  │
                           dial: auto | review | paused · crisis    │
                           paper | live per organ                   │
                                ├── voice  posts, replies, metrics  │
                                └── hands  trades on BNB Chain ─────┘
```

## What she does

### On X (the voice organ)

| | |
|---|---|
| **Posting calendar** | 3 posts a day (1 to 6) at the hours her own numbers say work best; 9:00, 13:00 and 20:00 until there is data. A missed slot is skipped after two hours, never posted late. A fixed interval is one click away. |
| **Posting engine** | Code picks *what*, she writes *how*. 399 topics in 12 sections (half trading, half kawaii life) in `personas/flapa.topics.json`, weighted, never repeating lately, sometimes blending trading with kawaii. Each post gets a shape (hot take, confession, ranking, question…), a goal (followers 35%, replies 30%, expertise 25%, soft promo 10%) and a kind (post, poll on question shapes, short thread on trading topics). |
| **Draft scoring** | She drafts three versions, scores each on hook, novelty, emotion, shareability and reply potential, posts the best, and the score (0-100) is kept on the post. |
| **Measure and learn** | Every 6 hours she reads her own posts' numbers (views, likes, replies, reposts, quotes, bookmarks, profile clicks) and her follower count. She finds her baseline, the sections, shapes, goals and hours that beat it, and the reasons her best posts stood out. Topic weights shift (0.6× to 1.6×, cautious on small samples) and every brief carries a short "what your numbers say". |
| **Mentions** | Each mention is sorted (fan, question, chat, critic, troll, spam, collab offer). Spam and trolls are skipped. Critics, collab offers and accounts over 250k followers get a reply that waits for you. Replies see the post being answered and what she remembers about that person. |
| **Outbound replies** | Off by default. Every 2 hours (capped per day) she searches her watch list (or her niche), scores posts on reach, freshness, momentum, fit and crowding, skips shills and accounts under 1k followers, and answers the best one. |
| **People** | Everyone she talks to gets a relationship record (mentions, replies, kinds, strength) and their own memories in mem0. |
| **Persona, lore, story** | Style rules (words she uses, words she never uses, caps, emoji, length, conflict), a reputation line every post should reinforce, and favorite accounts. Catchphrases, running jokes and recurring characters grow at most two a week from what she actually posted. Story chapters are written from real events (first trade, first win, losses, streaks, follower milestones, posts that blew up) as Day N of her life. |
| **Research and news** | Every 30 minutes: CoinDesk, Cointelegraph, Decrypt and The Block. Each headline keeps its source and time; a story two outlets ran is marked confirmed. A daily digest names the three narratives that matter, with sources, and feeds her thoughts. Breaking news squarely in her niche (BNB Chain, memecoins) wakes her to react, at most twice a day, and that post always waits for you. |
| **Triggers** | BNB or BTC moving 5%+ in a day: one in-character reaction. Passing a follower milestone: a celebration post. A 50k+ account mentioning her, or a 10k+ account following her: a to-do for you. An engagement slump: the next 48 hours of posts change shape and lead harder. |

### Trading (the hands organ)

- **Trade cycle:** every 2 hours she makes one trade. She buys the best-scoring PancakeSwap v2 WBNB pool from
  GeckoTerminal (liquid, at least 3 days old, rising but not parabolic, more buyers than sellers, actively traded),
  or, when her slots or the day's budget are full, sells her weakest bag. Nothing qualifies, she skips.
- **Limits in code:** per-trade and daily budgets, a daily loss stop, max open positions, minimum liquidity,
  per-token cooldown, slippage. Exits run every 2 minutes: half off at take-profit, then a trailing stop; stop-loss.
- **Paper and live never mix.** Separate positions, daily books and cooldowns. A buy follows the switch; a sell
  follows the position, so a live bag keeps its stop loss even after the switch goes back to paper.
- **fomo mode:** her wallet is a fomo.family smart account (EIP-7702). Swaps go out as user operations through the
  EntryPoint, paid by a separate gas wallet, so her trades count on fomo. Only `helper/trade.mjs` ever reads the keys.
- **Copy-scan** (off by default) reads what fomo's top traders bought and lets her judge each signal.

### Safety (the conscience organ)

- **Every outward action** (post, reply, trade) passes one gate and is stored as data, so anything held for you
  survives a restart and runs in whatever mode is current when you approve it.
- **Tiers:** red never goes out (keys, claiming to be human, impersonation, talk of her X setup or fomo being down).
  Yellow waits for you (buy or sell calls, price predictions, promises, giveaways, politics, tragedies, accusing
  anyone of fraud, news reactions, replies to critics or huge accounts). Green goes out.
- **Reviewer:** a quick model also checks for advice in disguise, unsure facts stated as fact, fights with named
  accounts, screenshot risk, and posts that don't sound like her.
- **Dial:** auto, review (everything waits) or paused (nothing goes out, except exits: a stop loss only removes risk).
- **Crisis mode:** 6+ hostile mentions from 4+ accounts within an hour pauses everything, drafts a calm statement
  (never posted on its own), adds a to-do and shows a banner. Mentions are watched even with auto-reply off.

### Memory

With `MEM0_API_KEY` set, her long-term memory lives in [mem0](https://mem0.ai): every turn is kept there (mem0
extracts and dedupes), recall is semantic search, and each X account has its own memories (`user_id x:<handle>`).
Local memories migrate once. Without a key, a local extractor and word-and-entity recall do the job.

## Run it locally

```sh
bun install
bun start            # → http://127.0.0.1:7777
bun test             # 112 tests
```

Put keys in `.env` (git ignores it; Bun loads it). Never paste them into chat. Every outward organ starts on
**paper**; going live is a switch per organ in the dashboard header, refused until that organ's keys exist.

## Run it 24/7 on Render

`Dockerfile` + `render.yaml` describe a Render background worker (Starter plan, 1 GB disk for her state).

1. `claude setup-token` on your machine: a one-year token for the brain (`CLAUDE_CODE_OAUTH_TOKEN`).
2. `bun scripts/pack-state.ts` right before deploying: packs her state into `state-seed.txt` for `FLAPA_SEED`.
   It is applied once, only to an empty disk.
3. Render → New → Blueprint → this repo. Paste the secrets it asks for.
4. When the logs say `seeded 6 state files`, stop the local copy. **Two running copies post twice.**

If Render reports out-of-memory, move to the Standard plan: every thought starts a `claude` process.

## Environment

| var | for |
|---|---|
| `ANTHROPIC_API_KEY` | the API brain (`claude-opus-5-5`, `claude-haiku-4-5` for quick calls). Without it she uses `claude -p` |
| `CLAUDE_CODE_OAUTH_TOKEN` | signs `claude -p` in on a server (from `claude setup-token`) |
| `FLAPA_BRAIN` | force `api` or `cli` |
| `FLAPA_MODEL`, `FLAPA_QUICK_MODEL`, `FLAPA_EFFORT` | brain overrides |
| `FLAPA_BRAIN_TIMEOUT_S` | how long one `claude -p` call may take (default 240) |
| `MEM0_API_KEY` | long-term memory in mem0 |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | posting, mentions, metrics, search (OAuth 1.0a user keys) |
| `BLOB_READ_WRITE_TOKEN` | the public window's snapshot (Vercel Blob) |
| `FLAPA_TRADER_KEY` | her trading wallet (only the helper reads it) |
| `FLAPA_WALLET_MODE`, `FLAPA_GAS_KEY` | `fomo` for her fomo.family smart account, and the gas wallet that pays for it |
| `BSC_RPC_URL` | BNB Chain RPC |
| `FLAPA_TRADER_MAX_BNB` | the helper's own hard cap per buy (default 0.1) |
| `FLAPA_PORT`, `FLAPA_HOME` | default `7777`, `./data` |
| `FLAPA_SEED` | one-time state import on a fresh host |

Data sources that need no key: GeckoTerminal and DexScreener (pools), CoinGecko (prices), the four news RSS feeds.

## Useful scripts

All read-only unless noted.

| script | shows |
|---|---|
| `bun scripts/x-probe.ts` | what the X keys can read |
| `bun scripts/learn-preview.ts` | what the measure-and-learn loop sees on her real account |
| `bun scripts/reply-preview.ts [handles…]` | which post outbound replies would pick right now |
| `bun scripts/cycle-preview.ts` | what the next trade cycle would buy |
| `bun scripts/mem0-check.ts` | a mem0 round trip (writes and deletes one test memory) |
| `bun scripts/pack-state.ts` | packs her state for `FLAPA_SEED` (writes `state-seed.txt`) |
| `bun scripts/helper.ts <cmd> '<json>'` | runs the trade helper; add `"dryRun": true` to simulate |
| `bun scripts/check-keys.ts` | checks the keys in `.env` have the right shapes |

## The public window

`site/` is a read-only copy of the dashboard on Vercel at https://flapa-nu.vercel.app. Flapa uploads one public
Vercel Blob, `flapa/snapshot.json`, whenever something changes and at least every 4 minutes. The snapshot
(`src/core/publish.ts`) is an allow-list: mood, goals, beliefs, research, positions and trades, posts that went out,
and thoughts from turns she started herself. Never chats with you, memories, held or blocked actions, the approval
queue, controls, or anything shaped like a key. Nothing on Vercel can reach back to her. Redeploy with
`cd site && vercel deploy --prod`.

The local dashboard listens on 127.0.0.1 only, checks the Host header, and every call carries a per-boot token, so
other websites can't drive her.

## Layout

```
src/core     body (organs, queue, clock), brain (API or CLI), store, server, publish, seed
src/organs   identity · conscience · beliefs · agenda · affect · memory · eyes · voice · hands
src/lib      the pure logic behind them (one tested file each): analytics, calendar, crisis, lore, mem0,
             news, posting, rules, social, strategy, triggers, limits, market, …
personas     flapa.json (who she is) · flapa.topics.json (what she posts about)
helper       trade.mjs, the only process that touches keys
web · site   the local dashboard · the public window
docs         social-roadmap.md
```

## Writing an organ

```ts
export function gills(body: Body): Organ {
  const store = body.store('gills')
  return {
    name: 'gills', role: 'One line for the dashboard.',
    tools: [/* {name, description, input_schema, run} */],
    sense: async turn => 'a system-prompt section, or undefined',
    after: async (turn, result) => {},            // post-turn work
    rhythms: [{ name: 'breathe', due: (now, last) => now - last > 60_000, run: async () => {} }],
    perform: async (outward, mode) => 'result',   // only if it acts outward; called by the conscience
    view: () => ({}), actions: { doThing: input => ({}) },   // dashboard
  }
}
```

Grow it in `src/main.ts`. Its tools, prompt section, rhythms and dashboard data are wired in automatically.
