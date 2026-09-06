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

  // A10: the dashboard used to mirror auth.ok. It now mirrors nothing — a read-only diagnostic
  // that produced a complete payload is a successful call, and "not ready" is a field inside it,
  // not a failure to answer. (grok_auth_check above still mirrors, deliberately: its entire
  // output IS the verdict, so there is nothing else for a consumer to lose.)
  it('grok_build_status is a successful call whatever it has to report', async () => {
    expect((await call(await connect(), 'grok_build_status')).isError).toBeFalsy();
    const bad = await call(await connect({ checkAuth: () => failAuth } as Partial<ServerDeps>), 'grok_build_status');
    expect(bad.isError).toBeFalsy();
    // The news is still delivered — just not by throwing the payload away.
    expect(payload(bad).auth.ok).toBe(false);
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
  // A10: `blocked` moved from false to true. A refused command did not run, and a consumer
  // branching on isError alone was reading it as "success with no output".
  for (const [status, expected] of [['ok', false], ['blocked', true], ['error', true], ['timeout', true]] as const) {
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

// A1 (docs/10, MEASURED 2026-09-05): grok_build_route ADVERTISES `additionalProperties: false` on
// both the top-level object and `signals`, but zod silently stripped anything unknown. A consumer
// sending `meteredBilling` (camelCase — the tool takes `metered_billing`) got a LOW route with the
// metered strictness never applied, and no hint that the field was ignored. Honour the schema we
// publish: unknown keys are refused, not dropped.
describe('grok_build_route — the published schema is enforced, not just advertised', () => {
  it('refuses an unknown top-level key instead of silently dropping it', async () => {
    const res = await call(await connect(), 'grok_build_route', { task: 'backfill tests', meteredBilling: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/meteredBilling/);
  });

  it('refuses an unknown signals key', async () => {
    const res = await call(await connect(), 'grok_build_route', { task: 'backfill tests', signals: { securityy: true } });
    expect(res.isError).toBe(true);
  });

  it('accepts the two danger signals a Task Manager may legitimately raise', async () => {
    const res = await call(await connect(), 'grok_build_route', { task: 'clean up', signals: { destructive: true, production: true } });
    expect(res.isError).toBe(false);
  });
});

// A2 (docs/10, MEASURED 2026-09-05): the passthrough below really did write a2.txt and really did
// spend a subscription turn, and ~/.grok-build/history.jsonl stayed at 1790 lines. /grok:usage and
// /grok:status read that file and nothing else, so passthrough edits were invisible to the
// dashboards that exist to report usage.
describe('A2 — grok_cli prompt runs land in the delegation history', () => {
  const recorder = () => {
    const rows: { input: unknown; result: unknown; meta: unknown }[] = [];
    return { rows, recordDelegation: (input: unknown, result: unknown, meta: unknown) => { rows.push({ input, result, meta }); } };
  };

  it('records a prompt run with its prompt, cwd, files and grok_cli provenance', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, mode: 'subscription', billing: 'subscription', promptRun: true, filesChanged: ['a2.txt'], stdoutTail: 'Created a2.txt' }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', { args: ['-p', 'Create a file named a2.txt', '--always-approve'], cwd: '/tmp/x' });
    expect(rec.rows).toHaveLength(1);
    const { input, result, meta } = rec.rows[0] as { input: Record<string, unknown>; result: Record<string, unknown>; meta: Record<string, unknown> };
    expect(input.prompt).toBe('Create a file named a2.txt');
    expect(input.cwd).toBe('/tmp/x');
    expect(result.status).toBe('completed');
    expect(result.filesChanged).toEqual(['a2.txt']);
    expect(meta.via).toBe('grok_cli');
  });

  it('does NOT record a read-only query — diagnostics are not delegations', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, mode: 'subscription', billing: 'subscription' }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', { args: ['sessions', 'list'], cwd: '/tmp/x' });
    expect(rec.rows).toHaveLength(0);
  });

  it('does NOT record a blocked command — nothing spawned, nothing spent', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({ status: 'blocked', exitCode: null, mode: 'subscription', billing: 'subscription', message: 'refused' }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', { args: ['-p', 'x', 'dashboard'], cwd: '/tmp/x' });
    expect(rec.rows).toHaveLength(0);
  });

  it('records a failed turn too — a burned turn is usage whether or not it worked', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({ status: 'timeout', exitCode: null, mode: 'subscription', billing: 'subscription', promptRun: true, filesChanged: [] }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', { args: ['-p', 'x'], cwd: '/tmp/x' });
    expect(rec.rows).toHaveLength(1);
    expect((rec.rows[0].result as Record<string, unknown>).status).toBe('timeout');
  });
});

