#!/usr/bin/env node
/**
 * Optional live probe: what does headless grok do when auth.json EXISTS but is REJECTED?
 *
 * This is the "expired session" case, which `probe-unauth-device-flow.mjs` cannot reach —
 * that one measures ABSENCE (no auth.json), and absence and rejection take different code
 * paths in the CLI. Documented as contract §7 path C.
 *
 * Usage (from mcp-server/): node scripts/probe-expired-session.mjs
 * Exit 0 always (probe); prints a JSON summary to stdout.
 *
 * AUDITED BY GROK 2026-09-23, no finding. The whole-file and whole-fragment framings both timed
 * out on this file's command arrays, so the task was split instead: Grok listed every environment
 * variable this script sets or deletes (seven, with the quoted lines) and the judgement is mine
 * against that list. It matches the sister probe Grok cleared outright — the three directory
 * variables are all redirected, GROK_HOME (the one that outranks the others) is set AFTER the
 * process.env spread, both API keys are deleted, and the win32 app-data dirs follow. (2026-09-24:
 * "both API keys" turned out to be too narrow — see isolatedGrokEnv in synthetic-auth.mjs.) The one
 * difference is deliberate: GROK_HOME points at `join(home, '.grok')`, a subdirectory of the
 * mkdtemp, because this probe must give grok a credential to reject. It is still inside the
 * throwaway directory, so the real ~/.grok remains unreachable.
 *
 * SAFETY: never reads or writes the real ~/.grok. Every variant writes a SYNTHETIC auth.json
 * (fabricated key + refresh_token in the real shape) into an isolated GROK_HOME. GROK_HOME is
 * the authoritative knob and outranks HOME/USERPROFILE (contract §8) — it is set explicitly
 * because this env spreads process.env, and a developer who already has GROK_HOME set would
 * otherwise defeat the isolation and probe their real, billed session.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticAuth, isolatedGrokEnv } from './synthetic-auth.mjs';

const TIMEOUT_MS = 120_000; // must exceed the ~25-30s the CLI spends retrying before it reports

// The synthetic credential lives in synthetic-auth.mjs (shared with worker-marker-probe.mjs),
// together with why its OAuth client id has to be exactly the real one.

async function runVariant({ id, note, auth }) {
  const home = mkdtempSync(join(tmpdir(), 'grok-expired-probe-'));
  const grokHome = join(home, '.grok');
  mkdirSync(grokHome, { recursive: true });
  if (auth) writeFileSync(join(grokHome, 'auth.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });

  // isolatedGrokEnv drops every GROK_*/XAI_* variable, not just the two API keys this used to delete:
  // GROK_AUTH_PROVIDER_COMMAND would let grok re-authenticate this "rejected" session for real
  // (2026-09-24 review finding; the reasoning lives beside the function in synthetic-auth.mjs).
  const overrides = { HOME: home, USERPROFILE: home, GROK_HOME: grokHome };
  if (process.platform === 'win32') {
    overrides.APPDATA = join(home, 'AppData', 'Roaming');
    overrides.LOCALAPPDATA = join(home, 'AppData', 'Local');
    mkdirSync(overrides.APPDATA, { recursive: true });
    mkdirSync(overrides.LOCALAPPDATA, { recursive: true });
  }
  const env = isolatedGrokEnv(process.env, overrides);

  const started = Date.now();
  // Same argv and stdio as runDelegate, so the probe measures the shipped call, not a variant.
  const child = spawn(
    'grok',
    ['--no-auto-update', '--always-approve', '--cwd', home, '-p', 'Say ok.', '--output-format', 'json'],
    { env, cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
  );

  let stdout = '';
  let stderr = '';
  let firstByteMs = null;
  const mark = () => { if (firstByteMs === null) firstByteMs = Date.now() - started; };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { mark(); stdout += d; });
  child.stderr.on('data', (d) => { mark(); stderr += d; });

  // Tracked, not assumed: a killed run closes with code null, indistinguishable from a clean
  // exit unless the kill is recorded (same trap as probe-unauth-device-flow.mjs).
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch { /* ignore */ }
  }, TIMEOUT_MS);

  const result = await new Promise((resolve) => {
    child.on('close', (code) => {
      clearTimeout(timer);
      const all = stdout + stderr;
      resolve({
        variant: id, note, timedOut, exitCode: code,
        elapsedMs: Date.now() - started, firstByteMs,
        stdoutTail: stdout.slice(-800), stderrTail: stderr.slice(-800),
        signals: {
          // AUTH_ERROR_SIGNALS / DEVICE_AUTH_SIGNALS in src/delegate.ts
          notSignedIn: /not signed in/i.test(all),
          notAuthenticated: /not authenticated/i.test(all),
          grokLogin: /grok login/i.test(all),
          deviceOauth: /accounts\.x\.ai\/oauth2\/device/i.test(all),
          waitingAuth: /waiting for authorization/i.test(all),
          invalidOrExpiredCredentials: /invalid or expired credentials/i.test(all),
        },
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ variant: id, note, timedOut, exitCode: -1, error: err.message });
    });
  });

  try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  return result;
}

const nowSec = Math.floor(Date.now() / 1000);
const variants = [
  {
    id: 'C1-expired-unrefreshable',
    note: 'auth.json present, expires_at 1h in the PAST, refresh_token bogus (real expiry whose refresh also fails)',
    auth: syntheticAuth(nowSec - 3600),
  },
  {
    id: 'C2-unexpired-but-rejected',
    note: 'auth.json present, expires_at 1h in the FUTURE, signature bogus (revoked server-side)',
    auth: syntheticAuth(nowSec + 3600),
  },
  {
    id: 'B-absent-control',
    note: 'no auth.json (contract §7 path B control — should differ from C1/C2)',
    auth: null,
  },
];

const results = [];
for (const v of variants) results.push(await runVariant(v));
console.log(JSON.stringify({ probe: 'expired-session', platform: process.platform, results }, null, 2));
