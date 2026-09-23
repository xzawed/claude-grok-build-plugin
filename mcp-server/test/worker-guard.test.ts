/**
 * A34 against the COMMITTED BUNDLE: the process a worker's grok actually starts is
 * `node dist/index.js`, and the only thing it learns about where it runs is its environment.
 *
 * Why a bundle test and not only the in-memory ones in server-tools.test.ts: those pass the
 * worker flag in by hand, so they stay green if index.ts forgets to read GROK_BUILD_WORKER at
 * all — the same shape as the handlers-in-anonymous-closures trap CLAUDE.md records for
 * server.ts. Here the flag can only come from the env, the way grok hands it over (MEASURED
 * 2026-09-24: a variable set on grok's parent reached a grok-started stdio server).
 *
 * Nothing here spawns grok or writes to the real home. The worker case refuses before any
 * dependency runs; the control uses grok_build_route, a pure local decision. And the bundle gets
 * a throwaway HOME / USERPROFILE / GROK_HOME, so that if the guard ever regresses, the delegate
 * call stops at the auth pre-check (no grok session there) instead of reaching a real session
 * and appending a row to the developer's own ~/.grok-build/history.jsonl.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const fakeHome = mkdtempSync(join(tmpdir(), 'worker-guard-home-'));
afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

interface ToolResult { isError?: boolean; content?: { type: string; text: string }[] }

/** The tool's JSON payload. A non-JSON answer (e.g. the plain-text auth refusal) parses to {}. */
function body(res: ToolResult): Record<string, unknown> {
  try { return JSON.parse(res.content?.[0]?.text ?? '') as Record<string, unknown>; } catch { return {}; }
}

/** initialize -> initialized -> one tools/call, over the bundle's real stdio. */
function callBundle(env: NodeJS.ProcessEnv, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('bundle did not answer within 15s')); }, 15_000);
    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
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
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result ?? {});
        }
      }
    });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'worker-guard-test', version: '0' } },
    });
  });
}

/**
 * The runner's env with the marker removed (the suite may itself be running inside a grok worker)
 * and every home redirected to a throwaway directory.
 */
function envWithoutMarker(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fakeHome, USERPROFILE: fakeHome, GROK_HOME: join(fakeHome, '.grok'),
    GROK_BUILD_AUTH_MODE: 'subscription',
  };
  delete env.GROK_BUILD_WORKER;
  return env;
}

describe('A34 — the committed bundle reads GROK_BUILD_WORKER from its environment', () => {
  it('refuses the nested delegation a real worker sent (reproduction payload)', async () => {
    const res = await callBundle({ ...envWithoutMarker(), GROK_BUILD_WORKER: '1' }, 'grok_build_delegate', {
      prompt: 'Create a file named nested.txt containing the single word hi. Do nothing else.',
      cwd: 'C:\\Users\\u\\AppData\\Local\\Temp\\claude\\scratchpad\\a34\\m2c-B',
      timeout_ms: 150000,
    });
    expect(res.isError).toBe(true);
    expect(body(res).reason).toBe('inside_grok_worker');
  }, 30_000);

  it('refuses even a side-effect-free tool when the marker is set', async () => {
    const res = await callBundle({ ...envWithoutMarker(), GROK_BUILD_WORKER: '1' }, 'grok_build_route', { task: 'add tests' });
    expect(res.isError).toBe(true);
    expect(body(res).reason).toBe('inside_grok_worker');
  }, 30_000);

  it('answers normally when the marker is absent — the guard is not "refuse always"', async () => {
    const res = await callBundle(envWithoutMarker(), 'grok_build_route', { task: 'add tests' });
    expect(res.isError).toBeFalsy();
    expect(body(res).reason).toBeUndefined();
    expect(body(res)).toHaveProperty('nextAction');
  }, 30_000);
});
