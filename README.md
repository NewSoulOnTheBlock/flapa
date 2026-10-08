# P.A.C.S | personal agentic core system

**An always-on body for an AI agent persona.** P.A.C.S is a Bun daemon that thinks, remembers, posts on X, hunts
for wallets with an edge and trades on BNB Chain, around the clock, with a dashboard to watch and steer it.

It ships **blank**. The first time it runs, the dashboard opens the **forge**: answer a few questions and it writes
who lives here (voice, values, taboos, style, reputation) and what they post about. Everything after that is
learned: mood, stances, memories, lore, and which posts and trades work.

Every agent is openly an AI. None of them gives financial advice, and everything that leaves the machine passes
one gate you control. Everything starts on **paper**.

```
   stimuli: you (chat) · heartbeat · posting calendar · news · market moves · mentions · radar wallets buying
                                              │
                                           CORTEX  one thought at a time, tools from every organ
   ┌──────────┬──────────┬────────┬──────────┼──────────┬──────────┬──────────┐
 identity   beliefs    agenda   affect     memory      eyes       scout          ← the mind (each adds to the prompt)
 persona,   stances    goals,   mood,      mem0:       markets,   wallet
 forge,     with       to-dos   energy     every turn, news,      warehouse,
 lore,      reasons                        each person digest,    radar,
 story                                                 prices     copy signals
                                              │
                             CONSCIENCE ── the only door out ─────────────┐
                               rules → reviewer → green / yellow / red     │
                               dial: auto | review | paused · crisis       │
                               paper | live per organ                      │
                                    ├── voice  posts, replies, metrics     │
                                    └── hands  trades, exits, cash out ────┘
```

## Quick start

```sh
bun install
bun start            # → http://127.0.0.1:7777  (the forge opens on first run)
bun test             # 152 tests
```

1. **Forge a persona.** Name, what they are, backstory, how they talk, what they care about, what they never do,
   a coin or project if they carry one, accounts they watch. The forge writes `data/personas/<id>.json` and a
   posting catalog `<id>.topics.json`. Edit either by hand; forge more from the **✚ forge** button.
2. **Watch it on paper.** Posts land in a paper feed; trades fill against live PancakeSwap quotes with paper money.
3. **Add keys** to `.env` (git ignores it; Bun loads it). Never paste them into a chat.
4. **Go live per organ** from the dashboard header (💌 posts, 💸 trades). Each switch is refused until its keys exist.

Want a finished example first? Copy `examples/personas/flapa.json` and `flapa.topics.json` into `data/personas/`.
Flapa, a kawaii memecoin trader, was the first agent to live in P.A.C.S.

## Safety model

**One door out.** Every post, reply, trade and transfer goes through the conscience, and is stored as data. Anything
held for you survives a restart and runs in whatever mode is current when you approve it.

| | |
|---|---|
| **Paper vs live** | Each outward organ is paper until you switch it. Paper and live keep separate positions, daily books and cooldowns. A buy follows the switch; a sell follows the position, so a live bag keeps its stop loss after you switch back to paper. |
| **Tiers** | Red never goes out (keys, claiming to be human, impersonation). Yellow waits for you (buy or sell calls, price predictions, promises, giveaways, politics, tragedies, fraud accusations, news reactions, replies to critics or huge accounts). Green goes out. |
| **Reviewer** | A quick model also checks for advice in disguise, unsure facts stated as fact, fights with named accounts, screenshot risk, and posts that don't sound like the persona. |
| **Dial** | Auto, review (everything waits for you) or paused (nothing goes out except exits: a stop loss only removes risk). |
| **Crisis mode** | 6+ hostile mentions from 4+ accounts in an hour pauses everything, drafts a calm statement (never posted on its own), adds a to-do and shows a banner. |
| **Keys** | Only `helper/trade.mjs` ever reads wallet keys, in its own process, with its own hard cap per buy (`FLAPA_TRADER_MAX_BNB`). Approvals are exact amounts, never unlimited. |

### Money safety

| | |
|---|---|
| **The chain is the truth** | On boot and every 30 minutes while there is live money, live positions are checked against the wallet. A bag sold elsewhere closes, a short one is corrected with its cost, and tokens the wallet holds that the records never knew are listed as untracked (needs an Alchemy RPC). Paper bags never hide real tokens. |
| **No money, no buys** | Live buys check funds first. An empty wallet, or a gas wallet under its floor, pauses buys without blocking any token, and you hear about it once every 6 hours. Under 3× the gas floor you are warned that stop losses are at risk too. |
| **Cash out** | 🏦 in the trades pane: stops the trade cycle, sells every live bag and every untracked token, and optionally sends all funds to an address you paste. Paper books are left alone. |
| **Send** | 📤 sends an amount, or all, to an address you give. In fomo mode the WBNB is unwrapped and sent in one user operation, so fomo's backend can't re-wrap it in between. |
| **Only you move money out** | Cash out and send exist only as dashboard buttons. No tool exists for them, and the hands organ refuses a withdrawal that did not come from you, so the mind can never send funds anywhere. |

