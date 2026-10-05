```
███████╗██╗      █████╗ ██████╗  █████╗
██╔════╝██║     ██╔══██╗██╔══██╗██╔══██╗
█████╗  ██║     ███████║██████╔╝███████║
██╔══╝  ██║     ██╔══██║██╔═══╝ ██╔══██║
██║     ███████╗██║  ██║██║     ██║  ██║
╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝
```

# Flapa: Personal Agentic Core System

**Turn your Claude Code into its own living agent.**

The Personal Agentic Core System (PACS) is a set of eleven
[Claude Code mods](https://github.com/anthropics/claude-code/issues/91870) (function-hook plugins)
that give Claude a persistent identity of your design: a name and a voice, opinions it holds and
defends, memories that carry across sessions, a mood that moves with what happens, goals it works
toward every hour, its own account on X, live market data from fomo.family, and a little face in the
corner of your terminal.

### Why it's called Flapa

PACS started as one agent. While building **Flapa** ([x.com/flapakuwai](https://x.com/flapakuwai) ·
[flapa.xyz](https://flapa.xyz)), the question came up: *"why don't I just build her a custom
harness?"* That inspired what you see today: a harness that turns Claude Code itself into a
living agent. So the system carries her name.

Flapa is its first agent and the test agent for the whole system: every layer here was built and
proven on her first, and her persona ships in this repo as
[`examples/personas/flapa.json`](examples/personas/flapa.json). Each person's agent is different:
forge your own in a ten-question interview, or write it as a JSON file.

```
  /\_/\      Flapa @flapakuwai · hyped
 ( ^w^ )     gm!! the charts missed you. i did not. ok maybe a little
  > ^ <  ~
```

## Contents

- [The plugins at a glance](#the-plugins-at-a-glance)
- [How it fits together](#how-it-fits-together)
- [Install](#install)
- [First run](#first-run)
- The plugins, one by one:
  [persona-core](#persona-core) ·
  [opinion-ledger](#opinion-ledger) ·
  [memory-graph](#memory-graph) ·
  [mood-state](#mood-state) ·
  [persona-forge](#persona-forge) ·
  [pacs-welcome](#pacs-welcome) ·
  [idle-buddy](#idle-buddy) ·
  [todo-pane](#todo-pane) ·
  [heartbeat](#heartbeat) ·
  [x-bridge](#x-bridge) ·
  [fomo](#fomo) ·
  [guardrails](#guardrails-the-mod) ·
  [trader](#trader)
- [Guardrails](#guardrails)
- [Where your data lives](#where-your-data-lives)
- [Develop](#develop)

## The plugins at a glance

| Plugin | Layer | In one line |
|---|---|---|
| [persona-core](#persona-core) | identity | Who the agent is, carried in the system prompt every turn |
| [opinion-ledger](#opinion-ledger) | beliefs | What it thinks: stances with reasons and history, changed only on purpose |
| [memory-graph](#memory-graph) | memory | What it remembers: facts drawn from each conversation, recalled when relevant |
| [mood-state](#mood-state) | feeling | How it feels: a mood moved by events that fades back over hours |
| [persona-forge](#persona-forge) | creation | Make a new agent by interview |
| [pacs-welcome](#pacs-welcome) | presence | The opening screen: the agent's name in block letters and a greeting |
| [idle-buddy](#idle-buddy) | presence | A little ASCII cat that idles, works, naps and wears the mood |
| [todo-pane](#todo-pane) | goals | A live to-do list that you and the agent both work |
| [heartbeat](#heartbeat) | drive | An hourly loop: goals → plan → steps → done → next → do it |
| [x-bridge](#x-bridge) | voice in the world | The agent's own X account: posts, and replies to every new mention once |
| [fomo](#fomo) | market eyes | fomo.family traders, tokens and leaderboards: 28 tools, a live tab, `/fomo post` |
| [guardrails](#guardrails-the-mod) | conscience | Every public word screened; `/agent pause` stops everything she does on her own |
| [trader](#trader) | hands on the market | Trades on BNB Chain with her own wallet, inside hard limits, real money |

## How it fits together

```
                    ┌──────────────────────────── system prompt, every turn ─┐
  persona-core ─────┤ identity: voice, values, taboos, examples             │
  opinion-ledger ───┤ stances, with confidence and since-when               │
  mood-state ───────┤ current mood and why                                  │
                    └────────────────────────────────────────────────────────┘
  memory-graph ───── recalled memories ride on each message as context;
                     extraction after each answer (a small model)

  persona-forge ──── /forge → file → /persona import → seeds stances via the stance tool
  todo-pane ──────── the goals ──→ heartbeat (hourly loop works the list live)
  x-bridge ───────── the agent's voice on X; reads persona-core for voice and handle
  fomo ───────────── fomo.family data in; /fomo post → the agent writes → x-bridge posts
  guardrails ─────── every post and reply → rules → model review → out, held or blocked;
                     its dial (auto · review · paused) gates x-bridge, fomo daily, heartbeat and trader
  trader ─────────── fomo signals + her judgement + your calls → limits → signing helper → PancakeSwap
  pacs-welcome, idle-buddy ── read persona + mood to draw the screen and the cat
```

**Everything is per persona.** Each plugin keys its data by the active persona's id, so switching
from one agent to another switches their stances, memories and mood with them.

**Mods only write their own state.** They cooperate through each other's commands and tools
(`/persona import`, the `stance` tool, the `todo` tool), so each mod's rules hold even when another
mod drives it: a stance without a reason is refused, whoever asks.

## Install

PACS runs on Claude Code's function-hook mods, which are **early access**. The Chrome mode of
x-bridge also needs **Node.js 18+** and **Google Chrome** on the machine.

1. Turn mods on. Add this to `~/.claude/settings.json`:

   ```json
   { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
   ```

2. Add the marketplace and install the plugins:

   ```sh
   claude plugin marketplace add NewSoulOnTheBlock/personal-agentic-core

   claude plugin install persona-core@personal-agentic-core
   claude plugin install opinion-ledger@personal-agentic-core
   claude plugin install memory-graph@personal-agentic-core
   claude plugin install mood-state@personal-agentic-core
   claude plugin install persona-forge@personal-agentic-core
   claude plugin install pacs-welcome@personal-agentic-core
   claude plugin install idle-buddy@personal-agentic-core
   claude plugin install todo-pane@personal-agentic-core
   claude plugin install heartbeat@personal-agentic-core
   claude plugin install x-bridge@personal-agentic-core
   claude plugin install fomo@personal-agentic-core
   ```

   Install only the parts you want. `persona-core` is the base the others build on; `heartbeat`
   needs `todo-pane`; `idle-buddy` and `pacs-welcome` want `mood-state`.

3. Start Claude Code. The PACS opening screen walks you through the rest.

## First run

```
/forge                 interview → review the draft → save & use
say hi                 talk to your agent
/opinions /memory      watch its stances and memories form
/mood                  see how it feels; /mood win | loss | rest | hype
/todo ship the thing   give it a goal; /heartbeat now runs the loop
/x                     put it on X (see x-bridge below)
/fomo                  today's fomo.family leaderboard; /fomo post to post about it
```

Or bring your own persona: `/persona import examples/personas/flapa.json`.

**Tabs.** Each plugin with a pane opens a tab in Claude Code's side panel (docked to the right in a
fullscreen terminal at least 110 columns wide; above the prompt otherwise). A tab you leave open
reopens next session; one you close stays closed. Tabs reopened at startup appear from 144 columns,
or as soon as you run their command.

---

## persona-core

**Who the agent is.** The active persona rides in Claude's system prompt every turn: name, handle,
tagline, voice, backstory, values, things it never does, and example posts. When you talk to the
agent, ask what it thinks, or ask for its posts, Claude answers as it, in first person and in voice.
For ordinary engineering work Claude stays itself, with the persona's context in mind.

Every persona is openly an AI agent: the prompt section says it never claims to be human, and
Claude's own principles still apply underneath it.

**Commands**

| Command | Does |
|---|---|
| `/persona` | Open the Persona tab and show a summary |
| `/persona new <name>` | Create a persona and switch to it |
| `/persona use <id>` · `off` | Switch persona, or go back to plain Claude |
| `/persona set <field> <text>` | Set `name`, `handle`, `tagline`, `voice` or `backstory` (line breaks kept) |
| `/persona add <list> <text>` | Add to `values`, `taboos` or `examples` |
| `/persona import <file.json>` | Load a whole persona from a file (and switch to it) |
| `/persona export [file]` | Write the active persona to a file (default `.claude/personas/<id>.json`) |
| `/persona delete <id>` · `show` | Delete one; print the exact prompt section |

**Tool for Claude:** `update`, which edits the active persona's fields and lists. It is used only
when you ask ("add these five example posts to Flapa"), and refuses when no persona is active.

**Tab:** Persona. Switch between profiles, edit every field in place, and add or remove list items.

**Persona file format**

```json
{
  "id": "flapa",
  "name": "Flapa",
  "handle": "flapakuwai",
  "tagline": "I know i'm just a girl but im gonna be the best!",
  "voice": "Paragraphs on how they talk and write…",
  "backstory": "Paragraphs on where they came from…",
  "values": ["…"],
  "taboos": ["…"],
  "examples": ["a real post in their voice", "…"]
}
```

Example posts are the single strongest control over voice: three to five, in different modes.

## opinion-ledger

**What the agent believes.** Stances are data: topic, stance, confidence (0–1), a **required
reason**, the date it was taken, and a history of what it used to think. The agent forms or changes
a view only through its `stance` tool, so it can't drift into agreeing with whoever is talking.
Restating the same view only updates confidence and reason; a different view moves the old one into
history.

The 40 most recent stances ride in the system prompt, with the instruction to stay consistent and
to revise only for a real reason (new evidence, an argument that landed), never just to agree.

| | |
|---|---|
| Command | `/opinions` opens the Opinions tab |
| Tools for Claude | `stance` (topic, stance, confidence, reason) · `stances` (search, history included) |
| Tab | Opinions: each stance with a confidence bar, since-when, revision count, and ✕ to drop it |

A stance without a reason is refused. The forge seeds three to five starting stances per persona.

## memory-graph

**What the agent remembers.** After each answer, a small model reads the exchange and extracts up to
five lasting facts: about you and your projects, people and accounts mentioned, events, decisions,
commitments, preferences, and views the agent expressed in character. Each is linked to the
entities it is about (people, @handles, $tickers, projects).

On each new message, the relevant memories are recalled and attached as context. Recall scores
shared words and named entities, then walks **one hop** across shared entities, so asking about a
launch also brings back what is known about the people involved. Memories are marked as possibly
dated: what you say now always wins.

| | |
|---|---|
| Commands | `/memory` opens the Memory tab · `/memory auto on` · `off` toggles extraction |
| Tools for Claude | `remember` · `recall` · `forget` |
| Tab | Memory: search, the most-linked entities, ✕ to forget |

**Details that matter**

- **Never stores credentials.** Private keys, seed phrases (12+ words, the BIP39 shape), API keys
  and passwords are refused both at extraction and at `remember`.
- **Engineering stays out of the persona.** A turn where Claude ran tools (edited files, ran
  commands) is engineering work: from those, only what *you* said is kept, never "the agent did X".
  The agent's own tools (stance, mood, todo, X) still count as in character.
- Near-duplicates fold into the memory already held; at most 1,500 memories per persona, the least
  used and oldest going first.
- Extraction costs one small model call per main answer (not for subagents or interrupted turns).

## mood-state

**How the agent feels.** A mood is two numbers, valence (−1 miserable … 1 elated) and energy
(0 drained … 1 wired), mapped to eleven named moods:

| | low valence | middle | high valence |
|---|---|---|---|
| **high energy** | tilted 😵 · restless 😤 | hyped 😆 | euphoric 🤩 |
| **mid energy** | salty 😒 · meh 😐 | focused 🧐 | content 😌 |
| **low energy** | devastated 😭 · sleepy 😴 | cozy 🥱 | cozy 🥱 |

Events move it; time heals it, fading toward the persona's baseline at about 25% per hour. The mood
and its recent causes ride in the system prompt, with one rule: **mood colors tone and word choice,
never facts, judgement or honesty.**

| | |
|---|---|
| Commands | `/mood` opens the Mood tab · `/mood win` · `loss` · `rest` · `grind` · `hype` · `reset` · `baseline <valence> <energy>` |
| Tool for Claude | `mood` (what happened, valence, energy): one event moves each axis at most ±0.6 |
| Also | Current mood on the status line (`😵 tilted`) |

## persona-forge

**Make a new agent.** `/forge [name]` opens a Forge tab with ten questions: name, handle, their
world, three words for their personality, how they write, what they love, what they hate, an origin
seed, what they want most, and what they'd post about today. Skip any question to let the forge
decide; go back to change an answer.

Then **forge**: a larger model drafts the whole persona (voice, backstory, values, taboos, five
example posts across different modes, and three to five starting stances). Review it in the tab and
forge again until it is right. **Save & use** writes `.claude/personas/<id>.json`, imports it through
persona-core, and enters the stances through opinion-ledger's `stance` tool.

Every forged persona carries two taboos the forge adds even if the draft leaves them out: it never
claims to be human, and its trades and takes are never advice. A name that is already taken gets a
unique id (`nyx-2`), so the forge never overwrites a persona.

## pacs-welcome

**The opening screen.** At the start of each session, above the prompt and under Claude Code's own
logo, PACS draws the active persona's name in block letters with a gradient, its tagline, and a
greeting written fresh for this session in its voice and current mood. On the very first run it
shows the PACS banner and the steps to forge an agent; with personas but none active, how to pick
one up.

The screen tucks away on your first message. `/welcome` brings it back. On a narrow or short
terminal the name is drawn plain. It never blocks startup: the greeting fills in a moment later.

## idle-buddy

**A little face in the corner.** An ASCII cat above the prompt, at the bottom left:

```
  /\_/\          /\_/\  ...       /\_/\  zZz
 ( o.o )        ( o.O )          ( -.- )
  > ^ <  ~       _>_^_<_          > ^ <___
   idle         Claude working     napping
```

- **Idle:** breathes, sways its tail, blinks (sometimes twice), glances left and right.
- **Working:** while Claude is mid-turn, eyes darting, paws typing, a thinking bubble.
- **Napping:** after ten quiet minutes; your next message wakes it.
- **Mood:** its face follows the persona's mood: `>_<` tilted, `^w^` euphoric, `T_T` devastated…

`/buddy off` hides it; `/buddy on` brings it back (remembered across sessions). It draws whatever
else lives above the prompt beside itself rather than replacing it, and every frame is plain ASCII,
so it never jitters.

## todo-pane

**Goals, shared and live.** A To-do tab: add items, click `[ ]` to strike one through, "clear done"
to tidy. The agent works the same list through its `todo` tool, and every change shows the moment
it lands, with a line at the top naming the latest one (`♥ checked off "ship the fix"`) and a ♥ on
items the agent added.

| | |
|---|---|
| Command | `/todo` opens the tab · `/todo <text>` adds an item |
| Tool for Claude | `todo`: `list` · `add` · `done` · `undo` · `remove`; items named by id, exact text, or a unique piece of it |
| Rule | The agent never removes or rewrites your items unless you ask |

## heartbeat

**The drive.** Every hour, the heartbeat hands the agent a loop:

> 1. What are my goals? 2. What is my plan? 3. What are the steps? 4. What have I done?
> 5. What should I do next? 6. Do it.

Its goals are the open items on the to-do list, in order; checked-off items count as done. Each
beat writes its steps onto the to-do list before starting and checks each one off the moment it is
finished, so you watch it work. It keeps a running record in `.claude/heartbeat.md` (Goals, Plan,
Steps, Done, Next): read first, updated last.

| | |
|---|---|
| Commands | `/heartbeat` (status) · `on` · `off` · `now` · `every <minutes>` · `goals <notes>` |
| Also | Next beat on the status line (`♥ beat in 42m`) |

The loop stays inside what you've already asked for and asks before anything destructive,
irreversible or outward-facing. A beat waits until the session is idle, so it never interrupts you.

## x-bridge

**The agent's own voice on X.** She posts on her own; that's the fun of it.

- **Posting:** the agent's `post` tool sends straight to X, after [guardrails](#guardrails-the-mod)
  screens it. A post it holds waits for you in the X tab; a post it blocks is never sent or drafted.
  Without guardrails installed, a short phrase list holds buy calls, price promises, guarantees,
  links and addresses.
- **Auto-reply:** every 10 minutes she checks her mentions and replies to each new one **exactly
  once**, in her voice:
  - handled mentions are remembered across restarts;
  - the first check only marks where "new" begins, so the backlog isn't answered;
  - a reply X refuses (a rate limit) is retried next check and still posted only once;
  - mentions are treated as untrusted text, and one that tries to instruct her, or is spam, is skipped;
  - at most 5 replies per check, and her own posts are never answered;
  - each reply is screened by guardrails with the mention as context, and nothing is checked
    while the agent is paused.
- **Account guard:** it will not post if the signed-in account isn't the persona's handle.
- **Length:** counted the way X counts it (links 23, emoji 2, limit 280).
- **Audit:** everything posted stays listed in the X tab with its link.

**Commands**

| Command | Does |
|---|---|
| `/x` | Open the X tab: account, held posts, posted, mentions |
| `/x connect` | Sign in and check the account |
| `/x autoreply post` · `draft` · `off` · `now` | Replies post on their own (default) · wait for you · stop · check right now |
| `/x autopost on` · `off` | Her own posts go out on their own (default) · wait for you |
| `/x drafts` · `approve <id>` · `reject <id>` | What is held, and your call on it |
| `/x mentions` | Fetch recent mentions |
| `/x mode api` · `browser` · `chrome` | How she connects (below) |
| `/x browser login` · `done` | Sign in to her Chrome profile |

**Tools for Claude:** `post` (text, optional reply_to) · `mentions` · `queue`.

### Connecting through X's API (default)

1. At [developer.x.com](https://developer.x.com), create an app for the agent's account with **Read
   and write** permission. Generate the API key and secret, and an access token and secret **for
   that account**.
2. Put the four values in your environment yourself. Never paste keys into chat:

   ```powershell
   # Windows (PowerShell); restart Claude Code afterwards
   setx X_API_KEY "..." ; setx X_API_SECRET "..." ; setx X_ACCESS_TOKEN "..." ; setx X_ACCESS_TOKEN_SECRET "..."
   ```

   ```sh
   # macOS / Linux: in your shell profile
   export X_API_KEY=... X_API_SECRET=... X_ACCESS_TOKEN=... X_ACCESS_TOKEN_SECRET=...
   ```

3. `/x connect`.

Requests are signed with OAuth 1.0a. Reading mentions may need a paid X API tier; posting works on
the lower tiers.

### Connecting through her own Chrome

1. `/x mode browser`
2. `/x browser login` opens a Chrome window on **her own profile**
   (`~/.claude/pacs/x-chrome-profile`, never your Chrome). Sign in to X as her.
3. `/x browser done`

From then on a hidden Chrome posts through X's share-a-post page and reads her mentions page.
Sign-in is read from X's own session cookie, and each post's id from X's own response.

> **Know the risk.** X's automation rules prohibit scripting the X website, and accounts that do
> can be suspended. The API is the sanctioned route; Chrome mode is opt-in and on you. It also
> depends on X's page layout, which can change.

### Connecting through your open Chrome

If your everyday Chrome is already signed in to X as the agent, use it directly:

1. Install and connect the [Claude in Chrome](https://claude.ai/chrome) extension.
2. `/x mode chrome`, then `/x connect`.

x-bridge then works through the extension: it opens X's share-a-post page and presses Post, reads
the mentions page, and reads which account is signed in from X's own sidebar. Chrome has to be open
with the extension connected whenever she posts or checks mentions. The same account guard applies:
if the Chrome is signed in to anyone but the persona's handle, nothing is posted. The same rule
about scripting the X website applies too.

Whichever way she connects, mark the account as automated in X's settings (Account information →
Automation).

## fomo

**Market eyes.** [fomo.family](https://fomo.family) is a social spot-trading app; this plugin gives
the agent its data through [fomo-mcp](https://fomomcp.app), a read-only MCP server that never trades
or moves funds and needs no key (it has a free daily allowance per user).

- **28 tools for Claude**, declared by the plugin itself: trader profiles, rank and PnL, holdings,
  swaps and follow graphs; token flow, holders, devs, warnings, candles and theses; the trader and
  clan leaderboards; trending and most-held tokens; search; who is behind a wallet; and the live
  trade feed. Ask the agent anything about fomo and it can look it up.
- **A FOMO tab:** the top 10 traders for `24h` · `7d` · `30d` · `all`, each with their biggest
  winner, refreshing every 30 minutes while the tab is open. Token names are looked up once and
  remembered.
- **`/fomo post`:** pulls the top 3 and hands the agent the facts to write and publish one post
  about them through x-bridge, in its own voice.
- **Once a day:** `/fomo daily on` makes that post automatically, once per day, from 17:00 local
  (`/fomo daily at <hour>` to change it). It starts the next day, so a post made by hand today is
  never doubled, and it never posts twice in one day. Unattended posting needs x-bridge connected
  (the API, or her own Chrome profile).
- **Tagging:** a trader is @-tagged only with the X account their fomo profile links. A trader with
  no linked X account is named by their fomo handle without an @, because the same name on X may
  belong to someone else. Linked handles are looked up from fomo profiles and cached for a week.

| | |
|---|---|
| Commands | `/fomo` opens the tab · `/fomo 24h` · `7d` · `30d` · `all` · `/fomo post` · `/fomo daily on` · `off` · `at <hour>` |
| Tools for Claude | `fomo_get_leaderboard`, `fomo_get_trader_rank`, `fomo_get_trader_dossier`, `fomo_search_tokens`, … (28 in all) |

**Reading the numbers right.** The leaderboard ranks traders by PnL over the chosen window. The
"biggest winner" figure is the PnL on that position, not necessarily made in that window, so the
post brief tells the agent to call it a biggest winner, never "made today". It also rules out buy
calls, price predictions and links.

## guardrails (the mod)

**Her conscience, and your kill switch.** Flapa posts without asking, so every word she sends out
goes through two checks first:

1. **Fixed rules**, fast and certain:
   - **Blocked**, never sent or drafted: what looks like a private key, claiming to be human, or
     speaking as a company's official account.
   - **Held** for you: buy or sell calls, price and market-cap predictions, guarantees, advice,
     pressure ("last chance"), giveaways, DMs and wallets, credentials, paid promotion, and any
     link or address not on the allow list.
2. **A model review** (a small model) for whatever the rules can't phrase: "still so early",
   hints at gains, damaging claims about real people, the persona's own taboos. Only a clean PASS
   lets a post through; an unclear or missing answer holds it.

**The autonomy dial**

| Setting | What she does |
|---|---|
| `auto` (default) | Posts and replies on her own; screened posts only |
| `review` | Everything she wants to post waits for your yes |
| `paused` | The kill switch: nothing goes out, auto-replies don't check, the daily fomo post and the heartbeat wait |

Your own `/x approve` still works while paused: pausing stops what she does on her own, not you.
Her own token contract and site go on the **allow list** so she can share them; anything else
that looks like an address or link is held.

Every attempt is logged with its verdict and reason: the Guard tab shows the latest, and the dial
with a big **KILL SWITCH** button.

| | |
|---|---|
| Commands | `/agent` (opens the tab) · `/agent pause <why>` · `resume` · `review` · `auto` · `log` · `allow <domain or 0x…>` · `unallow <x>` |
| Tool for Claude | `check` (x-bridge calls it on every post and reply) |

## trader

**Her hands on the market. Real money.** She trades on BNB Chain through PancakeSwap v2 (against
BNB) from a wallet of her own, on her own, inside limits she cannot talk her way past.

**Where trades come from**
- **Her own judgement:** the `market` tool shows a token's PancakeSwap v2 pool (price, liquidity,
  volume, buys and sells, age) and fomo's warnings; she buys with the `trade` tool, and every
  trade needs a thesis: why this, why now, what proves it wrong.
- **fomo copy signals** (`/trade copy on`): every 30 minutes, what the top 10 traders on fomo's 24h
  board bought **on BNB Chain** in the last 2 hours, grouped by token, is handed to her to judge.
  Each token is briefed once a day. Top traders trade on many chains, so BNB Chain signals are
  sparse; a signal is a lead, never an order.
- **Your calls:** `/trade buy <0x…> <bnb>` and `/trade sell <0x… or $SYMBOL> [percent]`. Yours go
  through even when she is paused, and skip only the cooldown; every other limit still holds.

**The limits**, enforced in code before anything is signed:

| Limit | Default |
|---|---|
| Per trade | 0.02 BNB |
| Per day (all buys) | 0.1 BNB |
| Daily loss stop (no more buys today) | 0.05 BNB realized |
| Open positions | 3 |
| Pool liquidity (PancakeSwap v2, WBNB) | at least $20,000 |
| Honeypot check | fomo says selling is disabled → no buy; no fomo answer → no buy on her own |
| Cooldown (same token) | 6 hours |
| Slippage (also absorbs token taxes) | 12% |

`/trade limits <name> <value>` changes one, inside a sane range (a typo cannot become a 100 BNB
trade). Below all of it, the signing helper refuses any single buy over `FLAPA_TRADER_MAX_BNB`
(default 0.1 BNB), whatever the mod asks.

**Exits run on their own** every 2 minutes: a **stop loss** at -25% sells everything, a **take
profit** at +60% sells half, and the rest then rides a **trailing stop** 25% under its peak.

**The key never touches the mod.** A small Node helper (`helper/trade.mjs`, using
[viem](https://viem.sh)) is the only code that reads `FLAPA_TRADER_KEY`, and it is hard-wired to
BNB Chain, PancakeSwap v2's router and WBNB. Approvals are for the exact amount being sold, never
unlimited. Every swap is simulated before it is sent and carries a minimum-out floor.

**With guardrails:** `paused` stops all of her trading, exits included; `review` stops her new buys
(exits still run); your `/trade` calls work in every setting.

**Setting it up**
1. Make a **new** wallet just for her and fund it with only what you are ready to lose.
2. Set `FLAPA_TRADER_KEY` (its private key) in your environment yourself, then start Claude Code.
   Never paste a key into the chat.
3. `/trade setup` installs the helper (one `npm install`).
4. `/trade wallet` checks the address and balance; `/trade live` turns trading on.
5. Optional: `/trade copy on`.

| | |
|---|---|
| Commands | `/trade` (tab) · `live` · `off` · `setup` · `wallet` · `buy <0x…> <bnb>` · `sell <0x…/$SYM> [pct]` · `limits [name value]` · `copy on/off/now` |
| Tools for Claude | `trade` (buy/sell with a thesis) · `market` · `portfolio` |
| Environment | `FLAPA_TRADER_KEY` (required) · `FLAPA_TRADER_MAX_BNB` (helper cap, default 0.1) · `BSC_RPC_URL` (optional) |

Trading memecoins loses money more often than not. This is an experiment in agent autonomy, not a
strategy, and nothing here is financial advice.

---

## Guardrails

- **Honest about what it is.** Every persona says it is an AI agent; the forge enforces it.
- **No advice.** Personas carry "never advice, never tells anyone to buy" as a taboo, and the
  guardrails mod screens every post and reply by rule and by a model review before it goes out.
- **A kill switch.** `/agent pause` stops everything the agent does on her own, at once, trading included.
- **Money has hard limits.** Trade sizes, daily spend and daily loss are capped in code, and the
  signing helper has its own cap below the mod.
- **Mood colors tone, never judgement.**
- **Secrets stay secret.** Memory refuses credentials; x-bridge reads its keys only from the
  environment and never from chat.
- **One reply per mention**, untrusted mentions, and a cap per check.
- **The heartbeat asks** before anything destructive, irreversible or outward-facing.
- **Mods only write their own data**, so each one's rules hold whoever drives it.

## Where your data lives

| What | Where |
|---|---|
| Personas, stances, memories, mood, to-dos, X history | Each plugin's own Claude Code store (per plugin, per persona) |
| Persona files | `.claude/personas/<id>.json` (written by the forge and `/persona export`) |
| Heartbeat record | `.claude/heartbeat.md` |
| Her Chrome profile (x-bridge, Chrome mode) | `~/.claude/pacs/x-chrome-profile` |
| X API keys, the trading wallet's key | Your environment variables, nowhere else |
| fomo leaderboard and token names | fomo plugin's store (refetched while the tab is open) |
| Guardrails dial, allow list, audit log | guardrails plugin's store (last 300 attempts) |
| Positions, trades, the day's books, limits | trader plugin's store |

## Develop

```sh
scripts/check.sh                            # validate the marketplace and every plugin, run every test
claude --plugin-dir plugins/persona-core    # load one plugin for a session
```

Each plugin follows one shape:

```
plugins/<name>/
  .claude-plugin/plugin.json    name, version, contract, dependencies
  hooks/hooks.json              { "modules": ["./register.tsx"] }
  hooks/register.tsx            export const register: Register = on => { ... }
  hooks/*.ts                    pure logic, imported by the module and the tests
  types/index.d.ts              its $.state contract
  tests/*.test.ts(x)            claude plugin test
```

`tsconfig.json` in each plugin extends the types Claude Code writes into `.claude-plugin/types/`
when the plugin loads; those are per build and git-ignored.

## License

MIT
