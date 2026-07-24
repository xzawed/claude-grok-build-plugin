#!/usr/bin/env node
/**
 * Optional live probe: run headless grok with an isolated home so auth.json/keyring
 * for the real user are not used. Documents current unauth CLI behaviour.
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

const home = mkdtempSync(join(tmpdir(), 'grok-unauth-probe-'));
const timeoutMs = 15_000;

const env = { ...process.env, HOME: home, USERPROFILE: home };
delete env.XAI_API_KEY;
delete env.GROK_CODE_XAI_API_KEY;
if (process.platform === 'win32') {
  env.APPDATA = join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  mkdirSync(env.APPDATA, { recursive: true });
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
}

const child = spawn(
  'grok',
  ['--no-auto-update', '-p', 'Say ok.', '--output-format', 'json'],
  { env, cwd: home, windowsHide: true },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });

const timer = setTimeout(() => {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch { /* ignore */ }
}, timeoutMs);

const result = await new Promise((resolve) => {
  child.on('close', (code) => {
    clearTimeout(timer);
    resolve({
      timedOut: false,
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
    resolve({ timedOut: false, code: -1, error: err.message, isolatedHome: home });
  });
});

try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(JSON.stringify(result, null, 2));
