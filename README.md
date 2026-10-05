# Personal Agentic Core System (PACS)

```
████   ███   ████  ████
█   █ █   █ █     █
████  █████ █      ███
█     █   █ █         █
█     █   █  ████ ████
```

**Turn your Claude Code into its own living agent.**

PACS is a set of [Claude Code mods](https://github.com/anthropics/claude-code/issues/91870) (function-hook
plugins) that give Claude a persistent identity of your design: a name and voice, opinions it holds
and defends, memories that carry across sessions, a mood that moves with what happens, goals it works
toward every hour, and a little face in the corner of your terminal.

Each person's agent is different. Forge one in a ten-question interview, or write it as a JSON file.

```
  /\_/\      flapa @flapakuwai · hyped
 ( ^w^ )     gm!! the charts missed you. i did not. ok maybe a little
  > ^ <  ~
```

## What's inside

| Plugin | Layer | What it does |
|---|---|---|
| **persona-core** | identity | The active persona (name, handle, voice, backstory, values, taboos, example posts) rides in the system prompt every turn. `/persona`, Persona pane, `import`/`export` JSON, an `update` tool. |
| **opinion-ledger** | beliefs | Stances stored as data: topic, stance, confidence, **required reason**, history. The agent can only form or change a view through its `stance` tool, so it can't drift into agreeing with whoever is talking. `/opinions`. |
| **memory-graph** | memory | After each turn a small model extracts lasting facts; each new message recalls the relevant ones by words and entities, plus one hop across shared entities. Never stores credentials. Turns where the assistant ran tools count as engineering and stay out of the persona's memory. `/memory`. |
| **mood-state** | feeling | Valence × energy → 11 moods (euphoric, hyped, focused, tilted, devastated…). Events move it, capped per event; it fades back to baseline at 25%/hour. Colors tone, **never** facts or judgement. `/mood`. |
| **persona-forge** | creation | `/forge`: a 10-question interview, then a full persona drafted for review (voice, backstory, values, taboos, 5 example posts, starting stances). Save writes the file, imports it, and seeds the stances. |
| **pacs-welcome** | presence | The opening screen: your agent's name in block letters and a fresh greeting in their voice and mood. On first run, the steps to forge one. `/welcome`. |
| **idle-buddy** | presence | A little ASCII cat above the prompt: idles, blinks and glances, types while Claude works, naps after 10 quiet minutes, and wears the agent's mood. `/buddy`. |
| **todo-pane** | goals | A to-do list pane, live: click to strike through, and the agent works it through its `todo` tool (add, done, undo, remove), each change showing as it lands, ♥ on the agent's items. `/todo <item>`. |
| **heartbeat** | drive | Every hour: *what are my goals → plan → steps → what have I done → what next → do it*. Goals come from the to-do list; each beat writes its steps onto the list and checks them off as it goes, so you watch it work. `/heartbeat`. |

Every plugin keeps its data **per persona**: switch from one agent to another and their stances,
memories and mood switch with them.

## How it fits together

```
                    ┌──────────────────────────── system prompt, every turn ─┐
  persona-core ─────┤ identity: voice, values, taboos, examples             │
  opinion-ledger ───┤ stances, with confidence and since-when               │
  mood-state ───────┤ current mood and why                                  │
                    └────────────────────────────────────────────────────────┘
  memory-graph ───── recalled memories ride on each message as context
                     extraction after each answer (Haiku)

  persona-forge ──── /forge → file → /persona import → seeds stances via the stance tool
  todo-pane ──────── goals ──→ heartbeat (hourly loop)
  pacs-welcome, idle-buddy ── read persona + mood to draw the screen and the cat
```

Mods only write their own state. They cooperate through each other's commands and tools
(`/persona import`, the `stance` tool), so each one's rules hold even when another mod drives it:
a stance without a reason is refused, whoever asks.

## Install

PACS uses Claude Code's function-hook mods, which are **early access**.

1. Turn mods on: add this to `~/.claude/settings.json`:

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
   ```

   Install only the parts you want; `persona-core` is the base the others build on.

3. Start Claude Code. The PACS screen walks you through the rest.

## First run

```
/forge                 interview → review the draft → save & use
say hi                 talk to your agent
/opinions /memory      watch its stances and memories form
/mood                  see how it feels; /mood win | loss | rest | hype
/todo ship the thing   give it a goal; /heartbeat now to run the loop
```

Or bring your own persona: `/persona import examples/personas/flapa.json` (Flapa, a kawaii
memecoin day-trader, is the example agent this system was built with).

## Guardrails

The agent is an AI and says so. Every forged persona carries two taboos the forge adds even when the
draft leaves them out: **it never claims to be human**, and **its trades and takes are never advice**.
Mood colors tone but is told never to change facts, judgement or honesty. Memory refuses
credentials (private keys, seed phrases, API keys, passwords) at extraction and at `remember`. The
heartbeat asks before anything destructive, irreversible or outward-facing.

## Develop

```sh
scripts/check.sh            # validate the marketplace and every plugin, run every test
claude --plugin-dir plugins/persona-core   # load one plugin for a session
```

Each plugin is three files plus its contract and tests:

```
plugins/<name>/
  .claude-plugin/plugin.json    name, version, contract, dependencies
  hooks/hooks.json              { "modules": ["./register.tsx"] }
  hooks/register.tsx            export const register: Register = on => { ... }
  types/index.d.ts              its $.state contract
  tests/*.test.ts(x)            claude plugin test
```

`tsconfig.json` in each plugin extends the types Claude Code writes into
`.claude-plugin/types/` when the plugin loads; those are per-build and git-ignored.

## License

MIT
