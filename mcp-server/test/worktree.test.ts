import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  createGrokWorktree,
  parseWorktreePorcelain,
  isPathInsideBase,
  removeGrokWorktree,
  applyGrokWorktree,
  listRepoWorktrees,
  diffGrokWorktree,
  runGitBounded,
  pruneGrokWorktrees,
  parseWorktreeOwner,
  GIT_TIMEOUT_MS,
  GIT_BULK_TIMEOUT_MS,
  GIT_MAX_BUFFER,
  WORKTREE_DIR_MODE,
} from '../src/worktree.js';
import { HISTORY_DIR_MODE } from '../src/history.js';

describe('createGrokWorktree', () => {
  it('runs `git -C <cwd> worktree add <baseDir>/<name> -b grok/<name> HEAD` and returns the path', async () => {
    const calls: string[][] = [];
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-wt-'));
    const path = await createGrokWorktree('/abs/repo', {
      name: 'fixed', baseDir, runGit: async (a) => { calls.push(a); },
    });
    const expected = join(baseDir, 'fixed');
    expect(path).toBe(expected);
    // a rev-parse pre-check runs first so failure cleanup never deletes a pre-existing branch
    expect(calls.filter((c) => c.includes('worktree'))).toEqual([
      ['-C', '/abs/repo', 'worktree', 'add', expected, '-b', 'grok/fixed', 'HEAD'],
    ]);
  });
  // docs/09 §C deferred item, riding along with the first change that had a real reason.
  // `mkdirSync(baseDir, {recursive:true})` with no mode can create the PARENT ~/.grok-build
  // at 0755 on a fresh install if a worktree call runs before the first history write (which
  // does pass 0700). The dir holds prompt previews, so on a shared POSIX host that is
  // world-readable. Windows ignores the mode bit, hence the platform guard.
  // Runs everywhere: the two plugin-owned dirs share one parent (~/.grok-build), so whichever
  // creates it first decides its permissions. They must agree on the mode.
  it('uses the same restrictive dir mode as the history writer', () => {
    expect(WORKTREE_DIR_MODE).toBe(0o700);
    expect(WORKTREE_DIR_MODE).toBe(HISTORY_DIR_MODE);
  });
  // The behavioural half. Windows ignores POSIX mode bits, so this assertion is only
  // meaningful — and only runs — on Linux/macOS (which is what CI checks).
  it.skipIf(process.platform === 'win32')('creates its base dir 0700, matching history', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'grok-wt-mode-'));
    const baseDir = join(parent, '.grok-build', 'worktrees');
    await createGrokWorktree('/abs/repo', { name: 'fixed', baseDir, runGit: async () => {} });
    expect(statSync(baseDir).mode & 0o777).toBe(WORKTREE_DIR_MODE);
    expect(statSync(join(parent, '.grok-build')).mode & 0o777).toBe(WORKTREE_DIR_MODE);
    rmSync(parent, { recursive: true, force: true });
  });
  it('propagates a git failure (throws)', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-wt-'));
    await expect(createGrokWorktree('/abs/repo', {
      name: 'fixed', baseDir, runGit: async () => { throw new Error('not a git repo'); },
    })).rejects.toThrow();
  });
});

describe('parseWorktreePorcelain', () => {
  it('parses multi-worktree porcelain', () => {
    const text = [
      'worktree /repo',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repo/.grok/wt1',
      'HEAD def',
      'branch refs/heads/grok/wt1',
      '',
    ].join('\n');
    const e = parseWorktreePorcelain(text);
    expect(e).toHaveLength(2);
    expect(e[0].path).toBe('/repo');
    expect(e[1].branch).toBe('refs/heads/grok/wt1');
  });
});

describe('isPathInsideBase', () => {
  it('accepts children of base, rejects base itself and outsiders', () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const child = join(base, 'child');
    mkdirSync(child);
    expect(isPathInsideBase(child, base)).toBe(true);
    expect(isPathInsideBase(base, base)).toBe(false);
    expect(isPathInsideBase(join(tmpdir(), 'other'), base)).toBe(false);
    expect(isPathInsideBase(join(base, '..', 'escaped'), base)).toBe(false);
  });
});

describe('removeGrokWorktree', () => {
  it('refuses paths outside the worktree base dir', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    let ran = false;
    const r = await removeGrokWorktree('/abs/repo', join(tmpdir(), 'evil-wt'), {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async () => { ran = true; },
    });
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
    expect(r.message).toMatch(/아래 worktree만/);
  });
  it('removes when path is under base', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['-C', '/abs/repo', 'worktree', 'remove', '--force', wt]);
  });
  it('deletes the grok/<name> branch after removing the worktree', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'grok-abc123');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['-C', '/abs/repo', 'worktree', 'remove', '--force', wt]);
    // -d, not -D: git refuses if the branch holds commits that are not merged, so grok work
    // that was actually committed on the branch is never silently destroyed.
    expect(calls[1]).toEqual(['-C', '/abs/repo', 'branch', '-d', 'grok/grok-abc123']);
    expect(r.branchDeleted).toBe(true);
  });
  it('still succeeds when the branch cannot be safely deleted, and says so', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'grok-unmerged');
    mkdirSync(wt);
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async (a) => {
        if (a.includes('branch')) throw new Error('error: the branch is not fully merged');
        },
    });
    expect(r.ok).toBe(true);
    expect(r.branchDeleted).toBe(false);
    expect(r.message).toMatch(/grok\/grok-unmerged/);
  });
  it('does not attempt a branch delete when the worktree removal itself failed', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'grok-fail');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async (a) => { calls.push(a); throw new Error('worktree is dirty'); },
    });
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.includes('branch'))).toBe(false);
  });
});

