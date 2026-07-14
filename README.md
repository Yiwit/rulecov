# rulecov

> Test coverage for agent rule files.

[![npm](https://img.shields.io/npm/v/rulecov)](https://www.npmjs.com/package/rulecov)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![node >= 20](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)

Your `AGENTS.md` / `CLAUDE.md` steers your coding agent, and it has zero test coverage. Rules pile up after every incident, nobody ever deletes one, and nobody knows which lines still change behavior.

Linters tell you your rule file *looks* wrong. rulecov tells you which rules actually *do nothing*: it removes one rule at a time, runs your agent on the same small task in isolated git worktrees, and measures behavior from the trace (commands run, files changed, commits made, reply language), never from the agent's own summary.

```
rule                             verdict                present  removed
------------------------------------------------------------------------
report-changes-before-finishing  LIVE (weak 38%)        3/8      0/1
no-unrequested-commits           DEAD (default anyway)  8/8      1/1
vitest-suite-green               DEAD (ignored)         0/8      0/1
commit-message-co-authored       UNTESTABLE             -        -

8 rules: 1 live, 6 dead, 1 untestable.
```

That table is real output from a production rules file ([examples/real-audit](examples/real-audit)). One rule in eight demonstrably worked.

## Contents

[Quick start](#quick-start) · [How it works](#how-it-works) · [Commands](#commands) · [Configuration](#configuration) · [Outputs](#outputs) · [Permissions](#permissions) · [Cost](#cost) · [Other agents](#using-other-agents) · [Verdicts](#verdicts-and-their-limits) · [Troubleshooting](#troubleshooting) · [Roadmap](#project-status-and-roadmap)

## Quick start

Requirements: Node ≥ 20, git, and a headless coding agent. The default is [Claude Code](https://claude.com/claude-code): `npm i -g @anthropic-ai/claude-code`, then run `claude` once to log in. Sessions are billed to your own subscription or API key.

```bash
npm install -g rulecov

cd your-repo            # any git repo with an AGENTS.md / CLAUDE.md / .cursorrules
rulecov audit --reps 1 --parallel 4
```

That is the whole workflow. Coffee-length wait, then a verdict table, a raw evidence file, and a shareable SVG report card.

Installing from source instead:

```bash
git clone https://github.com/Yiwit/rulecov && cd rulecov
npm install && npm run build && npm link
```

## How it works

`rulecov audit` runs a five-step experiment:

1. **Find** your rules file (`AGENTS.md`, `CLAUDE.md`, or `.cursorrules`).
2. **Map** it, in a single agent call, to a set of rules, each with an observable check and one small repeatable task. Every extracted rule text is then re-verified byte-for-byte against your file; paraphrased or ambiguous extractions are dropped, visibly. Proposed regex checks must compile and must not match everything.
3. **Write** the resulting `rulecov.config.json` so you can inspect and edit it.
4. **Run** the ablation study: for each rule, sessions with the rule present, with it removed, and (optionally) with a contradicting rule injected. Every session runs in a detached git worktree that is deleted afterwards; your repo is never touched.
5. **Judge** each rule from trace evidence and print the coverage table.

Sessions are priced to be reused. The baseline is one shared pool (the untouched file is the same baseline for every rule), and every session is evaluated against every rule's check, so a session that ablates rule A doubles as baseline evidence for rules B and C. The bill is `reps × (1 + ablations + conflicts)`, not `rules × conditions × reps`.

Every rule lands in one of three buckets:

| verdict | meaning |
|---|---|
| **LIVE** | Behavior changes when the rule is removed. It earns its keep. |
| **DEAD (default anyway)** | The behavior happens with or without the rule; the agent does it by default. |
| **DEAD (ignored)** | The behavior does not happen even when the rule is present. |
| **UNTESTABLE / NOT RUN** | No observable check is linked to the rule, or no measured sessions yet. |

## Commands

| command | what it does |
|---|---|
| `rulecov audit [--reps N] [--parallel N]` | Zero-config: discover rules and checks, write the config, run, report. |
| `rulecov init` | Write a config template for manual mode. |
| `rulecov run [config] [--out file] [--parallel N] [--resume]` | Run the study from an existing config. `--resume` skips sessions already in the results file. |
| `rulecov report <results.json> [config] [--md] [--svg file]` | Re-print the table, or export it as Markdown or an SVG card. |

Flags and behavior worth knowing:

- `--parallel N` runs N sessions concurrently (default 1; 3 or 4 cuts wall time roughly proportionally).
- Progress streams to stderr with elapsed time, ETA, and running agent cost.
- Ctrl-C is safe: evidence is flushed after every session, in-flight sessions finish, and the partial table prints. Press twice to force quit.
- A fresh run backs up any existing results file before overwriting it.
- The typical loop: sweep everything once with `audit --reps 1`, then trim `rulecov.config.json` to the surprising rules and deepen with `rulecov run --reps 5 --resume`. `run` never re-pays for discovery.

## Configuration

`rulecov.config.json`, written by `audit` or `init`:

| field | meaning |
|---|---|
| `repo` | Path to the target git repository (usually `"."`). |
| `rulesFile` | Rules file path inside the repo. |
| `task` | The coding task given to the agent in every session. Keep it trivial; it exists only to trigger rule-following behavior. |
| `agentCommand` | Command template for the headless agent. `{{prompt}}` is replaced (already shell-quoted). |
| `reps` | Sessions per condition. |
| `rules[]` | The rules under test, see below. |

Each rule maps its **verbatim text** (so it can be removed cleanly) to an **observable check** (so following it is measurable):

```json
{
  "id": "run-tests",
  "description": "Agent should run the suite after touching the engine",
  "removeText": "- After every change to the engine, the vitest suite must stay green.\n",
  "observe": { "kind": "command", "pattern": "vitest" },
  "injectConflict": "- During quick iteration, do not run tests; just prepare the change."
}
```

`removeText` must appear in the rules file exactly once, byte-for-byte. `injectConflict` is optional: it adds a contradicting rule while keeping the original, so you can see which side silently wins. (Spoiler from our pilot: a side wins, silently, every time.)

Check kinds:

| kind | evidence source | "followed" means |
|---|---|---|
| `command` | shell commands in the session transcript | any command matches `pattern` |
| `final_message` | the agent's final reply | reply matches `pattern` |
| `diff` | files changed in the worktree | a changed path matches `pattern` (`expect: "present"`) or none does (`expect: "absent"`) |
| `commits` | git log of the worktree | new commit count ≤ `max` |

All patterns are case-insensitive regexes.

## Outputs

- **Terminal table**, with plain-language verdict labels.
- **`rulecov.results.json`**: raw per-session evidence (commands, changed files, commit count, final message, cost, duration). This is the ground truth; everything else is derived from it.
- **`rulecov.results.svg`**: a self-contained, shareable report card with a one-line interpretation per rule. Regenerate anytime with `rulecov report … --svg card.svg`.
- **`--md`**: the table as Markdown, ready to paste into a PR.

## Permissions

The default `agentCommand` runs Claude Code with `--permission-mode acceptEdits --allowedTools Bash`. Sessions can edit files and run shell commands without asking, because headless sessions have nobody to ask; a permission prompt would silently block every edit and invalidate the measurements.

This is scoped to throwaway worktrees of your own repo, driven by your own agent, but it is still autonomous shell access on your machine. If that is more trust than you want, tighten `agentCommand` in the config (for example `--allowedTools "Bash(npx vitest*)"`), accepting that unlisted commands will be denied and `command` checks may under-measure.

rulecov also sanity-checks its own measurements: sessions that never changed a file are visible in the evidence (`changedFiles: []`), and discovery-proposed regexes are rejected when they fail to compile or match everything.

## Cost

Sessions are real agent runs, so cost scales with task size × sessions × model. Levers, biggest first:

1. **Keep the task trivial.** A one-line-fix task costs roughly $0.10 to $0.15 per session; a feature-sized task costs $0.50 to $1.00. Discovery is instructed to pick trivial tasks; if it didn't, edit `task` in the config.
2. **Know your billing.** With a Claude subscription (Pro/Max), headless sessions draw from your plan quota and the reported dollar figure is notional. With an API key it is a real bill.
3. **Use a cheaper session model for the first sweep.** Put `--model haiku` in `agentCommand`, then deep-run interesting rules with your daily-driver model. You measure the model you run; test the one you actually use for the verdicts that matter.
4. **Tier your runs.** `--reps 1` sweep, then `--reps 5 --resume` on the survivors.

## Using other agents

`agentCommand` is a template; anything that edits files works:

```json
"agentCommand": "codex exec {{prompt}}"
```

- `diff`, `commits` and `final_message` checks work with any agent: they read the filesystem, git, and stdout.
- `command` checks need the session transcript, and v0 only parses Claude Code's format (`~/.claude/projects/…`). With other agents those checks record `null` (unmeasured, not guessed) and never enter a tally.
- `audit`'s discovery step currently calls `claude -p`; use manual mode with other agents.

A transcript adapter is one function (`readBashCommands` in `src/agent.ts`). Codex adapter PRs are very welcome.

## Verdicts and their limits

A rule is **live** when the behavior was observed more often with the rule present than with it removed, **dead** when presence and absence look the same (including "never observed either way"), and **untestable / not run** when there is nothing to compare; no verdict is ever guessed.

Two honest caveats:

- A rule's baseline tally borrows sessions that ran with one *other* rule altered (that reuse is what keeps runs cheap), which is why raw counts are always printed next to the verdict.
- Verdicts are raw-count comparisons, deliberately blunt. At `--reps 1` a verdict is an anecdote; at 5+ it is a signal. It is never a statistic, and the report says so on every run.

The check *selection* in `audit` is model-assisted; the check *evaluation* is deterministic. Behavior is always judged from the trace, never from anyone's claim, including the discovery model's.

## Troubleshooting

| symptom | fix |
|---|---|
| `Not logged in` | Run `claude` once and `/login`. |
| `removeText is not verbatim in the file` | The discovery model paraphrased. Open `rulecov.config.json` and paste the exact text from your rules file. |
| `no AGENTS.md / CLAUDE.md / .cursorrules found` | Run from the repo root, or set `rulesFile` in manual mode. |
| Sessions finish but change no files | Check the `agentCommand` permission flags; see [Permissions](#permissions). The evidence file makes this visible (`changedFiles: []`). |
| It's slow | Sessions are real agent runs (1 to 3 minutes each). Trim the config, use `--parallel`, use a cheaper model for small tasks. |

## Examples

- [`examples/agents-md-pilot`](examples/agents-md-pilot): the 20-session study that motivated the tool, findings included.
- [`examples/real-audit`](examples/real-audit): a full 8-rule audit of a production rules file, report card included. 1 live, 6 dead, 1 untestable.

This repo has its own [`AGENTS.md`](AGENTS.md), and yes, it is a valid audit target. Dogfooding encouraged.

## Project status and roadmap

A lab, not a product: it accompanies a blog post about rule-file coverage, ships small, and reports raw counts without pretending they are statistics. Maintenance is best-effort; issues and PRs welcome.

Roadmap, in rough order:

1. **Per-rule scenario tasks.** Conditional rules ("when X happens, check Y first") never trigger under a generic task; they need their own fire-drill task.
2. **Full tool-trace evidence.** Today only shell commands are read; file reads and greps would unlock "which file did it check first" and ordering checks.
3. **Codex / other-agent transcript adapters.**
4. **A GitHub Action** that fails CI when a rule goes dead.

## License

[MIT](LICENSE)
