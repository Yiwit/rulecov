import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Check, Config, Rule } from './types.js';

const sh = promisify(exec);

const DISCOVERY_PROMPT = `You are helping set up a behavioral coverage study for an agent rules file.

Below is the full rules file of this repository. Produce a JSON object (and NOTHING else, no prose, no code fences) with this exact shape:

{
  "task": "<one TRIVIAL, concrete, repeatable coding task for this repository. Strict size limit: a single function in a single file, under 20 changed lines, no design decisions — e.g. widen an input guard, add a null-check, extend an enum mapping. NEVER a feature, never anything touching multiple files. The task exists only to trigger rule-following behavior; smaller is better and much cheaper. Base it on a real file you can see in this repo.>",
  "rules": [
    {
      "id": "<kebab-case-slug>",
      "description": "<one line: what behavior the rule demands>",
      "removeText": "<the rule's text COPIED VERBATIM from the file below, including its bullet/dash and trailing newline. It must be an exact substring.>",
      "observe": <one of:
        {"kind":"command","pattern":"<regex matched against shell commands the agent runs>"} |
        {"kind":"final_message","pattern":"<regex matched against the agent's final reply>"} |
        {"kind":"diff","pattern":"<regex over changed file paths>","expect":"present"|"absent"} |
        {"kind":"commits","max":0} |
        null (if the rule has no observable behavioral consequence)>
    }
  ]
}

Rules for you:
- Pick at most 8 rules, preferring ones with clear observable behavior.
- removeText MUST be an exact substring of the file; do not paraphrase, do not fix typos.
- If a rule is vague ("be careful", "keep quality high"), include it with "observe": null so it is reported as untestable.
- Output raw JSON only.

RULES FILE:
----------------
`;

interface Discovered {
  task: string;
  rules: Array<{ id: string; description: string; removeText: string; observe: Check | null }>;
}

export interface DiscoveryResult {
  config: Config;
  skipped: Array<{ id: string; reason: string }>;
}

/** Ask the agent CLI to map the rules file into a rulecov config, then validate every claim against the file. */
export async function discover(
  repo: string,
  rulesFile: string,
  rulesContent: string,
  agentCommand: string,
  reps: number,
): Promise<DiscoveryResult> {
  const prompt = DISCOVERY_PROMPT + rulesContent;
  const command = agentCommand.replaceAll('{{prompt}}', `'${prompt.replaceAll("'", `'\\''`)}'`);
  const { stdout } = await sh(command, { cwd: repo, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  const parsed = extractJson(stdout);

  const skipped: Array<{ id: string; reason: string }> = [];
  const rules: Rule[] = [];
  for (const r of parsed.rules) {
    if (!r.removeText || typeof r.removeText !== 'string') {
      skipped.push({ id: r.id ?? '?', reason: 'no removeText' });
      continue;
    }
    const occurrences = rulesContent.split(r.removeText).length - 1;
    if (occurrences !== 1) {
      // The model paraphrased or picked ambiguous text. Never trust the claim; drop it visibly.
      skipped.push({ id: r.id, reason: occurrences === 0 ? 'removeText is not verbatim in the file' : 'removeText is not unique' });
      continue;
    }
    let observe: Check | undefined;
    try {
      observe = sanitizeCheck(r.observe);
    } catch (error) {
      skipped.push({ id: r.id, reason: `invalid observe pattern: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    rules.push({
      id: r.id,
      description: r.description ?? '',
      removeText: r.removeText,
      observe,
    });
  }
  if (rules.length === 0) throw new Error('discovery produced no verifiable rules; write rulecov.config.json by hand');
  return {
    config: { repo, rulesFile, task: parsed.task, agentCommand, reps, rules },
    skipped,
  };
}

/** Validate a model-proposed check: known kind, compilable regex. Returns undefined for null (untestable). */
function sanitizeCheck(raw: Check | null | undefined): Check | undefined {
  if (raw === null || raw === undefined) return undefined;
  const kinds = ['command', 'final_message', 'diff', 'commits'];
  if (!kinds.includes(raw.kind)) throw new Error(`unknown check kind: ${String(raw.kind)}`);
  let pattern = raw.pattern;
  if (raw.kind !== 'commits') {
    if (typeof pattern !== 'string' || !pattern) throw new Error('missing pattern');
    // LLMs often emit PCRE/Python inline flags like (?i) or (?i:...), which JS RegExp rejects.
    // evaluate() already compiles every pattern case-insensitively, so drop the flag groups.
    pattern = pattern.replace(/^\(\?[a-zA-Z]+\)/, '').replace(/\(\?[a-zA-Z]+:/g, '(?:');
    const re = new RegExp(pattern);
    // A pattern that matches the empty string matches everything: the check would
    // report "followed" unconditionally. Seen in the wild as "[a-zA-Z]{0,0}".
    if (re.test('')) throw new Error(`vacuous pattern (matches empty string): ${pattern}`);
  }
  return {
    kind: raw.kind,
    pattern,
    expect: raw.expect === 'absent' ? 'absent' : 'present',
    max: typeof raw.max === 'number' ? raw.max : 0,
  };
}

function extractJson(stdout: string): Discovered {
  let text = stdout;
  try {
    const outer = JSON.parse(stdout) as { result?: string };
    if (typeof outer.result === 'string') text = outer.result;
  } catch {
    /* stdout was not the CLI JSON envelope */
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('discovery: agent returned no JSON');
  const parsed = JSON.parse(text.slice(start, end + 1)) as Discovered;
  if (typeof parsed.task !== 'string' || !Array.isArray(parsed.rules)) {
    throw new Error('discovery: JSON missing task/rules');
  }
  return parsed;
}