describe('applyGrokWorktree', () => {
  it('no-ops on empty cached diff; still stages then resets worktree index', async () => {
    const calls: string[][] = [];
    let appliedToCwd = false;
    const r = await applyGrokWorktree('/abs/repo', '/abs/wt', {
      baseDir: '/abs',
      captureGit: async (args) => {
        if (args.includes('--cached')) return { stdout: '', stderr: '' };
        return { stdout: '', stderr: '' };
      },
      runGit: async (a) => {
        calls.push(a);
        if (a.includes('apply')) appliedToCwd = true;
      },
    });
    expect(r.ok).toBe(true);
    expect(appliedToCwd).toBe(false);
    expect(calls.some((c) => c.includes('add') && c.includes('-A'))).toBe(true);
    expect(calls.some((c) => c.includes('reset'))).toBe(true);
    expect(r.message).toMatch(/변경이 없습니다/);
  });
  it('stages worktree (incl. untracked via add -A), applies cached patch to cwd, resets stage', async () => {
    const calls: string[][] = [];
    // new-file style patch as produced for previously untracked files after git add -A
    const patch =
      'diff --git a/new.txt b/new.txt\n' +
      'new file mode 100644\n' +
      '--- /dev/null\n' +
      '+++ b/new.txt\n' +
      '@@\n+ok\n';
    const r = await applyGrokWorktree('/abs/repo', '/abs/wt', {
      baseDir: '/abs',
      captureGit: async (args) => {
        if (args.includes('--name-only')) return { stdout: 'new.txt\0', stderr: '' };
        if (args.includes('--cached')) return { stdout: patch, stderr: '' };
        return { stdout: '', stderr: '' };
      },
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/커밋하지 않았습니다/);
    expect(r.filesChanged).toContain('new.txt');
    expect(calls[0]).toEqual(['-C', '/abs/wt', 'add', '-A']);
    expect(calls.some((c) => c.includes('reset'))).toBe(true);
    const applyCalls = calls.filter((c) => c.includes('apply'));
    expect(applyCalls[0]?.includes('--check')).toBe(true);
    expect(applyCalls[1]?.includes('--check')).toBe(false);
  });
  it('fails closed when apply --check throws; still attempts reset', async () => {
    const calls: string[][] = [];
    const r = await applyGrokWorktree('/abs/repo', '/abs/wt', {
      baseDir: '/abs',
      captureGit: async () => ({ stdout: 'diff --git a/x b/x\n+++ b/x\n', stderr: '' }),
      runGit: async (a) => {
        calls.push(a);
        if (a.includes('--check')) throw new Error('patch does not apply');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/apply 실패/);
    expect(calls.some((c) => c.includes('reset'))).toBe(true);
  });
});

describe('listRepoWorktrees / diffGrokWorktree', () => {
  it('list rejects relative cwd', async () => {
    const r = await listRepoWorktrees('relative');
    expect(r.ok).toBe(false);
  });
  it('diff returns files from porcelain', async () => {
    const r = await diffGrokWorktree('/abs/wt', {
      captureGit: async (args) => {
        if (args.includes('status')) return { stdout: ' M a.ts\0?? b.ts\0', stderr: '' };
        if (args.includes('--stat')) return { stdout: ' a.ts | 1 +\n', stderr: '' };
        return { stdout: '', stderr: '' };
      },
    });
    expect(r.ok).toBe(true);
    expect(r.filesChanged).toEqual(['a.ts', 'b.ts']);
    expect(r.diffStat).toContain('a.ts');
  });
});

describe('applyGrokWorktree filesChanged (real git)', () => {
  it('reports non-ASCII, deleted, renamed and space-containing paths, and no phantom from content', async () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-apply-real-'));
    const main = join(base, 'main');
    mkdirSync(main);
    const git = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

    git(['init', '-q', '.'], main);
    git(['config', 'user.email', 'test@example.com'], main);
    git(['config', 'user.name', 'test'], main);
    git(['config', 'core.autocrlf', 'false'], main);
    writeFileSync(join(main, 'keep.txt'), 'keep\n');
    writeFileSync(join(main, 'to-delete.txt'), 'delete me\n');
    writeFileSync(join(main, 'old-name.txt'), 'renamed content\n');
    git(['add', '-A'], main);
    git(['commit', '-qm', 'init'], main);

    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', wt, '-b', 'grok/apply-test', 'HEAD'], main);

    rmSync(join(wt, 'to-delete.txt'));
    git(['mv', 'old-name.txt', 'new-name.txt'], wt);
    writeFileSync(join(wt, '한글파일.txt'), 'korean\n');
    writeFileSync(join(wt, 'file with spaces.txt'), 'spaced\n');
    // A line of CONTENT that renders as `+++ b/...` in the unified diff.
    writeFileSync(join(wt, 'note.md'), '++ b/phantom.txt\n');

    const r = await applyGrokWorktree(main, wt, { baseDir: base });

    expect(r.ok).toBe(true);
    expect([...(r.filesChanged ?? [])].sort()).toEqual(
      ['file with spaces.txt', 'new-name.txt', 'note.md', 'to-delete.txt', '한글파일.txt'].sort(),
    );

    rmSync(base, { recursive: true, force: true });
  }, 60_000);
});

describe('applyGrokWorktree patch file handling', () => {
  it('writes the patch into a private temp subdirectory, not loose in the shared temp root', async () => {
    const applyPaths: string[] = [];
    const r = await applyGrokWorktree('/abs/repo', '/abs/wt', {
      baseDir: '/abs',
      captureGit: async (args) =>
        args.includes('--name-only')
          ? { stdout: 'a.txt\0', stderr: '' }
          : { stdout: 'diff --git a/a.txt b/a.txt\n+++ b/a.txt\n@@\n+x\n', stderr: '' },
      runGit: async (a) => {
        if (a.includes('apply')) applyPaths.push(a[a.length - 1]);
      },
    });
    expect(r.ok).toBe(true);
    const patchPath = applyPaths[0];
    // A predictable name directly under tmpdir() is pre-creatable by another local user
    // (symlink swap / world-readable source diff) — the patch must live in its own dir.
    expect(dirname(patchPath)).not.toBe(tmpdir());
    expect(dirname(dirname(patchPath))).toBe(tmpdir());
    // and the whole private dir is removed, not just the file
    expect(existsSync(dirname(patchPath))).toBe(false);
  });
});

describe('runGitBounded', () => {
  it('rejects a git call that would otherwise block forever', async () => {
    // `hash-object --stdin` waits on stdin that execFile never closes; unbounded, this hangs
    // and takes runDelegate's timeout_ms with it, because createGrokWorktree/apply run before
    // and outside the grok spawn timer.
    const t0 = Date.now();
    await expect(runGitBounded(['hash-object', '--stdin'], 800)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 30_000);
  it('bounds every production git call', () => {
    expect(Number.isFinite(GIT_TIMEOUT_MS)).toBe(true);
    expect(GIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GIT_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
    expect(Number.isFinite(GIT_MAX_BUFFER)).toBe(true);
    expect(GIT_MAX_BUFFER).toBeGreaterThan(0);
  });
  it('returns stdout for an ordinary call', async () => {
    const r = await runGitBounded(['--version']);
    expect(r.stdout).toMatch(/^git version/);
  }, 30_000);
});

describe('pruneGrokWorktrees', () => {
  const mkBase = () => mkdtempSync(join(tmpdir(), 'grok-prune-'));
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;

  it('is a dry run by default: reports stale worktrees and removes nothing', async () => {
    const baseDir = mkBase();
    const calls: string[][] = [];
    const r = await pruneGrokWorktrees('/abs/repo', {}, {
      baseDir,
      listBaseDir: () => ['grok-old', 'grok-fresh'],
      dirMtimeMs: (p) => (p.endsWith('grok-old') ? NOW - 30 * DAY : NOW - 1 * DAY),
      now: () => NOW,
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.candidates.map((c) => c.path)).toEqual([join(baseDir, 'grok-old')]);
    expect(r.removed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('honours maxAgeDays', async () => {
    const baseDir = mkBase();
    const r = await pruneGrokWorktrees('/abs/repo', { maxAgeDays: 60 }, {
      baseDir,
      listBaseDir: () => ['grok-old'],
      dirMtimeMs: () => NOW - 30 * DAY,
      now: () => NOW,
      runGit: async () => {},
    });
    expect(r.candidates).toEqual([]);
  });

  it('apply:true removes each stale worktree and its branch', async () => {
    const baseDir = mkBase();
    const calls: string[][] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true, maxAgeDays: 7 }, {
      baseDir,
      listBaseDir: () => ['grok-a', 'grok-b'],
      dirMtimeMs: () => NOW - 30 * DAY,
      now: () => NOW,
      // a clean worktree: the status probe answers, so dirty === false and prune may delete it
      captureGit: async () => ({ stdout: '', stderr: '' }),
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.dryRun).toBe(false);
    expect(r.removed).toEqual([join(baseDir, 'grok-a'), join(baseDir, 'grok-b')]);
    expect(calls.filter((c) => c.includes('remove')).length).toBe(2);
    expect(calls.filter((c) => c.includes('branch')).map((c) => c[c.length - 1]))
      .toEqual(['grok/grok-a', 'grok/grok-b']);
  });

  it('one failure does not abort the rest', async () => {
    const baseDir = mkBase();
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, {
      baseDir,
      listBaseDir: () => ['grok-bad', 'grok-good'],
      dirMtimeMs: () => NOW - 30 * DAY,
      now: () => NOW,
      // a clean worktree: the status probe answers, so dirty === false and prune may delete it
      captureGit: async () => ({ stdout: '', stderr: '' }),
      runGit: async (a) => {
        if (a.includes('remove') && a[a.length - 1].endsWith('grok-bad')) throw new Error('locked');
      },
      // git cannot remove it AND the directory cannot be deleted either, so the orphan
      // fallback fails too — that is what a genuine per-candidate failure looks like now.
      removeDir: (path) => { if (path.endsWith('grok-bad')) throw new Error('EBUSY'); },
    });
    expect(r.removed).toEqual([join(baseDir, 'grok-good')]);
    expect(r.failed.map((f) => f.path)).toEqual([join(baseDir, 'grok-bad')]);
    expect(r.ok).toBe(true);
  });

  it('rejects a relative cwd without touching anything', async () => {
    let ran = false;
    const r = await pruneGrokWorktrees('relative', { apply: true }, {
      listBaseDir: () => ['grok-a'],
      runGit: async () => { ran = true; },
    });
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });

  it('is fine when the base dir does not exist yet', async () => {
    const r = await pruneGrokWorktrees('/abs/repo', {}, {
      baseDir: join(tmpdir(), 'grok-prune-does-not-exist-xyz'),
      runGit: async () => {},
    });
    expect(r.ok).toBe(true);
    expect(r.candidates).toEqual([]);
  });
});

describe('createGrokWorktree bulk timeout + failure cleanup', () => {
  it('gives `worktree add` a checkout-sized budget, not the metadata one', async () => {
    const calls: { args: string[]; timeoutMs?: number }[] = [];
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    await createGrokWorktree('/abs/repo', {
      baseDir,
      name: 'grok-bulk',
      runGit: async (args, timeoutMs) => { calls.push({ args, timeoutMs }); },
    });
    const add = calls.find((c) => c.args.includes('add'));
    // 30s SIGTERM-killed a 20k-file checkout at 87% — measured. A checkout is bulk file I/O
    // and must not share the metadata budget.
    expect(add?.timeoutMs).toBe(GIT_BULK_TIMEOUT_MS);
    expect(GIT_BULK_TIMEOUT_MS).toBeGreaterThan(GIT_TIMEOUT_MS * 4);
    expect(Number.isFinite(GIT_BULK_TIMEOUT_MS)).toBe(true);
  });

  it('cleans up the partial worktree, registration and branch when `add` fails', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const calls: string[][] = [];
    await expect(
      createGrokWorktree('/abs/repo', {
        baseDir,
        name: 'grok-doomed',
        runGit: async (args) => {
          calls.push(args);
          if (args.includes('rev-parse')) throw new Error('not found'); // fresh branch name
          if (args.includes('add') && args.includes('worktree')) throw new Error('killed: SIGTERM');
        },
      }),
    ).rejects.toThrow(/SIGTERM/);
    // a killed checkout leaves a partial dir, a .git/worktrees registration and the branch
    expect(calls.some((c) => c.includes('remove') && c.includes('--force'))).toBe(true);
    expect(calls.some((c) => c.includes('prune'))).toBe(true);
    expect(calls.some((c) => c.includes('branch'))).toBe(true);
  });

  it('does not run cleanup when `add` succeeds', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const calls: string[][] = [];
    await createGrokWorktree('/abs/repo', {
      baseDir, name: 'grok-ok', runGit: async (a) => { calls.push(a); },
    });
    expect(calls.some((c) => c.includes('remove') || c.includes('prune') || c.includes('branch'))).toBe(false);
    expect(calls.some((c) => c.includes('add') && c.includes('worktree'))).toBe(true);
  });
});

describe('parseWorktreeOwner', () => {
  it('extracts the owning repo from a worktree .git file', () => {
    expect(parseWorktreeOwner('gitdir: /home/u/proj/.git/worktrees/grok-a\n')).toBe('/home/u/proj');
    const BS = String.fromCharCode(92);
    const win = 'gitdir: C:' + BS + 'Users' + BS + 'u' + BS + 'proj' + BS + '.git' + BS + 'worktrees' + BS + 'grok-a';
    expect(parseWorktreeOwner(win)).toBe('C:' + BS + 'Users' + BS + 'u' + BS + 'proj');
  });
  it('returns undefined for anything that is not a worktree .git file', () => {
    expect(parseWorktreeOwner('')).toBeUndefined();
    expect(parseWorktreeOwner('ref: refs/heads/main')).toBeUndefined();
    expect(parseWorktreeOwner('gitdir: /home/u/proj/.git')).toBeUndefined();
  });
});

describe('pruneGrokWorktrees ownership and safety', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;
  const base = () => mkdtempSync(join(tmpdir(), 'grok-prune2-'));
  const common = (baseDir: string) => ({
    baseDir,
    dirMtimeMs: () => NOW - 30 * DAY,
    now: () => NOW,
  });

  it('removes each worktree through the repo that actually owns it, not cwd', async () => {
    const baseDir = base();
    const calls: string[][] = [];
    const r = await pruneGrokWorktrees('/abs/caller', { apply: true }, {
      ...common(baseDir),
      listBaseDir: () => ['grok-a'],
      readGitFile: () => 'gitdir: /abs/OWNER/.git/worktrees/grok-a\n',
      captureGit: async () => ({ stdout: '', stderr: '' }),
      runGit: async (a) => { calls.push(a); },
    });
    // ~/.grok-build/worktrees is global; `git worktree remove` is per repo. Removing from the
    // caller's repo can only ever work for trees that repo registered.
    expect(calls[0]).toEqual(['-C', '/abs/OWNER', 'worktree', 'remove', '--force', join(baseDir, 'grok-a')]);
    expect(r.removed).toEqual([join(baseDir, 'grok-a')]);
    expect(r.candidates[0].owner).toBe('/abs/OWNER');
  });

  it('never deletes a worktree that still holds uncommitted work', async () => {
    const baseDir = base();
    const calls: string[][] = [];
    const r = await pruneGrokWorktrees('/abs/caller', { apply: true }, {
      ...common(baseDir),
      listBaseDir: () => ['grok-dirty'],
      readGitFile: () => 'gitdir: /abs/OWNER/.git/worktrees/grok-dirty\n',
      captureGit: async () => ({ stdout: ' M src/a.ts\0', stderr: '' }),
      runGit: async (a) => { calls.push(a); },
    });
    // mtime is creation time, not idle time, so an "old" tree can hold unapplied grok work.
    expect(r.skippedDirty).toEqual([join(baseDir, 'grok-dirty')]);
    expect(r.removed).toEqual([]);
    expect(calls.some((c) => c.includes('remove'))).toBe(false);
    expect(r.candidates[0].dirty).toBe(true);
  });
  // A5 (docs/10, 2026-09-05): this case used to assert the OPPOSITE, and that assertion described
  // how committed history got destroyed. A directory with no `.git` file that nonetheless answers
  // `git status` cleanly is a real repository — an independent checkout that happens to sit under
  // the global base dir — and `git worktree remove` failing on it means only that git never
  // registered it as a worktree. Deleting it was never prune's job. Real orphans are now found by
  // classification (see the A5 block below), not by a failed remove.
  it('does NOT rmSync a tree that answers git cleanly, even when worktree remove refuses', async () => {
    const baseDir = base();
    const wt = join(baseDir, 'grok-orphan');
    mkdirSync(wt);
    const deleted: string[] = [];
    const r = await pruneGrokWorktrees('/abs/caller', { apply: true }, {
      ...common(baseDir),
      listBaseDir: () => ['grok-orphan'],
      readGitFile: () => { throw new Error('ENOENT'); },
      captureGit: async () => ({ stdout: '', stderr: '' }),
      runGit: async () => { throw new Error('fatal: is not a working tree'); },
      removeDir: (p) => { deleted.push(p); },
    });
    expect(deleted).toEqual([]);
    expect(r.removedOrphan).toEqual([]);
    expect(r.failed.length).toBe(1);
    expect(r.ok).toBe(true);
  });

  it('refuses the orphan fallback for a path that resolves outside the base', async () => {
    const baseDir = base();
    const deleted: string[] = [];
    const r = await pruneGrokWorktrees('/abs/caller', { apply: true }, {
      baseDir,
      dirMtimeMs: () => NOW - 30 * DAY,
      now: () => NOW,
      listBaseDir: () => ['..'],
      readGitFile: () => { throw new Error('ENOENT'); },
      runGit: async () => { throw new Error('nope'); },
      removeDir: (p) => { deleted.push(p); },
    });
    expect(deleted).toEqual([]);
    expect(r.removedOrphan).toEqual([]);
  });

  it('dry run reports owner and dirtiness and touches nothing', async () => {
    const baseDir = base();
    const calls: string[][] = [];
    const r = await pruneGrokWorktrees('/abs/caller', {}, {
      ...common(baseDir),
      listBaseDir: () => ['grok-a'],
      readGitFile: () => 'gitdir: /abs/OWNER/.git/worktrees/grok-a\n',
      captureGit: async () => ({ stdout: ' M x\0', stderr: '' }),
      runGit: async (a) => { calls.push(a); },
      removeDir: () => { throw new Error('must not delete on a dry run'); },
    });
    expect(r.dryRun).toBe(true);
    expect(calls).toEqual([]);
    expect(r.candidates[0].owner).toBe('/abs/OWNER');
    expect(r.candidates[0].dirty).toBe(true);
    expect(r.candidates[0].createdDaysAgo).toBe(30);
  });
});

describe('v0.2.11 residuals', () => {
  it('failed-add cleanup never deletes a branch that already existed', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const calls: string[][] = [];
    await expect(
      createGrokWorktree('/abs/repo', {
        baseDir,
        name: 'grok-taken',
        runGit: async (args) => {
          calls.push(args);
          // the branch already exists, which is exactly why `worktree add -b` fails
          if (args.includes('rev-parse')) return;
          if (args.includes('add') && args.includes('worktree')) {
            throw new Error("fatal: a branch named 'grok/grok-taken' already exists");
          }
        },
      }),
    ).rejects.toThrow(/already exists/);
    // cleaning up a branch we did not create would destroy someone else's merged work
    expect(calls.some((c) => c.includes('branch'))).toBe(false);
    // the tree/registration cleanup still runs
    expect(calls.some((c) => c.includes('prune'))).toBe(true);
  });

  it('still deletes the branch it created itself when add fails', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const calls: string[][] = [];
    await expect(
      createGrokWorktree('/abs/repo', {
        baseDir,
        name: 'grok-mine',
        runGit: async (args) => {
          calls.push(args);
          if (args.includes('rev-parse')) throw new Error('not found');
          if (args.includes('add') && args.includes('worktree')) throw new Error('killed: SIGTERM');
        },
      }),
    ).rejects.toThrow(/SIGTERM/);
    expect(calls.some((c) => c.includes('branch'))).toBe(true);
  });

  it('removeGrokWorktree asks for the bulk budget too', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'grok-rm');
    mkdirSync(wt);
    const seen: { args: string[]; timeoutMs?: number }[] = [];
    await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      // A4: a clean worktree — the dirty probe must find nothing to protect.
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      runGit: async (args, timeoutMs) => { seen.push({ args, timeoutMs }); },
    });
    const rm = seen.find((c) => c.args.includes('remove'));
    expect(rm?.timeoutMs).toBe(GIT_BULK_TIMEOUT_MS);
  });

  it('applyGrokWorktree gives the whole-tree git calls the bulk budget', async () => {
    const seen: { args: string[]; timeoutMs?: number }[] = [];
    await applyGrokWorktree('/abs/repo', '/abs/wt', {
      baseDir: '/abs',
      captureGit: async (args) =>
        args.includes('--name-only')
          ? { stdout: 'a.txt\0', stderr: '' }
          : { stdout: 'diff --git a/a.txt b/a.txt\n+++ b/a.txt\n@@\n+x\n', stderr: '' },
      runGit: async (args, timeoutMs) => { seen.push({ args, timeoutMs }); },
    });
    // `add -A` hashes every file and `git apply` writes them; both scale with the tree
    expect(seen.find((c) => c.args.includes('-A'))?.timeoutMs).toBe(GIT_BULK_TIMEOUT_MS);
    expect(seen.find((c) => c.args.includes('apply') && !c.args.includes('--check'))?.timeoutMs)
      .toBe(GIT_BULK_TIMEOUT_MS);
  });

  it('the empty dry-run message talks about creation time, not idleness', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-prune-empty-'));
    const r = await pruneGrokWorktrees('/abs/repo', {}, { baseDir, listBaseDir: () => [] });
    expect(r.candidates).toEqual([]);
    expect(r.message).toMatch(/만들어진/);
  });
});