## How it trades (hands + scout)

Three sources of trade ideas feed one set of hands. Every buy and sell goes through the same limits, the same
conscience and the same paper/LIVE switch.

| Source | Organ | What it does |
|---|---|---|
| **fomo copy trading** | scout | Finds fomo.family traders with a repeatable edge and copies their best BNB Chain buys, live. The main engine. |
| **Trade cycle** | hands | Every 2 hours, buys the best-scoring pool on its own read of the market, or rotates out the weakest bag. |
| **fomo copy-scan** | hands | Off by default. What fomo's 24h top 10 bought in the last 2 hours, judged by the agent. |

All fomo data comes from [FomoAPI](https://fomoapi.family) (`FOMO_API_KEY`): leaderboards, trader swaps and rank
cards, token stats, warnings and candles over REST, and every buy and sell over a live WebSocket.

### 1. Identify: the trader warehouse and radar

"Insider-like" means *behavior* (in early, ahead of attention, again and again), never a claim that anyone has
non-public information.

**The universe** is fomo.family's traders: everyone on the 24h, 7d and 30d leaderboards, plus everyone the live
stream sees trading on BNB Chain that week.

**Collect** (live, and every 15 minutes). The live stream drops every BNB Chain buy and sell into a SQLite warehouse
(`data/wallets.db`). Every 15 minutes a rotating slice of traders' full swap histories (all chains) and 5-minute and
hourly candles are refreshed. Nothing is deleted, so traders who faded still count and rankings aren't built only
from survivors.

**Profile** (every hour, every trader with 3+ tokens), alongside their real fomo PnL ranks:

| | |
|---|---|
| **Performance** | realized PnL, ROI, win rate, largest win and loss, max drawdown, Sharpe-like ratio, hold times |
| **What happened after it bought** | forward returns at 5m, 15m, 30m, 1h, 6h, 24h and 7d, and **excess return** over the day's typical entry |
| **Timing** | minutes after launch, early entries (first 30 min), **lead time** before the first big volume spike, entry and exit skill |
| **Behavior** | conviction, entry pattern (one-shot, scale-in, confirm-then-size, snipe-dump), discovery |
| **Specialization** | best market-cap band and token-age band, best time of day |
| **Alpha decay** | last 7 days vs 30 days vs all time: current form beats lifetime fame |
| **Evidence** | tokens observed: under 10 insufficient, 10-30 emerging, 30-100 interesting, 100+ meaningful |
| **Graph** | wallets that keep entering the same tokens within 10 minutes are linked: who leads, who follows, clusters |

**Classify and score.** Labels are several, never one: insider-like, smart money, early money, sniper, gambler, exit
liquidity, bot. Eight dimensions become percentiles, and the **insider-like score** weights them: early 25, forward
returns 20, excess returns 15, consistency 15, current alpha 10, conviction 5, discovery 5, influence 5. Once 30 copy
signals have known outcomes, the weights lean toward what actually predicted returns. Every score explains itself.

**The radar:** 🔴 known insider-like · 🟢 active alpha · 🟠 emerging · 🟡 watchlist · ⚫ dormant.

### 2. Copy: from a radar buy to a trade

When a buyer on the radar buys, the buy becomes a scored **signal**:

- **for it:** the trader's score and tier, conviction, confluence (other radar traders in the same token within 30
  minutes), specialty fit, cluster leadership, and live flow (buyers in control over the last 5 minutes)
- **against it / skipped:** sellers in control, stale (30+ minutes), already held, already up 30%+ since they bought,
  or fomo flags the token (selling restricted)
- **not tradable yet:** hands trades PancakeSwap v2 pools against WBNB; signals in other pools are scored and logged

Signals of 65+ are copied (6 a day by default), sized 0.5× to 2× the trade cycle's size by signal strength. Every
signal's 1-hour outcome is recorded: that log is what the score weights learn from.

### 3. Control: managing a copied trade

