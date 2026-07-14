#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { discover } from './discover.js';
import { applyVariant, conditionsFor } from './variant.js';
import { addWorktree, changedFiles, currentHead, newCommitCount, removeWorktree } from './worktree.js';
import { runAgent } from './agent.js';
import { evaluate } from './evaluate.js';
import { buildVerdicts, formatMarkdown, formatTable, normalizeSessions, runCostUsd } from './report.js';
import { renderSvg } from './svg.js';
import type { Condition, Config, Evidence, Rule, RunReport, SessionRecord } from './types.js';

const CONFIG_TEMPLATE = `{
  "repo": ".",
  "rulesFile": "AGENTS.md",
  "task": "Describe one small, repeatable coding task here. Keep it identical across all sessions.",
  "agentCommand": "claude -p {{prompt}} --output-format json --model sonnet --permission-mode acceptEdits --allowedTools Bash",
  "reps": 3,
  "rules": [
    {
      "id": "run-tests",
      "description": "Agent should run the test suite after a change",
      "removeText": "PASTE the exact rule text from your rules file here (verbatim, unique)\\n",
      "observe": { "kind": "command", "pattern": "vitest|npm test|pytest" },
      "injectConflict": "- During quick iteration, do not run tests; just prepare the change."
    },
    {
      "id": "no-commit",
      "description": "Agent must not commit without being asked",
      "removeText": "PASTE the exact no-commit rule text here\\n",
      "observe": { "kind": "commits", "max": 0 }
    }
  ]
}
`;

function usage(): string {
  return [
    'Usage:',
    '  rulecov audit [--reps N] [--parallel N]   zero-config: discover rules + checks from your',
    '                                            AGENTS.md/CLAUDE.md, then run and report',
    '  rulecov init                              write rulecov.config.json template (manual mode)',
    '  rulecov run [config] [--out file] [--parallel N] [--resume]',
    '                                            run the ablation study (worktrees + agent sessions);',
    '                                            --resume skips sessions already in the results file',
    '  rulecov report <results.json> [config] [--md] [--svg file]',
    '                                            classify rules and print the coverage table',
  ].join('\n');
}

const DEFAULT_AGENT = 'claude -p {{prompt}} --output-format json --model sonnet --permission-mode acceptEdits --allowedTools Bash';

interface RunFlags {
  parallel: number;
  resume: boolean;
}

async function cmdAudit(reps: number, flags: RunFlags): Promise<string> {
  const repo = resolve('.');
  const rulesFile = await detectRulesFile(repo);
  const content = await readFile(join(repo, rulesFile), 'utf8');
  process.stderr.write(`[rulecov] discovering rules from ${rulesFile}...\n`);
  const { config, skipped } = await discover(repo, rulesFile, content, DEFAULT_AGENT, reps);
  const configPath = resolve('rulecov.config.json');
  await writeFile(configPath, `${JSON.stringify({ ...config, repo: '.' }, null, 2)}\n`);
  for (const s of skipped) process.stderr.write(`[rulecov] skipped ${s.id}: ${s.reason}\n`);
  process.stderr.write(
    `[rulecov] ${config.rules.length} rules, task: "${config.task}"\n` +
      `[rulecov] config written to ${configPath} (edit it and re-run 'rulecov run' to iterate)\n`,
  );
  return cmdRun(configPath, resolve('rulecov.results.json'), flags);
}