// ── Audit findings, 2026-09-02. Each test pins one measured defect. ────────────────────

describe('applyGrokWorktree containment (audit: apply had no path guard)', () => {
  // remove and prune both call isPathInsideBase; apply validated only isAbsolute, and its
  // `git add -A` + `git reset HEAD -- .` run against worktreePath BEFORE the `apply --check`
  // that may abort. Pointed at an ordinary repo it wiped that repo's staged index even on failure.
  it('refuses a worktree path outside the base dir, without running git', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    let ran = false;
    const r = await applyGrokWorktree('/abs/repo', join(tmpdir(), 'someone-elses-repo'), {
      baseDir,
      runGit: async () => { ran = true; },
      captureGit: async () => { ran = true; return { stdout: '', stderr: '' }; },
    });
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
    expect(r.message).toMatch(/worktree만/);
    rmSync(baseDir, { recursive: true, force: true });
  });
});

describe('applyGrokWorktree byte fidelity (audit: UTF-8 round trip corrupted files)', () => {
  // runGitBounded decoded the patch as UTF-8 and it was written back as UTF-8, so any byte
  // sequence that is not valid UTF-8 became U+FFFD. `--binary` only covers files git calls
  // binary (NUL in the first 8000 bytes), so NUL-free CP949/EUC-KR/Latin-1 text was mangled.
  it('applies a non-UTF-8 text file byte-for-byte', async () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-enc-'));
    const main = join(base, 'main');
    mkdirSync(main);
    const git = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    git(['init', '-q', '.'], main);
    git(['config', 'user.email', 'test@example.com'], main);
    git(['config', 'user.name', 'test'], main);
    git(['config', 'core.autocrlf', 'false'], main);
    writeFileSync(join(main, 'seed.txt'), 'seed\n');
    git(['add', '-A'], main);
    git(['commit', '-qm', 'init'], main);

    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', wt, '-b', 'grok/enc-test', 'HEAD'], main);
    // "caf<E9>\n" in Latin-1 — no NUL, so git classifies it as text and --binary will not help.
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(join(wt, 'latin1.txt'), latin1);

    const r = await applyGrokWorktree(main, wt, { baseDir: base });

    expect(r.ok).toBe(true);
    expect(readFileSync(join(main, 'latin1.txt')).equals(latin1)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  }, 60_000);
});

