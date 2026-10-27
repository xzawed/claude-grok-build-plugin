import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

// spawnBounded against children a real process cannot be made to produce on demand. The mock is
// file-wide (vi.mock is hoisted), which is why these live apart from delegate.test.ts.
const fake = vi.hoisted(() => ({ child: (): unknown => { throw new Error('set fake.child first'); } }));
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: () => fake.child(),
}));
// A68: where the sign-in watch opens grok's log, counted (as in sign-in-watch-stop.test.ts).
const opened = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  const open: typeof real.open = (path, flags, mode) => {
    opened.paths.push(String(path));
    return real.open(path, flags, mode);
  };
  return { ...real, open };
});

const { spawnBounded } = await import('../src/delegate.js');

// A pid no system hands out, so the POSIX group kill (`process.kill(-pid)`) can only fail with ESRCH.
const NO_SUCH_PID = 2_000_000_000;

describe('spawnBounded — children that misbehave in ways a test process cannot', () => {
  // A41's cap-started grace (pre-merge review): a kill that FAILS emits 'error', which is ignored once
  // the child started, and no exit ever comes. Without the grace the call waited forever.
  it('a cap whose kill fails still ends the call, as a timeout and not a spawn error', async () => {
    fake.child = () => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.pid = NO_SUCH_PID;
      child.kill = () => {
        child.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }));
        return false;
      };
      process.nextTick(() => child.emit('spawn'));
      return child;
    };
    const t0 = Date.now();
    const r = await spawnBounded('grok', ['x'], process.cwd(), process.env, 100, 100);
    expect(r.timedOut).toBe(true);
    expect(r.spawnError).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  // The pre-merge review, under `ulimit -n`: out of file descriptors, spawn neither throws nor starts —
  // it returns a child with NO pipes and emits 'error' on the next tick. The first `setEncoding` threw
  // (the promise rejected), and the 'error' then had no listener and ended the server (exit 1).
  it('a child with no pipes (EMFILE) is a spawn error, and its error event is handled', async () => {
    fake.child = () => {
      const child = new EventEmitter();
      process.nextTick(() => child.emit('error', Object.assign(new Error('spawn grok EMFILE'), { code: 'EMFILE' })));
      return child;
    };
    const r = await spawnBounded('grok', ['x'], process.cwd(), process.env, 5000);
    expect(r.spawnError).toBe(true);
    expect(r.code).toBe(-1);
    expect(r.stderr).toMatch(/EMFILE/);
  });

  // A68: the sign-in watch is made before the spawn, so this path ends it too (sign-in-watch-stop.test.ts has the rest).
  it('a child with no pipes leaves no sign-in watch reading grok\'s log', async () => {
    fake.child = () => {
      const child = new EventEmitter();
      process.nextTick(() => child.emit('error', Object.assign(new Error('spawn grok EMFILE'), { code: 'EMFILE' })));
      return child;
    };
    const dir = mkdtempSync(join(tmpdir(), 'a68-pipeless-'));
    try {
      const log = join(dir, 'unified.jsonl');
      writeFileSync(log, '');
      const r = await spawnBounded('grok', ['x'], process.cwd(), process.env, 5000, 300, { signInLog: log, pollMs: 20 });
      expect(r.spawnError).toBe(true);
      await new Promise((res) => setTimeout(res, 300));
      expect(opened.paths.filter((p) => p === log)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The re-review, win32 with a 260+ character cwd: the child reports ENOENT, and its pipes ALSO emit
  // 'error' (ENOTCONN). Nothing listened on the pipes, so that 'error' ended the server.
  it('a pipe that errors while the spawn fails does not end the process', async () => {
    fake.child = () => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
      const out = new PassThrough();
      const err = new PassThrough();
      child.stdout = out;
      child.stderr = err;
      process.nextTick(() => {
        child.emit('error', Object.assign(new Error('spawn grok ENOENT'), { code: 'ENOENT' }));
        out.emit('error', Object.assign(new Error('read ENOTCONN'), { code: 'ENOTCONN' }));
        err.emit('error', Object.assign(new Error('read ENOTCONN'), { code: 'ENOTCONN' }));
      });
      return child;
    };
    const r = await spawnBounded('grok', ['x'], process.cwd(), process.env, 5000);
    expect(r.spawnError).toBe(true);
    expect(r.stderr).toMatch(/ENOENT/);
  });
});
