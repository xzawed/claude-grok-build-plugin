import { describe, it, expect } from 'vitest';
import { resolveHookMode, decideHook, runHook, parseHookPayload, needsAuthGate, type HookIO } from '../src/hook.js';
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