describe('applyGrokWorktree from a sub-directory (audit: changes were dropped silently)', () => {
  // The worktree checks out the repo ROOT, so the patch is root-relative. Replaying it with
  // `git -C <subdir> apply` made git ignore every entry outside that subdir — exit 0, and
  // `--check` passed too — while filesChanged still listed the dropped files as applied.
  it('lands root-level files even when cwd is a sub-directory', async () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-subdir-'));
    const main = join(base, 'main');
    mkdirSync(join(main, 'pkg'), { recursive: true });
    const git = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    git(['init', '-q', '.'], main);
    git(['config', 'user.email', 'test@example.com'], main);
    git(['config', 'user.name', 'test'], main);
    git(['config', 'core.autocrlf', 'false'], main);
    writeFileSync(join(main, 'pkg', 'a.txt'), 'original\n');
    writeFileSync(join(main, 'top.txt'), 'top original\n');
    git(['add', '-A'], main);
    git(['commit', '-qm', 'init'], main);

    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', wt, '-b', 'grok/subdir-test', 'HEAD'], main);
    writeFileSync(join(wt, 'pkg', 'a.txt'), 'grok edit\n');
    writeFileSync(join(wt, 'top.txt'), 'grok changed the ROOT file\n');
    writeFileSync(join(wt, 'rootnew.txt'), 'new root file\n');

    const r = await applyGrokWorktree(join(main, 'pkg'), wt, { baseDir: base });

    expect(r.ok).toBe(true);
    // Everything reported as applied must actually be on disk.
    expect(readFileSync(join(main, 'top.txt'), 'utf8')).toBe('grok changed the ROOT file\n');
    expect(existsSync(join(main, 'rootnew.txt'))).toBe(true);
    expect(readFileSync(join(main, 'pkg', 'a.txt'), 'utf8')).toBe('grok edit\n');
    rmSync(base, { recursive: true, force: true });
  }, 60_000);
});

