import { describe, it, expect } from 'vitest';
import { runGrokCli, isBlockedGrokCommand, type GrokCliDeps } from '../src/grok-cli.js';
import type { SpawnFn, SpawnResult } from '../src/delegate.js';

const fakeSpawn = (r: Partial<SpawnResult>, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): SpawnFn =>
  async (args, _cwd, env) => { cap?.(args, env); return { code: 0, stdout: '', stderr: '', timedOut: false, ...r }; };
const deps = (spawnR: Partial<SpawnResult>, env: NodeJS.ProcessEnv = {}, cap?: (a: string[], e: NodeJS.ProcessEnv) => void): GrokCliDeps =>
  ({ spawn: fakeSpawn(spawnR, cap), env });

describe('isBlockedGrokCommand', () => {
  it('blocks non-headless commands', () => {
    for (const c of ['dashboard', 'agent', 'leader', 'completions', 'wrap']) {
      expect(isBlockedGrokCommand([c])).toBe(true);
    }
  });
  it('blocks login entirely (device URL cannot be surfaced through the buffered spawn)', () => {
    expect(isBlockedGrokCommand(['login'])).toBe(true);
    expect(isBlockedGrokCommand(['login', '--device-auth'])).toBe(true);
  });
  it('allows normal utility commands', () => {
    expect(isBlockedGrokCommand(['sessions', 'list'])).toBe(false);
    expect(isBlockedGrokCommand(['models'])).toBe(false);
  });
});

describe('runGrokCli', () => {
  it('blocked command returns status blocked without spawning', async () => {
    let spawned = false;
    const r = await runGrokCli('subscription', ['dashboard'], {
      spawn: async () => { spawned = true; return { code: 0, stdout: '', stderr: '', timedOut: false }; },
      env: {},
    });
    expect(r.status).toBe('blocked');
    expect(spawned).toBe(false);
  });
  it('prepends --no-auto-update and applies billing-safe env (subscription strips keys)', async () => {
    let capArgs: string[] = []; let capEnv: NodeJS.ProcessEnv = {};
    await runGrokCli('subscription', ['models'], deps({ code: 0, stdout: 'gpt' }, { XAI_API_KEY: 'sk', PATH: '/usr/bin' }, (a, e) => { capArgs = a; capEnv = e; }));
    expect(capArgs[0]).toBe('--no-auto-update');
    expect(capArgs).toContain('models');
    expect(capEnv.XAI_API_KEY).toBeUndefined();
  });
  it('api mode passes keys through and reports metered_api billing', async () => {
    let capEnv: NodeJS.ProcessEnv = {};
    const r = await runGrokCli('api', ['models'], deps({ code: 0 }, { XAI_API_KEY: 'sk' }, (_a, e) => { capEnv = e; }));
    expect(capEnv.XAI_API_KEY).toBe('sk');
    expect(r.billing).toBe('metered_api');
  });
  it('exit 0 -> ok, non-zero -> error, timeout -> timeout', async () => {
    expect((await runGrokCli('subscription', ['models'], deps({ code: 0 }))).status).toBe('ok');
    expect((await runGrokCli('subscription', ['models'], deps({ code: 1, stderr: 'boom' }))).status).toBe('error');
    expect((await runGrokCli('subscription', ['models'], deps({ timedOut: true, code: null }))).status).toBe('timeout');
  });
  it('timeout preserves the captured stdout/stderr tails (not discarded)', async () => {
    const r = await runGrokCli('subscription', ['export', 'big'], deps({ timedOut: true, code: null, stdout: 'partial output', stderr: 'warn' }));
    expect(r.status).toBe('timeout');
    expect(r.stdoutTail).toContain('partial output');
    expect(r.stderrTail).toContain('warn');
  });
  it('spawnError -> error', async () => {
    const r = await runGrokCli('subscription', ['models'], deps({ spawnError: true, code: null }));
    expect(r.status).toBe('error');
  });
});
