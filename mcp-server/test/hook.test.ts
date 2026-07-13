import { describe, it, expect } from 'vitest';
import { resolveHookMode, decideHook, runHook, type HookIO } from '../src/hook.js';
import { GROK_NOT_INSTALLED_MESSAGE, type AuthDeps } from '../src/auth.js';

const deps = (over: Partial<AuthDeps>): AuthDeps => ({
  grokInstalled: () => true,
  authFileExists: () => true,
  env: {},
  ...over,
});

describe('resolveHookMode', () => {
  it('returns subscription when explicitly set', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'subscription' })).toBe('subscription');
  });
  it('returns api when explicitly set', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'api' })).toBe('api');
  });
  it('returns unknown when unset', () => {
    expect(resolveHookMode({})).toBe('unknown');
  });
  it('returns unknown for an empty string', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: '' })).toBe('unknown');
  });
  it('returns unknown for an invalid value (never throws)', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'xyz' })).toBe('unknown');
  });
});

describe('decideHook', () => {
  it('denies when grok is not installed (subscription)', () => {
    const d = decideHook('subscription', deps({ grokInstalled: () => false }));
    expect(d.deny).toBe(true);
    expect(d.reason).toBe(GROK_NOT_INSTALLED_MESSAGE);
  });
  it('denies when grok is not installed (api, even with a key)', () => {
    const d = decideHook('api', deps({ grokInstalled: () => false, env: { XAI_API_KEY: 'sk' } }));
    expect(d.deny).toBe(true);
    expect(d.reason).toBe(GROK_NOT_INSTALLED_MESSAGE);
  });
  it('denies when grok is not installed (unknown mode)', () => {
    const d = decideHook('unknown', deps({ grokInstalled: () => false }));
    expect(d.deny).toBe(true);
    expect(d.reason).toBe(GROK_NOT_INSTALLED_MESSAGE);
  });
  it('subscription: denies when auth.json is missing', () => {
    const d = decideHook('subscription', deps({ authFileExists: () => false }));
    expect(d.deny).toBe(true);
    expect(d.reason).toContain('grok login');
  });
  it('subscription: allows when auth.json exists', () => {
    expect(decideHook('subscription', deps({})).deny).toBe(false);
  });
  it('api: denies when no key is present', () => {
    const d = decideHook('api', deps({ authFileExists: () => false, env: {} }));
    expect(d.deny).toBe(true);
    expect(d.reason).toContain('XAI_API_KEY');
  });
  it('api: allows when a key is present (even without auth.json)', () => {
    const d = decideHook('api', deps({ authFileExists: () => false, env: { XAI_API_KEY: 'sk' } }));
    expect(d.deny).toBe(false);
  });
  it('unknown mode + grok installed: allows despite missing auth.json and key (never false-block)', () => {
    const d = decideHook('unknown', deps({ authFileExists: () => false, env: {} }));
    expect(d.deny).toBe(false);
  });
});

describe('runHook', () => {
  const io = (over: Partial<HookIO>): HookIO => ({
    readStdin: async () => '',
    writeStdout: () => {},
    env: {},
    deps: deps({}),
    ...over,
  });

  it('deny path writes the PreToolUse deny JSON to stdout', async () => {
    let out = '';
    await runHook(io({
      env: { GROK_BUILD_AUTH_MODE: 'subscription' },
      deps: deps({ authFileExists: () => false }),
      writeStdout: (s) => { out += s; },
    }));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('grok login');
  });

  it('allow path (unknown mode, missing auth) writes nothing', async () => {
    let out = '';
    await runHook(io({
      env: {},
      deps: deps({ authFileExists: () => false, env: {} }),
      writeStdout: (s) => { out += s; },
    }));
    expect(out).toBe('');
  });

  it('fails open (writes nothing) when a dep throws', async () => {
    let out = '';
    await runHook(io({
      env: { GROK_BUILD_AUTH_MODE: 'subscription' },
      deps: deps({ grokInstalled: () => { throw new Error('boom'); } }),
      writeStdout: (s) => { out += s; },
    }));
    expect(out).toBe('');
  });
});
