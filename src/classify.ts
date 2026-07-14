import type { RuleVerdict, SessionRecord } from './types.js';

function tally(sessions: SessionRecord[], ruleId: string, keep: (s: SessionRecord) => boolean) {
  const rows = sessions.filter((s) => keep(s) && s.observations[ruleId] !== null && s.observations[ruleId] !== undefined);
  return { observed: rows.filter((s) => s.observations[ruleId]).length, total: rows.length };
}

/**
 * v0 classification, deliberately blunt:
 * - untestable: rule has no observable check, or one of the two conditions
 *   never produced a measured session — there is nothing to compare.
 * - live: behavior observed more often with the rule present than with it removed.
 * - dead: presence and absence look the same (including "never observed either way").
 * Rates are reported alongside so readers can judge the margin themselves.
 *
 * Baseline evidence is every session in which the rule's text was intact and
 * unconflicted: the shared-baseline sessions plus every session that manipulated a
 * *different* rule. Those borrowed samples ran with one other rule altered, which is
 * why rates are always reported alongside the verdict.
 */
export function classify(sessions: SessionRecord[], ruleId: string, hasCheck: boolean, hasConflict: boolean): RuleVerdict {
  // `s.condition === 'baseline'` also admits legacy per-rule baseline sessions (ruleId === ruleId).
  const baseline = tally(sessions, ruleId, (s) => s.ruleId !== ruleId || s.condition === 'baseline');
  const ablated = tally(sessions, ruleId, (s) => s.ruleId === ruleId && s.condition === 'ablated');
  const conflict = hasConflict ? tally(sessions, ruleId, (s) => s.ruleId === ruleId && s.condition === 'conflict') : undefined;
  if (!hasCheck || baseline.total === 0 || ablated.total === 0) {
    return { ruleId, classification: 'untestable', hasCheck, baseline, ablated, conflict };
  }
  const baseRate = baseline.observed / baseline.total;
  const ablRate = ablated.observed / ablated.total;
  const classification = baseRate > ablRate ? 'live' : 'dead';
  return { ruleId, classification, hasCheck, baseline, ablated, conflict };
}
