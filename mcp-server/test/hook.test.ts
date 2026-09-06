import { describe, it, expect } from 'vitest';
import { resolveHookMode, decideHook, runHook, parseHookPayload, needsAuthGate, type HookIO } from '../src/hook.js';
import { GROK_NOT_INSTALLED_MESSAGE, type AuthDeps } from '../src/auth.js';
import { resolveAuthMode } from '../src/config.js';

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
  // A7 (docs/10, MEASURED 2026-09-05 on the shipped dist/hook.js): unset is not an ambiguous
  // configuration, it is THE shipped one — .mcp.json carries no env block — and the server reads
  // it as subscription. Reading it as 'unknown' here disarmed the deny branch in production while
  // every test that exercised that branch passed an explicit mode and stayed green.
  it('returns subscription when unset (the shipped configuration)', () => {
    expect(resolveHookMode({})).toBe('subscription');
  });
  it('returns subscription for an empty string', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: '' })).toBe('subscription');
  });
  it('returns subscription for whitespace only', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: '   ' })).toBe('subscription');
  });
  it('normalizes case and surrounding whitespace like the server does', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'Subscription' })).toBe('subscription');
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: ' API ' })).toBe('api');
  });
  // resolveAuthMode's signature is (env = process.env). resolveHookMode passes its argument
  // positionally so the default can never engage — but "can never" is the kind of claim that
  // stops being true after one careless edit, and the failure would be invisible: the hook would
  // silently grade the machine's real environment instead of the payload's. Pinned explicitly.
  it('reads the env it is given, never process.env', () => {
    const saved = process.env.GROK_BUILD_AUTH_MODE;
    process.env.GROK_BUILD_AUTH_MODE = 'api';
    try {
      expect(resolveHookMode({})).toBe('subscription');
      expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'subscription' })).toBe('subscription');
    } finally {
      if (saved === undefined) delete process.env.GROK_BUILD_AUTH_MODE;
      else process.env.GROK_BUILD_AUTH_MODE = saved;
    }
  });
  // Deliberately NOT subscription: resolveAuthMode throws on this, so the server never starts.
  // Denying with "run `grok login`" would send the user to fix the wrong thing (see A12).
  it('returns unknown for an invalid value (never throws)', () => {
    expect(resolveHookMode({ GROK_BUILD_AUTH_MODE: 'xyz' })).toBe('unknown');
  });
});

