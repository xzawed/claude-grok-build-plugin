import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[]) => Promise<void>;

export interface WorktreeDeps {
  runGit?: GitRunner;
  baseDir?: string;
  name?: string;
}

const defaultRunGit: GitRunner = async (args) => {
  await execFileAsync('git', args); // rejects on non-zero exit
};

export function worktreeName(): string {
  return `grok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Creates a fresh git worktree at <baseDir>/<name> on a new branch grok/<name>
// based on the current HEAD of the repo at cwd. Returns the worktree path.
// Throws if cwd is not a git repo / has no commits / git otherwise fails.
// grok's own --worktree flag is a headless no-op, so the wrapper manages the
// worktree and points grok's --cwd at the returned path.
export async function createGrokWorktree(cwd: string, deps: WorktreeDeps = {}): Promise<string> {
  const name = deps.name ?? worktreeName();
  const baseDir = deps.baseDir ?? join(homedir(), '.grok-build', 'worktrees');
  const runGit = deps.runGit ?? defaultRunGit;
  const path = join(baseDir, name);
  mkdirSync(baseDir, { recursive: true });
  await runGit(['-C', cwd, 'worktree', 'add', path, '-b', `grok/${name}`, 'HEAD']);
  return path;
}
