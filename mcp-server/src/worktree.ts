import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[], timeoutMs?: number) => Promise<void>;
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

/**
 * Budget for git calls that are bulk file I/O rather than metadata: a `worktree add` is a full
 * checkout of HEAD and a `worktree remove --force` deletes that whole tree again. Measured: the
 * 30s metadata budget SIGTERM-killed a 20,000-file checkout at 87% and a 6,000-file repo already
 * spent 31-61% of it, so sharing one constant broke `worktree: true` on large repos. Still finite
 * — a wedged git must not hang the server forever — but far above real checkout time.
 */
export const GIT_BULK_TIMEOUT_MS = 600_000;
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

const defaultRunGit: GitRunner = async (args, timeoutMs) => {
  await runGitBounded(args, timeoutMs);
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
  // The cleanup below must not delete a branch we did not create. `worktree add -b` fails when
  // the name is already taken, and `branch -d` would then silently destroy a pre-existing
  // MERGED branch of the same name. Reachable whenever a caller supplies its own `name`.
  let branchPreexisted = false;
  try {
    await runGit(['-C', cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/grok/${name}`]);
    branchPreexisted = true;
  } catch {
    // no such branch — a branch created below is ours to remove again
  }
  try {
    await runGit(['-C', cwd, 'worktree', 'add', path, '-b', `grok/${name}`, 'HEAD'], GIT_BULK_TIMEOUT_MS);
  } catch (e) {
    // A killed or failed checkout leaves three things behind: the partial directory, a
    // `.git/worktrees/<name>` registration, and the branch. Nothing ran inside the tree yet, so
    // discarding all three is safe and keeps a timeout from becoming a permanent leak.
    try { await runGit(['-C', cwd, 'worktree', 'remove', '--force', path], GIT_BULK_TIMEOUT_MS); } catch { /* may not be registered */ }
    try { await runGit(['-C', cwd, 'worktree', 'prune']); } catch { /* best effort */ }
    if (!branchPreexisted) {
      try { await runGit(['-C', cwd, 'branch', '-d', `grok/${name}`]); } catch { /* may not exist */ }
    }
    throw e;
  }
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
    await runGit(['-C', worktreePath, 'add', '-A'], GIT_BULK_TIMEOUT_MS);
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
        await runGit(['-C', worktreePath, 'reset', 'HEAD', '--', '.'], GIT_BULK_TIMEOUT_MS);
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
      await runGit(['-C', cwd, 'apply', '--check', patchPath], GIT_BULK_TIMEOUT_MS);
      await runGit(['-C', cwd, 'apply', patchPath], GIT_BULK_TIMEOUT_MS);
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
    await runGit(['-C', cwd, 'worktree', 'remove', '--force', worktreePath], GIT_BULK_TIMEOUT_MS);
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
  /**
   * Age of the directory's own mtime. That is CREATION age, not idleness: editing a nested file
   * never refreshes the parent directory, so an "old" tree can still hold unapplied grok work.
   * The dirty check is what actually protects that work.
   */
  createdDaysAgo: number;
  /** Repo that registered this worktree, read from its `.git` file. */
  owner?: string;
  /** Has uncommitted changes. Undefined when git could not be asked (orphan / owner gone). */
  dirty?: boolean;
}

export interface PruneWorktreesResult {
  ok: boolean;
  /** True when nothing was removed because `apply` was not set. */
  dryRun: boolean;
  baseDir: string;
  candidates: PruneCandidate[];
  removed: string[];
  /** Directories git no longer knows about, deleted directly (still inside baseDir). */
  removedOrphan: string[];
  /** Left alone because they hold uncommitted work. */
  skippedDirty: string[];
  failed: { path: string; message: string }[];
  message: string;
}

export interface PruneDeps extends WorktreeDeps {
  listBaseDir?: (baseDir: string) => string[];
  dirMtimeMs?: (path: string) => number;
  now?: () => number;
  /** Reads `<worktree>/.git`, which for a linked worktree is a FILE, not a directory. */
  readGitFile?: (worktreePath: string) => string;
  removeDir?: (path: string) => void;
}

export const PRUNE_DEFAULT_MAX_AGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A linked worktree's `.git` is a file containing `gitdir: <repo>/.git/worktrees/<name>`.
 * `~/.grok-build/worktrees` is GLOBAL while `git worktree remove` is per repo, so prune must find
 * the repo that registered each tree instead of assuming the caller owns it. Measured while
 * writing this: dozens of trees spanning several repos, the large majority owned by a project
 * that was not the caller — so removing only the caller's trees reclaimed almost nothing.
 */
export function parseWorktreeOwner(gitFileText: string): string | undefined {
  const m = /^gitdir:[ \t]*(.*)$/m.exec(gitFileText);
  if (!m) return undefined;
  const dir = m[1].trim();
  const marker = /[\\/]\.git[\\/]worktrees[\\/]/.exec(dir);
  if (!marker) return undefined;
  return dir.slice(0, marker.index);
}

/**
 * Collect stale isolation worktrees under the wrapper base dir.
 *
 * Dry run by default: a stale tree can still hold work that was never applied, and the age here is
 * creation age (see PruneCandidate.createdDaysAgo), so the caller decides. With `apply`, a tree
 * that reports uncommitted changes is never deleted.
 */
export async function pruneGrokWorktrees(
  cwd: string,
  opts: { maxAgeDays?: number; apply?: boolean } = {},
  deps: PruneDeps = {},
): Promise<PruneWorktreesResult> {
  const baseDir = deps.baseDir ?? defaultWorktreeBaseDir();
  const apply = opts.apply === true;
  const maxAgeDays = opts.maxAgeDays ?? PRUNE_DEFAULT_MAX_AGE_DAYS;
  const empty = {
    baseDir,
    candidates: [] as PruneCandidate[],
    removed: [] as string[],
    removedOrphan: [] as string[],
    skippedDirty: [] as string[],
    failed: [] as { path: string; message: string }[],
  };

  if (!isAbsolute(cwd)) {
    return { ok: false, dryRun: !apply, ...empty, message: 'cwd는 절대 경로여야 합니다.' };
  }

  const list = deps.listBaseDir ?? ((dir: string) =>
    readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
  const mtime = deps.dirMtimeMs ?? ((path: string) => statSync(path).mtimeMs);
  const now = deps.now ?? (() => Date.now());
  const readGitFile = deps.readGitFile ?? ((wt: string) => readFileSync(join(wt, '.git'), 'utf8'));
  const removeDir = deps.removeDir ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
  const capture = deps.captureGit ?? defaultCaptureGit;
  const runGit = deps.runGit ?? defaultRunGit;

  let names: string[];
  try {
    names = list(baseDir);
  } catch {
    return { ok: true, dryRun: !apply, ...empty, message: `정리할 worktree가 없습니다 (${baseDir}).` };
  }

  const at = now();
  const candidates: PruneCandidate[] = [];
  for (const name of names) {
    const path = join(baseDir, name);
    let age: number;
    try {
      age = (at - mtime(path)) / MS_PER_DAY;
    } catch {
      continue; // vanished between listing and stat
    }
    if (age < maxAgeDays) continue;
    const c: PruneCandidate = { path, createdDaysAgo: Math.floor(age) };
    try {
      c.owner = parseWorktreeOwner(readGitFile(path));
    } catch {
      // no .git file — an orphan directory git never knew, or no longer knows
    }
    try {
      const { stdout } = await capture(['-C', path, 'status', '--porcelain']);
      c.dirty = stdout.trim().length > 0;
    } catch {
      // not answerable as a worktree; leave dirty undefined rather than guessing "clean"
    }
    candidates.push(c);
  }

  if (!apply) {
    const dirty = candidates.filter((c) => c.dirty).length;
    return {
      ok: true,
      dryRun: true,
      baseDir,
      candidates,
      removed: [],
      removedOrphan: [],
      skippedDirty: [],
      failed: [],
      message: candidates.length
        ? `${maxAgeDays}일 이상 전에 만들어진 worktree ${candidates.length}개` +
          (dirty ? ` (그중 ${dirty}개는 커밋되지 않은 변경이 있어 apply해도 건너뜁니다)` : '') +
          '. 지우려면 apply를 켜세요. 나이는 생성 시각 기준이지 마지막 사용 시각이 아닙니다.'
        : `${maxAgeDays}일 이상 전에 만들어진 worktree가 없습니다 (${baseDir}).`,
    };
  }

  const removed: string[] = [];
  const removedOrphan: string[] = [];
  const skippedDirty: string[] = [];
  const failed: { path: string; message: string }[] = [];

  for (const c of candidates) {
    if (c.dirty) {
      skippedDirty.push(c.path);
      continue;
    }

    // Remove through the repo that registered it, not the caller: the base dir is global.
    const r = await removeGrokWorktree(c.owner ?? cwd, c.path, deps);
    if (r.ok) {
      removed.push(c.path);
      continue;
    }

    // git does not know this tree (owner gone, never registered, registration already pruned).
    // That is the exact garbage this action exists to collect, so delete the directory itself —
    // but only after re-confirming it really resolves inside the base dir.
    if (!isPathInsideBase(c.path, baseDir)) {
      failed.push({ path: c.path, message: r.message });
      continue;
    }
    try {
      removeDir(c.path);
      removedOrphan.push(c.path);
      if (c.owner) {
        try { await runGit(['-C', c.owner, 'worktree', 'prune']); } catch { /* best effort */ }
      }
    } catch (e) {
      failed.push({ path: c.path, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const parts = [`worktree ${removed.length}개 제거`];
  if (removedOrphan.length) parts.push(`고아 디렉토리 ${removedOrphan.length}개 삭제`);
  if (skippedDirty.length) parts.push(`미커밋 변경으로 건너뜀 ${skippedDirty.length}개`);
  if (failed.length) parts.push(`실패 ${failed.length}개`);
  return {
    ok: true,
    dryRun: false,
    baseDir,
    candidates,
    removed,
    removedOrphan,
    skippedDirty,
    failed,
    message: `${parts.join(', ')} (${baseDir}). 커밋은 하지 않았습니다.`,
  };
}
