/**
 * The request-size limit `docs/04` states, against the COMMITTED BUNDLE.
 *
 * The limit is not ours: since 1.30.0 the MCP SDK's stdio read buffer refuses to grow past
 * 10 × 1024 × 1024 bytes (`STDIO_DEFAULT_MAX_BUFFER_SIZE`, kept by SDK v2), and `index.ts` serves
 * through `serveStdio`, which opens the transport with that default. When the bytes held for an unfinished line plus the
 * chunk just read would cross it, the SDK drops the buffer and closes the transport; this server sets
 * no `onerror`, so nothing is logged and nothing answers again. MEASURED 2026-10-09 (v0.2.41
 * candidate; the pre-merge review saw the same on Linux): a line written on its own, exactly
 * 10,485,760 bytes with its newline, was answered and one byte more was not; a line 512 KiB over
 * ended the process with exit 0. The v0.2.40 bundle (SDK 1.29.0) answered all of them. These cases
 * pin docs/04's first two items on both CI platforms — the byte counting too, with lines padded in
 * Hangul (three UTF-8 bytes per character) at the limit and one byte over — so if an SDK bump moves
 * the boundary, counts something other than bytes, or the server starts logging the error, the doc
 * has to move with it. docs/04's other items (answers to calls already running, when a process just
 * over the limit ends, a following message in the same read) are observations this file does not
 * check; docs/04 says how each was measured.
 *
 * Nothing here spawns grok: grok_build_route is a pure local decision, and the bundle gets a
 * throwaway HOME / USERPROFILE / GROK_HOME (the same isolation as worker-guard.test.ts).
 *
 * MCP 2.0 plan, Review Focus 5: every case runs in both protocol eras. The 2026-07-28 session opens with
 * `server/discover` instead of `initialize`, and each request carries the revision in `params._meta` — counted in the
 * line's bytes, like everything else on it. The limit and how each case ends must be the same in both. A case fails
 * unless its opening is answered in its era — an SDK v1 bundle answers discover with -32601, and a silent or exiting
 * bundle answers nothing — so no case can pass while its bytes went to a server that never opened (review of PR #231).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundlePath } from './bundle-client.js';

const dist = bundlePath;
const fakeHome = mkdtempSync(join(tmpdir(), 'stdio-limit-home-'));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

const LIMIT = 10 * 1024 * 1024;

type Era = 'legacy' | 'modern';
/** What a 2026-07-28 request carries in `params._meta` (rpc-era.mjs builds the same). */
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'stdio-limit-test', version: '0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

interface ToolResult { isError?: boolean; content?: { type: string; text: string }[] }
interface Outcome {
  answers: Map<number, ToolResult>;
  exit?: { code: number | null; signal: NodeJS.Signals | null };
  stderr: string;
}

/**
 * A grok_build_route request whose whole line, newline included, is exactly `bytes` UTF-8 bytes
 * long, its task padded with ASCII — or, with `hangul`, mostly with a three-byte Hangul syllable
 * (JSON.stringify leaves it unescaped), so the line is about a third as many UTF-16 units as bytes.
 */
function routeLine(id: number, bytes: number, hangul = false, era: Era = 'legacy'): string {
  const meta = era === 'modern' ? { _meta: MODERN_META } : {};
  const make = (task: string) =>
    JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'grok_build_route', arguments: { task }, ...meta } }) + '\n';
  const room = bytes - Buffer.byteLength(make(''));
  if (!hangul) return make('a'.repeat(room));
  const syllable = String.fromCharCode(0xac00);
  return make(syllable.repeat(Math.floor(room / 3)) + 'a'.repeat(room % 3));
}

/**
 * The opening (legacy: initialize -> initialized; modern: server/discover) -> each of `writes` (one stdin write each,
 * `afterMs` after the previous one). Settles when `until` holds, when the process ends, or after `watchMs`, then
 * kills it.
 */
function drive(writes: { afterMs: number; data: string }[], watchMs: number, until: (o: Outcome) => boolean, era: Era = 'legacy'): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: fakeHome, USERPROFILE: fakeHome, GROK_HOME: join(fakeHome, '.grok'),
      GROK_BUILD_AUTH_MODE: 'subscription',
    };
    delete env.GROK_BUILD_WORKER;
    const child = spawn(process.execPath, [dist], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out: Outcome = { answers: new Map(), stderr: '' };
    let settled = false;
    let opened = false;
    const timers: NodeJS.Timeout[] = [];
    const fail = (why: string) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      if (out.exit === undefined) child.kill();
      reject(new Error(why));
    };
    // No outcome counts before the opening was answered in its era: a silent or exiting bundle would otherwise pass
    // every case that asserts silence or an exit (review of PR #231).
    const settle = () => {
      if (!opened) {
        const ended = out.exit ? ` (it exited with code ${String(out.exit.code)})` : '';
        fail(`the bundle did not answer the ${era} opening${ended}`);
        return;
      }
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      if (out.exit === undefined) child.kill();
      resolve(out);
    };
    timers.push(setTimeout(settle, watchMs));
    // The process may end while a long line is still being written — that EPIPE is part of the
    // behaviour under test, not a failure of the harness.
    child.stdin.on('error', () => {});
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { out.stderr += chunk; });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id?: number; result?: ToolResult & { protocolVersion?: unknown; supportedVersions?: unknown } };
        if (msg.id === 1) {
          const offered = msg.result?.supportedVersions;
          const inEra = era === 'legacy'
            ? typeof msg.result?.protocolVersion === 'string'
            : Array.isArray(offered) && offered.includes(MODERN_META['io.modelcontextprotocol/protocolVersion']);
          if (!inEra) {
            fail(`the bundle did not open the ${era} era: ${line.slice(0, 200)}`);
            return;
          }
          opened = true;
          if (era === 'legacy') child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          let at = 0;
          for (const w of writes) {
            at += w.afterMs;
            timers.push(setTimeout(() => { if (!settled) child.stdin.write(w.data); }, at));
          }
        } else if (typeof msg.id === 'number') {
          out.answers.set(msg.id, msg.result ?? {});
          if (until(out)) settle();
        }
      }
    });
    child.on('exit', (code, signal) => { out.exit = { code, signal }; settle(); });
    child.on('error', (e) => { for (const t of timers) clearTimeout(t); reject(e); });
    child.stdin.write(JSON.stringify(era === 'legacy'
      ? {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-limit-test', version: '0' } },
      }
      : { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: MODERN_META } }) + '\n');
  });
}

