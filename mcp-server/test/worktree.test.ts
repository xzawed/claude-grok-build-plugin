import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGrokWorktree,
  parseWorktreePorcelain,
  isPathInsideBase,
  removeGrokWorktree,
  applyGrokWorktree,
  listRepoWorktrees,
  diffGrokWorktree,
} from '../src/worktree.js';

describe('createGrokWorktree', () => {
  it('runs `git -C <cwd> worktree add <baseDir>/<name> -b grok/<name> HEAD` and returns the path', async () => {
    const calls: string[][] = [];
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-wt-'));
    const path = await createGrokWorktree('/abs/repo', {
      name: 'fixed', baseDir, runGit: async (a) => { calls.push(a); },
    });
    const expected = join(baseDir, 'fixed');
    expect(path).toBe(expected);
    expect(calls).toEqual([['-C', '/abs/repo', 'worktree', 'add', expected, '-b', 'grok/fixed', 'HEAD']]);
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
  });
});

describe('removeGrokWorktree', () => {
  it('refuses paths outside the worktree base dir', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-base-'));
    let ran = false;
    const r = await removeGrokWorktree('/abs/repo', join(tmpdir(), 'evil-wt'), {
      baseDir,
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
      runGit: async (a) => { calls.push(a); },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['-C', '/abs/repo', 'worktree', 'remove', '--force', wt]);
  });
});

describe('applyGrokWorktree', () => {
  it('no-ops on empty cached diff; still stages then resets worktree index', async () => {
    const calls: string[][] = [];
    let appliedToCwd = false;
    const r = await applyGrokWorktree('/abs/repo', '/abs/wt', {
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
      captureGit: async (args) => {
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
