import type { Check, Evidence } from './types.js';

/** Did the trace show the behavior the rule asks for? */
export function evaluate(check: Check, evidence: Evidence): boolean {
  const re = check.pattern ? new RegExp(check.pattern, 'i') : undefined;
  switch (check.kind) {
    case 'command':
      return evidence.bashCommands.some((cmd) => re!.test(cmd));
    case 'final_message':
      return re!.test(evidence.finalMessage);
    case 'diff': {
      const hit = evidence.changedFiles.some((f) => re!.test(f));
      return check.expect === 'absent' ? !hit : hit;
    }
    case 'commits':
      return evidence.newCommits <= (check.max ?? 0);
  }
}
