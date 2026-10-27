import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSignInLine, startSignInWatch, signInLogFor, SIGN_IN_MESSAGE } from '../src/sign-in-watch.js';

// A68 (docs/10). MEASURED 2026-10-27, win32, grok 1.0.62 / 1.0.67 / 1.0.70, quota 0: a headless run whose session the
// server rejects deletes auth.json, logs this line to <GROK_HOME>/logs/unified.jsonl, opens the default browser on
// auth.x.ai/oauth2/authorize about 20 ms later, and then waits with nothing on stdout or stderr — still waiting at 340 s on
// all three versions. These two lines are verbatim from those runs (1.0.70, then the 1.0.62 replica of the 10-17 probe).
const LINE_1070 = '{"ts":"2026-10-27T05:01:22.717Z","src":"shell","pid":52008,"ver":"1.0.70","lvl":"info","msg":"auth: inline auth flow","ctx":{"method":"grok.com","headless":false,"reauth":false,"use_oauth":true}}';
const LINE_1062 = '{"ts":"2026-10-27T05:26:02.723Z","src":"shell","pid":52812,"ver":"1.0.62","lvl":"info","msg":"auth: inline auth flow","ctx":{"method":"grok.com","headless":false,"reauth":false,"use_oauth":true}}';
// The line before it in the same 1.0.70 log — the same pid, not the sign-in.
const LINE_BEFORE = '{"ts":"2026-10-27T05:01:22.717Z","src":"shell","pid":52008,"ver":"1.0.70","lvl":"info","msg":"auth started","ctx":{"method":"grok.com"}}';
// The measured line with its time set to now — what a grok started by this run writes. The watcher counts only lines
// stamped after it started, so the verbatim lines above (stamped 2026-10-27) are what an EARLIER process left.
const fresh = (pid = 52008) => LINE_1070.replace('"2026-10-27T05:01:22.717Z"', JSON.stringify(new Date().toISOString())).replace('52008', String(pid));
const NL = String.fromCharCode(10);

const dirs: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'sign-in-watch-'));
  dirs.push(d);
  return d;
};
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  return cond();
};

describe('A68 — isSignInLine', () => {
  it('matches the measured line for its own pid, on both versions', () => {
    expect(SIGN_IN_MESSAGE).toBe('auth: inline auth flow');
    expect(isSignInLine(LINE_1070, 52008)).toBe(true);
    expect(isSignInLine(LINE_1062, 52812)).toBe(true);
  });
  it('another grok\'s line in the same shared log is not this run\'s', () => {
    expect(isSignInLine(LINE_1070, 52812)).toBe(false);
  });
  it('other messages of the same grok, text that only quotes the message, and nested fields do not match', () => {
    expect(isSignInLine(LINE_BEFORE, 52008)).toBe(false);
    expect(isSignInLine('note: auth: inline auth flow pid 52008', 52008)).toBe(false);
    expect(isSignInLine('{"pid":52008,"msg":"x","ctx":{"msg":"auth: inline auth flow"}}', 52008)).toBe(false);
    expect(isSignInLine('{"pid":"52008","msg":"auth: inline auth flow"}', 52008)).toBe(false);
    expect(isSignInLine(`${LINE_1070.slice(0, -1)}`, 52008)).toBe(false);
  });
  it('a CRLF ending still reads as the line', () => {
    expect(isSignInLine(`${LINE_1070}${String.fromCharCode(13)}`, 52008)).toBe(true);
  });
  it('with a start time, a line stamped before it — or with no readable stamp — is not this run\'s', () => {
    const at = Date.parse('2026-10-27T05:01:22.717Z');
    expect(isSignInLine(LINE_1070, 52008, at)).toBe(true);
    expect(isSignInLine(LINE_1070, 52008, at + 1)).toBe(false);
    expect(isSignInLine('{"pid":52008,"msg":"auth: inline auth flow"}', 52008, 0)).toBe(false);
    expect(isSignInLine('{"ts":"not a time","pid":52008,"msg":"auth: inline auth flow"}', 52008, 0)).toBe(false);
    expect(isSignInLine('{"ts":1793077282717,"pid":52008,"msg":"auth: inline auth flow"}', 52008, 0)).toBe(false);
  });
});

