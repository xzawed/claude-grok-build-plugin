/**
 * The request-size limit `docs/04` states, against the COMMITTED BUNDLE.
 *
 * The limit is not ours: since 1.30.0 the MCP SDK's stdio read buffer refuses to grow past
 * 10 × 1024 × 1024 bytes (`STDIO_DEFAULT_MAX_BUFFER_SIZE`), and `index.ts` builds
 * `new StdioServerTransport()` with the default. When the bytes held for an unfinished line plus the
 * chunk just read would cross it, the SDK drops the buffer and closes the transport; this server sets
 * no `onerror`, so nothing is logged and nothing answers again. MEASURED 2026-10-09 (v0.2.41
 * candidate; the pre-merge review saw the same on Linux): a line written on its own, exactly
 * 10,485,760 bytes with its newline, was answered and one byte more was not; a line 512 KiB over
 * ended the process with exit 0. The v0.2.40 bundle (SDK 1.29.0) answered all of them. These cases
 * pin docs/04's first two items on both CI platforms — the byte counting too, with a line padded in
 * Hangul (three UTF-8 bytes per character) — so if an SDK bump moves the boundary, counts something
 * other than bytes, or the server starts logging the error, the doc has to move with it. docs/04's
 * other items (answers to calls already running, when a process just over the limit ends, a
 * following message in the same read) are observations this file does not check: they depend on
 * where reads split and on the default stream highWaterMark of the Node that runs the server.
 *
 * Nothing here spawns grok: grok_build_route is a pure local decision, and the bundle gets a
 * throwaway HOME / USERPROFILE / GROK_HOME (the same isolation as worker-guard.test.ts).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const fakeHome = mkdtempSync(join(tmpdir(), 'stdio-limit-home-'));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

const LIMIT = 10 * 1024 * 1024;

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
function routeLine(id: number, bytes: number, hangul = false): string {
  const make = (task: string) =>
    JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'grok_build_route', arguments: { task } } }) + '\n';
  const room = bytes - Buffer.byteLength(make(''));
  if (!hangul) return make('a'.repeat(room));
  const syllable = String.fromCharCode(0xac00);
  return make(syllable.repeat(Math.floor(room / 3)) + 'a'.repeat(room % 3));
}

/**
 * initialize -> initialized -> each of `writes` (one stdin write each, `afterMs` after the previous
 * one). Settles when `until` holds, when the process ends, or after `watchMs`, then kills it.
 */
function drive(writes: { afterMs: number; data: string }[], watchMs: number, until: (o: Outcome) => boolean): Promise<Outcome> {
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
    const timers: NodeJS.Timeout[] = [];
    const settle = () => {
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
        const msg = JSON.parse(line) as { id?: number; result?: ToolResult };
        if (msg.id === 1) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
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
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-limit-test', version: '0' } },
    }) + '\n');
  });
}

const small = (id: number) => routeLine(id, 200);

// How long this machine took to answer a 10 MiB line (set by the first case). The silent cases wait
// several times that: on a loaded machine a bundle that wrongly ACCEPTED the line could answer after
// a fixed window, and the silence they assert would then be vacuous (measured: with other work on the
// machine, a bundle whose limit was one byte higher passed a fixed 6 s window). Without that
// measurement (the first case filtered out or skipped) they wait the longest window.
let exactLimitMs = 0;
const silenceWindow = () => (exactLimitMs > 0 ? Math.min(50_000, Math.max(6_000, 4 * exactLimitMs)) : 50_000);

describe('docs/04 request-size limit — the committed bundle over stdio', () => {
  it('answers a line of exactly 10 MiB, newline included', async () => {
    const t0 = Date.now();
    const out = await drive([{ afterMs: 0, data: routeLine(2, LIMIT) }], 30_000, (o) => o.answers.has(2));
    exactLimitMs = Date.now() - t0;
    expect(out.answers.get(2)?.isError).toBeFalsy();
    expect(JSON.parse(out.answers.get(2)?.content?.[0]?.text ?? '{}')).toHaveProperty('nextAction');
  }, 60_000);

  it('one byte over: no answer to it or to a request after it, and nothing logged', async () => {
    const out = await drive(
      [{ afterMs: 0, data: routeLine(2, LIMIT + 1) }, { afterMs: 1_000, data: small(3) }],
      silenceWindow(),
      () => false,
    );
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);

  // The same one byte over, in a line that is about a third as many characters: a limit counted in
  // UTF-16 units or characters instead of bytes would answer it.
  it('one byte over in Hangul: the limit counts UTF-8 bytes, not characters', async () => {
    const line = routeLine(2, LIMIT + 1, true);
    expect(Buffer.byteLength(line)).toBe(LIMIT + 1);
    expect(line.length).toBeLessThan(LIMIT / 2);
    const out = await drive([{ afterMs: 0, data: line }, { afterMs: 1_000, data: small(3) }], silenceWindow(), () => false);
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);

  it('far over: the process ends with exit 0, without an answer or a log line', async () => {
    const out = await drive([{ afterMs: 0, data: routeLine(2, LIMIT + 512 * 1024) }], 30_000, () => false);
    expect(out.exit?.code).toBe(0);
    expect([...out.answers.keys()]).toEqual([]);
    expect(out.stderr).toBe('');
  }, 60_000);
});