async function detectRulesFile(repo: string): Promise<string> {
  for (const candidate of ['AGENTS.md', 'CLAUDE.md', '.cursorrules']) {
    try {
      const content = await readFile(join(repo, candidate), 'utf8');
      // A CLAUDE.md that is just an @AGENTS.md alias should resolve to the real file.
      if (content.trim().startsWith('@') && content.trim().length < 40) continue;
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('no AGENTS.md / CLAUDE.md / .cursorrules found in this directory');
}

async function cmdInit(): Promise<string> {
  const path = resolve('rulecov.config.json');
  await writeFile(path, CONFIG_TEMPLATE, { flag: 'wx' });
  return `Wrote ${path}. Fill in removeText blocks verbatim from your rules file, then: rulecov run`;
}

interface Job {
  /** Rule manipulated in this session; null for a shared-baseline session. */
  rule: Rule | null;
  condition: Condition;
  rep: number;
  variant: string;
}

/**
 * Evaluate every rule's check against one session's evidence. Checks are deterministic
 * and free, so each paid agent session feeds every rule's tally: a session where a
 * rule's text was intact is baseline evidence for that rule.
 */
function observeAll(rules: Rule[], evidence: Evidence, hasTranscript: boolean): Record<string, boolean | null> {
  const observations: Record<string, boolean | null> = {};
  for (const rule of rules) {
    if (!rule.observe) continue;
    // Without a transcript a 'command' check is unmeasured, not false.
    observations[rule.id] = rule.observe.kind === 'command' && !hasTranscript ? null : evaluate(rule.observe, evidence);
  }
  return observations;
}

/** git worktree add/remove mutate shared repo state; serialize them across parallel sessions. */
let gitLock: Promise<unknown> = Promise.resolve();
function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = gitLock.then(fn, fn);
  gitLock = next.catch(() => undefined);
  return next;
}

let interrupted = false;

async function cmdRun(configPath: string, outPath: string, flags: RunFlags): Promise<string> {
  const config = await loadConfig(configPath);
  const base = await currentHead(config.repo);
  const original = await readFile(join(config.repo, config.rulesFile), 'utf8');
  const scratch = join(tmpdir(), `rulecov-${Date.now()}`);
  await mkdir(scratch, { recursive: true });
  const report: RunReport = { configPath: resolve(configPath), startedAt: new Date().toISOString(), sessions: [] };

  const done = new Set<string>();
  if (flags.resume) {
    try {
      const prior = normalizeSessions(JSON.parse(await readFile(outPath, 'utf8')) as RunReport);
      for (const s of prior.sessions) {
        if (s.error) continue;
        report.sessions.push(s);
        done.add(`${s.ruleId ?? '~baseline~'}|${s.condition}|${s.rep}`);
      }
      process.stderr.write(`[rulecov] resume: keeping ${done.size} completed sessions from ${outPath}\n`);
    } catch {
      process.stderr.write(`[rulecov] resume: no readable ${outPath}, starting fresh\n`);
    }
  } else {
    // A fresh run overwrites the results file; rotate any existing one so no paid evidence is lost.
    try {
      const existing = await readFile(outPath, 'utf8');
      const backup = outPath.replace(/\.json$/, '') + `.bak-${Date.now()}.json`;
      await writeFile(backup, existing);
      process.stderr.write(`[rulecov] existing results backed up to ${backup}\n`);
    } catch {
      /* nothing to back up */
    }
  }

  const jobs: Job[] = [];
  // Baseline is shared: the untouched file is the baseline variant for every rule, so
  // one pool of `reps` sessions serves them all instead of `rules × reps`.
  const enqueue = (job: Job): void => {
    if (!done.has(`${job.rule?.id ?? '~baseline~'}|${job.condition}|${job.rep}`)) jobs.push(job);
  };
  for (let rep = 1; rep <= config.reps; rep += 1) {
    enqueue({ rule: null, condition: 'baseline', rep, variant: original });
  }
  for (const rule of config.rules) {
    for (const condition of conditionsFor(rule)) {
      let variant: string;
      try {
        variant = applyVariant(original, rule, condition);
      } catch (error) {
        process.stderr.write(`[rulecov] skipping ${rule.id}/${condition}: ${error instanceof Error ? error.message : error}\n`);
        continue;
      }
      for (let rep = 1; rep <= config.reps; rep += 1) enqueue({ rule, condition, rep, variant });
    }
  }

  const started = Date.now();
  let completed = 0;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    process.stderr.write('\n[rulecov] interrupted: no new sessions will start; waiting for in-flight ones (Ctrl-C again to force quit)\n');
  });

  const runJob = async (job: Job): Promise<void> => {
    const label = job.rule?.id ?? 'baseline';
    const wt = join(scratch, `${label}-${job.condition}-${job.rep}`);
    const record: SessionRecord = {
      ruleId: job.rule?.id ?? null,
      condition: job.condition,
      rep: job.rep,
      observations: {},
      evidence: { bashCommands: [], finalMessage: '', changedFiles: [], newCommits: 0 },
      worktree: wt,
    };
    report.sessions.push(record);
    try {
      await withGitLock(() => addWorktree(config.repo, wt, base));
      await writeFile(join(wt, config.rulesFile), job.variant);
      const agent = await runAgent(config.agentCommand, config.task, wt);
      record.costUsd = agent.costUsd;
      record.durationMs = agent.durationMs;
      record.evidence = {
        bashCommands: agent.bashCommands,
        finalMessage: agent.finalMessage,
        changedFiles: (await changedFiles(wt)).filter((f) => f !== config.rulesFile),
        newCommits: await newCommitCount(wt, base),
      };
      record.observations = observeAll(config.rules, record.evidence, agent.hasTranscript);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
    } finally {
      await withGitLock(() => removeWorktree(config.repo, wt)).catch(() => {});
    }
    completed += 1;
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
    const elapsed = (Date.now() - started) / 1000;
    const eta = completed > 0 ? Math.round((elapsed / completed) * (jobs.length - completed)) : 0;
    const cost = runCostUsd(report);
    process.stderr.write(
      `[rulecov] ${label} ${job.condition} #${job.rep} done · ${completed}/${jobs.length}` +
        ` · elapsed ${Math.round(elapsed)}s · ~${eta}s left${cost > 0 ? ` · $${cost.toFixed(2)}` : ''}\n`,
    );
  };

  const workers = Math.max(1, flags.parallel);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      while (cursor < jobs.length && !interrupted) {
        const job = jobs[cursor];
        cursor += 1;
        await runJob(job);
      }
    }),
  );

  const verdicts = buildVerdicts(config, report);
  const svgPath = outPath.replace(/\.json$/, '') + '.svg';
  await writeFile(svgPath, renderSvg(verdicts, report));
  const cost = runCostUsd(report);
  const suffix = interrupted ? '\n(partial: run was interrupted)' : '';
  return `${formatTable(verdicts)}${suffix}\n\nRaw evidence: ${outPath}\nShareable card: ${svgPath}${cost > 0 ? `\nTotal agent cost: $${cost.toFixed(2)}` : ''}`;
}

