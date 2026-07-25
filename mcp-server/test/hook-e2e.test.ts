/**
 * Process-level PreToolUse harness e2e against the committed bundle `dist/hook.js`.
 *
 * This is the closest CI can get to "Claude Code UI PreToolUse" without the UI:
 * real node process, real stdin drain, real defaultAuthDeps (PATH / auth.json / GROK_BIN_DIR),
 * real deny JSON / allow silence / always exit 0.
 *
 * Isolation: temp HOME/USERPROFILE + GROK_BIN_DIR + sanitized PATH so the host machine's
 * real grok / auth.json cannot leak into the decision.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const hookJs = join(here, '../dist/hook.js');

/** Claude Code–shaped PreToolUse stdin (fields the hook currently drains and ignores). */
function preToolUsePayload(tool = 'mcp__plugin_grok_grok-build__grok_build_delegate'): string {
  return JSON.stringify({
    session_id: 'e2e-session',
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { prompt: 'e2e', cwd: '/abs/proj' },
    cwd: '/abs/proj',
    permission_mode: 'default',
  });
}

function writeStubGrok(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    // where.exe + resolveGrokInstalled look for grok.cmd / grok.exe / grok
    writeFileSync(join(binDir, 'grok.cmd'), '@echo off\r\nexit /b 0\r\n', 'utf8');
  } else {
    const p = join(binDir, 'grok');
    writeFileSync(p, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(p, 0o755);
  }
}

function isolatedEnv(opts: {
  home: string;
  binDir: string;
  mode?: string;
  /** When false, binDir has no stub (and PATH is stripped of host grok). */
  withGrokStub?: boolean;
}): NodeJS.ProcessEnv {
  if (opts.withGrokStub !== false) writeStubGrok(opts.binDir);

  // Keep only what Node/where need; drop host PATH so real ~/.grok/bin does not win.
  const pathParts: string[] = [opts.binDir];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    pathParts.push(join(root, 'System32'), root);
  } else {
    pathParts.push('/usr/bin', '/bin');
  }

  const env: NodeJS.ProcessEnv = {
    PATH: pathParts.join(delimiter),
    HOME: opts.home,
    USERPROFILE: opts.home,
    GROK_BIN_DIR: opts.binDir,
    // Prevent accidental metered leakage into other tools if any child ran.
    // (hook itself does not spawn grok.)
  };
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
    env.SYSTEMROOT = process.env.SYSTEMROOT || env.SystemRoot;
    env.PATHEXT = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    env.ComSpec = process.env.ComSpec || join(env.SystemRoot!, 'System32', 'cmd.exe');
  }
  if (opts.mode !== undefined) env.GROK_BUILD_AUTH_MODE = opts.mode;
  return env;
}

function runHookBundle(env: NodeJS.ProcessEnv, stdin = preToolUsePayload()): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [hookJs], {
    env,
    input: stdin,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function parseDeny(stdout: string): {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  hookEventName?: string;
} | null {
  const t = stdout.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as {
      hookSpecificOutput?: {
        permissionDecision?: string;
        permissionDecisionReason?: string;
        hookEventName?: string;
      };
    };
    return j.hookSpecificOutput ?? null;
  } catch {
    return null;
  }
}

describe('PreToolUse hook harness e2e (dist/hook.js)', () => {
  beforeAll(() => {
    expect(existsSync(hookJs), 'committed dist/hook.js must exist for e2e').toBe(true);
  });

  it('always exits 0 (deny is JSON, not exit code)', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    // No stub → not installed → deny path
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: false }));
    expect(r.status).toBe(0);
  });

  it('subscription + missing grok → deny with install guidance', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: false }));
    expect(r.status).toBe(0);
    const d = parseDeny(r.stdout);
    expect(d?.permissionDecision).toBe('deny');
    expect(d?.hookEventName).toBe('PreToolUse');
    expect(d?.permissionDecisionReason).toMatch(/PATH|install\.(sh|ps1)/i);
  });

  it('subscription + stub grok + missing auth.json → deny login', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: true }));
    expect(r.status).toBe(0);
    const d = parseDeny(r.stdout);
    expect(d?.permissionDecision).toBe('deny');
    expect(d?.permissionDecisionReason).toContain('grok login');
  });

  it('subscription + stub grok + auth.json → allow (empty stdout)', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'auth.json'), '{"e2e":true}\n', 'utf8');
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: true }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('api mode + stub grok + no key → allow (defer to server; never false-block)', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'api', withGrokStub: true }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('unknown/unset mode + stub grok → allow even without auth.json', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    const r = runHookBundle(isolatedEnv({ home, binDir, withGrokStub: true }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('drains realistic PreToolUse stdin for plan/verify tool names too', () => {
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'auth.json'), '{}', 'utf8');
    for (const tool of [
      'mcp__plugin_grok_grok-build__grok_build_plan',
      'mcp__plugin_grok_grok-build__grok_build_verify',
    ]) {
      const r = runHookBundle(
        isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: true }),
        preToolUsePayload(tool),
      );
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    }
  });

  it('host auth.json does not leak when HOME is isolated (deny without local auth)', () => {
    // Sanity: this machine may have a real auth.json under the real home; isolation must win.
    const realAuth = join(homedir(), '.grok', 'auth.json');
    if (!existsSync(realAuth)) return; // nothing to prove on a clean agent
    const home = mkdtempSync(join(tmpdir(), 'hook-e2e-home-'));
    const binDir = mkdtempSync(join(tmpdir(), 'hook-e2e-bin-'));
    const r = runHookBundle(isolatedEnv({ home, binDir, mode: 'subscription', withGrokStub: true }));
    expect(r.status).toBe(0);
    expect(parseDeny(r.stdout)?.permissionDecision).toBe('deny');
  });
});
