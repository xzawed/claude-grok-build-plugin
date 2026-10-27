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
// `calls` fills as the kills happen, so a caller can read it from inside fn.
const watchingProcessKill = (fn: () => void, calls: unknown[][] = []) => {
  const spy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: string | number) => {
    calls.push([pid, signal]);
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
  }) as typeof process.kill);
  try { fn(); } finally { spy.mockRestore(); }
  return calls;
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
  // POSIX: a process-group id is not reissued while any member of the group lives, and a member holding grok's pipes is
  // exactly why the group is stopped after grok exited (spawnBounded's grace does the same). Once every member is gone a
  // reused pid could lead a new group — the case stopTree's comment names. grok itself is not signalled then: Node's
  // handle is gone, so that would do nothing anyway.
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
  const count = (src: string, s: string) => src.split(s).length - 1;
  // Every reference to the watch and to the remover, whatever its spelling — not only the calls (pre-merge review: a stray
  // `signIn.stop()` right after the spawn, which is A68 itself, and `child.on('exit', offSignal)` both slipped past).
  const refs = (src: string, name: string) => (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
  // Each path is read where it is, not counted overall (pre-merge review: a close path that dropped both the watch stop
  // and the handler removal, or a removal moved to before grok had ended, kept the counts and passed). A handler left by
  // an earlier run is called first and exits before a later run's — the review measured a second grok left running so —
  // and one removed too early leaves an interrupt nothing to stop grok with.
  // What the stop wiring takes in, pinned as reviewed — `alive` (a running grok only), the probe's `detached` and its use
  // in the spawn, the watch's log and stop, the cap, and the remover's binding (the last pre-merge check: one-token edits
  // there, such as `===` to `!==` in `alive` or `detached` dropped from the spawn, brought A68 or the POSIX group stop back).
  const ALIVE = 'const alive = () => (child && child.exitCode === null && child.signalCode === null ? child.pid : undefined);';
  const common = (src: string, log: string, spawnOptions: string, cap: RegExp, timerRefs: number) => {
    expect(src).toContain(ALIVE);
    expect(src).toContain("const detached = process.platform !== 'win32';");
    expect(src).toContain(spawnOptions);
    // The watch reads that grok's own log and stops grok's tree with the probe's options — as does the cap, which only
    // grok's end clears.
    expect(src).toContain(`watchSignIn(signInLogFor(${log}), alive, () => { signInStarted = true; stopTree(child, { detached }); }`);
    expect(src).toMatch(cap);
    expect(count(src, 'stopTree(child, { detached })')).toBe(2);
    expect(refs(src, 'timer')).toBe(timerRefs);
    // With the probe's own `detached`, so POSIX stops grok's group (pre-merge review: `{}` there killed grok alone),
    // bound to the remover, and before grok is spawned.
    expect(src).toContain('const offSignal = stopTreeOnSignal(() => child, { detached });');
    expect(count(src, 'stopTreeOnSignal(')).toBe(1);
    expect(src.indexOf('stopTreeOnSignal(() => child, { detached })')).toBeLessThan(src.indexOf('child = spawn('));
    expect(src).not.toMatch(/process\.on\('SIG/);
  };
  const CAP_BLOCK = (limit: string) => new RegExp(
    `const timer = setTimeout\\(\\(\\) => \\{\\s+timedOut = true;\\s+stopTree\\(child, \\{ detached \\}\\);\\s+\\}, ${limit}\\);`,
  );
  it.each([
    ['probe-expired-session.mjs', 'grokHome', "{ env, cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached },", 'TIMEOUT_MS'],
    ['probe-unauth-device-flow.mjs', 'home', '{ env, cwd: home, windowsHide: true, detached },', 'timeoutMs'],
  ])('%s — in its close and its error handler, nowhere else', (file, log, spawnOptions, limit) => {
    const src = source(file);
    common(src, log, spawnOptions, CAP_BLOCK(limit), 3); // the cap, and its clearing in those two handlers
    const onEnd = /child\.on\('(close|error)', \([^)]*\) => \{\s+clearTimeout\(timer\);\s+signIn\.stop\(\);\s+offSignal\(\);/g;
    expect([...src.matchAll(onEnd)].map((m) => m[1]).sort()).toEqual(['close', 'error']);
    expect([refs(src, 'signIn'), refs(src, 'offSignal')]).toEqual([3, 3]); // each declared once, used in those two
  });
  it('worker-marker-probe.mjs — in done, which its close and its error handler call, nowhere else', () => {
    const src = source('worker-marker-probe.mjs');
    common(src, 'grokHome', "{ env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached });",
      /const timer = setTimeout\(\(\) => stopTree\(child, \{ detached \}\), timeoutMs\);/, 2); // the cap, its clearing in done
    expect(src).toMatch(/const done = \(ran, code\) => \{\s+clearTimeout\(timer\);\s+signIn\.stop\(\);\s+offSignal\(\);\s+resolve\(/);
    expect(src).toContain("child.on('error', () => done(false, null));");
    expect(src).toContain("child.on('close', (code) => done(true, code));");
    expect([refs(src, 'signIn'), refs(src, 'offSignal'), refs(src, 'done')]).toEqual([2, 2, 3]); // declared once; done called twice
  });
  it('probe-home-lookup.mjs — its own handlers, added before the runs, stop the live groks and exit with the code', () => {
    const src = source('probe-home-lookup.mjs');
    expect(src).toContain(ALIVE);
    expect(src).toContain('const signIn = watchSignIn(signInLogFor(watchedHome), alive, () => { signInStarted = true; stopTree(child); });');
    expect(src).toContain('const timer = setTimeout(() => stopTree(child), 90_000);');
    expect(refs(src, 'timer')).toBe(3); // the cap, and its clearing on error and on close
    expect(src).toMatch(/child = spawn\([^;]+;\s+\} catch \{ end\(false\); return; \}\s+live\.add\(child\);/);
    expect(src).toMatch(/const end = \(found\) => \{ signIn\.stop\(\); live\.delete\(child\); done\(found\); \};/);
    // The only `process.exit(code)` after it is its own (bail's is above it), so the lazy match cannot reach past it.
    expect(src).toMatch(/const stopAndLeave = \(code\) => \(\) => \{\s+for \(const c of live\) stopTree\(c\);[\s\S]*?\s+process\.exit\(code\);\s+\};/);
    for (const [signal, code] of [['SIGINT', 130], ['SIGBREAK', 149], ['SIGHUP', 129]]) {
      expect(src).toContain(`process.on('${signal}', stopAndLeave(${code}));`);
    }
    expect(count(src, "process.on('SIG")).toBe(3);
    // At module level between the handler and the runs: measure and grokFound are declared above stopAndLeave, so a
    // registration moved into either comes before it (pre-merge review: one moved into measure, after its runs, passed).
    expect(src.indexOf("process.on('SIG")).toBeGreaterThan(src.indexOf('const stopAndLeave = '));
    expect(src.lastIndexOf("process.on('SIG")).toBeLessThan(src.indexOf('await measure('));
  });
});

// Interrupting a probe must not leave grok behind: on POSIX a detached grok leads its own session, so the terminal's
// SIGINT does not reach it, and the log watch ends with the probe — a grok waiting at a sign-in would keep its window
// (pre-merge review). The handlers are called directly; emitting a real signal would reach the test runner's own.
describe('stopTreeOnSignal', () => {
  const SIGNALS = [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['SIGBREAK', 149]] as const;
  const counts = () => SIGNALS.map(([s]) => process.listeners(s).length);
  // `exit` throws, as process.exit never returns — so what the handler did is what it did BEFORE it exited (pre-merge
  // review: with a no-op exit, a handler that exited first and only then stopped grok passed every test).
  // With the probes' own options: on POSIX each signal must reach grok's group, not only grok (pre-merge review: a
  // handler that dropped the options for one signal left grok's child running after a real SIGHUP — measured).
  it('stops grok\'s tree before it exits, for each signal, and exits with 128 + its number', () => {
    const detached = process.platform !== 'win32';
    for (const [signal, code] of SIGNALS) {
      const { kills, child } = fakeChild();
      sync.calls.length = 0;
      const groupKills: unknown[][] = [];
      const atExit: unknown[] = [];
      const before = process.listeners(signal);
      const off = probe.stopTreeOnSignal(() => child, { detached }, (c: number) => {
        atExit.push([c, groupKills.length, kills.length, sync.calls.length]);
        throw new Error('exited');
      });
      try {
        // Only the handler this call added — never one of the test runner's own.
        const added = process.listeners(signal).filter((l) => !before.includes(l)) as Array<(s: string) => void>;
        expect(added.length, signal).toBe(1);
        watchingProcessKill(() => expect(() => added[0](signal), signal).toThrow('exited'), groupKills);
      } finally {
        off();
      }
      // At the exit — win32: taskkill /T had run (status 0, so grok itself was not killed). POSIX: the group kill of
      // grok's (fake) pid had been tried, had failed, and grok itself had followed.
      expect(atExit, signal).toEqual([detached ? [code, 1, 1, 0] : [code, 0, 0, 1]]);
      expect(groupKills, signal).toEqual(detached ? [[-NO_SUCH_PID, 'SIGKILL']] : []);
    }
  });
  it('removed, it leaves none of its handlers behind and no one else\'s gone (removing twice is harmless)', () => {
    const others = SIGNALS.map(([s]) => [s, () => {}] as const);
    for (const [s, l] of others) process.on(s, l);
    try {
      const before = counts();
      const off = probe.stopTreeOnSignal(() => undefined, {}, () => {});
      expect(counts()).toEqual(before.map((n) => n + 1));
      off();
      off();
      expect(counts()).toEqual(before);
      for (const [s, l] of others) expect(process.listeners(s), s).toContain(l);
    } finally {
      for (const [s, l] of others) process.off(s, l);
    }
  });
  it('stops the child it is given at the moment of the signal, with the probe\'s options', () => {
    let current: unknown;
    const before = process.listeners('SIGINT');
    const off = probe.stopTreeOnSignal(() => current, { detached: true }, () => {});
    try {
      const added = process.listeners('SIGINT').filter((l) => !before.includes(l)) as Array<(s: string) => void>;
      expect(added.length).toBe(1);
      const onSigint = () => added[0]('SIGINT');
      sync.calls.length = 0;
      current = undefined; // not spawned yet: nothing to stop
      const nothing = watchingProcessKill(onSigint);
      expect([nothing, sync.calls]).toEqual([[], []]);
      const { kills, child } = fakeChild();
      current = child;
      if (process.platform === 'win32') {
        onSigint();
        expect(sync.calls).toEqual([['taskkill', ['/T', '/F', '/PID', String(NO_SUCH_PID)]]]);
        expect(kills).toEqual([]);
      } else {
        expect(watchingProcessKill(onSigint)).toEqual([[-NO_SUCH_PID, 'SIGKILL']]);
      }
    } finally {
      off();
    }
  });
});
