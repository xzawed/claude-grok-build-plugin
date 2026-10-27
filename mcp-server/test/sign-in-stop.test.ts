/**
 * `scripts/sign-in-stop.mjs` is the probes' copy of `src/sign-in-watch.ts` (the scripts run under plain node and cannot
 * import TypeScript). The two must read grok's log the same way, so they are held to the same lines here; the
 * watcher itself is exercised against a real file, as its source twin is in sign-in-watch.test.ts.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as probe from '../scripts/sign-in-stop.mjs';
import * as server from '../src/sign-in-watch.js';

// stopTree's taskkill is recorded, never run (vitest hoists both of these above the imports).
const sync = vi.hoisted(() => ({ calls: [] as unknown[][], status: 0 as number }));
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawnSync: (cmd: unknown, args: unknown) => { sync.calls.push([cmd, args]); return { status: sync.status }; },
}));

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
// Verbatim from the 2026-10-27 runs (grok 1.0.70, then the 1.0.62 replica), and the line before the first one.
const LINE_1070 = '{"ts":"2026-10-27T05:01:22.717Z","src":"shell","pid":52008,"ver":"1.0.70","lvl":"info","msg":"auth: inline auth flow","ctx":{"method":"grok.com","headless":false,"reauth":false,"use_oauth":true}}';
const LINE_1062 = '{"ts":"2026-10-27T05:26:02.723Z","src":"shell","pid":52812,"ver":"1.0.62","lvl":"info","msg":"auth: inline auth flow","ctx":{"method":"grok.com","headless":false,"reauth":false,"use_oauth":true}}';
const LINE_BEFORE = '{"ts":"2026-10-27T05:01:22.717Z","src":"shell","pid":52008,"ver":"1.0.70","lvl":"info","msg":"auth started","ctx":{"method":"grok.com"}}';
// The measured line stamped now — what a grok started after the watch writes (the verbatim one is an earlier process's).
const fresh = (pid = 52008) => LINE_1070.replace('"2026-10-27T05:01:22.717Z"', JSON.stringify(new Date().toISOString())).replace('52008', String(pid));

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  return cond();
};

describe('the probes read grok\'s log as the server does', () => {
  it('the same message and the same file', () => {
    expect(probe.SIGN_IN_MESSAGE).toBe(server.SIGN_IN_MESSAGE);
    const home = mkdtempSync(join(tmpdir(), 'sign-in-stop-'));
    dirs.push(home);
    expect(probe.signInLogFor(home)).toBe(server.signInLogFor(home));
  });

  it('the same verdict on every line, for every pid', () => {
    const lines = [
      LINE_1070, LINE_1062, LINE_BEFORE, `${LINE_1070}${CR}`, LINE_1070.slice(0, -1), '',
      'note: auth: inline auth flow pid 52008',
      '{"pid":52008,"msg":"x","ctx":{"msg":"auth: inline auth flow"}}',
      '{"pid":"52008","msg":"auth: inline auth flow"}',
      '{"msg":"auth: inline auth flow","pid":52008}',
      '["auth: inline auth flow", 52008]',
      'null', '"auth: inline auth flow"',
      '{"ts":"not a time","pid":52008,"msg":"auth: inline auth flow"}',
      '{"ts":1793077282717,"pid":52008,"msg":"auth: inline auth flow"}',
      LINE_1070.replace('"src":"shell"', '"src":"mcp"'), LINE_1070.replace('"src":"shell",', ''),
      LINE_1070.replace('"reauth":false', '"reauth":true'), LINE_1070.replace('"reauth":false,', ''),
      LINE_1070.replace('"reauth":false', '"reauth":"true"'),
    ];
    const at = Date.parse('2026-10-27T05:01:22.717Z');
    for (const line of lines) {
      for (const pid of [52008, 52812, 1]) {
        for (const notBefore of [undefined, 0, at, at + 1]) {
          expect(probe.isSignInLine(line, pid, notBefore), `${line} / ${pid} / ${notBefore}`)
            .toBe(server.isSignInLine(line, pid, notBefore));
        }
      }
    }
    expect(probe.isSignInLine(LINE_1070, 52008)).toBe(true);
    expect(probe.isSignInLine(LINE_1070, 52008, at + 1)).toBe(false);
  });
});

describe('watchSignIn', () => {
  const scratch = () => {
    const d = mkdtempSync(join(tmpdir(), 'sign-in-stop-'));
    dirs.push(d);
    const log = join(d, 'unified.jsonl');
    writeFileSync(log, LINE_1070 + NL); // a line from before the watch — not this run's
    return log;
  };
  it('fires once on this grok\'s line written after it started, and not on what was there', async () => {
    const log = scratch();
    let fired = 0;
    const w = probe.watchSignIn(log, () => 52008, () => { fired += 1; }, 10);
    try {
      await new Promise((r) => setTimeout(r, 80));
      expect(fired).toBe(0);
      const line = fresh();
      appendFileSync(log, LINE_BEFORE + NL + line.slice(0, 50));
      await new Promise((r) => setTimeout(r, 80));
      expect(fired).toBe(0);
      appendFileSync(log, line.slice(50) + NL);
      expect(await until(() => fired > 0)).toBe(true);
      await new Promise((r) => setTimeout(r, 60));
      expect(fired).toBe(1);
    } finally { w.stop(); }
  });
  // Each negative ends with a line it must take, so it cannot pass with no tick run (pre-merge review).
  it('ignores another grok, then takes its own', async () => {
    const log = scratch();
    let fired = 0;
    const w = probe.watchSignIn(log, () => 4242, () => { fired += 1; }, 10);
    try {
      appendFileSync(log, fresh() + NL + fresh(52812) + NL);
      await new Promise((r) => setTimeout(r, 120));
      expect(fired).toBe(0);
      appendFileSync(log, fresh(4242) + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  it('ignores an earlier same-pid line in a replacing log, then takes a new one', async () => {
    const replaced = scratch();
    writeFileSync(replaced, (LINE_BEFORE + NL).repeat(20));
    let fired = 0;
    const w = probe.watchSignIn(replaced, () => 52008, () => { fired += 1; }, 10);
    try {
      writeFileSync(replaced, LINE_1070 + NL);
      await new Promise((r) => setTimeout(r, 120));
      expect(fired).toBe(0);
      appendFileSync(replaced, fresh() + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  it('nothing fires once stopped', async () => {
    const log = scratch();
    let fired = 0;
    const w = probe.watchSignIn(log, () => 52008, () => { fired += 1; }, 10);
    w.stop();
    appendFileSync(log, fresh() + NL);
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(0);
  });
});

const NO_SUCH_PID = 2_000_000_000;
const EXITED = [{ exitCode: 0 }, { exitCode: 1 }, { signalCode: 'SIGKILL' }];
const fakeChild = (over: Record<string, unknown> = {}) => {
  const kills: unknown[] = [];
  return { kills, child: { pid: NO_SUCH_PID, exitCode: null, signalCode: null, kill: (s: unknown) => { kills.push(s); return true; }, ...over } };
};
// process.kill watched, so a group kill shows even where it fails (a pid no system hands out — then grok itself is the
// fallback, and a test reading only that could not tell the group was tried: pre-merge review).
const watchingProcessKill = (fn: () => void) => {
  const calls: unknown[][] = [];
  const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    calls.push([pid, signal]);
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  }) as typeof process.kill);
  try { fn(); } finally { spy.mockRestore(); }
  return calls;
};
const lastListener = (signal: 'SIGINT' | 'SIGTERM') => {
  const all = process.listeners(signal);
  return all[all.length - 1] as (s: string) => void;
};

describe('stopTree', () => {
  // win32: a grok that has exited has a pid Windows may already have given to something else — `taskkill /T` would take
  // that process's whole tree (pre-merge review; the measurement watcher of this PR killed an unrelated firefox.exe so).
  it.skipIf(process.platform !== 'win32')('win32: kills nothing once grok has exited', () => {
    for (const over of EXITED) {
      const { kills, child } = fakeChild(over);
      sync.calls.length = 0;
      probe.stopTree(child, { detached: true });
      expect(kills, JSON.stringify(over)).toEqual([]);
      expect(sync.calls, JSON.stringify(over)).toEqual([]);
    }
  });
  it.skipIf(process.platform !== 'win32')('win32: taskkill /T for a running grok, and grok itself when taskkill fails', () => {
    for (const [status, killed] of [[0, []], [128, ['SIGKILL']]] as const) {
      const { kills, child } = fakeChild();
      sync.calls.length = 0;
      sync.status = status;
      probe.stopTree(child);
      expect(sync.calls).toEqual([['taskkill', ['/T', '/F', '/PID', String(NO_SUCH_PID)]]]);
      expect(kills).toEqual(killed);
    }
    sync.status = 0;
  });
  it.skipIf(process.platform === 'win32')('POSIX: a running grok — through its group when it leads one, alone otherwise', () => {
    for (const detached of [true, false]) {
      const { kills, child } = fakeChild();
      sync.calls.length = 0;
      const groupKills = watchingProcessKill(() => probe.stopTree(child, { detached }));
      expect(groupKills, String(detached)).toEqual(detached ? [[-NO_SUCH_PID, 'SIGKILL']] : []);
      expect(kills, String(detached)).toEqual(['SIGKILL']); // after the failed group kill, or alone
      expect(sync.calls).toEqual([]);
    }
  });
  // POSIX keeps no pid-reuse hazard here: a process-group id is not reissued while any member of the group lives, and a
  // member holding grok's pipes is exactly why the group is stopped after grok exited (spawnBounded's grace does the same).
  // grok itself is not signalled then — Node's handle is gone, so that would do nothing anyway.
  it.skipIf(process.platform === 'win32')('POSIX: after grok exited, its group is still stopped, grok itself is not', () => {
    for (const over of EXITED) {
      for (const detached of [true, false]) {
        const { kills, child } = fakeChild(over);
        const groupKills = watchingProcessKill(() => probe.stopTree(child, { detached }));
        expect(groupKills, `${JSON.stringify(over)} ${detached}`).toEqual(detached ? [[-NO_SUCH_PID, 'SIGKILL']] : []);
        expect(kills, `${JSON.stringify(over)} ${detached}`).toEqual([]);
      }
    }
  });
  // The pre-merge review measured it: a stand-in grok that exited at once and left a 20 s child on its stdout and stderr
  // held a 2 s probe cap open for 20 s once the exit guard also covered the group kill. Here the child lives 10 s.
  it.skipIf(process.platform === 'win32')('POSIX: a descendant holding grok\'s pipes after grok exited goes with the group', async () => {
    const standIn = "const { spawn } = require('node:child_process');"
      + " spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();";
    const child = spawn(process.execPath, ['-e', standIn], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume();
    child.stderr.resume();
    const closedAt = new Promise<number>((res) => child.on('close', () => res(Date.now())));
    await new Promise((res) => child.on('exit', res));
    expect(child.exitCode).toBe(0);
    const t0 = Date.now();
    probe.stopTree(child, { detached: true });
    expect((await closedAt) - t0).toBeLessThan(3000);
  }, 20_000);
});

// The probes' watch reads synchronously: a blocking open of a FIFO there would stop the whole probe, its cap included —
// so it runs in a child here, and the test ends that child itself if it never answers (pre-merge review).
describe('watchSignIn and a FIFO at the log path', () => {
  it.skipIf(process.platform === 'win32')('does not block the probe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sign-in-stop-'));
    dirs.push(dir);
    const log = join(dir, 'unified.jsonl');
    execFileSync('mkfifo', [log]);
    const script = join(dir, 'watch.mjs');
    writeFileSync(script, `import { watchSignIn } from ${JSON.stringify(new URL('../scripts/sign-in-stop.mjs', import.meta.url).href)};${NL}`
      + `const w = watchSignIn(process.argv[2], () => 1, () => {}, 10);${NL}`
      + `setTimeout(() => { w.stop(); process.stdout.write('alive'); process.exit(0); }, 300);${NL}`);
    const child = spawn(process.execPath, [script, log], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await new Promise((res) => child.on('close', res));
    clearTimeout(killer);
    expect(out).toBe('alive');
  }, 15_000);
});

// The four probes that start grok with a throwaway home wire both in — read from their source, as spawn-safety.test.ts
// reads the server's, since each needs a grok to run. probe:home already had a SIGINT handler that exits, and Node runs
// listeners in the order they were added, so one added per run would never run there: that handler stops the live groks.
describe('the probes use the watch and the signal stop', () => {
  const source = (file: string) => readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
  it.each(['worker-marker-probe.mjs', 'probe-expired-session.mjs', 'probe-unauth-device-flow.mjs'])('%s', (file) => {
    const src = source(file);
    expect(src).toMatch(/watchSignIn\(signInLogFor\(/);
    expect(src).toMatch(/stopTreeOnSignal\(\(\) => child, /);
    expect(src.split('offSignal()').length - 1).toBeGreaterThan(0);
    expect(src).not.toMatch(/process\.on\('SIG/);
  });
  it('probe-home-lookup.mjs', () => {
    const src = source('probe-home-lookup.mjs');
    expect(src).toMatch(/watchSignIn\(signInLogFor\(/);
    expect(src).toMatch(/live\.add\(child\)/);
    expect(src).toMatch(/live\.delete\(child\)/);
    expect(src).toMatch(/process\.on\('SIGINT', \(\) => \{\s+for \(const c of live\) stopTree\(c\);/);
    expect(src.split("process.on('SIG").length - 1).toBe(1);
  });
});

// Interrupting a probe must not leave grok behind: on POSIX a detached grok leads its own session, so the terminal's
// SIGINT does not reach it, and the log watch ends with the probe — a grok waiting at a sign-in would keep its window
// (pre-merge review). The handlers are called directly; emitting a real signal would reach the test runner's own.
describe('stopTreeOnSignal', () => {
  it('exits as the signal would; removed, it leaves no handler behind', () => {
    const before = { SIGINT: process.listeners('SIGINT').length, SIGTERM: process.listeners('SIGTERM').length };
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      const exits: unknown[] = [];
      const off = probe.stopTreeOnSignal(() => undefined, { detached: false }, (c: number) => { exits.push(c); });
      try {
        expect(process.listeners(signal).length, signal).toBe(before[signal] + 1);
        lastListener(signal)(signal);
        expect(exits, signal).toEqual([code]);
      } finally {
        off();
      }
      expect(process.listeners('SIGINT').length).toBe(before.SIGINT);
      expect(process.listeners('SIGTERM').length).toBe(before.SIGTERM);
    }
  });
  it('stops the child it is given at the moment of the signal, with the probe\'s options', () => {
    let current: unknown;
    const off = probe.stopTreeOnSignal(() => current, { detached: true }, () => {});
    try {
      sync.calls.length = 0;
      current = undefined; // not spawned yet: nothing to stop
      const nothing = watchingProcessKill(() => lastListener('SIGINT')('SIGINT'));
      expect([nothing, sync.calls]).toEqual([[], []]);
      const { kills, child } = fakeChild();
      current = child;
      if (process.platform === 'win32') {
        lastListener('SIGINT')('SIGINT');
        expect(sync.calls).toEqual([['taskkill', ['/T', '/F', '/PID', String(NO_SUCH_PID)]]]);
        expect(kills).toEqual([]);
      } else {
        expect(watchingProcessKill(() => lastListener('SIGINT')('SIGINT'))).toEqual([[-NO_SUCH_PID, 'SIGKILL']]);
      }
    } finally {
      off();
    }
  });
});
