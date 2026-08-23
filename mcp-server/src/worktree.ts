import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[]) => Promise<void>;
export type GitCapture = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface WorktreeDeps {
  runGit?: GitRunner;
  captureGit?: GitCapture;
  baseDir?: string;
  name?: string;
}

/**
 * Every git call this module makes is bounded. An unbounded one is not merely slow: git can
 * block indefinitely (a stdin-reading plumbing command, a credential helper, a contended lock),
 * and createGrokWorktree / applyGrokWorktree run BEFORE and OUTSIDE the grok spawn timer, so a
 * hung git makes runDelegate ignore its own timeout_ms and never settle.
 */
export const GIT_TIMEOUT_MS = 30_000;
export const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/** Single bounded git entry point shared by both default runners. Rejects on non-zero exit. */
export async function runGitBounded(
  args: string[],
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
}

const defaultRunGit: GitRunner = async (args) => {
  await runGitBounded(args);
};

const defaultCaptureGit: GitCapture = (args) => runGitBounded(args);

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
 *
 * Includes **tracked edits and untracked new files** by temporarily staging
 * (`git add -A`) in the worktree, capturing `git diff --cached --binary`, then
 * always `git reset HEAD` so the worktree index is restored. Target cwd gets
 * `git apply --check` then `git apply` only — never commit.
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
    // Stage everything in the *worktree* only so untracked files enter the patch.
    await runGit(['-C', worktreePath, 'add', '-A']);
    let patch = '';
    // filesChanged comes from git's own name list, never from parsing the patch body:
    // `+++ b/` lines omit deletions and pure renames, C-quote non-ASCII paths, keep a
    // trailing TAB on names containing spaces, and can be forged by a line of file
    // CONTENT that begins with `++ b/`. Must be captured before the reset below.
    let staged: string[] = [];
    try {
      const quoteOff = ['-c', 'core.quotepath=false'];
      const { stdout } = await capture([
        '-C', worktreePath, ...quoteOff, 'diff', '--cached', '--binary',
      ]);
      patch = stdout;
      const { stdout: namesZ } = await capture([
        '-C', worktreePath, ...quoteOff, 'diff', '--cached', '--name-only', '-z',
      ]);
      staged = namesZ.split('\0').filter(Boolean);
    } finally {
      // Always unstage — leave worktree files intact, index clean of our temp stage.
      try {
        await runGit(['-C', worktreePath, 'reset', 'HEAD', '--', '.']);
      } catch {
        try { await runGit(['-C', worktreePath, 'reset', 'HEAD']); } catch { /* ignore */ }
      }
    }

    if (!patch.trim()) {
      return {
        ok: true,
        message: '적용할 변경이 없습니다 (tracked/untracked 모두 깨끗).',
        filesChanged: [],
      };
    }

    // mkdtemp is atomic and gives an unpredictable 0700 directory. A clock-derived name
    // directly under a shared /tmp is pre-creatable by another local user, which turns the
    // default symlink-following write into an arbitrary-file-write and leaves the whole
    // source diff world-readable.
    const patchDir = mkdtempSync(join(tmpdir(), 'grok-apply-'));
    const patchPath = join(patchDir, 'changes.patch');
    try {
      writeFileSync(patchPath, patch, { encoding: 'utf8', mode: 0o600 });
      await runGit(['-C', cwd, 'apply', '--check', patchPath]);
      await runGit(['-C', cwd, 'apply', patchPath]);
    } finally {
      try { rmSync(patchDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return {
      ok: true,
      message:
        'worktree 변경(신규 파일 포함)을 cwd 워킹트리에 적용했습니다. 커밋하지 않았습니다 — diff를 검토하세요.',
      filesChanged: staged,
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
  /** True when the companion `grok/<name>` branch was deleted too. */
  branchDeleted?: boolean;
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
  } catch (e) {
    return {
      ok: false,
      message: `worktree 제거 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // createGrokWorktree also creates branch `grok/<name>`, and nothing ever deleted it — every
  // isolated delegation used to leave one behind permanently. `-d` (not `-D`) makes git refuse
  // when the branch holds unmerged commits, so work grok actually committed there is never
  // destroyed; that case is reported instead.
  const branch = `grok/${basename(worktreePath)}`;
  try {
    await runGit(['-C', cwd, 'branch', '-d', branch]);
    return {
      ok: true,
      branchDeleted: true,
      message: `worktree 제거됨: ${worktreePath} (브랜치 ${branch} 삭제).`,
    };
  } catch {
    return {
      ok: true,
      branchDeleted: false,
      message:
        `worktree 제거됨: ${worktreePath} — 브랜치 ${branch}는 남겨뒀습니다 ` +
        '(머지되지 않은 커밋이 있거나 이미 없음). 확인 후 git branch -D ' + branch + ' 로 지우세요.',
    };
  }
}

export interface PruneCandidate {
  path: string;
  ageDays: number;
}

export interface PruneWorktreesResult {
  ok: boolean;
  /** True when nothing was removed because `apply` was not set. */
  dryRun: boolean;
  baseDir: string;
  candidates: PruneCandidate[];
  removed: string[];
  failed: { path: string; message: string }[];
  message: string;
}

export interface PruneDeps extends WorktreeDeps {
  listBaseDir?: (baseDir: string) => string[];
  dirMtimeMs?: (path: string) => number;
  now?: () => number;
}

export const PRUNE_DEFAULT_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Nothing ever removed the isolation worktrees this wrapper creates, so they accumulate
 * forever under ~/.grok-build/worktrees (measured 2026-08-23 on the author's machine: 37
 * trees, ~398 MiB). grok's own `worktree gc` cannot help — it tracks a different set, and
 * reports "No worktrees found" while these exist.
 *
 * Dry run by default: a worktree may hold work that was never applied, so removal is only
 * performed when the caller explicitly passes `apply`.
 */
export async function pruneGrokWorktrees(
  cwd: string,
  opts: { maxAgeDays?: number; apply?: boolean } = {},
  deps: PruneDeps = {},
): Promise<PruneWorktreesResult> {
  const baseDir = deps.baseDir ?? defaultWorktreeBaseDir();
  const apply = opts.apply === true;
  const maxAgeDays = opts.maxAgeDays ?? PRUNE_DEFAULT_MAX_AGE_DAYS;
  const empty = { baseDir, candidates: [], removed: [], failed: [] };

  if (!isAbsolute(cwd)) {
    return { ok: false, dryRun: !apply, ...empty, message: 'cwd는 절대 경로여야 합니다.' };
  }

  const list = deps.listBaseDir ?? ((dir: string) =>
    readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  const mtime = deps.dirMtimeMs ?? ((path: string) => statSync(path).mtimeMs);
  const now = deps.now ?? (() => Date.now());

  let names: string[];
  try {
    names = list(baseDir);
  } catch {
    // base dir has never been created — nothing to prune, not an error
    return { ok: true, dryRun: !apply, ...empty, message: `정리할 worktree가 없습니다 (${baseDir}).` };
  }

  const at = now();
  const candidates: PruneCandidate[] = [];
  for (const name of names) {
    const path = join(baseDir, name);
    let ageDays: number;
    try {
      ageDays = (at - mtime(path)) / MS_PER_DAY;
    } catch {
      continue; // vanished between listing and stat
    }
    if (ageDays >= maxAgeDays) candidates.push({ path, ageDays: Math.floor(ageDays) });
  }

  if (!apply) {
    return {
      ok: true,
      dryRun: true,
      baseDir,
      candidates,
      removed: [],
      failed: [],
      message: candidates.length
        ? `${maxAgeDays}일 이상 된 worktree ${candidates.length}개를 찾았습니다. 지우려면 apply를 켜세요 (미적용 변경이 남아 있을 수 있으니 먼저 diff로 확인하세요).`
        : `${maxAgeDays}일 이상 된 worktree가 없습니다 (${baseDir}).`,
    };
  }

  const removed: string[] = [];
  const failed: { path: string; message: string }[] = [];
  for (const c of candidates) {
    const r = await removeGrokWorktree(cwd, c.path, deps);
    if (r.ok) removed.push(c.path);
    else failed.push({ path: c.path, message: r.message });
  }

  return {
    ok: true,
    dryRun: false,
    baseDir,
    candidates,
    removed,
    failed,
    message: `worktree ${removed.length}개 제거${failed.length ? `, ${failed.length}개 실패` : ''} (${baseDir}). 커밋은 하지 않았습니다.`,
  };
}