describe('diffGrokWorktree diffStat (audit: blind to staged and untracked)', () => {
  // filesChanged came from porcelain (sees staged + untracked) while diffStat came from a bare
  // `git diff --stat` (working tree vs index only). Since grok routinely creates new files, the
  // common case was a full file list beside no stat at all.
  it('reports a stat that covers newly created files', async () => {
    const base = mkdtempSync(join(tmpdir(), 'grok-stat-'));
    const main = join(base, 'main');
    mkdirSync(main);
    const git = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
    git(['init', '-q', '.'], main);
    git(['config', 'user.email', 'test@example.com'], main);
    git(['config', 'user.name', 'test'], main);
    git(['config', 'core.autocrlf', 'false'], main);
    writeFileSync(join(main, 'seed.txt'), 'seed\n');
    git(['add', '-A'], main);
    git(['commit', '-qm', 'init'], main);

    const wt = join(base, 'wt');
    git(['worktree', 'add', '-q', wt, '-b', 'grok/stat-test', 'HEAD'], main);
    writeFileSync(join(wt, 'feature.ts'), 'new feature\n');
    git(['add', '-A'], wt); // grok's new files reach the index the same way apply stages them

    const r = await diffGrokWorktree(wt);

    expect(r.ok).toBe(true);
    expect(r.filesChanged).toContain('feature.ts');
    expect(r.diffStat).toBeDefined();
    expect(r.diffStat).toContain('feature.ts');
    rmSync(base, { recursive: true, force: true });
  }, 60_000);
});

