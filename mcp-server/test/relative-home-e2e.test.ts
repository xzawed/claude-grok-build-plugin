/**
 * A35 against the COMMITTED BUNDLES (`dist/index.js`, `dist/hook.js`): a relative GROK_HOME is
 * resolved against the folder grok will run in, not against the process that asks.
 *
 * Why a bundle test (pre-merge code review, measured): server-tools.test.ts injects every
 * dependency, including a stub `buildStatusSnapshot`. On a scratch copy, removing the folder from
 * `defaultServerDeps.checkAuth` / `billingCaveat`, blanking the default `grokHomeNote` and deleting
 * the field in `buildStatusSnapshot` left every unit suite green. Only the real wiring answers here.
 *
 * Isolation, as in hook-e2e: a stub grok on a sanitized PATH, a throwaway HOME / USERPROFILE (which
 * also moves ~/.grok-build/worktrees), and session files that are empty `{}` — the pre-check only
 * tests that auth.json exists. No grok runs: status and auth check spawn nothing, the refusals stop
 * at the pre-check, and `best_of_n` is the second stop behind it (refused before any spawn).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = join(here, '../dist/index.js');
const hookJs = join(here, '../dist/hook.js');

const root = mkdtempSync(join(tmpdir(), 'a35-e2e-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, 'home');
const binDir = join(root, 'bin');
const serverFolder = join(root, 'server-folder'); // the MCP server's own folder: no session here
const task = join(root, 'task');                  // the only folder with a session and a config
const other = join(root, 'other');                // a task folder with no session
const REL = 'rel-home';
for (const d of [home, binDir, serverFolder, join(task, REL), other]) mkdirSync(d, { recursive: true });
writeFileSync(join(task, REL, 'auth.json'), '{}');
writeFileSync(join(task, REL, 'config.toml'), '[model."e2e-probe"]\napi_key = "fake-e2e-key"\n');
if (process.platform === 'win32') {
  writeFileSync(join(binDir, 'grok.cmd'), '@echo off\r\nexit /b 0\r\n');
} else {
  writeFileSync(join(binDir, 'grok'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(binDir, 'grok'), 0o755);
}

function isolatedEnv(grokHome: string): NodeJS.ProcessEnv {
  const pathParts = [binDir];
  const env: NodeJS.ProcessEnv = {
    HOME: home, USERPROFILE: home, GROK_BIN_DIR: binDir,
    GROK_HOME: grokHome, GROK_BUILD_AUTH_MODE: 'subscription',
  };
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    pathParts.push(join(sysRoot, 'System32'), sysRoot);
    env.SystemRoot = sysRoot;
    env.PATHEXT = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    env.ComSpec = process.env.ComSpec || join(sysRoot, 'System32', 'cmd.exe');
  } else {
    pathParts.push('/usr/bin', '/bin');
  }
  env.PATH = pathParts.join(delimiter);
  return env;
}

interface ToolResult { isError?: boolean; content?: { type: string; text: string }[] }
const text = (r: ToolResult) => r.content?.[0]?.text ?? '';
const body = (r: ToolResult): Record<string, unknown> => {
  try { return JSON.parse(text(r)) as Record<string, unknown>; } catch { return {}; }
};

/** initialize -> initialized -> one tools/call, over the bundle's real stdio, started in serverFolder. */
function callServer(name: string, args: Record<string, unknown>, grokHome = REL): Promise<ToolResult> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [serverJs], { cwd: serverFolder, env: isolatedEnv(grokHome), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); fail(new Error(`${name}: no answer within 15s`)); }, 15_000);
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
          // Resolve only once the child is gone: on Windows a killed process can still hold serverFolder
          // (its cwd) when the next line runs, and afterAll's rmSync then fails with EBUSY — measured when
          // the A36 block below ended on a server call.
          const result = msg.result ?? {};
          if (child.exitCode !== null || child.signalCode !== null) done(result);
          else { child.once('exit', () => done(result)); child.kill(); }
        }
      }
    });
    child.on('error', (e) => { clearTimeout(timer); fail(e); });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'a35-e2e', version: '0' } } });
  });
}

/** The hook's decision for one payload, run in serverFolder like the server. '' means allow. */
function hookSays(tool: string, toolInput: Record<string, unknown>, grokHome = REL): string {
  const r = spawnSync(process.execPath, [hookJs], {
    cwd: serverFolder, env: isolatedEnv(grokHome), encoding: 'utf8', windowsHide: true, timeout: 15_000,
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: `mcp__plugin_grok_grok-build__${tool}`, tool_input: toolInput }),
  });
  return (r.stdout ?? '').trim();
}

// Each test spawns node processes. vitest's 5 s default would fire before the 15 s guard in
// callServer could say which call hung (re-review; worker-guard.test.ts uses 30 s the same way).
const TEST_TIMEOUT = 30_000;

