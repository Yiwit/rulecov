import type { Condition, Rule } from './types.js';

/**
 * Produce the rules-file content for a condition.
 * - baseline: untouched.
 * - ablated: rule.removeText removed (must match verbatim, exactly once).
 * - conflict: rule.injectConflict prepended to the file while removeText stays.
 */
export function applyVariant(original: string, rule: Rule, condition: Condition): string {
  if (condition === 'baseline') return original;
  if (condition === 'ablated') {
    const count = original.split(rule.removeText).length - 1;
    if (count === 0) throw new Error(`rule ${rule.id}: removeText not found in rules file`);
    if (count > 1) throw new Error(`rule ${rule.id}: removeText matches ${count} times; make it unique`);
    return original.replace(rule.removeText, '');
  }
  if (!rule.injectConflict) throw new Error(`rule ${rule.id}: no injectConflict defined`);
  return `${rule.injectConflict.trimEnd()}\n\n${original}`;
}

/**
 * Per-rule conditions to schedule. Baseline is not per-rule: the baseline variant is the
 * untouched file for every rule, so one shared pool of baseline sessions serves them all.
 */
export function conditionsFor(rule: Rule): Condition[] {
  const conditions: Condition[] = ['ablated'];
  if (rule.injectConflict) conditions.push('conflict');
  return conditions;
}