describe('pruneGrokWorktrees unknown dirty state (audit: undefined read as clean)', () => {
  // The catch deliberately leaves `dirty` undefined rather than guessing "clean", but both
  // consumers tested `if (c.dirty)` — so the one state meaning "unknown" was the one that
  // read as "safe to delete", and the same missing owner routed into the orphan rmSync.
  const undecidableDeps = (removed: string[]) => ({
    baseDir: '/base',
    listBaseDir: () => ['grok-unknown'],
    dirMtimeMs: () => 0,
    now: () => 100 * 24 * 60 * 60 * 1000,
    readGitFile: () => { throw new Error('no .git'); },
    captureGit: async () => { throw new Error('fatal: not a git repository'); },
    runGit: async () => { throw new Error('not a working tree'); },
    removeDir: (p: string) => { removed.push(p); },
  });

  it('does not delete a worktree whose dirty state could not be determined', async () => {
    const removed: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { maxAgeDays: 7, apply: true }, undecidableDeps(removed));
    expect(removed).toEqual([]);
    expect(r.removedOrphan).toEqual([]);
    expect(r.skippedDirty).toContain(join('/base', 'grok-unknown'));
  });

  it('warns in the dry run that an undecidable tree will be skipped', async () => {
    const removed: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { maxAgeDays: 7 }, undecidableDeps(removed));
    expect(r.dryRun).toBe(true);
    expect(r.message).toMatch(/건너뜁니다/);
  });
});

