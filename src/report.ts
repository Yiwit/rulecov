import type { RuleVerdict, RunReport, SessionRecord } from './types.js';
import { classify } from './classify.js';
import type { Config } from './types.js';

export interface Interpretation {
  label: string;
  /** One plain-language sentence saying what the numbers mean for this rule. */
  meaning: string;
}

export function interpret(v: RuleVerdict): Interpretation {
  if (v.classification === 'untestable') {
    return v.hasCheck
      ? { label: 'NOT RUN', meaning: 'Has a check, but no measured sessions yet — no verdict.' }
      : { label: 'UNTESTABLE', meaning: 'No observable behavior is linked to this rule; it cannot be judged.' };
  }
  const baseRate = v.baseline.total ? v.baseline.observed / v.baseline.total : 0;
  const ablRate = v.ablated.total ? v.ablated.observed / v.ablated.total : 0;
  if (v.classification === 'live') {
    return baseRate < 0.75
      ? {
          label: `LIVE (weak ${Math.round(baseRate * 100)}%)`,
          meaning: 'Removing the rule changes behavior — but even with it, compliance is spotty.',
        }
      : { label: 'LIVE', meaning: 'Removing the rule changes behavior. It earns its keep.' };
  }
  if (baseRate >= 0.5 && ablRate >= 0.5) {
    return {
      label: 'DEAD (default anyway)',
      meaning: 'The behavior happens with or without the rule — the agent does this by default; the rule adds nothing.',
    };
  }
  if (baseRate < 0.5 && ablRate < 0.5) {
    return {
      label: 'DEAD (ignored)',
      meaning: 'The behavior does not happen even when the rule is present. The rule is being ignored.',
    };
  }
  return { label: 'DEAD', meaning: 'Presence and absence look the same; the rule changes nothing here.' };
}

export function verdictLabel(v: RuleVerdict): string {
  return interpret(v).label;
}

/** Read old-format sessions (single `observed` field) as the current observations model. */
export function normalizeSessions(report: RunReport): RunReport {
  const sessions = report.sessions.map((s) => {
    const legacy = s as SessionRecord & { observed?: boolean | null };
    if (legacy.observations === undefined) {
      const observations: Record<string, boolean | null> = {};
      if (legacy.ruleId && legacy.observed !== undefined) observations[legacy.ruleId] = legacy.observed;
      return { ...legacy, observations };
    }
    return s;
  });
  return { ...report, sessions };
}

export function buildVerdicts(config: Config, report: RunReport): RuleVerdict[] {
  const normalized = normalizeSessions(report);
  return config.rules.map((rule) =>
    classify(normalized.sessions, rule.id, rule.observe !== undefined, rule.injectConflict !== undefined),
  );
}

export function runCostUsd(report: RunReport): number {
  return report.sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
}

export function formatMarkdown(verdicts: RuleVerdict[]): string {
  const lines = [
    '| rule | verdict | present | removed | conflict |',
    '|---|---|---|---|---|',
    ...verdicts.map(
      (v) =>
        `| ${v.ruleId} | ${verdictLabel(v)} | ${v.baseline.observed}/${v.baseline.total} | ${v.ablated.observed}/${v.ablated.total} | ${v.conflict ? `${v.conflict.observed}/${v.conflict.total}` : '-'} |`,
    ),
  ];
  return lines.join('\n');
}

export function formatTable(verdicts: RuleVerdict[]): string {
  const rows = verdicts.map((v) => ({
    rule: v.ruleId,
    verdict: verdictLabel(v),
    present: `${v.baseline.observed}/${v.baseline.total}`,
    removed: `${v.ablated.observed}/${v.ablated.total}`,
    conflict: v.conflict ? `${v.conflict.observed}/${v.conflict.total}` : '-',
  }));
  const header = { rule: 'rule', verdict: 'verdict', present: 'present', removed: 'removed', conflict: 'conflict' };
  const all = [header, ...rows];
  const width = (key: keyof typeof header) => Math.max(...all.map((r) => r[key].length));
  const line = (r: typeof header) =>
    `${r.rule.padEnd(width('rule'))}  ${r.verdict.padEnd(width('verdict'))}  ${r.present.padEnd(width('present'))}  ${r.removed.padEnd(width('removed'))}  ${r.conflict.padEnd(width('conflict'))}`;
  const counts = verdicts.reduce(
    (acc, v) => ((acc[v.classification] += 1), acc),
    { live: 0, dead: 0, untestable: 0 },
  );
  return [
    line(header),
    '-'.repeat(line(header).length),
    ...rows.map(line),
    '',
    `${verdicts.length} rules: ${counts.live} live, ${counts.dead} dead, ${counts.untestable} untestable.`,
    'Numbers are observed/total per condition. A pilot is a signal, not a statistic.',
  ].join('\n');
}
