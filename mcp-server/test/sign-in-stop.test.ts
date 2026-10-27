/**
 * `scripts/sign-in-stop.mjs` is the probes' copy of `src/sign-in-watch.ts` (the scripts run under plain node and cannot
 * import TypeScript). The two must read grok's log the same way, so they are held to the same lines here; the
 * watcher itself is exercised against a real file, as its source twin is in sign-in-watch.test.ts.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as probe from '../scripts/sign-in-stop.mjs';
import * as server from '../src/sign-in-watch.js';

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
  it('ignores another grok, an earlier same-pid line in a replacing log, and nothing fires once stopped', async () => {
    const log = scratch();
    let fired = 0;
    const w = probe.watchSignIn(log, () => 4242, () => { fired += 1; }, 10);
    appendFileSync(log, fresh() + NL + fresh(52812) + NL);
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(0);
    w.stop();
    const replaced = scratch();
    writeFileSync(replaced, (LINE_BEFORE + NL).repeat(20));
    const w3 = probe.watchSignIn(replaced, () => 52008, () => { fired += 1; }, 10);
    writeFileSync(replaced, LINE_1070 + NL);
    await new Promise((r) => setTimeout(r, 120));
    w3.stop();
    expect(fired).toBe(0);
    const w2 = probe.watchSignIn(log, () => 52008, () => { fired += 1; }, 10);
    w2.stop();
    appendFileSync(log, fresh() + NL);
    await new Promise((r) => setTimeout(r, 120));
    expect(fired).toBe(0);
  });
});