describe('isError says whether the CALL failed, not whether the news is bad (A10)', () => {
  // MEASURED 2026-09-06 through the shipped bundle.
  //
  //   grok_cli {"args":["dashboard"]}       -> isError false, status "blocked"
  //   grok_build_status (api mode, no key)  -> isError true, beside a payload with all 13 fields
  //                                            populated (usageHeadline, tips, nextSteps, …)
  //
  // Both readings mislead a consumer following docs/07: the first reads a REFUSED command as
  // "success with no output", the second throws away a complete dashboard.

  it('a blocked grok_cli command is an error — it did not run', async () => {
    const client = await connect({
      runGrokCli: async () => ({
        status: 'blocked', exitCode: null, mode: 'subscription', billing: 'subscription',
        message: '`grok dashboard`는 대화형/서버 모드라 헤드리스로 실행할 수 없습니다.',
      }),
    });
    expect((await call(client, 'grok_cli', { args: ['dashboard'] })).isError).toBe(true);
  });

  // A9 gave the cancel its own field; this is the other half. An orchestrator that branches on
  // isError alone must not read "the destructive command you asked for" as done.
  it('a cancelled confirmation is an error — the action did not happen', async () => {
    const client = await connect({
      runGrokCli: async () => ({
        status: 'ok', exitCode: 0, cancelled: true, mode: 'subscription', billing: 'subscription',
        message: '확인 프롬프트가 취소되어 아무것도 변경되지 않았습니다.',
      }),
    });
    expect((await call(client, 'grok_cli', { args: ['memory', 'clear'] })).isError).toBe(true);
  });

  it('an ordinary grok_cli success stays a success', async () => {
    const client = await connect({
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, mode: 'subscription', billing: 'subscription' }),
    });
    expect((await call(client, 'grok_cli', { args: ['models'] })).isError).toBeFalsy();
  });

  // The dashboard is a read-only diagnostic. "Not authenticated" is one of its fields, and
  // reporting the whole answer as a failed call makes a consumer discard the rest — including
  // the nextSteps that say how to fix the very thing it is reporting.
  it('grok_build_status returns a valid payload as a success, even when auth is not ready', async () => {
    const client = await connect({ checkAuth: () => failAuth });
    const res = await call(client, 'grok_build_status');
    expect(res.isError).toBeFalsy();
    // ...and the auth state is still in there, so the change hides nothing.
    expect(payload(res).auth.ok).toBe(false);
  });

  // grok_auth_check is deliberately NOT changed. Its whole output IS the verdict, so there are
  // no other fields to lose, and isError is the shortest true answer to "is Grok ready?".
  it('grok_auth_check still reports not-ready as an error', async () => {
    const client = await connect({ checkAuth: () => failAuth });
    expect((await call(client, 'grok_auth_check')).isError).toBe(true);
  });
});

describe('grok_build_plan honours the fields its siblings take (A14)', () => {
  // MEASURED 2026-09-06 through the shipped bundle. plan advertised only
  //   { prompt, cwd, timeout_ms }  with additionalProperties: false
  // while delegate advertised ten. A call passing worktree:true and model:"grok-code" came back
  // isError false, status completed, and NO worktreePath — accepted and silently dropped. That
  // breaks the contract in both directions at once: additionalProperties:false promises a
  // rejection, and zod strips instead, so the caller is told neither yes nor no.
  //
  // Spreading the fields (rather than rejecting them) is the direction that helps, and worktree
  // most of all: `--permission-mode plan` is NOT read-only — grok 1.0.13 ignores it — so worktree
  // isolation is the actual containment for a plan, not a nicety.

  it('advertises the same strength fields as verify', async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    const props = (n: string) => Object.keys(
      (tools.find((t) => t.name === n)!.inputSchema as { properties: Record<string, unknown> }).properties,
    ).sort();
    expect(props('grok_build_plan')).toEqual(props('grok_build_verify'));
  });

  it('passes them through to runDelegate instead of dropping them', async () => {
    let seen: Record<string, unknown> | undefined;
    const client = await connect({
      runDelegate: async (_mode: unknown, input: Record<string, unknown>) => {
        seen = input;
        return completed;
      },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_plan', {
      prompt: 'p', cwd: '/abs', worktree: true, sandbox: 'workspace',
      model: 'grok-code', effort: 'high', resume: 'sess-1',
    });
    expect(seen).toMatchObject({
      plan: true,
      worktree: true,
      sandbox: 'workspace',
      model: 'grok-code',
      effort: 'high',
      resumeSessionId: 'sess-1',
    });
  });

  it('still marks the run as a plan', async () => {
    let seen: Record<string, unknown> | undefined;
    const client = await connect({
      runDelegate: async (_mode: unknown, input: Record<string, unknown>) => { seen = input; return completed; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_plan', { prompt: 'p', cwd: '/abs' });
    expect(seen).toMatchObject({ plan: true });
  });

  // best_of_n is carried for the same reason delegate carries it: so passing it FAILS loudly
  // instead of being ignored. It was removed in CLI 1.0.
  it('carries best_of_n so it can be refused rather than ignored', async () => {
    let seen: Record<string, unknown> | undefined;
    const client = await connect({
      runDelegate: async (_mode: unknown, input: Record<string, unknown>) => { seen = input; return completed; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_plan', { prompt: 'p', cwd: '/abs', best_of_n: 3 });
    expect(seen).toMatchObject({ bestOfN: 3 });
  });
});