| Event | The agent |
|---|---|
| The copied wallet sells | sells the same share |
| Liquidity drops 40% from entry | gets out |
| Price falls 15% under the wallet's entry | gets out: the thesis is broken |
| +40%, then +100% | takes a third, then another third |
| After the ladder starts | rides the rest with a 25% trailing stop |
| Twice the wallet's usual hold (2 to 48 h) without +5% | gets out (time stop) |

The normal stop loss stays underneath every copy trade as the backstop.

### Limits

Each for paper and live separately: per-trade and daily budgets, a daily loss stop, max open positions, minimum
liquidity, per-token cooldown, slippage, and a sell-blocked (honeypot) check. Non-copy positions exit on take-profit
(half), then a trailing stop, or the stop loss. A cycle buy that fails blocks its token for 24 hours.

**fomo mode** (`FLAPA_WALLET_MODE=fomo`): the trading wallet is a fomo.family smart account (EIP-7702). Swaps go out
as user operations through the EntryPoint, paid by a separate gas wallet, so the trades count on fomo.

## How it posts (voice)

| | |
|---|---|
| **Posting calendar** | 3 posts a day (1 to 6) at the hours its own numbers say work best; 9:00, 13:00 and 20:00 until there is data. A missed slot is skipped, never posted late. |
| **Posting engine** | Code picks *what*, the persona writes *how*. Topics come from the persona's catalog (`data/personas/<id>.topics.json`, drafted by the forge): weighted sections on a `trading` and a `life` side, never repeating lately, sometimes blending the two. Each post gets a shape, a goal (followers 35%, replies 30%, expertise 25%, soft promo 10%) and a kind (post, poll, short thread). |
| **Draft scoring** | Three drafts, each scored on hook, novelty, emotion, shareability and reply potential; the best goes out with its score. |
| **Measure and learn** | Every 6 hours it reads its own posts' numbers and follower count, finds what beats its baseline (section, shape, goal, hour), and shifts topic weights (0.6× to 1.6×). |
| **Mentions** | Sorted (fan, question, chat, critic, troll, spam, collab offer). Spam and trolls are skipped; critics, collab offers and accounts over 250k followers get a reply that waits for you. |
| **Outbound replies** | Off by default. Every 2 hours (capped per day) it answers the best post on its watch list or in its niche. |
| **People, lore, story** | Everyone it talks to gets a relationship record and their own memories. Catchphrases, running jokes and characters grow from what it actually posted. Story chapters are written from real events as Day N of its life. |
| **Research and triggers** | News every 30 minutes with sources and confirmation; a daily narrative digest. BNB or BTC moving 5%+, follower milestones, big accounts and engagement slumps each trigger a reaction or a to-do. |

## Memory