describe('A35 — relative GROK_HOME through the committed bundles', () => {
  it('status answers for the folder it is given, and says so', async () => {
    const inTask = body(await callServer('grok_build_status', { cwd: task }));
    expect(inTask.ready).toBe(true);
    expect(String(inTask.grokHomeNote)).toContain(resolve(task, REL));
    const caveat = inTask.billingCaveat as { reason?: string; configPath?: string } | undefined;
    expect(caveat?.reason).toBe('config_model_keys');
    expect(caveat?.configPath).toBe(join(resolve(task, REL), 'config.toml'));
    expect(JSON.stringify(inTask)).not.toContain('fake-e2e-key');

    const bare = body(await callServer('grok_build_status', {}));
    expect(bare.ready).toBe(false);
    expect(String(bare.grokHomeNote)).toContain(resolve(serverFolder, REL));
  }, TEST_TIMEOUT);

  it('grok_auth_check takes the folder too', async () => {
    const r = await callServer('grok_auth_check', { cwd: task });
    expect(r.isError).toBeFalsy();
    expect(body(r).ok).toBe(true);
    expect(String(body(r).grokHomeNote)).toContain(resolve(task, REL));
  }, TEST_TIMEOUT);

  it('a delegation into a folder with no session is refused, naming the home it checked', async () => {
    const r = await callServer('grok_build_delegate', { prompt: 'e2e', cwd: other, best_of_n: 2 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('grok login');
    expect(text(r)).toContain(resolve(other, REL));
  }, TEST_TIMEOUT);

  it('a worktree delegation asks about a new worktree folder, and creates nothing', async () => {
    const r = await callServer('grok_build_delegate', { prompt: 'e2e', cwd: task, worktree: true, best_of_n: 2 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(join(home, '.grok-build', 'worktrees'));
    const worktrees = join(home, '.grok-build', 'worktrees');
    expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  }, TEST_TIMEOUT);

  it('the hook checks the call folder, and defers when it cannot name one', () => {
    expect(hookSays('grok_build_delegate', { prompt: 'e2e', cwd: task })).toBe('');
    const denied = hookSays('grok_build_delegate', { prompt: 'e2e', cwd: other });
    expect(denied).toContain('"deny"');
    expect(denied).toContain(JSON.stringify(resolve(other, REL)).slice(1, -1));
    expect(hookSays('grok_cli', { args: ['--cwd', task, '-p', 'x'], cwd: other })).toBe('');
    expect(hookSays('grok_build_delegate', { prompt: 'e2e', cwd: other, worktree: true })).toBe('');
  }, TEST_TIMEOUT);
});

/*
 * A36 through the same committed bundles, on a real Windows file system — the rules are Windows'
 * (docs/10 A36; MEASURED 2026-09-25 against grok 1.0.41, rows named as in env.test.ts). grok opens
 * <GROK_HOME>\auth.json through Windows path normalization; Node's fs uses \\?\ paths, which skip it.
 * Before the fix the shipped v0.2.34 bundle said "not logged in" for a home written `<dir>.` although grok
 * was signed in (A04), and the hook denied a grok_cli prompt run in a task folder written `<task>.` (B05).
 */
describe.skipIf(process.platform !== 'win32')('A36 — GROK_HOME spellings Windows normalizes, through the committed bundles', () => {
  const session = join(root, 'a36-home');
  mkdirSync(session, { recursive: true });
  writeFileSync(join(session, 'auth.json'), '{}');

  it('a home written with one trailing dot is the folder grok opens: ready, and the hook allows', async () => {
    const dotted = `${session}.`;
    expect(body(await callServer('grok_build_status', {}, dotted)).ready).toBe(true);
    expect(hookSays('grok_build_delegate', { prompt: 'e2e', cwd: task }, dotted)).toBe('');
  }, TEST_TIMEOUT);

  it('a trailing space stays "not logged in" (grok agrees), and every answer names the space', async () => {
    const spaced = `${session} `;
    const status = body(await callServer('grok_build_status', {}, spaced));
    expect(status.ready).toBe(false);
    expect(String(status.grokHomeNote)).toContain('&&');
    const refused = await callServer('grok_build_delegate', { prompt: 'e2e', cwd: task, best_of_n: 2 }, spaced);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('&&');
    const denied = hookSays('grok_build_delegate', { prompt: 'e2e', cwd: task }, spaced);
    expect(denied).toContain('"deny"');
    expect(denied).toContain('&&');
  }, TEST_TIMEOUT);

  it('a relative home is found under a task folder written with a trailing dot, as grok enters it', async () => {
    expect(body(await callServer('grok_build_status', { cwd: `${task}.` })).ready).toBe(true);
    expect(hookSays('grok_cli', { args: ['-p', 'x'], cwd: `${task}.` })).toBe('');
  }, TEST_TIMEOUT);
});
