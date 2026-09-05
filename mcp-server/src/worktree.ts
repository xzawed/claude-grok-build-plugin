import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, realpathSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
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
  /**
   * Is `<path>/.git` a file (linked worktree), a directory (an independent REPOSITORY) or
   * absent? Two separate gates need this and neither can get it from `readFileSync`, which
   * throws EISDIR on a directory and cannot distinguish that from "absent".
   */
  gitEntryKind?: (worktreePath: string) => 'file' | 'dir' | 'none';
}

export const defaultGitEntryKind = (wt: string): 'file' | 'dir' | 'none' => {
  try {
    return statSync(join(wt, '.git')).isDirectory() ? 'dir' : 'file';
  } catch {
    return 'none';
  }
};

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

/**
 * Byte-exact git capture for the apply patch. Identical bounds to `runGitBounded`, but
 * `encoding: 'buffer'` so no lossy decode happens between git and the patch file.
 */
async function defaultCapturePatchBytes(args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', args, {
    encoding: 'buffer',
    timeout: GIT_BULK_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''), 'utf8');
}

export function defaultWorktreeBaseDir(): string {
  return join(homedir(), '.grok-build', 'worktrees');
}

// Worktrees and the delegation history share the parent ~/.grok-build, so whichever writes
// first fixes its permissions — and `mkdirSync(recursive)` without a mode creates it 0755 on
// POSIX. Kept equal to HISTORY_DIR_MODE so the outcome does not depend on call order.
// (Only affects dirs created from now on; mode applies at creation.)
export const WORKTREE_DIR_MODE = 0o700;

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
  mkdirSync(baseDir, { recursive: true, mode: WORKTREE_DIR_MODE });
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
      // -uall for the same reason delegate.ts uses it: an untracked directory otherwise
      // collapses to one entry, so `worktree diff` under-reports exactly the new files that
      // `worktree apply` (add -A) enumerates in full — one tool disagreeing with itself.
      '-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z', '-uall',
    ]);
    // Local import-free parse: reuse same field rules as delegate.parsePorcelain
    const filesChanged = parsePorcelainZ(zStatus);
    // `diff --stat` compares the working tree to the INDEX, so it is blind to anything staged
    // and to every untracked file — exactly what grok produces most, since --always-approve
    // routinely creates new files. filesChanged (porcelain) listed them while the stat beside
    // it stayed empty or named only a subset, which reads as authoritative and is not.
    // `diff HEAD --stat` is equally read-only and covers the staged half.
    const { stdout: stat } = await capture(['-C', worktreePath, 'diff', 'HEAD', '--stat']);
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
  // Same containment `remove` and `prune` already enforce. apply is destructive on the tree it
  // is handed — `add -A` then `reset HEAD -- .` — and those run BEFORE the `apply --check` that
  // can abort the operation, so an unvalidated path meant an ordinary repository's staged index
  // was wiped even when the apply delivered nothing, with a failure message that never said so.
  const baseDir = deps.baseDir ?? defaultWorktreeBaseDir();
  if (!isPathInsideBase(worktreePath, baseDir)) {
    return {
      ok: false,
      message: `안전을 위해 ${baseDir} 아래 worktree만 적용할 수 있습니다.`,
    };
  }
  const capture = deps.captureGit ?? defaultCaptureGit;
  const runGit = deps.runGit ?? defaultRunGit;
  // The patch must survive as BYTES. `git diff --binary` only special-cases files git itself
  // calls binary (NUL in the first 8000 bytes); a NUL-free CP949 / EUC-KR / Latin-1 source is
  // "text", so decoding the diff as UTF-8 turned every invalid byte into U+FFFD and writing it
  // back re-encoded that as EF BF BD — silent corruption of the user's file under ok:true.
  // An injected string-level captureGit is still honoured so existing stub tests keep working.
  const capturePatch: (args: string[]) => Promise<Buffer> = deps.captureGit
    ? async (args) => Buffer.from((await deps.captureGit!(args)).stdout, 'utf8')
    : defaultCapturePatchBytes;
  try {
    // Stage everything in the *worktree* only so untracked files enter the patch.
    await runGit(['-C', worktreePath, 'add', '-A'], GIT_BULK_TIMEOUT_MS);
    let patch: Buffer = Buffer.alloc(0);
    // filesChanged comes from git's own name list, never from parsing the patch body:
    // `+++ b/` lines omit deletions and pure renames, C-quote non-ASCII paths, keep a
    // trailing TAB on names containing spaces, and can be forged by a line of file
    // CONTENT that begins with `++ b/`. Must be captured before the reset below.
    let staged: string[] = [];
    try {
      const quoteOff = ['-c', 'core.quotepath=false'];
      patch = await capturePatch([
        '-C', worktreePath, ...quoteOff, 'diff', '--cached', '--binary',
      ]);
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

    if (patch.length === 0 || patch.toString('utf8').trim().length === 0) {
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
      // Buffer in, buffer out — no encoding option, so the bytes git produced are the bytes
      // git replays. (`mode` still applies; mkdtemp already gave us a private 0700 dir.)
      writeFileSync(patchPath, patch, { mode: 0o600 });
      // The worktree checks out the repository ROOT, so the patch is root-relative. Replaying
      // it from a sub-directory made git silently ignore every entry outside that directory —
      // exit 0, empty stderr, and `--check` passed too, so the fail-closed gate was inert while
      // filesChanged still reported the dropped files as applied. Resolve the toplevel and
      // apply there; if cwd is not a work tree, fall back and let git report the real error.
      let applyRoot = cwd;
      try {
        const { stdout } = await capture(['-C', cwd, 'rev-parse', '--show-toplevel']);
        const top = stdout.trim();
        if (top) applyRoot = top;
      } catch { /* not a work tree — the apply below surfaces the actual failure */ }
      await runGit(['-C', applyRoot, 'apply', '--check', patchPath], GIT_BULK_TIMEOUT_MS);
      await runGit(['-C', applyRoot, 'apply', patchPath], GIT_BULK_TIMEOUT_MS);
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
/**
 * Is there anything in this worktree that a delete would destroy?
 *
 * `dirty: undefined` means the probe could not answer — the caller must NOT read that as clean.
 * A short sample of the paths goes back to the caller so the refusal names what is at stake
 * instead of asking them to go look.
 */
async function worktreeDirtyState(
  worktreePath: string,
  deps: WorktreeDeps,
): Promise<{ dirty: boolean | undefined; entries: string[] }> {
  const capture = deps.captureGit ?? defaultCaptureGit;
  // FOUND BY GROK reviewing this gate: with no `.git` entry of its own, `git -C <path> status`
  // WALKS UP and answers for whatever repository encloses the path — a home directory kept under
  // version control, say. A clean answer from the wrong repository reads here as "this worktree is
  // clean" and licenses the delete. So the probe first insists the path is its own git entry;
  // without one the state is unknown, and unknown already refuses.
  const entryKind = deps.gitEntryKind ?? defaultGitEntryKind;
  if (entryKind(worktreePath) === 'none') return { dirty: undefined, entries: [] };
  try {
    // `-uall` but deliberately NOT `--ignored`: also raised by Grok's review, and rejected on
    // purpose. `--force` does delete ignored files, but a worktree acquires `node_modules` or a
    // build directory the moment grok runs an install, and counting those as "unapplied work"
    // would make `remove` refuse essentially every worktree — a gate that always fires protects
    // nothing and gets forced past out of habit. Grok's OUTPUT is tracked or untracked, and both
    // are listed here.
    const { stdout } = await capture(['-C', worktreePath, 'status', '--porcelain', '-uall']);
    const lines = stdout.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.length > 0);
    return {
      dirty: lines.length > 0,
      entries: lines.slice(0, 10).map((l) => l.replace(/^[^ ]+ +/, String())),
    };
  } catch {
    return { dirty: undefined, entries: [] };
  }
}
/**
 * A4 (docs/10, MEASURED 2026-09-05): this ran `worktree remove --force` unconditionally.
 *
 * The wrapper NEVER commits, so grok's output in an isolation worktree is uncommitted by
 * construction — removing before `apply` destroyed it with nothing left in a blob, a reflog or a
 * branch, and reported a bare `ok: true`. On the very same state `prune` refuses to delete
 * anything it cannot prove clean; two commands, opposite defaults, one dataset.
 *
 * So: probe first, and treat UNKNOWN as dirty for the reason prune already documents — reading an
 * unanswerable status as "safe" is exactly how work disappears. `force: true` is the caller
 * saying it out loud.
 */
export async function removeGrokWorktree(
  cwd: string,
  worktreePath: string,
  deps: WorktreeDeps = {},
  opts: { force?: boolean } = {},
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
  if (!opts.force) {
    const state = await worktreeDirtyState(worktreePath, deps);
    if (state.dirty !== false) {
      return {
        ok: false,
        message:
          `worktree에 아직 적용되지 않은 변경이 있습니다: ${worktreePath}` +
          (state.entries.length > 0 ? ` — ${state.entries.join(', ')}` : ' — 상태를 확인할 수 없었습니다') +
          '. 먼저 action:"apply"로 가져오거나 diff로 확인하세요. 정말 버릴 거라면 force:true를 명시하세요' +
          ' (이 플러그인은 커밋하지 않으므로 삭제하면 복구할 수 없습니다).',
      };
    }
  }
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
  /**
   * A5: git no longer knows this tree at all — no `.git` file, and it does not answer as a
   * repository. That is the garbage prune exists to collect, and it is NOT the same state as
   * `dirty: undefined`, which the old code conflated with it and therefore skipped forever.
   */
  orphan?: boolean;
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
  /** A5: does the owning repo still exist? A `.git` file pointing at a deleted repo is an orphan. */
  pathExists?: (path: string) => boolean;

}

/**
 * A5: only directories this wrapper named are ever rmSync'd.
 *
 * `worktreeName()` produces `grok-<base36 Date.now()>-<base36 random>`. The base dir is a global
 * directory under the user's home, and the audit found somebody's own checkout sitting in it —
 * being unrecognisable to git does not make a directory ours to delete.
 *
 * FOUND BY GROK reviewing the first version of this fix: `/^grok-[0-9a-z]+-[0-9a-z]+$/` also
 * matches `grok-build-plugin` and `grok-my-project` — names a person would plausibly give a
 * checkout. The middle group is a base36 millisecond timestamp, which is 7-10 characters for
 * every date this software can run on, and that alone rejects both.
 */
const GROK_WORKTREE_NAME = /^grok-[0-9a-z]{7,10}-[0-9a-z]{1,8}$/;
export function isWrapperWorktreeName(name: string): boolean {
  return GROK_WORKTREE_NAME.test(name);
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
  const pathExists = deps.pathExists ?? ((path: string) => existsSync(path));
  const gitEntryKind = deps.gitEntryKind ?? defaultGitEntryKind;
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
      // unreadable or not a linked-worktree .git file; the KIND probe below is authoritative
    }
    let answersGit = true;
    try {
      const { stdout } = await capture(['-C', path, 'status', '--porcelain']);
      c.dirty = stdout.trim().length > 0;
    } catch {
      // not answerable as a worktree; leave dirty undefined rather than guessing "clean"
      answersGit = false;
    }
    // A5: git has forgotten this tree entirely. Two shapes, and the SECOND is the one the audit
    // measured: the `.git` file is still there, pointing at a repo that has been deleted, so
    // `git -C <tree> status` fails and `dirty` stays undefined — which the old
    // `dirty !== false` guard read as "might hold work" and skipped, every run, forever.
    // A tree whose owner still exists but that git cannot answer for is NOT an orphan: that is
    // genuinely undecidable, and undecidable stays protected (the 2026-09-02 incident).
    //
    // FOUND BY GROK reviewing the first version of this fix: `hasGitFile` came from
    // `readFileSync('<tree>/.git')`, which throws EISDIR on a `.git` DIRECTORY — so an ordinary
    // checkout looked exactly like "no .git file". With git absent from PATH every status probe
    // also throws, so a whole base dir of real repositories would classify as orphans at once.
    // The entry KIND is therefore probed directly: a `.git` directory is a repository, full stop.
    const kind = gitEntryKind(path);
    const ownerGone = kind === 'file' && (!c.owner || !pathExists(c.owner));
    if (!answersGit && (kind === 'none' || ownerGone)) c.orphan = true;
    candidates.push(c);
  }

  if (!apply) {
    // Same rule as the apply loop: anything not KNOWN clean is skipped, so the preview must
    // count it. Counting only `dirty === true` promised a deletion that apply would refuse —
    // or, before the apply loop was fixed, performed one the preview never warned about.
    // Deletable orphans are announced separately; everything else that is not KNOWN clean is
    // still announced as skipped — including an orphan this wrapper did not name, which apply
    // will refuse to touch.
    const collectable = (c: PruneCandidate) => !!c.orphan && isWrapperWorktreeName(basename(c.path));
    const orphans = candidates.filter(collectable).length;
    const dirty = candidates.filter((c) => !collectable(c) && c.dirty !== false).length;
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
          (dirty
            ? ` (그중 ${dirty}개는 커밋되지 않은 변경이 있거나 상태를 확인할 수 없어 apply해도 건너뜁니다)`
            : '') +
          (orphans ? ` (그중 ${orphans}개는 git이 더 이상 모르는 고아 디렉토리라 apply하면 삭제됩니다)` : '') +
          '. 지우려면 apply를 켜세요. 나이는 생성 시각 기준이지 마지막 사용 시각이 아닙니다.'
        : `${maxAgeDays}일 이상 전에 만들어진 worktree가 없습니다 (${baseDir}).`,
    };
  }

  const removed: string[] = [];
  const removedOrphan: string[] = [];
  const skippedDirty: string[] = [];
  const failed: { path: string; message: string }[] = [];

  for (const c of candidates) {
    // Delete only what is KNOWN clean. `dirty` is left undefined above when the status probe
    // could not answer, and `if (c.dirty)` used to read that "unknown" as "safe" — the one
    // state the catch exists to flag. Worse, the condition that makes the probe throw (owner
    // repo gone) is the same one that fails removeGrokWorktree and routes into the orphan
    // rmSync below, so unknown-dirty and force-delete always arrived together. Measured
    // 2026-09-02: an orphaned tree holding unapplied grok output was deleted under ok:true,
    // with no blob, reflog or branch left to recover it.
    // A5: an orphan is handled before the dirty gate, because for an orphan `dirty` is undefined
    // BY DEFINITION — git cannot be asked. Gating on it is what made this branch unreachable.
    if (c.orphan) {
      if (!isPathInsideBase(c.path, baseDir) || !isWrapperWorktreeName(basename(c.path))) {
        // Inside the base dir but not named by this wrapper: somebody else's directory.
        skippedDirty.push(c.path);
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
      continue;
    }

    if (c.dirty !== false) {
      skippedDirty.push(c.path);
      continue;
    }

    // Remove through the repo that registered it, not the caller: the base dir is global.
    const r = await removeGrokWorktree(c.owner ?? cwd, c.path, deps);
    if (r.ok) {
      removed.push(c.path);
      continue;
    }

    // A5 (MEASURED 2026-09-05): this used to rmSync anything `worktree remove` refused. The trees
    // that reach here ANSWER git cleanly — they are real repositories that git simply never
    // registered as worktrees, e.g. an independent checkout sitting under the base dir. Deleting
    // one destroyed COMMITTED history, which is the opposite of what this action is for. Real
    // orphans are handled above, by classification, not by a failed remove.
    failed.push({ path: c.path, message: r.message });
  }

  const parts = [`worktree ${removed.length}개 제거`];
  if (removedOrphan.length) parts.push(`고아 디렉토리 ${removedOrphan.length}개 삭제`);
  if (skippedDirty.length) parts.push(`미커밋 변경 또는 상태 불명으로 건너뜀 ${skippedDirty.length}개`);
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
