/**
 * The request-size limit `docs/04` states, against the COMMITTED BUNDLE.
 *
 * The limit is not ours: since 1.30.0 the MCP SDK's stdio read buffer refuses to grow past
 * 10 MiB (`STDIO_DEFAULT_MAX_BUFFER_SIZE`), and `index.ts` builds `new StdioServerTransport()` with
 * the default. When a request's line would cross it, the SDK drops the buffer and closes the
 * transport; this server sets no `onerror`, so nothing is logged, nothing answers, and with stdin
 * released the process ends. MEASURED 2026-10-09 on win32 (v0.2.41 candidate): 10.1 MiB ended the
 * process with exit 0 and an empty stderr; 9.9 MiB was answered; the v0.2.40 bundle (SDK 1.29.0)
 * answered 10.1 MiB. This file keeps the documented boundary true on both CI platforms — if an SDK
 * bump moves it, or the server starts logging the error, the doc has to move with it.
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

const MiB = 1024 * 1024;

interface ToolResult { isError?: boolean; content?: { type: string; text: string }[] }
interface Outcome { result?: ToolResult; exit?: { code: number | null; signal: NodeJS.Signals | null }; stderr: string }

/**
 * initialize -> initialized -> one grok_build_route call whose `task` is `taskBytes` long. Settles
 * on the call's answer (then kills the process) or on the process ending, whichever comes first.
 */
function routeCall(taskBytes: number): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: fakeHome, USERPROFILE: fakeHome, GROK_HOME: join(fakeHome, '.grok'),
      GROK_BUILD_AUTH_MODE: 'subscription',
    };
    delete env.GROK_BUILD_WORKER;
    const child = spawn(process.execPath, [dist], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;
    const settle = (o: Omit<Outcome, 'stderr'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...o, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the bundle neither answered nor ended within 30s'));
    }, 30_000);
    // The process may end while the large line is still being written — that EPIPE is the
    // behaviour under test, not a failure of the harness.
    child.stdin.on('error', () => {});
    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
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
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'grok_build_route', arguments: { task: 'a'.repeat(taskBytes) } } });
        } else if (msg.id === 2) {
          child.kill();
          settle({ result: msg.result ?? {} });
        }
      }
    });
    child.on('exit', (code, signal) => settle({ exit: { code, signal } }));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-limit-test', version: '0' } },
    });
  });
}

describe('docs/04 request-size limit — the committed bundle over stdio', () => {
  it('answers a request just under 10 MiB', async () => {
    const out = await routeCall(Math.floor(9.5 * MiB));
    expect(out.exit).toBeUndefined();
    expect(out.result?.isError).toBeFalsy();
    expect(JSON.parse(out.result?.content?.[0]?.text ?? '{}')).toHaveProperty('nextAction');
  }, 60_000);

  it('ends without an answer or a log line when one request crosses 10 MiB', async () => {
    const out = await routeCall(Math.floor(10.5 * MiB));
    expect(out.result).toBeUndefined();
    expect(out.exit).toBeDefined();
    expect(out.stderr).toBe('');
  }, 60_000);
});
