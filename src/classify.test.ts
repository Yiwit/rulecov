import { describe, expect, it } from 'vitest';
import { classify } from './classify.js';
import type { SessionRecord } from './types.js';

function session(
  ruleId: string | null,
  condition: SessionRecord['condition'],
  observations: Record<string, boolean | null>,
): SessionRecord {
  return {
    ruleId,
    condition,
    rep: 1,
    observations,
    evidence: { bashCommands: [], finalMessage: '', changedFiles: [], newCommits: 0 },
    worktree: '/tmp/x',
  };
}

describe('classify', () => {
  it('marks a rule live when presence beats absence', () => {
    const sessions = [
      session(null, 'baseline', { r: true }),
      session(null, 'baseline', { r: false }),
      session('r', 'ablated', { r: false }),
      session('r', 'ablated', { r: false }),
    ];
    expect(classify(sessions, 'r', true, false).classification).toBe('live');
  });

  it('marks a rule dead when presence and absence look the same', () => {
    const sessions = [
      session(null, 'baseline', { r: false }),
      session(null, 'baseline', { r: false }),
      session('r', 'ablated', { r: false }),
    ];
    expect(classify(sessions, 'r', true, false).classification).toBe('dead');
  });

  it('marks a rule untestable without an observable check', () => {
    expect(classify([], 'r', false, false).classification).toBe('untestable');
  });

  it('marks a rule untestable when a condition has no measured sessions to compare', () => {
    const noAblated = [session(null, 'baseline', { r: true })];
    expect(classify(noAblated, 'r', true, false).classification).toBe('untestable');

    const nullAblated = [session(null, 'baseline', { r: true }), session('r', 'ablated', { r: null })];
    expect(classify(nullAblated, 'r', true, false).classification).toBe('untestable');
  });

  it('borrows baseline evidence from sessions that manipulated other rules', () => {
    // No dedicated baseline session for r: its baseline tally comes from the shared
    // pool plus other rules' ablated/conflict sessions, where r's text was intact.
    const sessions = [
      session('other', 'ablated', { r: true, other: false }),
      session('other', 'conflict', { r: true, other: false }),
      session('r', 'ablated', { r: false }),
    ];
    const verdict = classify(sessions, 'r', true, false);
    expect(verdict.baseline).toEqual({ observed: 2, total: 2 });
    expect(verdict.classification).toBe('live');
  });

  it("never counts a rule's own ablated or conflict sessions as its baseline", () => {
    const sessions = [
      session(null, 'baseline', { r: false }),
      session('r', 'ablated', { r: true }),
      session('r', 'conflict', { r: true }),
    ];
    const verdict = classify(sessions, 'r', true, true);
    expect(verdict.baseline).toEqual({ observed: 0, total: 1 });
    expect(verdict.conflict).toEqual({ observed: 1, total: 1 });
    expect(verdict.classification).toBe('dead');
  });

  it('skips unmeasured (null) observations in every tally', () => {
    const sessions = [
      session(null, 'baseline', { r: true }),
      session(null, 'baseline', { r: null }),
      session('r', 'ablated', { r: false }),
      session('r', 'ablated', { r: null }),
    ];
    const verdict = classify(sessions, 'r', true, false);
    expect(verdict.baseline).toEqual({ observed: 1, total: 1 });
    expect(verdict.ablated).toEqual({ observed: 0, total: 1 });
  });
});
