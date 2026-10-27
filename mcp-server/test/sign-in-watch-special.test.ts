/**
 * A68: both watchers read grok's log only when it is a regular file. A FIFO is the case that was measured (opened
 * blocking, it held a thread — sign-in-watch.test.ts and sign-in-stop.test.ts run a real one on POSIX), but a FIFO opened
 * without blocking reports size 0, so nothing would be read there even without the check (pre-merge review: dropping it
 * left every test green). The check is what keeps any other non-regular file unread whatever size it reports — so here
 * the stat is stubbed to say "not a file, 1 MiB", and dropping the check shows as a read.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSignInWatch } from '../src/sign-in-watch.js';
import * as probe from '../scripts/sign-in-stop.mjs';

// Hoisted with the mocks below; the descriptor is one no real open returns here.
const seen = vi.hoisted(() => ({
  special: '', opens: 0, reads: 0, fakeFd: 987_654, notAFile: { isFile: () => false, size: 1024 * 1024 },
}));

// The server's watch: node:fs/promises `open` hands back a stand-in handle for the special path.
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  const open = ((path: Parameters<typeof real.open>[0], flags?: Parameters<typeof real.open>[1], mode?: Parameters<typeof real.open>[2]) => {
    if (String(path) !== seen.special) return real.open(path, flags, mode);
    seen.opens += 1;
    return Promise.resolve({
      stat: async () => seen.notAFile,
      read: async () => { seen.reads += 1; return { bytesRead: 0 }; },
      close: async () => {},
    });
  }) as typeof real.open;
  return { ...real, open };
});
// The probes' watch: node:fs's synchronous calls, with that descriptor.
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  const openSync = ((path: Parameters<typeof real.openSync>[0], ...rest: unknown[]) => {
    if (String(path) !== seen.special) return (real.openSync as (...a: unknown[]) => number)(path, ...rest);
    seen.opens += 1;
    return seen.fakeFd;
  }) as typeof real.openSync;
  const fstatSync = ((fd: number, ...rest: unknown[]) => (fd === seen.fakeFd
    ? seen.notAFile
    : (real.fstatSync as (...a: unknown[]) => unknown)(fd, ...rest))) as typeof real.fstatSync;
  const readSync = ((fd: number, ...rest: unknown[]) => {
    if (fd !== seen.fakeFd) return (real.readSync as (...a: unknown[]) => number)(fd, ...rest);
    seen.reads += 1;
    return 0;
  }) as typeof real.readSync;
  const closeSync = ((fd: number) => { if (fd !== seen.fakeFd) real.closeSync(fd); }) as typeof real.closeSync;
  return { ...real, openSync, fstatSync, readSync, closeSync };
});

const later = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe('A68 — a log path that is not a regular file is opened and never read', () => {
  it('by the server\'s watch', async () => {
    seen.special = join(tmpdir(), 'a68-special-server', 'unified.jsonl');
    seen.opens = 0;
    seen.reads = 0;
    let fired = 0;
    const w = startSignInWatch(seen.special, () => 4242, () => { fired += 1; }, 10);
    try { await later(150); } finally { w.stop(); }
    expect(seen.opens).toBeGreaterThan(0); // the ticks ran
    expect([seen.reads, fired]).toEqual([0, 0]);
  });

  it('by the probes\' watch', async () => {
    seen.special = join(tmpdir(), 'a68-special-probe', 'unified.jsonl');
    seen.opens = 0;
    seen.reads = 0;
    let fired = 0;
    const w = probe.watchSignIn(seen.special, () => 4242, () => { fired += 1; }, 10);
    try { await later(150); } finally { w.stop(); }
    expect(seen.opens).toBeGreaterThan(0);
    expect([seen.reads, fired]).toEqual([0, 0]);
  });
});
