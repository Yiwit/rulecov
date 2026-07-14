export type CheckKind = 'command' | 'final_message' | 'diff' | 'commits';

export interface Check {
  kind: CheckKind;
  /** Regex tested against: bash commands (command), final agent message (final_message), changed file paths (diff). */
  pattern?: string;
  /** For 'diff': whether a match means the behavior was observed ('present') or violated ('absent'). Default 'present'. */
  expect?: 'present' | 'absent';
  /** For 'commits': behavior observed when new commit count <= max. Default 0. */
  max?: number;
}

export interface Rule {
  id: string;
  description: string;
  /** Exact text block to remove from the rules file in the ablated condition. Must match verbatim. */
  removeText: string;
  /** Behavioral check proving the rule was followed. Omit → rule is classified 'untestable'. */
  observe?: Check;
  /** Optional conflict condition: this text is added to the rules file while removeText stays in place. */
  injectConflict?: string;
}

export interface Config {
  /** Absolute or config-relative path to the target git repository. */
  repo: string;
  /** Path of the rules file inside the repo (e.g. "AGENTS.md"). */
  rulesFile: string;
  /** Task prompt given to the agent in every session. */
  task: string;
  /** Command template to run the agent headless. {{prompt}} is replaced with the task. */
  agentCommand: string;
  /** Repetitions per condition. */
  reps: number;
  rules: Rule[];
}

export type Condition = 'baseline' | 'ablated' | 'conflict';

export interface Evidence {
  bashCommands: string[];
  finalMessage: string;
  changedFiles: string[];
  newCommits: number;
}

export interface SessionRecord {
  /** The rule manipulated in this session; null for a shared-baseline session (untouched rules file). */
  ruleId: string | null;
  condition: Condition;
  rep: number;
  /**
   * Check results for every rule with an observable check, evaluated against this
   * session's evidence. null = unmeasured (e.g. a 'command' check without a transcript).
   * A session in which a rule's text was intact doubles as baseline evidence for that
   * rule, so one paid agent session feeds every rule's tally.
   */
  observations: Record<string, boolean | null>;
  evidence: Evidence;
  worktree: string;
  costUsd?: number;
  durationMs?: number;
  error?: string;
}

export interface RunReport {
  configPath: string;
  startedAt: string;
  sessions: SessionRecord[];
}

export type Classification = 'live' | 'dead' | 'untestable';

export interface RuleVerdict {
  ruleId: string;
  classification: Classification;
  /** Whether the rule has an observable check; distinguishes "untestable" from "not run yet". */
  hasCheck: boolean;
  baseline: { observed: number; total: number };
  ablated: { observed: number; total: number };
  conflict?: { observed: number; total: number };
}
