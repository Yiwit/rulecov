import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Check, Config, Rule } from './types.js';

function fail(msg: string): never {
  throw new Error(`config: ${msg}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readCheck(v: unknown, where: string): Check {
  if (!isRecord(v)) fail(`${where} must be an object`);
  const kind = v.kind;
  if (kind !== 'command' && kind !== 'final_message' && kind !== 'diff' && kind !== 'commits') {
    fail(`${where}.kind must be command | final_message | diff | commits`);
  }
  if (kind !== 'commits' && typeof v.pattern !== 'string') fail(`${where}.pattern required`);
  if (v.pattern !== undefined) new RegExp(v.pattern as string);
  return {
    kind,
    pattern: v.pattern as string | undefined,
    expect: (v.expect as 'present' | 'absent' | undefined) ?? 'present',
    max: typeof v.max === 'number' ? v.max : 0,
  };
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(raw)) fail('root must be an object');
  for (const key of ['repo', 'rulesFile', 'task', 'agentCommand'] as const) {
    if (typeof raw[key] !== 'string' || !raw[key]) fail(`${key} must be a non-empty string`);
  }
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) fail('rules must be a non-empty array');
  const seen = new Set<string>();
  const rules: Rule[] = raw.rules.map((item, i) => {
    if (!isRecord(item)) fail(`rules[${i}] must be an object`);
    if (typeof item.id !== 'string' || !item.id) fail(`rules[${i}].id required`);
    if (seen.has(item.id)) fail(`duplicate rule id: ${item.id}`);
    seen.add(item.id);
    if (typeof item.removeText !== 'string' || !item.removeText) fail(`rules[${i}].removeText required`);
    return {
      id: item.id,
      description: typeof item.description === 'string' ? item.description : '',
      removeText: item.removeText,
      observe: item.observe === undefined ? undefined : readCheck(item.observe, `rules[${i}].observe`),
      injectConflict: typeof item.injectConflict === 'string' ? item.injectConflict : undefined,
    };
  });
  return {
    repo: resolve(dirname(resolve(path)), raw.repo as string),
    rulesFile: raw.rulesFile as string,
    task: raw.task as string,
    agentCommand: raw.agentCommand as string,
    reps: typeof raw.reps === 'number' && raw.reps > 0 ? Math.floor(raw.reps) : 3,
    rules,
  };
}