describe.each(['legacy', 'modern'] as const)('docs/04 request-size limit — the committed bundle over stdio (%s era)', (era) => {
// 600 bytes: room for the 2026 envelope (192 bytes on its own with this file's clientInfo) as well as a short task.
const small = (id: number) => routeLine(id, 600, false, era);

// How long this machine took to answer a 10 MiB line (set by the first case). The silent cases wait
// several times that: on a loaded machine a bundle that wrongly ACCEPTED the line could answer after
// a fixed window, and the silence they assert would then be vacuous (measured: with other work on the
// machine, a bundle whose limit was one byte higher passed a fixed 6 s window). Without that
// measurement (the first case filtered out or skipped) they wait the longest window.
let exactLimitMs = 0;
const silenceWindow = () => (exactLimitMs > 0 ? Math.min(50_000, Math.max(6_000, 4 * exactLimitMs)) : 50_000);

  it('answers a line of exactly 10 MiB, newline included', async () => {
    const t0 = Date.now();
    const out = await drive([{ afterMs: 0, data: routeLine(2, LIMIT, false, era) }], 30_000, (o) => o.answers.has(2), era);
    exactLimitMs = Date.now() - t0;
    expect(out.answers.has(2)).toBe(true);
    expect(out.answers.get(2)?.isError).toBeFalsy();
    expect(JSON.parse(out.answers.get(2)?.content?.[0]?.text ?? '{}')).toHaveProperty('nextAction');
  }, 60_000);

  it('one byte over: no answer to it or to a request after it, and nothing logged', async () => {
    const out = await drive(
      [{ afterMs: 0, data: routeLine(2, LIMIT + 1, false, era) }, { afterMs: 1_000, data: small(3) }],
      silenceWindow(),
      () => false,
      era,
    );
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);

  // The limit in a line that is about a third as many characters as bytes. Exactly at the limit it is
  // answered — a count that weighs a multi-byte character MORE than its bytes would refuse it — and
  // one byte over it is not — a count in UTF-16 units or characters would answer it.
  it('a Hangul line of exactly 10 MiB is answered', async () => {
    const line = routeLine(2, LIMIT, true, era);
    expect(Buffer.byteLength(line)).toBe(LIMIT);
    const out = await drive([{ afterMs: 0, data: line }], 30_000, (o) => o.answers.has(2), era);
    // An answer must exist — `answers.get(2)?.isError` alone is falsy when nothing answered (this
    // case's first draft asserted only that, and a bundle that over-weighed multi-byte characters
    // passed it by refusing the line).
    expect(out.answers.has(2)).toBe(true);
    expect(out.answers.get(2)?.isError).toBeFalsy();
    expect(JSON.parse(out.answers.get(2)?.content?.[0]?.text ?? '{}')).toHaveProperty('nextAction');
  }, 60_000);

  // The line is written behind a short message in the same write: on its own it arrived (win32) in
  // 160 reads of 64 KiB plus a final read holding only its newline, so the read that crossed the
  // limit carried no Hangul, and a count that took only the NEWEST read in characters passed (review
  // of v0.2.41). Shifted, the crossing read carries Hangul bytes.
  it('one byte over in Hangul: the limit counts UTF-8 bytes, not characters', async () => {
    const line = routeLine(2, LIMIT + 1, true, era);
    expect(Buffer.byteLength(line)).toBe(LIMIT + 1);
    expect(line.length).toBeLessThan(LIMIT / 2);
    const shift = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n';
    const out = await drive([{ afterMs: 0, data: shift + line }, { afterMs: 1_000, data: small(3) }], silenceWindow(), () => false, era);
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);

  it('far over: the process ends with exit 0, without an answer or a log line', async () => {
    const out = await drive([{ afterMs: 0, data: routeLine(2, LIMIT + 512 * 1024, false, era) }], 30_000, () => false, era);
    expect(out.exit?.code).toBe(0);
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);
});
