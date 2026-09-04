/**
 * The MCP tool handlers, driven through a real client over an in-memory transport.
 *
 * Why this file exists (audit 3, 2026-09-03): nothing exercised the handlers. Measured before
 * writing it — replacing `isError: result.status !== 'completed'` with `isError: false` at all
 * three delegate/plan/verify return sites left `tsc --noEmit` clean and all 352 tests green.
 * `isError` is the only signal an MCP client has that a delegation failed, so an inverted
 * contract would tell Claude a `grok_error` run succeeded.
 *
 * These tests call the tools the way a client does — `client.callTool({ name, arguments })` —
 * so they cover registration, schema, handler body and the returned envelope together. Fakes go
 * in through `ServerDeps`; no grok process is spawned and no home directory is touched.
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, type ServerDeps } from '../src/server.js';
import type { AuthMode } from '../src/types.js';

const okAuth = { ok: true, mode: 'subscription', billing: 'subscription', serverVersion: '0.0.0-test', message: 'ready' };
const failAuth = { ok: false, mode: 'subscription', billing: 'subscription', serverVersion: '0.0.0-test', reason: 'not_logged_in', message: 'grok login이 필요합니다.' };

const completed = { status: 'completed', mode: 'subscription', billing: 'subscription', summary: 'done', filesChanged: ['a.ts'] };
const failed = { status: 'grok_error', mode: 'subscription', billing: 'subscription', message: 'Grok Build 출력을 해석할 수 없습니다.' };

/** Deps that would explode if a handler reached for the real world. */
function deps(over: Partial<ServerDeps> = {}): ServerDeps {
  const boom = (name: string) => () => { throw new Error(`unexpected call: ${name}`); };
  return {
    checkAuth: () => okAuth,
    runDelegate: async () => completed,
    recordDelegation: () => {},
    readHistory: () => [],
    summarizeHistory: () => ({ total: 0 }),
    buildStatusSnapshot: (auth: unknown, usage: unknown) => ({ auth, usage }),
    listRepoWorktrees: async () => ({ ok: true, worktrees: [] }),
    diffGrokWorktree: async () => ({ ok: true, diff: '' }),
    applyGrokWorktree: async () => ({ ok: true, applied: true }),
    removeGrokWorktree: async () => ({ ok: true, removed: true }),
    pruneGrokWorktrees: async () => ({ ok: true, candidates: [] }),
    routeTask: () => ({ target: 'grok', risk: 'LOW', reasons: [] }),
    planNextAction: () => ({ tool: 'grok_build_delegate' }),
    runGrokCli: async () => ({ status: 'ok', exitCode: 0, mode: 'subscription', billing: 'subscription' }),
    now: () => 1_000,
    nowIso: () => '2026-09-03T00:00:00.000Z',
    ...over,
  } as unknown as ServerDeps;
}

async function connect(over: Partial<ServerDeps> = {}, mode: AuthMode = 'subscription') {
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    buildServer(mode, deps(over)).connect(serverSide),
    client.connect(clientSide),
  ]);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };

const payload = (res: { content: { text: string }[] }) => JSON.parse(res.content[0].text);

describe('registered tool surface', () => {
  it('lists exactly the nine documented tools', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'grok_auth_check', 'grok_build_delegate', 'grok_build_plan', 'grok_build_route',
      'grok_build_status', 'grok_build_usage', 'grok_build_verify', 'grok_build_worktree',
      'grok_cli',
    ]);
  });
});

