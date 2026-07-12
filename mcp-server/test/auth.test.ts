import { describe, it, expect } from 'vitest';
import { checkAuth, type AuthDeps } from '../src/auth.js';

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
});
