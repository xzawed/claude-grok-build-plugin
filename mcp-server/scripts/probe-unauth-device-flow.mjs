#!/usr/bin/env node
/**
 * Optional live probe: run headless grok with an isolated home so auth.json/keyring
 * for the real user are not used. Documents current unauth CLI behaviour.
 *
 * A48 (2026-09-25): the env comes from `throwawayHomeEnv` (synthetic-auth.mjs) — every GROK_* and
 * XAI_* variable dropped, every home grok consults pointed at the throwaway directory. The version
 * it replaced copied the parent env and deleted only the two API keys, so a token provider
 * (GROK_AUTH_PROVIDER_COMMAND, which grok re-runs after a 401) could make this "unauthenticated"
 * probe a real, billed turn. A 2026-09-23 review had cleared that version; it predated the
 * token-provider finding (2026-09-24) — see synthetic-auth.mjs.
 *
 * Usage (from mcp-server/): node scripts/probe-unauth-device-flow.mjs
 * Does not modify ~/.grok/auth.json. Safe to re-run.
 *
 * Exit 0 always (probe); prints JSON summary to stdout.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { throwawayHomeEnv } from './synthetic-auth.mjs';

const home = mkdtempSync(join(tmpdir(), 'grok-unauth-probe-'));
const timeoutMs = 15_000;

// throwawayHomeEnv drops every GROK_* / XAI_* name (a token provider in the parent would
// re-authenticate after a 401) and points every home grok consults at this directory.
const env = throwawayHomeEnv(process.env, home);
if (process.platform === 'win32') {
  mkdirSync(env.APPDATA, { recursive: true });
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
}

const child = spawn(
  'grok',
  ['--no-auto-update', '-p', 'Say ok.', '--output-format', 'json'],
  // detached so the child leads a process group. The timeout below kills that group
  // (process.kill(-child.pid, ...)); on POSIX the group exists only when the child leads it.
  // Windows has no such group and uses child.kill instead.
  { env, cwd: home, windowsHide: true, detached: process.platform !== 'win32' },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });

// Tracked, not assumed: a killed run closes with code null, which is indistinguishable from
// a clean exit unless the kill is recorded. Reporting timedOut:false unconditionally turned
// "the probe hung and we shot it" into "the probe exited quietly".
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* ignore */ }
}, timeoutMs);

const result = await new Promise((resolve) => {
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({
      timedOut,
      code,
      stdoutTail: stdout.slice(-800),
      stderrTail: stderr.slice(-800),
      signals: {
        notSignedIn: /not signed in/i.test(stdout + stderr),
        deviceOauth: /accounts\.x\.ai\/oauth2\/device/i.test(stdout + stderr),
        waitingAuth: /waiting for authorization/i.test(stdout + stderr),
        deviceCodeHint: /device-code/i.test(stdout + stderr),
      },
      isolatedHome: home,
    });
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    resolve({ timedOut, code: -1, error: err.message, isolatedHome: home });
  });
});

try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(JSON.stringify(result, null, 2));
