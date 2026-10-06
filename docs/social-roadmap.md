# Flapa's social side: roadmap

The 60-feature wish list, sorted into what Flapa already has, what gets built (in order), and what is
deferred because it costs more than it gives right now. Rule of thumb: the simplest version that closes
the loop **perceive → plan → act → measure → learn** wins.

What the X keys can do (probed 2026-10-06, `bun scripts/x-probe.ts`): post, read her own posts with public
and private metrics (impressions, profile clicks), mentions, followers, user lookup, recent search.

## Already in Flapa

| Feature (#) | Where |
|---|---|
| Persona, voice, taboos, examples (1) | `personas/flapa.json`, identity organ |
| Internal state: mood, energy (35) | affect organ |
| Long-term memory (34), opinions (38 partly) | memory + beliefs organs |
| Goals and to-dos (36, 37 partly) | agenda organ |
| Guardrails, rule screen, reviewer, approval dial (43, 44, 45 partly) | conscience organ, `src/lib/rules.ts` |
| Topic engine: 399 topics, sections, shapes, no repeats, storyline (5, 7 partly) | `src/lib/posting.ts` |
| Mentions + auto-reply (14, 15 partly) | voice organ, `src/lib/autoreply.ts` |
| Trading intelligence, journal, P&L, risk, trade cycle (55, 56) | hands + eyes organs, `src/lib/strategy.ts` |

## Build order

1. **Measure and learn** (9, 27, 28, 29, 30-lite): collect every post's metrics, find what beats her
   baseline (topic section, shape, hour), explain outliers, nudge the topic weights toward what works, and
   tell her what is working in each brief. A/B testing is the engine's natural variety, compared by tag.
2. **Risk tiers and crisis mode** (43, 45, 46): green posts go out, yellow waits for the person, red never
   posts. A spike of hostile mentions pauses posting and alerts the person.
3. **Reply engine and people memory** (10-15, 12, 40-lite): sort incoming mentions (fan, question, critic,
   troll, spam), answer with the thread's context, find a few worthwhile posts a day from accounts she
   watches and rank them, and remember everyone she talks to.
4. **Content strategy and calendar** (5, 6, 7, 8, 19-lite): pillar targets that shift with results, posts
   placed at her best hours, three drafts scored on a virality rubric with the best one posted, and the
   occasional poll or short thread.
5. **Persona, lore and story** (1, 38, 39, 56, 58, 59): style rules (always/never words, caps, emoji,
   length), a lore file of running jokes and catchphrases that grows slowly, and story chapters written from
   her real trades and milestones.
6. **Research and newsjacking** (3, 20-23, 52-54): crypto headlines (RSS) plus trending pools plus an X
   search sample, a daily narrative digest with sources, and fast drafts on relevant news that wait for
   approval.
7. **Triggers** (32, 33, 57-lite): big market move, follower milestone, a large account mentioning her,
   engagement falling under baseline. Each one drafts, alerts or adjusts.

## Deferred (and why)

| Feature (#) | Why not now |
|---|---|
| Images, memes, video, GIFs (16-18) | Needs an image model and taste checks; text first |
| DMs (47) | Extra API scopes and privacy risk for little gain |
| Communities (48), multi-account (49), cross-platform (50) | One account first; the persona design already allows more |
| Profile edits, bio A/B tests (2 partly) | Rare, manual, and fine to do by hand |
| Auto-follow networking (13, 25 partly) | Reads as spam; relationships come from replies instead |
| Competitor tracking, audience composition (24, 26) | Revisit once the measure loop has a month of data |
| Formal growth experiments (31) | The weight-nudging in section 1 is the lightweight version |
| fomo leaderboard optimization (57) | Waits for fomo's data feed to come back |
