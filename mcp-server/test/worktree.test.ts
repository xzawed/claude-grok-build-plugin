import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrokWorktree } from '../src/worktree.js';

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