async function cmdReport(resultsPath: string, configPath: string, md: boolean, svgPath?: string): Promise<string> {
  const config = await loadConfig(configPath);
  const report = JSON.parse(await readFile(resultsPath, 'utf8')) as RunReport;
  const verdicts = buildVerdicts(config, report);
  if (svgPath) {
    await writeFile(svgPath, renderSvg(verdicts, report));
    return `Wrote ${svgPath}`;
  }
  return md ? formatMarkdown(verdicts) : formatTable(verdicts);
}

function takeFlag(rest: string[], name: string): string | undefined {
  const i = rest.indexOf(name);
  if (i === -1) return undefined;
  const value = rest[i + 1];
  if (!value) throw new Error(`${name} requires a value`);
  rest.splice(i, 2);
  return value;
}

export async function runCli(args: string[]): Promise<string> {
  const [command, ...rest] = args;
  if (command === 'audit' || command === 'run') {
    const parallelRaw = takeFlag(rest, '--parallel');
    const parallel = parallelRaw === undefined ? 1 : Number(parallelRaw);
    if (!Number.isInteger(parallel) || parallel < 1) throw new Error('--parallel must be a positive integer');
    const resumeIndex = rest.indexOf('--resume');
    if (resumeIndex !== -1) rest.splice(resumeIndex, 1);
    const resume = resumeIndex !== -1;
    if (command === 'audit') {
      const repsRaw = takeFlag(rest, '--reps');
      const reps = repsRaw === undefined ? 3 : Number(repsRaw);
      if (!Number.isInteger(reps) || reps < 1) throw new Error('--reps must be a positive integer');
      return cmdAudit(reps, { parallel, resume });
    }
    const out = takeFlag(rest, '--out') ?? 'rulecov.results.json';
    return cmdRun(rest[0] ?? 'rulecov.config.json', resolve(out), { parallel, resume });
  }
  if (command === 'init') return cmdInit();
  if (command === 'report') {
    const svgPath = takeFlag(rest, '--svg');
    const mdIndex = rest.indexOf('--md');
    if (mdIndex !== -1) rest.splice(mdIndex, 1);
    const [results, config] = rest;
    if (!results) throw new Error(usage());
    return cmdReport(results, config ?? 'rulecov.config.json', mdIndex !== -1, svgPath);
  }
  throw new Error(usage());
}

async function main(): Promise<void> {
  try {
    console.log(await runCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const here = fileURLToPath(import.meta.url);
  if (here === entry) return true;
  // When invoked through a symlink (npm/homebrew bin shim), process.argv[1] is the
  // symlink path while import.meta.url resolves to the real file. Compare real paths.
  try {
    return realpathSync(entry) === here;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main();
}
