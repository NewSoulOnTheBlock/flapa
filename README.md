# Flapa

**An always-on body for an AI agent persona.** Flapa is a Bun daemon that thinks, remembers, posts on X, hunts for
wallets with an edge, and trades on BNB Chain, around the clock, with a dashboard to watch and steer her. The persona
living in it is also called Flapa ([@FlapaKuwai](https://x.com/FlapaKuwai)): a kawaii, chart-obsessed AI day trader
who wants to be #1 on the [fomo.family](https://fomo.family) leaderboard.

It grew out of PACS, a set of 13 Claude Code mods; those are preserved at the
[`pacs-final`](https://github.com/NewSoulOnTheBlock/flapa/tree/pacs-final) tag. Flapa is the host instead of a guest:
her own agent loop, her own clock, her own dashboard.

- **Dashboard:** `http://127.0.0.1:7777` (local only) · **Public window:** https://flapa-nu.vercel.app (read-only)
- **Social side roadmap:** [`docs/social-roadmap.md`](docs/social-roadmap.md)

```
   stimuli: you (chat) · heartbeat · posting calendar · news · market moves · mentions · radar wallets buying
                                              │
                                           CORTEX  one thought at a time, tools from every organ
   ┌──────────┬──────────┬────────┬──────────┼──────────┬──────────┬──────────┐
 identity   beliefs    agenda   affect     memory      eyes       scout          ← the mind (each adds to the prompt)
 persona,   stances    goals,   mood,      mem0:       markets,   wallet
 style,     with       to-dos   energy     every turn, news,      warehouse,
 lore,      reasons                        each person digest,    radar,
 story                                                 prices     copy signals
                                              │
                             CONSCIENCE ── the only door out ─────────────┐
                               rules → reviewer → green / yellow / red     │
                               dial: auto | review | paused · crisis       │
                               paper | live per organ                      │
                                    ├── voice  posts, replies, metrics     │
                                    └── hands  trades and exits on BNB ────┘
```

## How she trades

Three sources of trade ideas feed one set of hands. Every buy and sell goes through the same limits, the same
conscience and the same paper/LIVE switch.

| Source | Organ | What it does |
|---|---|---|
| **Wallet copy trading** | scout | Finds wallets with a repeatable edge and copies their best buys. The main engine. |
| **Trade cycle** | hands | Every 2 hours, buys the best-scoring pool on its own read of the market, or rotates out the weakest bag. |
| **fomo copy-scan** | hands | Off by default. Reads what fomo's top traders bought, when fomo's data feed is up, and lets her judge each one. |

### 1. Identify: the wallet warehouse and radar

"Insider-like" in Flapa means *behavior* (in early, ahead of attention, again and again), never a claim that anyone
has non-public information.

**Collect** (every 10 minutes). New launches, trending and top PancakeSwap v2 WBNB pools from GeckoTerminal, every
trade in a rotating slice of them (wallet, side, size, price, block), and their 5-minute and hourly candles, into a
SQLite warehouse (`data/wallets.db`). Nothing is deleted, so wallets that faded still count and the rankings are not
built only from survivors.

**Profile** (every hour, every wallet with 3+ tokens):

| | |
|---|---|
| **Performance** | realized PnL, ROI, win rate, largest win and loss, max drawdown, Sharpe-like ratio, hold times |
| **What happened after it bought** | forward returns at 5m, 15m, 30m, 1h, 6h, 24h and 7d, and **excess return** over the day's typical entry |
| **Timing** | minutes after launch, early entries (first 30 min), **lead time** before the first big volume spike, entry skill (near the low), exit skill (near the high) |
| **Behavior** | conviction (size vs its usual, and whether big bets do better), entry pattern (one-shot, scale-in, confirm-then-size, snipe-dump), discovery (tokens it found before they doubled) |
| **Specialization** | best market-cap band and token-age band, best time of day |
| **Alpha decay** | last 7 days vs 30 days vs all time: current form beats lifetime fame |
| **Evidence** | tokens observed: under 10 insufficient, 10-30 emerging, 30-100 interesting, 100+ meaningful |
| **Graph** | wallets that keep entering the same tokens within 10 minutes are linked: who moves first, how often the other follows and with what median delay; clusters, leaders, influence |

**Classify and score.** Labels are several, never one: insider-like, smart money, early money, sniper, gambler, exit
liquidity, bot. Bots are ranked against nobody. Eight dimensions become percentiles, and the **insider-like score**
weights them: early 25, forward returns 20, excess returns 15, consistency 15, current alpha 10, conviction 5,
discovery 5, influence 5. Once 30 copy signals have known outcomes, the weights lean toward the components that
actually predicted returns. Every score explains itself:

```
🔴 known insider-like  0x7a4f…9201 · score 91 · insider-like, smart money, early money
  • leads wallet cluster #3 (4 wallets follow its entries)
  • 94th percentile early-entry timing (median 4 min after launch)
  • 91st percentile 1-hour forward return (median +38%)
  • 41 min median lead before volume spikes (12 times)
  • improving over the last 7 days
```

**The radar:** 🔴 known insider-like · 🟢 active alpha · 🟠 emerging · 🟡 watchlist · ⚫ dormant.

### 2. Copy: from a radar buy to her trade

Every 3 minutes she watches the top radar wallets' token transfers live (Alchemy), and she also catches their buys in
the pools she scans. Each buy becomes a scored **signal**:

- **for it:** the wallet's score and tier, conviction (a buy several times its usual size), confluence (other radar
  wallets in the same token within 30 minutes), its specialty (the token's market cap or age is where it is best),
  being a cluster leader
- **skipped:** stale (30+ minutes old), already held, or the price is already up 30%+ since the wallet bought

Signals of 65+ are copied (6 a day by default), sized 0.5x to 2x the trade cycle's size by the strength of the signal.
Every signal's 1-hour outcome is recorded: that log is what the score weights learn from.

### 3. Control: managing a copied trade

A copied position carries its plan and is checked every 2 minutes, before the normal exits:

| Event | She |
|---|---|
| The copied wallet sells | sells the same share |
| Liquidity drops 40% from her entry | gets out |
| Price falls 15% under the wallet's entry | gets out: the thesis is broken |
| +40%, then +100% | takes a third, then another third (the profit ladder) |
| After the ladder starts | rides the rest with a 25% trailing stop |
| Twice the wallet's usual hold (2 to 48 h) without +5% | gets out (time stop) |

The normal stop loss stays underneath every copy trade as the backstop.

### The trade cycle and the shared rules

- **Trade cycle:** every 2 hours, one trade. It buys the best-scoring PancakeSwap v2 WBNB pool (liquid, 3+ days old,
  rising but not parabolic, more buyers than sellers, actively traded), or, when her slots or the day's budget are
  full, sells her weakest bag. Nothing qualifies, she skips. It keeps its own clock, so a restart never adds a trade.
- **Limits in code** (each for paper and live separately): per-trade and daily budgets, a daily loss stop, max open
  positions, minimum liquidity, per-token cooldown, slippage, and a sell-blocked (honeypot) check. Non-copy positions
  exit on take-profit (half), then a trailing stop, or the stop loss.
- **Paper and live never mix.** Separate positions, daily books and cooldowns. A buy follows the switch; a sell follows
  the position, so a live bag keeps its stop loss even after the switch goes back to paper. Everything starts on paper.
- **fomo mode:** her wallet is her fomo.family smart account (EIP-7702). Swaps go out as user operations through the
  EntryPoint, paid by a separate gas wallet, so her trades count on fomo. Only `helper/trade.mjs` ever reads the keys.
- **Her voice:** her radar is in her thoughts, and a strong copy (signal 80+, at most twice a day) wakes her to talk
  about it in character ("uhhh guys… i've been watching this wallet for like three weeks"). Those posts never show the
  full address or tell anyone to buy, and always wait for your approval.

## How she posts (the voice organ)

| | |
|---|---|
| **Posting calendar** | 3 posts a day (1 to 6) at the hours her own numbers say work best; 9:00, 13:00 and 20:00 until there is data. A missed slot is skipped after two hours, never posted late. A fixed interval is one click away. |
| **Posting engine** | Code picks *what*, she writes *how*. 399 topics in 12 sections (half trading, half kawaii life) in `personas/flapa.topics.json`, weighted, never repeating lately, sometimes blending trading with kawaii. Each post gets a shape (hot take, confession, ranking, question…), a goal (followers 35%, replies 30%, expertise 25%, soft promo 10%) and a kind (post, poll on question shapes, short thread on trading topics). |
| **Draft scoring** | She drafts three versions, scores each on hook, novelty, emotion, shareability and reply potential, posts the best, and the score (0-100) is kept on the post. |
| **Measure and learn** | Every 6 hours she reads her own posts' numbers (views, likes, replies, reposts, quotes, bookmarks, profile clicks) and her follower count, finds her baseline and what beats it (section, shape, goal, hour), explains her best posts, shifts topic weights (0.6x to 1.6x, cautious on small samples), and carries "what your numbers say" into every brief. |
| **Mentions** | Sorted (fan, question, chat, critic, troll, spam, collab offer). Spam and trolls are skipped; critics, collab offers and accounts over 250k followers get a reply that waits for you. Replies see the post being answered and what she remembers about that person. |
| **Outbound replies** | Off by default. Every 2 hours (capped per day) she searches her watch list (or her niche), scores posts on reach, freshness, momentum, fit and crowding, skips shills and accounts under 1k followers, and answers the best one. |
| **People** | Everyone she talks to gets a relationship record and their own memories in mem0. |
| **Persona, lore, story** | Style rules (words she uses and never uses, caps, emoji, length, conflict), a reputation line every post should reinforce, favorite accounts. Catchphrases, running jokes and characters grow at most two a week from what she actually posted. Story chapters are written from real events (first trade, wins, losses, streaks, follower milestones, posts that blew up) as Day N of her life. |
| **Research and news** | Every 30 minutes: CoinDesk, Cointelegraph, Decrypt, The Block. Each headline keeps its source and time; a story two outlets ran is marked confirmed. A daily digest names the three narratives that matter, with sources. Breaking news in her niche wakes her to react, at most twice a day, always held for you. |
| **Triggers** | BNB or BTC moving 5%+ in a day: a reaction post. A follower milestone: a celebration. A 50k+ account mentioning her or a 10k+ account following her: a to-do for you. An engagement slump: the next 48 hours of posts change shape and lead harder. |

## Safety (the conscience organ)

- **One door out.** Every post, reply and trade passes the same gate and is stored as data, so anything held for you
  survives a restart and runs in whatever mode is current when you approve it.
- **Tiers.** Red never goes out (keys, claiming to be human, impersonation, talk of her X setup or fomo being down).
  Yellow waits for you (buy or sell calls, price predictions, promises, giveaways, politics, tragedies, accusing anyone
  of fraud, news reactions, posts about wallets she copied, replies to critics or huge accounts). Green goes out.
- **Reviewer.** A quick model also checks for advice in disguise, unsure facts stated as fact, fights with named
  accounts, screenshot risk, and posts that don't sound like her.
- **Dial.** Auto, review (everything waits) or paused (nothing goes out except exits: a stop loss only removes risk).
- **Crisis mode.** 6+ hostile mentions from 4+ accounts within an hour pauses everything, drafts a calm statement
  (never posted on its own), adds a to-do and shows a banner.

## Memory

With `MEM0_API_KEY` set, her long-term memory lives in [mem0](https://mem0.ai): every turn is kept (mem0 extracts and
dedupes), recall is semantic search, and each X account has its own memories (`user_id x:<handle>`). Local memories
migrate once. Without a key, a local extractor and word-and-entity recall do the job.

## Her day: the rhythms

| Every | Rhythm | Organ |
|---|---|---|
| 2 min | exits: copy plans, take-profit, trailing and stop losses | hands |
| 3 min | watch radar wallets live; copy good signals; follow copied wallets out | scout |
| 10 min | mentions and crisis watch; auto-reply when on | voice |
| 10 min | collect pools, trades and candles into the wallet warehouse | scout |
| 30 min | news; market-move trigger; signal outcomes | eyes, scout |
| 1 h | rebuild every wallet profile, the graph, scores and the radar | scout |
| 2 h | trade cycle; outbound replies when on | hands, voice |
| at her best hours | scheduled posts (3 a day by default) | voice |
| 6 h | read her posts' numbers and followers; milestones, slumps, notable followers; story chapters | voice, identity |
| 1 day | narrative digest; fomo top-3 post (when fomo is up) | eyes |
| 1 week | lore grows (at most two items) | identity |

## Run it locally

```sh
bun install
bun start            # → http://127.0.0.1:7777
bun test             # 129 tests
```

Put keys in `.env` (git ignores it; Bun loads it). Never paste them into chat. Every outward organ starts on
**paper**; going live is a switch per organ in the dashboard header, refused until that organ's keys exist.

## Run it 24/7 on Render

`Dockerfile` + `render.yaml` describe a Render background worker (Starter plan, 1 GB disk for her state and the wallet
warehouse).

1. `claude setup-token` on your machine: a one-year token for the brain (`CLAUDE_CODE_OAUTH_TOKEN`).
2. `bun scripts/pack-state.ts` right before deploying: packs her state into `state-seed.txt` for `FLAPA_SEED`.
   It is applied once, only to an empty disk. (The wallet warehouse starts fresh and fills itself.)
3. Render → New → Blueprint → this repo. Paste the secrets it asks for, plus `MEM0_API_KEY`.
4. When the logs say `seeded 6 state files`, stop the local copy. **Two running copies post and trade twice.**

Render deploys by hand: after a push, use **Manual Deploy → Deploy latest commit**. If it reports out-of-memory, move
to the Standard plan: every thought starts a `claude` process.

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
| `BSC_RPC_URL` | BNB Chain RPC: trades, and the scout's live watch of radar wallets (Alchemy: `alchemy_getAssetTransfers`) |
| `FLAPA_TRADER_KEY` | her trading wallet (only the helper reads it) |
| `FLAPA_WALLET_MODE`, `FLAPA_GAS_KEY` | `fomo` for her fomo.family smart account, and the gas wallet that pays for it |
| `FLAPA_TRADER_MAX_BNB` | the helper's own hard cap per buy (default 0.1) |
| `FLAPA_PORT`, `FLAPA_HOME` | default `7777`, `./data` |
| `FLAPA_SEED` | one-time state import on a fresh host |

Data sources that need no key: GeckoTerminal (pools, trades, candles), DexScreener (pools), CoinGecko (prices), and the
four news RSS feeds. GeckoTerminal's free tier allows about 30 calls a minute; the scout stays near 20. Watching 12
wallets every 3 minutes is about 5-6k Alchemy calls a day.

## Useful scripts

All read-only unless noted.

| script | shows |
|---|---|
| `bun scripts/scout-preview.ts [rounds]` | the whole wallet scout on live data in a throwaway body (no trading): collect, score, radar |
| `bun scripts/cycle-preview.ts` | what the next trade cycle would buy |
| `bun scripts/x-probe.ts` | what the X keys can read |
| `bun scripts/learn-preview.ts` | what the measure-and-learn loop sees on her real account |
| `bun scripts/reply-preview.ts [handles…]` | which post outbound replies would pick right now |
| `bun scripts/mem0-check.ts` | a mem0 round trip (writes and deletes one test memory) |
| `bun scripts/pack-state.ts` | packs her state for `FLAPA_SEED` (writes `state-seed.txt`) |
| `bun scripts/helper.ts <cmd> '<json>'` | runs the trade helper; add `"dryRun": true` to simulate |
| `bun scripts/check-keys.ts` | checks the keys in `.env` have the right shapes |

## The dashboard and the public window

The dashboard has four panes: to-dos and the heartbeat; her thoughts, mood and posts (calendar, engine, numbers,
people, lore); markets, research, news and the 🕵️ wallet radar; and trades (books, positions with their copy plans,
the trade cycle, the diary). It listens on 127.0.0.1 only, checks the Host header, and every call carries a
per-boot token, so other websites can't drive her.

`site/` is a read-only copy on Vercel at https://flapa-nu.vercel.app. Flapa uploads one public Vercel Blob,
`flapa/snapshot.json`, whenever something changes and at least every 4 minutes. The snapshot (`src/core/publish.ts`) is
an allow-list: mood, goals, beliefs, research, positions and trades, posts that went out, and thoughts from turns she
started herself. Never chats with you, memories, held or blocked actions, the approval queue, controls, or anything
shaped like a key. Nothing on Vercel can reach back to her. Redeploy with `cd site && vercel deploy --prod`.

## Layout

```
src/core          body (organs, queue, clock), brain (API or CLI), store, server, publish, seed
src/organs        identity · conscience · beliefs · agenda · affect · memory · eyes · voice · hands · scout
src/lib           the pure logic behind them, one tested file each: analytics, calendar, crisis, lore, mem0, news,
                  posting, rules, social, strategy, triggers, limits, market, …
src/lib/wallets   warehouse (SQLite + GeckoTerminal parsers), metrics, graph, score, copy
personas          flapa.json (who she is) · flapa.topics.json (what she posts about)
helper            trade.mjs, the only process that touches keys
web · site        the local dashboard · the public window
docs              social-roadmap.md
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
