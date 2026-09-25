/**
 * A48 (docs/10, 2026-09-25) — `scripts/probe-unauth-device-flow.mjs` built its env as `{ ...process.env }`
 * minus the two API keys. That is the exact shape `scripts/synthetic-auth.mjs` records as a FOUND DEFECT
 * in its sibling probes: grok re-runs GROK_AUTH_PROVIDER_COMMAND after a 401, so with a token provider in
 * the operator's env the "unauthenticated" probe could run a real, billed turn (`-p 'Say ok.'`).
 * The siblings moved to `isolatedGrokEnv`; this one never did. Found by two independent reviewers of the
 * 2026-09-25 audit and confirmed against synthetic-auth.mjs's own record.
 *
 * The builder lives in synthetic-auth.mjs (no side effects) rather than in the probe, because the probe
 * spawns grok at its top level: importing it from a test would RUN it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { throwawayHomeEnv } from '../scripts/synthetic-auth.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const home = '/tmp/unauth-probe-home';
const credentialNames = (env: Record<string, string | undefined>) =>
  Object.keys(env).filter((k) => /^(grok_|xai_)/i.test(k) && k !== 'GROK_HOME');

describe('A48 — throwawayHomeEnv: a probe with a throwaway home cannot reach a real account', () => {
  it('drops every GROK_* and XAI_* variable in any spelling, not only the two API keys', () => {
    const env = throwawayHomeEnv({
      PATH: '/usr/bin',
      XAI_API_KEY: 'k1', xai_api_key: 'k2', Grok_Code_Xai_Api_Key: 'k3',
      GROK_AUTH_PROVIDER_COMMAND: '/usr/local/bin/mint-token',
      GROK_AUTH_PATH: '/real/home/.grok/auth.json',
      grok_deployment_key: 'd',
      GROK_HOME: '/real/home/.grok',
    }, home, 'linux');
    expect(credentialNames(env)).toEqual([]);
    expect(env.PATH).toBe('/usr/bin');
  });

  it('points every home grok could use at the throwaway directory', () => {
    const env = throwawayHomeEnv({ HOME: '/real/home', USERPROFILE: 'C:/Users/real' }, home, 'linux');
    expect(env.GROK_HOME).toBe(home);
    expect(env.HOME).toBe(home);
    expect(env.USERPROFILE).toBe(home);
    expect(env.APPDATA).toBeUndefined();
  });

  it('on win32 the app-data folders follow the throwaway home too', () => {
    const winHome = 'C:\\t\\unauth-probe-home';
    const env = throwawayHomeEnv({ APPDATA: 'C:\\Users\\real\\AppData\\Roaming' }, winHome, 'win32');
    expect(env.APPDATA?.startsWith(winHome)).toBe(true);
    expect(env.LOCALAPPDATA?.startsWith(winHome)).toBe(true);
  });
});

describe('A48 — the unauth probe is wired to it', () => {
  const src = readFileSync(join(here, '..', 'scripts', 'probe-unauth-device-flow.mjs'), 'utf8');
  it('builds its env with throwawayHomeEnv', () => {
    expect(src.includes('throwawayHomeEnv(')).toBe(true);
  });
  it('no longer spreads the parent env itself', () => {
    expect(src.includes('...process.env')).toBe(false);
  });
});
