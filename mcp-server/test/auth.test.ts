import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authFilePath, checkAuth, defaultAuthDeps, grokNotInstalledMessage, resolveGrokInstalled,
  grokBinNames, type AuthDeps,
} from '../src/auth.js';

const deps = (over: Partial<AuthDeps>): AuthDeps => ({
  grokInstalled: () => true,
  authFileExists: () => true,
  env: {},
  ...over,
});

describe('checkAuth', () => {
  it('fails when grok is not installed (either mode)', () => {
    const r = checkAuth('subscription', deps({ grokInstalled: () => false }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('grok_not_installed');
  });
  it('subscription: fails when auth.json is missing', () => {
    const r = checkAuth('subscription', deps({ authFileExists: () => false }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_logged_in');
  });
  it('subscription: ok when auth.json exists', () => {
    expect(checkAuth('subscription', deps({})).ok).toBe(true);
  });
  it('always reports billing + serverVersion (SSOT surface)', () => {
    const sub = checkAuth('subscription', deps({}));
    expect(sub.billing).toBe('subscription');
    expect(sub.serverVersion).toMatch(/^\d+\.\d+\.\d+/);
    const api = checkAuth('api', deps({ env: { XAI_API_KEY: 'sk-x' } }));
    expect(api.billing).toBe('metered_api');
    expect(api.serverVersion).toBe(sub.serverVersion);
  });
  it('api: fails when no key is present', () => {
    const r = checkAuth('api', deps({ authFileExists: () => false, env: {} }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_api_key');
  });
  it('api: ok when XAI_API_KEY is present (even without auth.json)', () => {
    const r = checkAuth('api', deps({ authFileExists: () => false, env: { XAI_API_KEY: 'sk-x' } }));
    expect(r.ok).toBe(true);
  });
  it('api: ok when only GROK_CODE_XAI_API_KEY is present', () => {
    const r = checkAuth('api', deps({ authFileExists: () => false, env: { GROK_CODE_XAI_API_KEY: 'sk-y' } }));
    expect(r.ok).toBe(true);
  });

  // Failure-mode message text (roadmap Phase 2 done-definition)
  it('grok_not_installed message mentions install + PATH', () => {
    const r = checkAuth('subscription', deps({ grokInstalled: () => false }));
    expect(r.message).toContain('PATH');
    expect(r.message).toMatch(/install\.(sh|ps1)/);
  });
  it('not_logged_in message tells the user to run grok login', () => {
    const r = checkAuth('subscription', deps({ authFileExists: () => false }));
    expect(r.message).toContain('grok login');
  });
  it('no_api_key message tells the user to set XAI_API_KEY', () => {
    const r = checkAuth('api', deps({ authFileExists: () => false, env: {} }));
    expect(r.message).toContain('XAI_API_KEY');
  });
});

describe('grokNotInstalledMessage', () => {
  it('uses install.ps1 on win32 and install.sh elsewhere', () => {
    expect(grokNotInstalledMessage('win32')).toContain('install.ps1');
    expect(grokNotInstalledMessage('linux')).toContain('install.sh');
    expect(grokNotInstalledMessage('darwin')).toContain('install.sh');
  });
});

describe('resolveGrokInstalled', () => {
  it('true when path lookup succeeds', () => {
    expect(resolveGrokInstalled({
      platform: 'win32', binDir: 'C:\\x', fileExists: () => false, pathLookupOk: true,
    })).toBe(true);
  });
  it('true when grok.exe exists under bin dir even if path lookup failed', () => {
    expect(resolveGrokInstalled({
      platform: 'win32',
      binDir: 'C:\\Users\\u\\.grok\\bin',
      fileExists: (p) => p.endsWith('grok.exe'),
      pathLookupOk: false,
    })).toBe(true);
  });
  it('false when neither path nor files exist', () => {
    expect(resolveGrokInstalled({
      platform: 'linux', binDir: '/home/u/.grok/bin', fileExists: () => false, pathLookupOk: false,
    })).toBe(false);
  });
  it('win32 bin names include .exe', () => {
    expect(grokBinNames('win32')).toContain('grok.exe');
    expect(grokBinNames('linux')).toEqual(['grok']);
  });
});

describe('authFilePath', () => {
  it('defaults to ~/.grok/auth.json', () => {
    expect(authFilePath({})).toBe(join(homedir(), '.grok', 'auth.json'));
  });
  it('follows GROK_HOME when grok relocates its config dir', () => {
    expect(authFilePath({ GROK_HOME: '/opt/grokhome' })).toBe(join('/opt/grokhome', 'auth.json'));
  });
});

// Measured on grok 1.0.5 (2026-09-02): `GROK_HOME=<dir> grok du --json` reports grok_home=<dir>,
// and auth resolves ONLY there — there is no fallback to ~/.grok. Probing the default home
// instead locks a GROK_HOME user out unrecoverably: the hook denies, and the `grok login` it
// tells them to run writes the token to $GROK_HOME/auth.json — the one path never looked at.
describe('defaultAuthDeps.authFileExists honours GROK_HOME', () => {
  it('finds auth.json under GROK_HOME', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grokhome-found-'));
    try {
      writeFileSync(join(dir, 'auth.json'), '{}');
      expect(defaultAuthDeps({ GROK_HOME: dir }).authFileExists()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reports missing when GROK_HOME holds no auth.json, whatever the default home has', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grokhome-empty-'));
    try {
      expect(defaultAuthDeps({ GROK_HOME: dir }).authFileExists()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('api-mode auth_check does not claim more than it checked (A13)', () => {
  // MEASURED 2026-09-06 through the shipped bundle:
  //   GROK_BUILD_AUTH_MODE=api XAI_API_KEY="not-a-real-key-at-all"  ->  ok true,
  //   "API 키 인증 준비됨." — "API key authentication ready" for a string that is not a key.
  // Nothing in this path ever contacts xAI, so "ready" was a claim the check never made.
  const apiDeps = (over: Partial<AuthDeps> = {}): AuthDeps => ({
    grokInstalled: () => true,
    authFileExists: () => false,
    env: { XAI_API_KEY: 'not-a-real-key-at-all' },
    ...over,
  });

  it('still says ok — presence is all this check can honestly test', () => {
    const r = checkAuth('api', apiDeps());
    expect(r.ok).toBe(true);
  });

  it('says the key is SET, not that it works', () => {
    const m = checkAuth('api', apiDeps()).message;
    expect(m).toContain('설정');
    expect(m).toContain('검증');       // ...and says validity was not verified
    expect(m).not.toContain('준비됨');  // the old claim
  });

  // The audit's sharper finding: with a dead key grok falls back to the subscription session, so
  // the run is NOT metered even though `billing` says metered_api (billing is derived from mode
  // by design — absolute principle #1 — never observed). When a session file is sitting right
  // there, saying so costs one stat call we already make and turns a silent surprise into a note.
  it('warns when a subscription session is also present', () => {
    const m = checkAuth('api', apiDeps({ authFileExists: () => true })).message;
    expect(m).toContain('구독 세션');
  });

  it('says nothing about a session when there is none', () => {
    expect(checkAuth('api', apiDeps()).message).not.toContain('구독 세션');
  });

  it('the no-key branch is untouched', () => {
    const r = checkAuth('api', apiDeps({ env: {} }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_api_key');
  });

  it('subscription mode is untouched', () => {
    expect(checkAuth('subscription', apiDeps({ authFileExists: () => true })).message).toBe('구독 세션 인증 준비됨.');
  });
});
