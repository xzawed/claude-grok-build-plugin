import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, realpathSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[]) => Promise<void>;
export type GitCapture = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface WorktreeDeps {
  runGit?: GitRunner;
  captureGit?: GitCapture;
  baseDir?: string;
  name?: string;
}

const defaultRunGit: GitRunner = async (args) => {
  await execFileAsync('git', args); // rejects on non-zero exit
};

const defaultCaptureGit: GitCapture = async (args) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
};

export function defaultWorktreeBaseDir(): string {
  return join(homedir(), '.grok-build', 'worktrees');
}

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
  const baseDir = deps.baseDir ?? defaultWorktreeBaseDir();
  const runGit = deps.runGit ?? defaultRunGit;
  const path = join(baseDir, name);
  mkdirSync(baseDir, { recursive: true });
  await runGit(['-C', cwd, 'worktree', 'add', path, '-b', `grok/${name}`, 'HEAD']);
  return path;
}

/**
 * True if `candidate` is strictly inside `baseDir` (after resolve).
 * Prevents `git worktree remove` on arbitrary paths.
 */
export function isPathInsideBase(candidate: string, baseDir: string): boolean {
  if (!isAbsolute(candidate) || !isAbsolute(baseDir)) return false;
  let cand: string;
  let base: string;
  try {
    cand = realpathSync(resolve(candidate));
    base = realpathSync(resolve(baseDir));
  } catch {
    // realpath fails if path missing — still compare resolved strings
    cand = resolve(candidate);
    base = resolve(baseDir);
  }
  const prefix = base.endsWith(sep) ? base : base + sep;
  return cand === base ? false : cand.startsWith(prefix);
}

export interface WorktreeListEntry {
  path: string;
  head?: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  locked?: boolean;
  prunable?: boolean;
}

/** Parse `git worktree list --porcelain` into entries. */
export function parseWorktreePorcelain(text: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  let cur: WorktreeListEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = { path: line.slice('worktree '.length) };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7);
    else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
    else if (line === '') {
      entries.push(cur);
      cur = null;
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

export interface ListWorktreesResult {
  ok: boolean;
  worktrees: WorktreeListEntry[];
  message?: string;
}

export async function listRepoWorktrees(cwd: string, deps: WorktreeDeps = {}): Promise<ListWorktreesResult> {
  if (!isAbsolute(cwd)) {
    return { ok: false, worktrees: [], message: 'cwd는 절대 경로여야 합니다.' };
  }
  const capture = deps.captureGit ?? defaultCaptureGit;
  try {
    const { stdout } = await capture(['-C', cwd, 'worktree', 'list', '--porcelain']);
    return { ok: true, worktrees: parseWorktreePorcelain(stdout) };
  } catch (e) {
    return {
      ok: false,
      worktrees: [],
      message: `git worktree list 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface DiffWorktreeResult {
  ok: boolean;
  worktreePath: string;
  filesChanged: string[];
  diffStat?: string;
  message?: string;
}

export async function diffGrokWorktree(
  worktreePath: string,
  deps: WorktreeDeps = {},
): Promise<DiffWorktreeResult> {
  if (!isAbsolute(worktreePath)) {
    return { ok: false, worktreePath, filesChanged: [], message: 'worktreePath는 절대 경로여야 합니다.' };
  }
  const capture = deps.captureGit ?? defaultCaptureGit;
  try {
    const { stdout: zStatus } = await capture([
      '-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z',
    ]);
    // Local import-free parse: reuse same field rules as delegate.parsePorcelain
    const filesChanged = parsePorcelainZ(zStatus);
    const { stdout: stat } = await capture(['-C', worktreePath, 'diff', '--stat']);
    return {
      ok: true,
      worktreePath,
      filesChanged,
      diffStat: (stat || '').trim() || undefined,
    };
  } catch (e) {
    return {
      ok: false,
      worktreePath,
      filesChanged: [],
      message: `worktree diff 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function parsePorcelainZ(zOutput: string): string[] {
  const fields = zOutput.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const path = field.slice(3);
    if (path) paths.push(path);
    if (field[0] === 'R' || field[0] === 'C') i += 1;
  }
  return paths;
}

export interface ApplyWorktreeResult {
  ok: boolean;
  message: string;
  filesChanged?: string[];
}

/**
 * Apply uncommitted worktree changes onto main cwd as a patch. Never commits.
 * Uses `git apply --check` then `git apply`. Empty diff → ok no-op.
 */
export async function applyGrokWorktree(
  cwd: string,
  worktreePath: string,
  deps: WorktreeDeps = {},
): Promise<ApplyWorktreeResult> {
  if (!isAbsolute(cwd) || !isAbsolute(worktreePath)) {
    return { ok: false, message: 'cwd와 worktreePath는 절대 경로여야 합니다.' };
  }
  const capture = deps.captureGit ?? defaultCaptureGit;
  const runGit = deps.runGit ?? defaultRunGit;
  try {
    const { stdout: patch } = await capture(['-C', worktreePath, 'diff']);
    if (!patch.trim()) {
      return { ok: true, message: '적용할 uncommitted diff가 없습니다 (이미 깨끗하거나 커밋된 변경만 있음).', filesChanged: [] };
    }
    // Write patch via git apply --stdin: use runGit with process — captureGit only returns strings.
    // Use execFile with input via child — our GitRunner has no stdin. Use capture with apply --check by temp?
    // Pass patch through `git -C cwd apply --check` using spawn with input in captureGit extended...
    // Simpler: write to a temp file via runGit isn't available. Use node write + apply path.
    const patchPath = join(tmpdir(), `grok-apply-${Date.now().toString(36)}.patch`);
    writeFileSync(patchPath, patch, 'utf8');
    try {
      await runGit(['-C', cwd, 'apply', '--check', patchPath]);
      await runGit(['-C', cwd, 'apply', patchPath]);
    } finally {
      try { unlinkSync(patchPath); } catch { /* ignore */ }
    }
    const files = patch
      .split('\n')
      .filter((l) => l.startsWith('+++ b/'))
      .map((l) => l.slice('+++ b/'.length));
    return {
      ok: true,
      message: 'worktree uncommitted diff를 cwd 워킹트리에 적용했습니다. 커밋하지 않았습니다 — diff를 검토하세요.',
      filesChanged: files,
    };
  } catch (e) {
    return {
      ok: false,
      message: `apply 실패 (충돌 가능, 커밋 없음): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface RemoveWorktreeResult {
  ok: boolean;
  message: string;
}

/**
 * Remove a worktree only if it lives under the plugin worktree base dir.
 */
export async function removeGrokWorktree(
  cwd: string,
  worktreePath: string,
  deps: WorktreeDeps = {},
): Promise<RemoveWorktreeResult> {
  if (!isAbsolute(cwd) || !isAbsolute(worktreePath)) {
    return { ok: false, message: 'cwd와 worktreePath는 절대 경로여야 합니다.' };
  }
  const baseDir = deps.baseDir ?? defaultWorktreeBaseDir();
  if (!isPathInsideBase(worktreePath, baseDir)) {
    return {
      ok: false,
      message: `안전을 위해 ${baseDir} 아래 worktree만 제거할 수 있습니다.`,
    };
  }
  const runGit = deps.runGit ?? defaultRunGit;
  try {
    await runGit(['-C', cwd, 'worktree', 'remove', '--force', worktreePath]);
    return { ok: true, message: `worktree 제거됨: ${worktreePath}` };
  } catch (e) {
    return {
      ok: false,
      message: `worktree 제거 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