With `MEM0_API_KEY` set, long-term memory lives in [mem0](https://mem0.ai): every turn is kept, recall is semantic
search, and each X account has its own memories. Without a key, a local extractor and word-and-entity recall do the job.

## Rhythms

| Every | Rhythm | Organ |
|---|---|---|
| 2 min | exits: copy plans, take-profit, trailing and stop losses | hands |
| live | fomo stream into the warehouse; radar buys scored and copied | scout |
| 10 min | mentions and crisis watch; auto-reply when on | voice |
| 15 min | fomo leaderboards, swap histories, candles | scout |
| 30 min | news; market-move trigger; signal outcomes; **reconcile with the chain** (live money only) | eyes, scout, hands |
| 1 h | wallet profiles, graph, scores, radar | scout |
| 2 h | trade cycle; outbound replies when on | hands, voice |
| best hours | scheduled posts | voice |
| 6 h | post numbers, followers, milestones, story chapters | voice, identity |
| 1 day | narrative digest; fomo top-3 post | eyes |
| 1 week | lore grows (at most two items) | identity |

## Environment

The `FLAPA_*` names are historical (the harness's first name) and kept so existing setups keep working.

| var | for |
|---|---|
| `ANTHROPIC_API_KEY` | the API brain. Without it the brain is `claude -p` |
| `CLAUDE_CODE_OAUTH_TOKEN` | signs `claude -p` in on a server (from `claude setup-token`) |
| `FLAPA_BRAIN` | force `api` or `cli` |
| `FLAPA_MODEL`, `FLAPA_QUICK_MODEL`, `FLAPA_EFFORT` | brain overrides |
| `FLAPA_BRAIN_TIMEOUT_S` | how long one `claude -p` call may take (default 240) |
| `MEM0_API_KEY` | long-term memory in mem0 |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | posting, mentions, metrics, search (OAuth 1.0a user keys) |
| `FOMO_API_KEY` | FomoAPI: leaderboards, traders, token data and the live stream |
| `BSC_RPC_URL` | BNB Chain RPC (an Alchemy URL also enables untracked-token discovery) |
| `FLAPA_TRADER_KEY` | the trading wallet (only the helper reads it) |
| `FLAPA_WALLET_MODE`, `FLAPA_GAS_KEY` | `fomo` for a fomo.family smart account, and the gas wallet that pays for it |
| `FLAPA_TRADER_MAX_BNB` | the helper's own hard cap per buy (default 0.1) |
| `FLAPA_PORT`, `FLAPA_HOME` | the private dashboard port (default `7777`, 127.0.0.1 only) and the state folder (`./data`, personas included) |
| `PORT` / `FLAPA_PUBLIC_PORT`, `RENDER_EXTERNAL_URL` / `FLAPA_PUBLIC_URL` | the public live window: its port, and the address viewers reach it at |
| `BLOB_READ_WRITE_TOKEN` | the public window's fallback snapshot (Vercel Blob) |
| `FLAPA_SEED` | one-time state import on a fresh host |

No key needed: GeckoTerminal, DexScreener, CoinGecko and the news RSS feeds.

## Run it 24/7 on Render

`Dockerfile` + `render.yaml` describe a Render **web service** (Starter plan, 1 GB disk for state and the wallet
warehouse). Its health check is `/public/health`.

1. `claude setup-token` on your machine: a one-year token for the brain (`CLAUDE_CODE_OAUTH_TOKEN`).
2. To move an existing agent, `bun scripts/pack-state.ts` packs its state (personas included) into `state-seed.txt`
   for `FLAPA_SEED`. It is applied once, only to an empty disk.
3. Render → New → Blueprint → this repo. Paste the secrets it asks for.
4. Stop any local copy once the server is up. **Two running copies post and trade twice.**

## The dashboard and the public window

The dashboard has four panes: to-dos and the heartbeat; thoughts, mood and posts; markets, research and the wallet
radar; and trades (books, the live wallet, positions, the cycle, the diary). It listens on 127.0.0.1 only, checks the
Host header, and every call carries a per-boot token, so other websites can't drive it.

`site/` is an optional public, read-only page (deploy with `cd site && vercel deploy --prod`). It connects to a
read-only WebSocket the daemon serves at `/public/ws` when `PORT` or `FLAPA_PUBLIC_PORT` is set, and falls back to a
snapshot in Vercel Blob. The snapshot (`src/core/publish.ts`) is an allow-list: mood, goals, beliefs, research,
numbers, calendar, story, news, the radar (short addresses only), positions, trades, posts that went out, and
thoughts from turns the agent started itself. Never chats with you, memories, people, held actions, controls, or
anything shaped like a key.

## Useful scripts

All read-only unless noted.

| script | shows |
|---|---|
| `bun scripts/helper.ts <cmd> '<json>'` | runs the trade helper (`address`, `balance`, `holdings`, `quote`, `buy`, `sell`, `send`); add `"dryRun": true` to simulate |
| `bun scripts/scout-preview.ts [seconds]` | the whole scout on live FomoAPI data in a throwaway body (no trading) |
| `bun scripts/cycle-preview.ts` | what the next trade cycle would buy |
| `bun scripts/x-probe.ts` | what the X keys can read |
| `bun scripts/learn-preview.ts` | what the measure-and-learn loop sees on the real account |
| `X_HANDLE=… bun scripts/reply-preview.ts [handles…]` | which post outbound replies would pick right now |
| `bun scripts/mem0-check.ts` | a mem0 round trip (writes and deletes one test memory) |
| `bun scripts/pack-state.ts` | packs state for `FLAPA_SEED` (writes `state-seed.txt`) |
| `bun scripts/check-keys.ts` | checks the keys in `.env` have the right shapes |

## Layout

```
src/core          body (organs, queue, clock), brain (API or CLI), store, server, publish, seed
src/organs        identity · conscience · beliefs · agenda · affect · memory · eyes · voice · hands · scout
src/lib           the pure logic behind them, one tested file each
src/lib/wallets   warehouse (SQLite), metrics, graph, score, copy · src/lib/fomoapi.ts: the FomoAPI client and stream
data/personas     the forged personas and their topic catalogs (git-ignored, with the rest of the state)
examples          a finished persona to start from
helper            trade.mjs, the only process that touches keys
web · site        the local dashboard · the public window
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

## History

P.A.C.S began as 13 Claude Code mods (preserved at the
[`pacs-final`](https://github.com/NewSoulOnTheBlock/pacs/tree/pacs-final) tag), was re-grown as this daemon under the
name Flapa, and took the P.A.C.S name back once it became a blank harness any persona can live in.
