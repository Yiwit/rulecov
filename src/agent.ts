import { exec } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const sh = promisify(exec);

export interface AgentResult {
  finalMessage: string;
  bashCommands: string[];
  /** Whether a session transcript was found. Without one, 'command' checks are unmeasured, not false. */
  hasTranscript: boolean;
  costUsd?: number;
  durationMs?: number;
}

/**
 * Run the agent command inside the worktree and extract behavioral evidence.
 *
 * The default agent command is Claude Code headless:
 *   claude -p {{prompt}} --output-format json --model sonnet
 * ({{prompt}} is shell-quoted on substitution — do not wrap it in quotes yourself)
 * whose stdout contains a session_id; the full tool-call transcript lives at
 * ~/.claude/projects/<cwd-slug>/<session_id>.jsonl. Bash tool inputs are read
 * from there so the evidence is the trace, not the agent's self-report.
 *
 * Any other command works too; without a transcript, 'command' checks are
 * skipped (observed=null) rather than guessed.
 */
export async function runAgent(agentCommand: string, task: string, worktree: string): Promise<AgentResult> {
  const command = agentCommand.replaceAll('{{prompt}}', shellQuote(task));
  const { stdout } = await sh(command, { cwd: worktree, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60_000 });
  let finalMessage = stdout;
  let sessionId: string | undefined;
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  try {
    const parsed = JSON.parse(stdout) as {
      result?: string;
      session_id?: string;
      total_cost_usd?: number;
      duration_ms?: number;
    };
    if (typeof parsed.result === 'string') finalMessage = parsed.result;
    if (typeof parsed.session_id === 'string') sessionId = parsed.session_id;
    if (typeof parsed.total_cost_usd === 'number') costUsd = parsed.total_cost_usd;
    if (typeof parsed.duration_ms === 'number') durationMs = parsed.duration_ms;
  } catch {
    /* non-JSON output: treat stdout as the final message */
  }
  const transcript = sessionId ? await findTranscript(worktree, sessionId) : undefined;
  const bashCommands = transcript ? await readBashCommands(transcript) : [];
  return { finalMessage, bashCommands, hasTranscript: transcript !== undefined, costUsd, durationMs };
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

async function readBashCommands(transcript: string): Promise<string[]> {
  const commands: string[] = [];
  for (const line of (await readFile(transcript, 'utf8')).split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as { message?: { content?: unknown } };
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === 'object' && (block as { name?: string }).name === 'Bash') {
          const cmd = (block as { input?: { command?: string } }).input?.command;
          if (typeof cmd === 'string') commands.push(cmd);
        }
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return commands;
}

async function findTranscript(cwd: string, sessionId: string): Promise<string | undefined> {
  const projects = join(homedir(), '.claude', 'projects');
  const slug = cwd.replaceAll('/', '-').replaceAll('.', '-');
  const direct = join(projects, slug, `${sessionId}.jsonl`);
  try {
    await readFile(direct, 'utf8');
    return direct;
  } catch {
    /* fall through to scan */
  }
  try {
    for (const dir of await readdir(projects)) {
      const candidate = join(projects, dir, `${sessionId}.jsonl`);
      try {
        await readFile(candidate, 'utf8');
        return candidate;
      } catch {
        /* keep scanning */
      }
    }
  } catch {
    /* no projects dir */
  }
  return undefined;
}
