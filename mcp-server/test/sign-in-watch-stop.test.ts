/**
 * A68: a bounded run stops reading grok's log when it ends, however it ends. A watch left running would open the shared
 * log every poll for as long as the server lives, once more for every run it ever made — and nothing the run returns
 * shows it. So it is counted where the watch opens the file (`open` of node:fs/promises, wrapped in this file). A child
 * with no pipes, which no real start produces on demand, is in spawn-mocked.test.ts.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnBounded } from '../src/delegate.js';

const opened = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  const open: typeof real.open = (path, flags, mode) => {
    opened.paths.push(String(path));
    return real.open(path, flags, mode);
  };
  return { ...real, open };
});

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratchLog = () => {
  const d = mkdtempSync(join(tmpdir(), 'a68-stop-'));
  dirs.push(d);
  const log = join(d, 'unified.jsonl');
  writeFileSync(log, '');
  return log;
};
const opensOf = (log: string) => opened.paths.filter((p) => p === log).length;
const later = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe('A68 — the log watch ends with the run', () => {
  it('a run that ends on its own: read while grok ran, never after', async () => {
    const log = scratchLog();
    const r = await spawnBounded(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], tmpdir(), process.env, 15_000, 300,
      { signInLog: log, pollMs: 20 });
    expect(r.code).toBe(0);
    const during = opensOf(log);
    expect(during).toBeGreaterThan(0);
    await later(300);
    expect(opensOf(log)).toBe(during);
  }, 20_000);

  it('a run the cap ends: never read after', async () => {
    const log = scratchLog();
    const r = await spawnBounded(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], tmpdir(), process.env, 300, 300,
      { signInLog: log, pollMs: 20 });
    expect(r.timedOut).toBe(true);
    const during = opensOf(log);
    expect(during).toBeGreaterThan(0);
    await later(300);
    expect(opensOf(log)).toBe(during);
  }, 20_000);

  // spawn THROWS for a NUL in an argument (A39) — the watch, made before the spawn, must end there too.
  it('a start that throws: never read', async () => {
    const log = scratchLog();
    const r = await spawnBounded(process.execPath, ['-e', '0', 'a\0b'], tmpdir(), process.env, 15_000, 300,
      { signInLog: log, pollMs: 20 });
    expect(r.spawnError).toBe(true);
    await later(300);
    expect(opensOf(log)).toBe(0);
  }, 20_000);

  it('a start that fails (no such program): never read after', async () => {
    const log = scratchLog();
    const r = await spawnBounded('no-such-grok-a68', [], tmpdir(), process.env, 15_000, 300, { signInLog: log, pollMs: 20 });
    expect(r.spawnError).toBe(true);
    const during = opensOf(log);
    await later(300);
    expect(opensOf(log)).toBe(during);
  }, 20_000);
});
