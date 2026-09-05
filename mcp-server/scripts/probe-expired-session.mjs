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
import { randomBytes } from 'node:crypto';

const TIMEOUT_MS = 120_000; // must exceed the ~25-30s the CLI spends retrying before it reports

// The auth.json entry key is `<oidc_issuer>::<oidc_client_id>` — MEASURED: the UUID equals the
// entry's own `oidc_client_id` field and matches no user/principal/team id. It identifies the
// grok CLI as an OAuth client (public by design, identical for every install), so it is a
// constant here, not a credential.
//
// It also has to be right: with any other UUID the CLI finds no entry for its client and every
// variant below collapses into the plain "Not signed in" path B — which silently turns this
// probe into a duplicate of probe-unauth-device-flow.mjs. That happened, and only comparing
// against the real file's field caught it.
const OIDC_ISSUER = 'https://auth.x.ai';
const OIDC_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rand = (n) => randomBytes(n).toString('base64url').slice(0, n);
const iso = (sec) => new Date(sec * 1000).toISOString().replace('Z', '000Z');

/** Real auth.json shape (grok 1.0.13, oidc): ES256 at+jwt access token + opaque refresh token. */
function syntheticAuth(expSec) {
  const header = { typ: 'at+jwt', alg: 'ES256', kid: 'oauth2-production-2026-02-19' };
  const payload = {
    iss: OIDC_ISSUER, sub: '00000000-0000-4000-8000-000000000000',
    aud: 'https://api.x.ai', exp: expSec, iat: expSec - 21600, scope: 'api',
    principal_type: 'User', principal_id: '00000000-0000-4000-8000-000000000000',
    client_id: OIDC_CLIENT_ID,
    jti: '00000000-0000-4000-8000-000000000002', tier: 'free',
    team_id: '00000000-0000-4000-8000-000000000003',
  };
  return {
    [`${OIDC_ISSUER}::${OIDC_CLIENT_ID}`]: {
      key: `${b64u(header)}.${b64u(payload)}.${rand(86)}`,
      auth_mode: 'oidc',
      create_time: iso(expSec - 21600),
      user_id: '00000000-0000-4000-8000-000000000000',
      email: 'probe@example.com', first_name: 'Probe', last_name: 'Xx',
      profile_image_asset_id: rand(80),
      principal_type: 'User',
      principal_id: '00000000-0000-4000-8000-000000000000',
      team_id: '00000000-0000-4000-8000-000000000003',
      coding_data_retention_opt_out: false,
      refresh_token: rand(86),
      expires_at: iso(expSec),
      oidc_issuer: OIDC_ISSUER,
      oidc_client_id: OIDC_CLIENT_ID,
    },
  };
}

async function runVariant({ id, note, auth }) {
  const home = mkdtempSync(join(tmpdir(), 'grok-expired-probe-'));
  const grokHome = join(home, '.grok');
  mkdirSync(grokHome, { recursive: true });
  if (auth) writeFileSync(join(grokHome, 'auth.json'), JSON.stringify(auth, null, 2), { mode: 0o600 });

  const env = { ...process.env, HOME: home, USERPROFILE: home, GROK_HOME: grokHome };
  delete env.XAI_API_KEY;
  delete env.GROK_CODE_XAI_API_KEY;
  if (process.platform === 'win32') {
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
    mkdirSync(env.APPDATA, { recursive: true });
    mkdirSync(env.LOCALAPPDATA, { recursive: true });
  }

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
