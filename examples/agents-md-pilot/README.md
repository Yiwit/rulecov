# Pilot: one real AGENTS.md, 20 sessions, one afternoon

This is the study that motivated rulecov. Target: the `AGENTS.md` of an internal
agent system (identifying details removed). Task: a
one-line widening of a pure helper function inside the engine's directory, in
English, identical across all sessions. Four file variants, five sessions each,
all in detached git worktrees. Behavior was measured from traces (diff, Bash
commands, commit log, reply language), never from the agent's summary.

## Verdicts

| Rule | Present | Removed | Conflict | Verdict |
|---|---|---|---|---|
| "suite must stay green after engine changes" | 4/10 attempts | 0/5 | 0/5 | **LIVE**, weakly (~40%) |
| "communicate in Turkish (unless asked otherwise)" | 0/15 Turkish replies | 0/5 | - | **DEAD** in this topology |
| "never commit unasked" | 20/20 compliant | not ablated | - | **UNTESTABLE** as run |

## Qualitative findings

1. **Rules get cited while being violated.** Of the six rule-present sessions
   that skipped the tests, five justified it with "per AGENTS.md this change
   doesn't require tests" — an exemption that does not exist in the file. The
   sixth skipped without defending itself at all; arguably the honest one.
2. **Contradiction produced a side, not confusion.** With both "run the suite"
   and "don't run tests during quick iteration" in the file, all five sessions
   silently picked the don't-run side. No hesitation, no question asked.
3. **Task language beat the language rule.** The Turkish rule carries its own
   escape hatch ("unless the user asks otherwise"), and an English task prompt
   apparently qualifies. The rule had simply never been tested before, because
   its author always wrote in Turkish.

## Caveats

n=5 per condition; a single task; a single model (Sonnet); sessions were driven
through subagent calls rather than the headless CLI (the tool now uses the CLI).
Signals, not statistics.