// A4 (docs/10, MEASURED 2026-09-05): `remove` ran `git worktree remove --force` unconditionally.
// This plugin NEVER commits, so grok's output in an isolation worktree is uncommitted by
// construction — removing before apply destroyed it with no blob, no reflog, no branch to recover
// from, and the response was a bare `ok: true`. Measured on the same data, `prune` refuses to
// delete anything it cannot prove clean; `remove` had the opposite default on identical state.
describe('A4 — remove must not silently destroy unapplied work', () => {
  const dirtyDeps = (over: Record<string, unknown> = {}) => ({
    captureGit: async () => ({ stdout: [" M a.ts", "?? new.ts", ""].join(String.fromCharCode(10)), stderr: "" }),
    ...over,
  });

  it('refuses a worktree with uncommitted or untracked changes', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, dirtyDeps({
      baseDir, runGit: async (a: string[]) => { calls.push(a); },
    }) as never);
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.includes('remove')), 'nothing may be deleted').toBe(false);
    expect(r.message).toMatch(/force/);
  });

  it('names what would be lost, so the caller can decide', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    const r = await removeGrokWorktree('/abs/repo', wt, dirtyDeps({ baseDir, runGit: async () => {} }) as never);
    expect(r.message).toContain('a.ts');
    expect(r.message).toContain('new.ts');
  });

  it('deletes when the caller says force explicitly', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, dirtyDeps({
      baseDir, runGit: async (a: string[]) => { calls.push(a); },
    }) as never, { force: true });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['-C', '/abs/repo', 'worktree', 'remove', '--force', wt]);
  });

  it('a clean worktree still removes without ceremony', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    const calls: string[][] = [];
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      captureGit: async () => ({ stdout: '', stderr: '' }),
      runGit: async (a: string[]) => { calls.push(a); },
    } as never);
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['-C', '/abs/repo', 'worktree', 'remove', '--force', wt]);
  });

  it('refuses when the state cannot be read — unknown is not clean', async () => {
    // The exact reasoning prune already uses: an unanswerable status probe leaves `dirty`
    // undefined, and reading undefined as "safe to delete" is how work disappears.
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    const wt = join(baseDir, 'w1');
    mkdirSync(wt);
    let ran = false;
    const r = await removeGrokWorktree('/abs/repo', wt, {
      baseDir,
      captureGit: async () => { throw new Error('not a worktree'); },
      runGit: async () => { ran = true; },
    } as never);
    expect(r.ok).toBe(false);
    expect(ran).toBe(false);
  });
});