describe('isError contract — delegate / plan / verify', () => {
  // The exact mutation that used to pass unnoticed.
  for (const tool of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
    it(`${tool}: completed → isError false`, async () => {
      const client = await connect({ runDelegate: async () => completed } as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(res.isError, `${tool} must not report a completed run as an error`).toBe(false);
      expect(payload(res).status).toBe('completed');
    });

    it(`${tool}: non-completed status → isError true`, async () => {
      const client = await connect({ runDelegate: async () => failed } as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(res.isError, `${tool} must surface a failed run as isError`).toBe(true);
      expect(payload(res).status).toBe('grok_error');
    });

    it(`${tool}: failed auth pre-check short-circuits without delegating`, async () => {
      let delegated = 0;
      const client = await connect({
        checkAuth: () => failAuth,
        runDelegate: async () => { delegated += 1; return completed; },
      } as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(res.isError).toBe(true);
      expect(delegated, 'must not spawn grok when auth is not ready').toBe(0);
      expect(res.content[0].text).toBe(failAuth.message);
    });

    it(`${tool}: records the delegation with timing`, async () => {
      const calls: { meta: { ts: string; durationMs: number } }[] = [];
      let t = 1_000;
      const client = await connect({
        recordDelegation: ((_i: unknown, _r: unknown, meta: { ts: string; durationMs: number }) => {
          calls.push({ meta });
        }) as unknown as ServerDeps['recordDelegation'],
        now: () => (t += 500) - 500,
      } as Partial<ServerDeps>);
      await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(calls, 'every delegation must reach history').toHaveLength(1);
      expect(calls[0].meta.durationMs).toBe(500);
      expect(calls[0].meta.ts).toBe('2026-09-03T00:00:00.000Z');
    });
  }

  it('plan sets plan:true and verify sets check:true on the delegate input', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = await connect({
      runDelegate: async (_m: AuthMode, input: Record<string, unknown>) => { seen.push(input); return completed; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_plan', { prompt: 'p', cwd: '/tmp/x' });
    await call(client, 'grok_build_verify', { prompt: 'p', cwd: '/tmp/x' });
    expect(seen[0].plan).toBe(true);
    expect(seen[0].check).toBeUndefined();
    expect(seen[1].check).toBe(true);
    expect(seen[1].plan).toBeUndefined();
  });
});

describe('isError contract — the read-only tools', () => {
  it('grok_auth_check mirrors auth.ok', async () => {
    expect((await call(await connect(), 'grok_auth_check')).isError).toBe(false);
    expect((await call(await connect({ checkAuth: () => failAuth } as Partial<ServerDeps>), 'grok_auth_check')).isError).toBe(true);
  });

  it('grok_build_status mirrors auth.ok, never the usage read', async () => {
    expect((await call(await connect(), 'grok_build_status')).isError).toBe(false);
    expect((await call(await connect({ checkAuth: () => failAuth } as Partial<ServerDeps>), 'grok_build_status')).isError).toBe(true);
  });

  it('grok_build_usage and grok_build_route are never errors', async () => {
    expect((await call(await connect(), 'grok_build_usage')).isError).toBe(false);
    expect((await call(await connect(), 'grok_build_route', { task: 'rename a symbol' })).isError).toBe(false);
  });

  it('grok_build_route returns nextAction beside the decision (docs/07 contract)', async () => {
    const res = await call(await connect(), 'grok_build_route', { task: 'bulk edit' });
    expect(payload(res).nextAction).toEqual({ tool: 'grok_build_delegate' });
    expect(payload(res).target).toBe('grok');
  });
});

describe('isError contract — grok_cli', () => {
  for (const [status, expected] of [['ok', false], ['blocked', false], ['error', true], ['timeout', true]] as const) {
    it(`status ${status} → isError ${expected}`, async () => {
      const client = await connect({
        runGrokCli: async () => ({ status, exitCode: null, mode: 'subscription', billing: 'subscription' }),
      } as unknown as Partial<ServerDeps>);
      const res = await call(client, 'grok_cli', { args: ['sessions', 'list'] });
      expect(res.isError).toBe(expected);
    });
  }
});

describe('isError contract — grok_build_worktree', () => {
  it('each action mirrors result.ok', async () => {
    const bad = { ok: false, message: 'nope' };
    for (const [action, key] of [
      ['list', 'listRepoWorktrees'], ['prune', 'pruneGrokWorktrees'],
      ['diff', 'diffGrokWorktree'], ['apply', 'applyGrokWorktree'], ['remove', 'removeGrokWorktree'],
    ] as const) {
      const args = { action, cwd: '/repo', worktree_path: '/wt' };
      expect((await call(await connect(), 'grok_build_worktree', args)).isError, `${action} ok`).toBe(false);
      const client = await connect({ [key]: async () => bad } as unknown as Partial<ServerDeps>);
      expect((await call(client, 'grok_build_worktree', args)).isError, `${action} failed`).toBe(true);
    }
  });

  it('diff/apply/remove without worktree_path fail closed instead of running', async () => {
    let touched = 0;
    for (const action of ['diff', 'apply', 'remove'] as const) {
      const client = await connect({
        diffGrokWorktree: async () => { touched += 1; return { ok: true }; },
        applyGrokWorktree: async () => { touched += 1; return { ok: true }; },
        removeGrokWorktree: async () => { touched += 1; return { ok: true }; },
      } as unknown as Partial<ServerDeps>);
      const res = await call(client, 'grok_build_worktree', { action, cwd: '/repo' });
      expect(res.isError, action).toBe(true);
      expect(payload(res).ok).toBe(false);
    }
    expect(touched, 'no worktree operation may run without an explicit path').toBe(0);
  });
});
