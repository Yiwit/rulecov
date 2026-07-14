# A real audit: 8 rules, 9 sessions, one command

`rulecov audit --reps 1 --parallel 4` against the `AGENTS.md` of an internal agent
engine (raw evidence withheld — it contains internal file paths; the numbers and the
[report card](report-card.svg) are the real output).

| rule | verdict | present | removed |
|---|---|---|---|
| no-unrequested-tests | DEAD (default anyway) | 8/8 | 1/1 |
| small-focused-changes | DEAD (default anyway) | 8/8 | 1/1 |
| mask-secrets-in-logs | DEAD (ignored) | 0/8 | 0/1 |
| no-unrequested-commits | DEAD (default anyway) | 8/8 | 1/1 |
| commit-message-co-authored | UNTESTABLE | - | - |
| report-changes-before-finishing | **LIVE (weak 38%)** | 3/8 | 0/1 |
| vitest-suite-green | DEAD (ignored) | 0/8 | 0/1 |

What this file's owner learned for ~$6:

- **One rule in eight demonstrably works** — and even that one only 38% of the time.
- **Three rules are the agent's default behavior anyway**: deleting them would change
  nothing. They are comfort, not control.
- **Two rules are ignored outright**, including "the test suite must stay green" —
  a verdict that has now replicated across three independent runs with different tasks.
- One rule couldn't be linked to observable behavior at all.

Also worth knowing: an earlier run of this audit produced a confident-looking table
that was entirely invalid — headless sessions were hitting a permission wall and had
edited zero files. The evidence file exposed it (`changedFiles: []` everywhere), which
is the whole point of keeping evidence: **distrust the table, check the trace.** The
default agent command now grants edit/shell permissions, and rulecov rejects
always-matching check patterns it catches at discovery time.

Reproduce on your own repo:

```bash
cd your-repo
rulecov audit --reps 1 --parallel 4
```