describe('A68 — signInLogFor', () => {
  it('names logs/unified.jsonl under the grok home', () => {
    const home = scratch();
    expect(signInLogFor(home)).toBe(join(home, 'logs', 'unified.jsonl'));
  });
});

describe('A68 — startSignInWatch', () => {
  it('fires on a matching line appended after it started', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, LINE_BEFORE + NL);
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    try {
      appendFileSync(log, fresh() + NL);
      expect(await until(() => fired > 0)).toBe(true);
      await new Promise((r) => setTimeout(r, 60));
      expect(fired).toBe(1);
    } finally { w.stop(); }
  });
  it('ignores what the log already held when it started (an earlier run of a reused pid)', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, fresh() + NL);
    await new Promise((r) => setTimeout(r, 5));
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    try {
      appendFileSync(log, LINE_BEFORE + NL);
      await new Promise((r) => setTimeout(r, 150));
      expect(fired).toBe(0);
    } finally { w.stop(); }
  });
  it('ignores another grok writing to the same log', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, '');
    let fired = 0;
    const w = startSignInWatch(log, () => 4242, () => { fired += 1; }, 10);
    try {
      appendFileSync(log, fresh() + NL + fresh(52812) + NL);
      await new Promise((r) => setTimeout(r, 150));
      expect(fired).toBe(0);
    } finally { w.stop(); }
  });
  it('joins a line written in two pieces', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, '');
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    try {
      const line = fresh();
      appendFileSync(log, line.slice(0, 70));
      await new Promise((r) => setTimeout(r, 80));
      expect(fired).toBe(0);
      appendFileSync(log, line.slice(70) + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  it('a log grok creates only after the run started is read from its start', async () => {
    const dir = scratch();
    const log = join(dir, 'logs', 'unified.jsonl');
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      mkdirSync(join(dir, 'logs'));
      writeFileSync(log, LINE_BEFORE + NL + fresh() + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  it('a log replaced by a shorter one is read from the new start', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, (LINE_BEFORE + NL).repeat(20));
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    try {
      writeFileSync(log, fresh() + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  // Grok's falsification of the first version: read from its first byte, a replaced log — or one that was not there
  // when the watch started — can hold a line an earlier process with the same (reused) pid left. It is not this run's.
  it('an earlier same-pid line in a replacing log, or in a log that appeared later, does not fire', async () => {
    const replaced = join(scratch(), 'unified.jsonl');
    writeFileSync(replaced, (LINE_BEFORE + NL).repeat(20));
    const appeared = join(scratch(), 'unified.jsonl');
    let fired = 0;
    const w1 = startSignInWatch(replaced, () => 52008, () => { fired += 1; }, 10);
    const w2 = startSignInWatch(appeared, () => 52008, () => { fired += 1; }, 10);
    try {
      writeFileSync(replaced, LINE_1070 + NL);
      writeFileSync(appeared, LINE_1070 + NL);
      await new Promise((r) => setTimeout(r, 150));
      expect(fired).toBe(0);
    } finally { w1.stop(); w2.stop(); }
  });
  it('does not fire before the pid is known, and fires once it is', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, '');
    let pid: number | undefined;
    let fired = 0;
    const w = startSignInWatch(log, () => pid, () => { fired += 1; }, 10);
    try {
      appendFileSync(log, fresh() + NL);
      await new Promise((r) => setTimeout(r, 80));
      expect(fired).toBe(0);
      pid = 52008;
      appendFileSync(log, fresh() + NL);
      expect(await until(() => fired > 0)).toBe(true);
    } finally { w.stop(); }
  });
  it('stops reading once stopped', async () => {
    const log = join(scratch(), 'unified.jsonl');
    writeFileSync(log, '');
    let fired = 0;
    const w = startSignInWatch(log, () => 52008, () => { fired += 1; }, 10);
    w.stop();
    appendFileSync(log, fresh() + NL);
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(0);
  });
});
