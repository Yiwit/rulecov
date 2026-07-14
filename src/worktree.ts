import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function currentHead(repo: string): Promise<string> {
  const { stdout } = await run('git', ['-C', repo, 'rev-parse', 'HEAD']);
  return stdout.trim();
}

export async function addWorktree(repo: string, path: string, commit: string): Promise<void> {
  await run('git', ['-C', repo, 'worktree', 'add', '--detach', path, commit]);
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  await run('git', ['-C', repo, 'worktree', 'remove', '--force', path]);
}

export async function changedFiles(worktree: string): Promise<string[]> {
  const { stdout } = await run('git', ['-C', worktree, 'status', '--porcelain']);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

export async function newCommitCount(worktree: string, baseCommit: string): Promise<number> {
  const { stdout } = await run('git', ['-C', worktree, 'rev-list', `${baseCommit}..HEAD`, '--count']);
  return Number(stdout.trim()) || 0;
}