// The permanent pin for A7. The hook may only deny on signals it reads IDENTICALLY to the server,
// so "reads the mode env the same way" is not a nicety — it is the precondition for the whole deny
// branch. Asserting it as a property (rather than case by case) is what stops the two parsers from
// drifting apart again the next time either one is edited.
describe('resolveHookMode agrees with the server resolveAuthMode (A7)', () => {
  const inputs: (string | undefined)[] = [
    undefined, '', '   ', 'subscription', 'api',
    'Subscription', 'API', ' subscription ', '\tapi\n', 'SUBSCRIPTION',
    'xyz', 'metered', 'sub', 'apikey', 'subscription api',
  ];
  for (const raw of inputs) {
    it(`agrees for ${JSON.stringify(raw)}`, () => {
      const env: NodeJS.ProcessEnv = raw === undefined ? {} : { GROK_BUILD_AUTH_MODE: raw };
      let serverMode: string;
      try {
        serverMode = resolveAuthMode(env);
      } catch {
        serverMode = 'throws';
      }
      // Where the server resolves a mode, the hook must resolve the SAME one. Only input that
      // stops the server from starting at all may fall back to 'unknown'.
      expect(resolveHookMode(env)).toBe(serverMode === 'throws' ? 'unknown' : serverMode);
    });
  }
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
  it('api mode: ALLOWS even when no key is visible to the hook (never false-block)', () => {
    // The api key may live in the server-only .mcp.json env block, invisible to the hook.
    // Denying here would false-block a delegation the server would have run. Defer to server.
    const d = decideHook('api', deps({ authFileExists: () => false, env: {} }));
    expect(d.deny).toBe(false);
  });
  it('api mode: allows when a key IS visible', () => {
    const d = decideHook('api', deps({ authFileExists: () => false, env: { XAI_API_KEY: 'sk' } }));
    expect(d.deny).toBe(false);
  });
  // 'unknown' now means only "the server would refuse to start" (A12), which is the one state
  // where a deny here would misdiagnose the problem.
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

  // A7: the shipped env (no GROK_BUILD_AUTH_MODE anywhere) must reach the deny branch. This is
  // the runHook-level pin — the unit test above can pass while the wiring still hands it 'unknown'.
  it('deny path (UNSET mode = shipped, missing auth) writes the login deny', async () => {
    let out = '';
    await runHook(io({
      env: {},
      deps: deps({ authFileExists: () => false, env: {} }),
      writeStdout: (s) => { out += s; },
    }));
    expect(JSON.parse(out).hookSpecificOutput.permissionDecisionReason).toContain('grok login');
  });

  it('allow path (unresolvable mode, missing auth) writes nothing', async () => {
    let out = '';
    await runHook(io({
      env: { GROK_BUILD_AUTH_MODE: 'nonsense' },
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

// A2 (docs/10, MEASURED 2026-09-05): hooks/hooks.json matched only
// grok_build_(delegate|plan|verify), so `grok_cli {"args":["-p","…","--always-approve"]}` — a run
// that really does edit files and spend a subscription turn — passed the PreToolUse gate entirely.
// Adding grok_cli to the matcher raises the opposite risk: denying `grok --version` or
// `grok sessions list` because the user is not signed in would break the very commands someone
// runs to DIAGNOSE not being signed in. So the gate follows the prompt, not the tool name.
describe('A2 — the auth gate follows the prompt, not the tool name', () => {
  const payload = (toolName: string, args?: string[]) =>
    JSON.stringify({ tool_name: toolName, tool_input: args ? { args } : {} });

  it('gates a grok_cli passthrough that carries a prompt', () => {
    expect(needsAuthGate(parseHookPayload(payload('mcp__plugin_grok_grok-build__grok_cli', ['-p', 'edit it', '--always-approve'])))).toBe(true);
    expect(needsAuthGate(parseHookPayload(payload('mcp__plugin_grok_grok-build__grok_cli', ['--single=edit it'])))).toBe(true);
  });

  it('gates a clustered short flag that clap would read as -p', () => {
    // MEASURED on grok 1.0.13: `grok -vp` demands a value for --single, i.e. clap split the
    // cluster. Whole-token matching missed it and the run would have spent a turn ungated.
    expect(needsAuthGate(parseHookPayload(payload('mcp__plugin_grok_grok-build__grok_cli', ['-vp', 'edit it'])))).toBe(true);
    expect(needsAuthGate(parseHookPayload(payload('mcp__plugin_grok_grok-build__grok_cli', ['-mp', 'x'])))).toBe(true);
  });
  it('does NOT gate a read-only grok_cli query', () => {
    for (const args of [['--version'], ['sessions', 'list'], ['models'], ['inspect', '--json']]) {
      expect(needsAuthGate(parseHookPayload(payload('mcp__plugin_grok_grok-build__grok_cli', args))), args.join(' ')).toBe(false);
    }
  });

  it('always gates delegate/plan/verify, whatever their input looks like', () => {
    for (const t of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
      expect(needsAuthGate(parseHookPayload(payload(`mcp__plugin_grok_grok-build__${t}`)))).toBe(true);
    }
  });

  it('gates when the payload cannot be read — the server has NO auth check on this path', () => {
    // Unlike delegate, runGrokCli never calls checkAuth, so this hook is the only gate a
    // passthrough gets. An unreadable payload therefore fails CLOSED, not open.
    for (const raw of ['', 'not json', '{}', '{"tool_name":123}']) {
      expect(needsAuthGate(parseHookPayload(raw)), JSON.stringify(raw)).toBe(true);
    }
  });

  it('runHook lets a read-only query through even with no session at all', async () => {
    let out = '';
    await runHook({
      readStdin: async () => payload('mcp__plugin_grok_grok-build__grok_cli', ['--version']),
      writeStdout: (s: string) => { out += s; },
      env: { GROK_BUILD_AUTH_MODE: 'subscription' },
      deps: deps({ authFileExists: () => false }),
    });
    expect(out).toBe('');
  });

  it('runHook still denies a read-only query when grok is not installed', async () => {
    let out = '';
    await runHook({
      readStdin: async () => payload('mcp__plugin_grok_grok-build__grok_cli', ['--version']),
      writeStdout: (s: string) => { out += s; },
      env: { GROK_BUILD_AUTH_MODE: 'subscription' },
      deps: deps({ grokInstalled: () => false }),
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecisionReason).toBe(GROK_NOT_INSTALLED_MESSAGE);
  });

  it('runHook denies a prompt passthrough with no session', async () => {
    let out = '';
    await runHook({
      readStdin: async () => payload('mcp__plugin_grok_grok-build__grok_cli', ['-p', 'edit it', '--always-approve']),
      writeStdout: (s: string) => { out += s; },
      env: { GROK_BUILD_AUTH_MODE: 'subscription' },
      deps: deps({ authFileExists: () => false }),
    });
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
