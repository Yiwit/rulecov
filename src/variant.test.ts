import { describe, expect, it } from 'vitest';
import { applyVariant, conditionsFor } from './variant.js';
import type { Rule } from './types.js';

const rule: Rule = {
  id: 'r',
  description: '',
  removeText: '- Run the tests after every change.\n',
  injectConflict: '- During quick iteration, do not run tests.',
};

const file = '# Rules\n\n- Run the tests after every change.\n- Never commit unasked.\n';

describe('applyVariant', () => {
  it('leaves baseline untouched', () => {
    expect(applyVariant(file, rule, 'baseline')).toBe(file);
  });

  it('removes exactly the rule text when ablated', () => {
    const out = applyVariant(file, rule, 'ablated');
    expect(out).not.toContain('Run the tests');
    expect(out).toContain('Never commit unasked.');
  });

  it('throws when removeText is missing or ambiguous', () => {
    expect(() => applyVariant('# empty\n', rule, 'ablated')).toThrow('not found');
    expect(() => applyVariant(file + file, rule, 'ablated')).toThrow('make it unique');
  });

  it('prepends the conflicting rule while keeping the original', () => {
    const out = applyVariant(file, rule, 'conflict');
    expect(out).toContain('do not run tests');
    expect(out).toContain('Run the tests after every change.');
  });

  it('schedules per-rule conditions only — baseline is a shared pool, not per-rule', () => {
    expect(conditionsFor(rule)).toEqual(['ablated', 'conflict']);
    expect(conditionsFor({ ...rule, injectConflict: undefined })).toEqual(['ablated']);
  });
});