// A5 (docs/10, MEASURED 2026-09-05): prune could never collect a REAL orphan — the only case it
// exists for. When the owning repo is deleted, `git -C <tree> status` fails, so `dirty` stays
// undefined, and the `c.dirty !== false` guard sends it to skippedDirty. It shows up as a
// candidate every run and is skipped every run. Meanwhile the one path that DID reach the rmSync
// was a directory that answers git cleanly but is not a registered worktree — i.e. an independent
// repo that happened to sit under the base dir, whose COMMITTED history got deleted.
describe('A5 — prune must collect the orphan it exists for, and only that', () => {
  const OLD = 40 * 24 * 60 * 60 * 1000;
  const base = () => mkdtempSync(join(tmpdir(), 'grok-prune-'));

  const pruneDeps = (over: Record<string, unknown>) => ({
    now: () => OLD * 2,
    dirMtimeMs: () => OLD,
    ...over,
  });

  it('classifies a tree whose owner repo is gone as an orphan, not as dirty', async () => {
    const baseDir = base();
    const r = await pruneGrokWorktrees('/abs/repo', {}, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-mtofhrcg-enz2hr'],
      readGitFile: () => { throw new Error('ENOENT'); },
      captureGit: async () => { throw new Error('not a git repository'); },
    }) as never);
    expect(r.candidates[0].orphan).toBe(true);
    expect(r.message).toMatch(/고아/);
  });

  it('the shape the audit measured: .git file intact, owner repo deleted', async () => {
    // This is what the 7 leftover trees on the audit machine actually looked like. The `.git`
    // file still names its repo; the repo is gone; `git -C <tree> status` therefore fails and
    // `dirty` stays undefined. That is an orphan, not an undecidable tree.
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-mtofhrcg-enz2hr'],
      readGitFile: () => 'gitdir: /gone/repo/.git/worktrees/grok-mtofhrcg-enz2hr',
      captureGit: async () => { throw new Error('not a git repository'); },
      pathExists: () => false,
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => {},
    }) as never);
    expect(r.candidates[0].orphan).toBe(true);
    expect(r.removedOrphan).toEqual([join(baseDir, 'grok-mtofhrcg-enz2hr')]);
  });

  it('an owner that still exists keeps the undecidable-tree protection', async () => {
    // Owner repo present, but git will not answer for the tree. Nothing is known, so nothing is
    // deleted — the 2026-09-02 protection this item must not quietly undo.
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-mtofhrcg-enz2hr'],
      readGitFile: () => 'gitdir: /live/repo/.git/worktrees/grok-mtofhrcg-enz2hr',
      captureGit: async () => { throw new Error('cannot lock ref'); },
      pathExists: () => true,
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => { throw new Error('nope'); },
    }) as never);
    expect(r.candidates[0].orphan).toBeUndefined();
    expect(removedDirs).toEqual([]);
    expect(r.skippedDirty.length).toBe(1);
  });
  it('actually deletes that orphan under apply — every run used to skip it', async () => {
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-mtofhrcg-enz2hr'],
      readGitFile: () => { throw new Error('ENOENT'); },
      captureGit: async () => { throw new Error('not a git repository'); },
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => {},
    }) as never);
    expect(r.removedOrphan).toEqual([join(baseDir, 'grok-mtofhrcg-enz2hr')]);
    expect(removedDirs).toEqual([join(baseDir, 'grok-mtofhrcg-enz2hr')]);
    expect(r.skippedDirty).toEqual([]);
  });

  it('will not rmSync a directory this wrapper did not name', async () => {
    // Someone else's checkout that happens to live under the base dir. Orphan by every other
    // test, but not ours to delete.
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['SCAManager'],
      readGitFile: () => { throw new Error('ENOENT'); },
      captureGit: async () => { throw new Error('not a git repository'); },
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => {},
    }) as never);
    expect(removedDirs).toEqual([]);
    expect(r.removedOrphan).toEqual([]);
  });

  it('will not rmSync an independent repo that answers git cleanly', async () => {
    // The inverse direction, and the one that used to destroy committed history: status succeeds
    // (clean), but `git worktree remove` fails because git never registered this tree.
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-standalone-repo'],
      readGitFile: () => { throw new Error('ENOENT'); },
      captureGit: async () => ({ stdout: String(), stderr: String() }),
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => { throw new Error('is not a working tree'); },
    }) as never);
    expect(removedDirs, 'committed history is not garbage').toEqual([]);
    expect(r.failed.length).toBe(1);
  });

  it('still refuses an orphan-shaped tree that git says is dirty', async () => {
    const baseDir = base();
    const removedDirs: string[] = [];
    const r = await pruneGrokWorktrees('/abs/repo', { apply: true }, pruneDeps({
      baseDir,
      listBaseDir: () => ['grok-mtofhrcg-enz2hr'],
      readGitFile: () => 'gitdir: /gone/repo/.git/worktrees/grok-mtofhrcg-enz2hr',
      captureGit: async () => ({ stdout: ' M a.ts', stderr: String() }),
      removeDir: (path: string) => { removedDirs.push(path); },
      runGit: async () => {},
    }) as never);
    expect(removedDirs).toEqual([]);
    expect(r.skippedDirty.length).toBe(1);
  });
});
