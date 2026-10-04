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
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, defaultServerDeps, type BuildServerOptions, type ServerDeps } from '../src/server.js';
import { buildHistoryEntry, recordDelegation } from '../src/history.js';
import { runGrokCli, type GrokCliDeps } from '../src/grok-cli.js';
import type { AuthMode } from '../src/types.js';

// Round 19 of the v0.2.36 pre-merge review: a handler that cut the prompt only past some length, or at 1,000
// characters, passed a test that sent one 868-character prompt — pasted indentation folds a secret far into the raw
// text back into the first 200. So a short one, one of plain words that stays over 4,000 characters when folded (round
// 21: versions that cut only a text whose folded length passed 4,000, or only one with no whitespace run, passed), and
// one with whitespace before the secret — 60,000 characters in round 19, 1,000,000 in round 20 (a cap at 65,536 had
// passed), 4,000,000 in round 21 (one at 1,048,576 had passed). A cap above that is not seen here. Round 22: pasted text
// has newlines, tabs and CRs, and cuts conditioned on a newline passed texts that had none — so newline and tab/CR
// versions were added; round 23: round 22 had REPLACED the plain ones, and cuts conditioned on having no newline then
// passed. Each long shape is here both ways.
const LONG_PROMPTS = [
  'Refactor the loader. '.repeat(40) + 'password: Xk9mQ2vR7tLpW4nB8c',
  'Refactor the loader module. '.repeat(200) + 'password: Xk9mQ2vR7tLpW4nB8c',
  'Refactor the loader module.\n'.repeat(200) + 'password: Xk9mQ2vR7tLpW4nB8c',
  'Refactor the loader.' + ' '.repeat(4_000_000) + 'password: Xk9mQ2vR7tLpW4nB8c',
  'Refactor the loader.' + ('\r\n\t' + ' '.repeat(97)).repeat(40_000) + 'password: Xk9mQ2vR7tLpW4nB8c',
];
// Compared by length and identity, never as strings: a failing comparison against a 1,000,000-character string made vitest
// compute a diff that did not finish in 5 minutes (round 20 — a failing test must fail, not hang the run).
const sameAsLong = (got: unknown[]) => got.map((g, k) => [typeof g === 'string' ? g.length : g, g === LONG_PROMPTS[k]]);
const LONG_EXPECTED = LONG_PROMPTS.map((p) => [p.length, true]);

const okAuth = { ok: true, mode: 'subscription', billing: 'subscription', serverVersion: '0.0.0-test', message: 'ready' };
const failAuth = { ok: false, mode: 'subscription', billing: 'subscription', serverVersion: '0.0.0-test', reason: 'not_logged_in', message: 'grok login이 필요합니다.' };

const completed = { status: 'completed', mode: 'subscription', billing: 'subscription', summary: 'done', filesChanged: ['a.ts'] };
// A stub return value, not a product string — these tests check that the server SHAPES a
// failure (isError, serialisation), never what the wording is. It used to copy a real message
// verbatim, which survived A33 changing that wording and left a string here that exists
// nowhere in src/.
const failed = { status: 'grok_error', mode: 'subscription', billing: 'subscription', message: '<stub failure message>' };

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
    billingCaveat: () => undefined,
    grokHomeNote: () => undefined,
    now: () => 1_000,
    nowIso: () => '2026-09-03T00:00:00.000Z',
    ...over,
  } as unknown as ServerDeps;
}

async function connect(over: Partial<ServerDeps> = {}, mode: AuthMode = 'subscription', opts: BuildServerOptions = {}) {
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    buildServer(mode, deps(over), opts).connect(serverSide),
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

    // v0.2.36 pre-merge review, round 18: the redactor must see the whole prompt before the preview is cut to 200 — a
    // handler that cut it first passed every test (the prompts here were `p`) and left the part of a secret before the
    // cut in the row (history.test.ts, round 18).
    it(`${tool}: hands history the whole prompt`, async () => {
      const inputs: { prompt: string }[] = [];
      const client = await connect({
        recordDelegation: ((i: { prompt: string }) => { inputs.push(i); }) as unknown as ServerDeps['recordDelegation'],
      } as Partial<ServerDeps>);
      for (const prompt of LONG_PROMPTS) await call(client, tool, { prompt, cwd: '/tmp/x' });
      expect(sameAsLong(inputs.map((i) => i.prompt))).toEqual(LONG_EXPECTED);
    });

    // …and the whole summary grok returned: the redactor must see all of it before the preview is cut. Round 20: a
    // handler that recorded the summary's last 4,000 characters passed every test (a cut there can fall after a secret's
    // name — the grok_cli leak round 19 fixed, on the other path) and wrote 18 of 18 characters to the row.
    it(`${tool}: hands history the whole summary`, async () => {
      const results: { summary?: string }[] = [];
      for (const summary of LONG_PROMPTS) {
        const client = await connect({
          runDelegate: async () => ({ ...completed, summary }),
          recordDelegation: ((_i: unknown, r: { summary?: string }) => { results.push(r); }) as unknown as ServerDeps['recordDelegation'],
        } as unknown as Partial<ServerDeps>);
        await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      }
      expect(sameAsLong(results.map((r) => r.summary))).toEqual(LONG_EXPECTED);
    });

    // …and a run with no summary records none — not grok's stderr in its place (round 23: a version that fell back to
    // the raw stderr tail passed every test and wrote a password whole).
    it(`${tool}: records no summary for a run that has none`, async () => {
      const results: Record<string, unknown>[] = [];
      const client = await connect({
        runDelegate: async () => ({ status: 'grok_error', mode: 'subscription', billing: 'subscription', message: 'm', rawStderrTail: 'fatal: password: Xk9mQ2vR7tLpW4nB8c' }),
        recordDelegation: ((_i: unknown, r: Record<string, unknown>) => { results.push(r); }) as unknown as ServerDeps['recordDelegation'],
      } as unknown as Partial<ServerDeps>);
      await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(results.map((r) => r.summary)).toEqual([undefined]);
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
  // Copied when written, as the real write is synchronous — every enumerable field, inherited ones too, read then (round
  // 25: a version that removed the summary from the row after recording it passed a recorder that kept references;
  // round 26: one that handed the summary over as an inherited field passed a recorder that copied own fields only).
  const snapshot = (o: unknown) => {
    const copy: Record<string, unknown> = {};
    for (const k in o as object) copy[k] = (o as Record<string, unknown>)[k];
    return copy;
  };
  const recorder = () => {
    const rows: { input: unknown; result: unknown; meta: unknown }[] = [];
    return { rows, recordDelegation: (input: unknown, result: unknown, meta: unknown) => { rows.push({ input: snapshot(input), result: snapshot(result), meta }); } };
  };

  it('records a prompt run with its prompt, cwd, files and grok_cli provenance', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      // A25: `cwd` now comes back from the run, so the stub has to model a run that happened
      // somewhere — the handler no longer re-derives it from its own arguments.
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, cwd: '/tmp/x', mode: 'subscription', billing: 'subscription', promptRun: true, filesChanged: ['a2.txt'], stdoutTail: 'Created a2.txt' }),
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

  // Round 18 of the v0.2.36 pre-merge review: the whole prompt, not a cut of it — the redactor must see all of it. Every
  // form that carries the text (round 19: a reader that cut only `--single`'s or only an attached `-p` value passed).
  it.each([
    ['-p <prompt>', (p: string) => ['-p', p]], ['-p<prompt>', (p: string) => ['-p' + p]], ['-p=<prompt>', (p: string) => ['-p=' + p]],
    ['-vp <prompt>', (p: string) => ['-vp', p]], ['--single <prompt>', (p: string) => ['--single', p]],
    ['--single=<prompt>', (p: string) => ['--single=' + p]],
    // Round 21: a reader that cut only a `-cp`/`-hp` cluster, or a prompt flag that is not the first argument, passed.
    ['-cp <prompt>', (p: string) => ['-cp', p]], ['-hp <prompt>', (p: string) => ['-hp', p]],
    ['--model m -p <prompt>', (p: string) => ['--model', 'grok-4', '-p', p]],
    // Round 22: and one that cut `--single` when it is not first, a value attached after a cluster, or a longer cluster.
    ['--model m --single <prompt>', (p: string) => ['--model', 'grok-4', '--single', p]],
    ['-vp<prompt>', (p: string) => ['-vp' + p]], ['-cp=<prompt>', (p: string) => ['-cp=' + p]],
    ['-cvp <prompt>', (p: string) => ['-cvp', p]], ['-vvp <prompt>', (p: string) => ['-vvp', p]],
    // Round 23: a form in a position no row held — `-c -p`, and each attached or clustered form after another flag.
    ['-c -p <prompt>', (p: string) => ['-c', '-p', p]], ['--model m --single=<prompt>', (p: string) => ['--model', 'grok-4', '--single=' + p]],
    ['--model m -p=<prompt>', (p: string) => ['--model', 'grok-4', '-p=' + p]], ['--model m -p<prompt>', (p: string) => ['--model', 'grok-4', '-p' + p]],
    ['--model m -vp <prompt>', (p: string) => ['--model', 'grok-4', '-vp', p]],
  ] as const)('records the whole prompt of a long run: %s', async (_label, form) => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, cwd: '/tmp/x', mode: 'subscription', billing: 'subscription', promptRun: true, filesChanged: [] }),
    } as unknown as Partial<ServerDeps>);
    for (const prompt of LONG_PROMPTS) await call(client, 'grok_cli', { args: [...form(prompt), '--always-approve'], cwd: '/tmp/x' });
    expect(sameAsLong(rec.rows.map((r) => (r.input as Record<string, unknown>).prompt))).toEqual(LONG_EXPECTED);
  });

  // …and the server records through history's own recordDelegation — every test here injects its own, so a cut placed
  // in the default deps, or a sibling module standing in for it, passed them all (round 19).
  it('the server\'s default recorder is history\'s recordDelegation', () => {
    expect(defaultServerDeps.recordDelegation).toBe(recordDelegation);
  });

  // A grok_cli run keeps 4,000 characters of a long output. Recorded as the row's summary, a cut text can hold a secret
  // the redactor cannot tell from text: a kept tail that begins after a secret's name, or inside a value past the start
  // that identifies it (round 19 of the v0.2.36 pre-merge review — 18 of 18 characters of a password cut at its name;
  // v0.2.35 wrote the same), and a kept head that ends inside a value, which the whitespace fold then pulls into the
  // 200-character preview (round 20 — 13 of 30 characters of an xAI key after 3,962 spaces, measured with the bundle).
  // Only output nothing was cut from is a summary — whatever the run's status (round 20: a version that also recorded a
  // cut output for a failed or timed-out run passed rows that were all `ok`) — and only output the read reached the end
  // of (round 21: a background child printing a key when the exit grace ran out left 17 of 30 of it, measured with the
  // bundle). A summary is the whole output, as long as it is: round 21 found handlers that cut a 32-character output
  // to 200 or 1,000 passing every row, round 22 ones that cut it to the default 4,000 (either end) passing an output of
  // 3,916, and round 23 ones that cut only an output with a newline, or at 8,192 or 10,000, passing an 8,116-character
  // line. A whole output is at most `max_chars`' ceiling, 100,000. Round 24: round 23 REPLACED that line with 100,000
  // characters of lines and put a secret in every row's stderr — versions that cut only a newline-free or shorter
  // output, or applied the rule only with stderr present, passed; and Grok, asked for versions that pass the grid, beat
  // each grid built against it (stderr in place of an empty stdout, a cut inside a window between two thresholds, a run
  // both cut and cut short — the cap on a long output sets both —, stderr of 64 or more). Round 25: round 24's grid
  // dropped the 960 spaces before the key (a version keyed on a run of spaces passed, as did one wrong only on a
  // server's first run — every cell shared one), its "alone" shapes held spaces from 32 characters up (versions keyed
  // on an output without whitespace passed), reachable flag pairs had no row (a kept head with a failed, cut-short or
  // capped run), and no call passed `max_chars`. Round 26: its stderr shapes lacked their features below 48
  // characters and no stderr held one feature without the others (versions keyed on a short stderr with a space or a
  // tab, or on non-ASCII or CR without LF, passed), a cancelled confirmation and a run killed by a signal had no row,
  // the fresh servers held six ASCII outputs (four with spaces, one with LF alone, one empty) under one call form, no
  // cell checked the prompt field, the
  // recorder dropped a summary handed over as an inherited field, round 21's and round 22's outputs were not back
  // (round 24 rebuilt the latter a character short), and round 25's turn over thirteen shapes left 1,638 of round 24's
  // pairs unsent. So every earlier output stays, as written then, each the first run of a fresh server; round 24's
  // cells run again as it sent them; round 25's keep their place, and so their call form, with round 26's after them;
  // and the grid is built to a stated bound that the test below checks: stdout of every length
  // at and between the thresholds a version would plausibly compare against, empty, or absent, in shapes that have
  // each feature — a space, a run of spaces, LF, CR, a tab, non-ASCII — alone, none, or all, at every length (and
  // round 24's six, whose words hold spaces); stderr absent, '', or of every such length up to grok_cli's 1,000, in
  // shapes that have each feature alone, none, or all at every length (and round 24's two, which hold theirs from 48);
  // every length with every shape, every length with every stderr, and every shape with every stderr meet in some
  // cell of every row; every reachable combination of the flags is a row; a server's first run meets every shape
  // with every call form, and every stderr shape and every length from 48; each call form meets every row; and every
  // cell checks the prompt as well as the summary. (A version keyed on a number not listed, on three conditions besides
  // the flags, or on where a character sits — an output over 32,768 characters that ends in LF, say — can still pass;
  // no finite grid closes that. An absent stdout or stderr is not what grok_cli
  // returns for a recorded run — a failed start is not recorded, and an empty stderr is '' — they stay as extra cells.
  // A timed-out run with neither flag is not a row: grok_cli marks every capped run cut short — grok-cli.test.ts.)
  const TAIL_CUT = { stdoutTruncated: true, stdoutTotalChars: 9000, stdoutKept: 'tail' };
  const HEAD_CUT = { stdoutTruncated: true, stdoutTotalChars: 9000, stdoutKept: 'head' };
  const THRESHOLDS = [32, 64, 100, 128, 200, 256, 500, 512, 1000, 1024, 2000, 2048, 4000, 4096, 5000, 8000, 8192, 10_000,
    16_384, 20_000, 32_768, 50_000, 65_536, 100_000];
  const LENGTHS = THRESHOLDS.flatMap((t, i) => [Math.floor(((THRESHOLDS[i - 1] ?? 0) + t) / 2), t]);
  // The outputs of rounds 19 to 24, as each was written (the 3,916, 8,116 and 100,000 of lines are rounds 21, 22 and
  // 23's, character for character).
  const KEY_AT_986 = 'Deploy notes: ' + ' '.repeat(960) + 'the key is xai-' + 'AbCdEf0123456789GhIjKl0123';
  const EARLIER_OUTS: Array<[string, string]> = [
    ['empty', ''],
    ['32 chars, one line', 'Xk9mQ2vR7tLpW4nB8c then deployed'],
    ['24 chars, two lines', 'done\nXk9mQ2vR7tLpW4nB8c\n'],
    ['3,916 chars, one line, the key behind 960 spaces', 'Deploy notes: ' + ' '.repeat(960) + 'the key is xai-' + 'AbCdEf0123456789GhIjKl0123 ' + 'y'.repeat(2900)],
    ['8,116 chars, one line, the key behind 960 spaces', 'Deploy notes: ' + ' '.repeat(960) + 'the key is xai-' + 'AbCdEf0123456789GhIjKl0123 ' + 'y'.repeat(7100)],
    ['8,115 chars, one line, the key behind 960 spaces', KEY_AT_986 + ' ' + 'y'.repeat(7099)],
    ['100,000 chars, one line, the key behind 960 spaces', (KEY_AT_986 + ' ' + 'y'.repeat(100_000)).slice(0, 100_000)],
    ['100,000 chars of lines, the key behind 960 spaces', (KEY_AT_986 + '\n' + 'step done, all services are up\n'.repeat(3300)).slice(0, 100_000)],
  ];
  const EARLIER_STDERRS = [undefined, '', 'warn: password: Xk9mQ2vR7tLpW4nB8c'];
  // Round 24's texts hold spaces inside their words; round 25's hold nothing but their separator. Each is built once.
  const textOf = (head: string, sep: string) => head + sep + 'Xk9mQ2vR7tLpW4nB8c' + sep
    + 'Deploy notes: the key is xai-AbCdEf0123456789GhIjKl0123' + sep + ('step done, all services are up' + sep).repeat(4000);
  const pure = (head: string, sep: string) =>
    [head, 'password:Xk9mQ2vR7tLpW4nB8c', 'key=xai-AbCdEf0123456789GhIjKl0123', ...Array<string>(5000).fill('step-done,all-services-are-up')].join(sep);
  // A space, a run of spaces, LF, CR, a tab, non-ASCII.
  const featuresOf = (s: string) => [s.includes(' '), s.includes('  '), s.includes('\n'), s.includes('\r'), s.includes('\t'), /[^\x00-\x7f]/.test(s)];
  // [name, text, its features, the length they hold from]
  const SHAPES: Array<[string, string, boolean[], number]> = ([
    ['spaces', textOf('done', ' '), '100000', 16],
    ['LF and spaces', textOf('done', '\n'), '101000', 32],
    ['CR and spaces', textOf('done', '\r'), '100100', 32],
    ['tabs and spaces', textOf('done', '\t'), '100010', 32],
    ['not ASCII and spaces', textOf('완료', ' '), '100001', 16],
    ['CRLF, a tab, not ASCII and spaces', textOf('완료', '\r\n\t'), '101111', 48],
    ['no whitespace', pure('done', ','), '000000', 16],
    ['LF alone', pure('done', '\n'), '001000', 16],
    ['CR alone', pure('done', '\r'), '000100', 16],
    ['a tab alone', pure('done', '\t'), '000010', 16],
    ['not ASCII alone', pure('완료', ','), '000001', 16],
    ['runs of spaces alone', pure('done', '  '), '110000', 16],
    ['all', pure('완료', '  \r\n\t'), '111111', 16],
  ] as const).map(([name, text, has, from]) => [name, text, [...has].map((c) => c === '1'), from]);
  const OUTS: Array<[string, string | undefined]> = [['no stdout', undefined], ['empty', ''],
    ...SHAPES.flatMap(([name, text]) => LENGTHS.map((n): [string, string] => [`${name}, ${n} chars`, text.slice(0, n)]))];
  // Rounds 24 and 25's three, then round 26's: each feature alone, and all — a unit of at most 15 characters, so the
  // last 16 already hold a whole one (a run of spaces too).
  const ERR_TEXTS = [('warn: retrying, password: Xk9mQ2vR7tLpW4nB8c\n').repeat(40),
    ('경고: 재시도,\tpassword: Xk9mQ2vR7tLpW4nB8c\r\n').repeat(40), ('password:Xk9mQ2vR7tLpW4nB8c;').repeat(40),
    ...['pw: Xk9mQ2vR7t;', 'pw:  Xk9mQ2vR7;', 'pw:Xk9mQ2vR7tL\n', 'pw:Xk9mQ2vR7tL\r', 'pw:\tXk9mQ2vR7tL', '암호:Xk9mQ2vR7tL', '키:  x\r\n\t']
      .map((unit) => unit.repeat(Math.ceil(1000 / unit.length) + 1))];
  // [features, the length they hold from], text by text
  const ERR_HAS: Array<[string, number]> = [['101000', 48], ['101111', 48], ['000000', 16], ['100000', 16], ['110000', 16],
    ['001000', 16], ['000100', 16], ['000010', 16], ['000001', 16], ['111111', 16]];
  const ERR_LENGTHS = LENGTHS.filter((n) => n <= 1000);
  const STDERRS: Array<string | undefined> = [undefined, '', ...ERR_TEXTS.flatMap((t) => ERR_LENGTHS.map((n) => t.slice(-n)))];
  // Round 25's stderrs are the first 56 (rounds 24's the first 38): its cells keep their place, and so their call form.
  const STDERRS_25 = STDERRS.slice(0, 2 + 3 * ERR_LENGTHS.length);
  const STDERRS_26 = STDERRS.slice(2 + 3 * ERR_LENGTHS.length);
  type Cell = [string, string | undefined, string | undefined];
  // Every output with the stderrs grok_cli most often gives: absent, '', short, its 1,000 ceiling.
  const EVERY_OUTPUT: Cell[] = OUTS.flatMap(([shape, out]) =>
    [undefined, '', 'warn: password: Xk9mQ2vR7tLpW4nB8c', ERR_TEXTS[0].slice(-1000)].map((err): Cell => [shape, out, err]));
  // Every stdout length (and absent, and empty) with every stderr, the shape turning with both — so each shape meets
  // each stderr too.
  const LEVELS: Array<number | undefined> = [undefined, 0, ...LENGTHS];
  const pairs = (errs: Array<string | undefined>, shapes: typeof SHAPES) => LEVELS.flatMap((n, i) => errs.map((err, j): Cell => {
    if (n === undefined) return ['no stdout', undefined, err];
    if (n === 0) return ['empty', '', err];
    const [name, text] = shapes[(i + j) % shapes.length];
    return [`${name}, ${n} chars`, text.slice(0, n), err];
  }));
  const EVERY_PAIR: Cell[] = [...pairs(STDERRS_25, SHAPES), ...pairs(STDERRS_26, SHAPES)];
  const CELLS: Cell[] = [...EVERY_OUTPUT, ...EVERY_PAIR];
  // Round 24's cells as it sent them — its 290 outputs with the four stderrs, then its six shapes turning with its 38
  // stderrs — every one with the plain call (round 26: round 25's turn over thirteen shapes, and its call forms, left
  // 1,638 of those pairs unsent and all but 296 cells of its grid connection under another call).
  const CELLS_24: Cell[] = [...EVERY_OUTPUT.slice(0, (2 + 6 * 48) * 4), ...pairs(STDERRS.slice(0, 2 + 2 * ERR_LENGTHS.length), SHAPES.slice(0, 6))];
  // Each form of the call, turning cell by cell.
  const CALLS = [
    { args: ['-p', 'deploy', '--always-approve'], cwd: '/tmp/x' },
    { args: ['-p', 'deploy', '--always-approve'], cwd: '/tmp/x', max_chars: 50 },
    { args: ['-p', 'deploy', '--always-approve'], cwd: '/tmp/x', max_chars: 100_000 },
    { args: ['-p', 'deploy', '--always-approve'], cwd: '/tmp/x', timeout_ms: 1000 },
    { args: ['-p', 'deploy', '--always-approve', '--help'], cwd: '/tmp/x' },
  ];
  // A server's first run: every shape under every call form, the stderr (absent, '', each shape) and the length (each
  // from 48) turning with them (round 26: the fresh servers held six ASCII outputs — four with spaces, one with LF
  // alone, one empty — under one call form).
  const LONG_ENOUGH = LENGTHS.filter((n) => n >= 48);
  const FIRST_ERRS = [undefined, '', ...ERR_TEXTS];
  const FIRST_RUNS: Array<[Cell, number, number]> = SHAPES.flatMap(([name, text], s) => CALLS.map((_, form): [Cell, number, number] => {
    const k = s * CALLS.length + form;
    const n = LONG_ENOUGH[k % LONG_ENOUGH.length];
    const e = k % FIRST_ERRS.length;
    const err = FIRST_ERRS[e] ? FIRST_ERRS[e]!.slice(-ERR_LENGTHS[k % ERR_LENGTHS.length]) : FIRST_ERRS[e];
    return [[`${name}, ${n} chars`, text.slice(0, n), err], form, e];
  }));
  const FEATURE_SETS = ['000000', '100000', '110000', '001000', '000100', '000010', '000001', '111111'];
  it('the summary grid spans its lengths, shapes, stderrs and call forms', () => {
    expect([LENGTHS.length, OUTS.length, Math.max(...OUTS.map(([, o]) => o?.length ?? 0)), STDERRS.length, CELLS.length])
      .toEqual([48, 2 + 13 * 48, 100_000, 2 + 10 * 18, (2 + 13 * 48) * 4 + 50 * (2 + 10 * 18)]);
    expect([STDERRS_25.length, STDERRS_26.length, CELLS_24.length]).toEqual([56, 126, 290 * 4 + 50 * 38]);
    // What earlier rounds sent stays as they sent it (round 27: nothing pinned it, and rounds 22 to 25 each lost inputs
    // while rebuilding the grid). Each hash is of that round's cells built from its own committed test text (ed112b4,
    // 5394cc2) — stdout, stderr and call form, one JSON line a cell — and the earlier outputs keep their lengths and labels.
    const digest = (cells: Cell[], form: (i: number) => number) => {
      const h = createHash('sha256');
      cells.forEach((c, i) => h.update(JSON.stringify([c[1] ?? null, c[2] ?? null, form(i)]) + '\n'));
      return h.digest('hex').slice(0, 16);
    };
    expect([digest(CELLS_24, () => 0), digest(CELLS.slice(0, 5304), (i) => i % CALLS.length)]).toEqual(['fab08affe7a3889d', 'd8fd6751e02f2a63']);
    expect(EARLIER_OUTS.map(([label, o]) => [o.length, o === '' ? label === 'empty' : label.startsWith(`${o.length.toLocaleString('en-US')} chars`)]))
      .toEqual([0, 32, 24, 3916, 8116, 8115, 100_000, 100_000].map((n) => [n, true]));
    // A server's first run: every shape with every call form; every stderr shape, absent and ''; every length from 48.
    expect([FIRST_RUNS.length, LONG_ENOUGH.length, FIRST_ERRS.length]).toEqual([13 * 5, 46, 12]);
    expect(new Set(FIRST_RUNS.map(([[label], form]) => `${label.slice(0, label.lastIndexOf(', '))}|${form}`)).size).toBe(SHAPES.length * CALLS.length);
    expect(new Set(FIRST_RUNS.map(([, , e]) => e)).size).toBe(FIRST_ERRS.length);
    expect(new Set(FIRST_RUNS.map(([[, o]]) => o!.length))).toEqual(new Set(LONG_ENOUGH));
    expect(FIRST_RUNS.every(([[label, o, err], , e]) => label.endsWith(` ${o!.length} chars`)
      && (e < 2 ? err === FIRST_ERRS[e] : ERR_TEXTS[e - 2].endsWith(err!) && ERR_LENGTHS.includes(err!.length)))).toBe(true);
    expect([...CELLS, ...CELLS_24].every(([label, o]) => o === undefined || o === '' || label.endsWith(` ${o.length} chars`))).toBe(true);
    // Every length with every shape; every stdout level with every stderr; every shape with every stderr.
    const key = (err: string | undefined) => (err === undefined ? 'absent' : err);
    expect(new Set(EVERY_OUTPUT.map(([label]) => label)).size).toBe(2 + SHAPES.length * LENGTHS.length);
    expect(new Set(EVERY_PAIR.map(([, o, err]) => `${o === undefined ? 'none' : o.length}|${key(err)}`)).size).toBe(50 * STDERRS.length);
    expect(new Set(EVERY_PAIR.filter(([, o]) => o).map(([label, , err]) => `${label.slice(0, label.lastIndexOf(', '))}|${key(err)}`)).size)
      .toBe(SHAPES.length * STDERRS.length);
    // Each shape has its features at every length from the one given (round 25: round 24 checked 16 characters only,
    // and its "alone" shapes held spaces from 32 up) — and among them each feature alone, none, and all.
    for (const [name, text, has, from] of SHAPES) {
      for (const n of LENGTHS.filter((m) => m >= from)) expect(featuresOf(text.slice(0, n)), `${name}, ${n} chars`).toEqual(has);
    }
    const whole = SHAPES.filter(([, , , from]) => from === 16).map(([, , has]) => has.map(Number).join(''));
    expect(FEATURE_SETS.every((f) => whole.includes(f))).toBe(true);
    expect(STDERRS.slice(2).map((e) => e!.length)).toEqual(ERR_TEXTS.flatMap(() => ERR_LENGTHS));
    expect(ERR_LENGTHS.at(-1)).toBe(1000);
    // The same for stderr, read from its end (round 26: its shapes were checked from 48 only, and none had one
    // feature without the others).
    expect(ERR_HAS).toHaveLength(ERR_TEXTS.length);
    for (const [k, [has, from]] of ERR_HAS.entries()) {
      for (const n of ERR_LENGTHS.filter((m) => m >= from)) expect(featuresOf(ERR_TEXTS[k].slice(-n)).map(Number).join(''), `stderr ${k}, ${n} chars`).toBe(has);
    }
    const errWhole = ERR_HAS.filter(([, from]) => from === 16).map(([has]) => has);
    expect(FEATURE_SETS.every((f) => errWhole.includes(f))).toBe(true);
    expect(CALLS.length).toBeLessThan(CELLS.length);
    // Every reachable combination of the flags is a row (round 26: the comment said so, and nothing checked it): what
    // was kept × whether the read reached stdout's end × how the run ended — ok, cancelled (exit 0), failed with a code,
    // killed by a signal (no code), or capped (always cut short). Only the whole, read-to-the-end rows keep a summary.
    const flagsOf = (f: Record<string, unknown>) => [f.stdoutKept ?? 'all', f.stdoutCutShort ? 'cut short' : 'to the end',
      f.status === 'timeout' ? 'capped' : f.cancelled ? 'cancelled' : f.status === 'error' ? (f.exitCode === null ? 'killed' : 'failed') : 'ok'].join('|');
    const have = new Set(ROWS.map(([, f]) => flagsOf(f)));
    const reachable = ['all', 'head', 'tail'].flatMap((kept) => ['to the end', 'cut short'].flatMap((read) =>
      ['ok', 'cancelled', 'failed', 'killed', ...(read === 'cut short' ? ['capped'] : [])].map((end) => `${kept}|${read}|${end}`)));
    expect(reachable).toHaveLength(27);
    expect(reachable.filter((r) => !have.has(r))).toEqual([]);
    expect(ROWS.filter(([, f, kept]) => kept !== flagsOf(f).startsWith('all|to the end|')).map(([label]) => label)).toEqual([]);
  });
  const ROWS = [
    ['whole', {}, true],
    ['whole, a failed run', { status: 'error', exitCode: 1 }, true],
    ['cut, its head kept', { stdoutTruncated: true, stdoutTotalChars: 9000, stdoutKept: 'head' }, false],
    ['cut, its tail kept', TAIL_CUT, false],
    ['cut, a failed run', { ...TAIL_CUT, status: 'error', exitCode: 1 }, false],
    ['cut, a timed-out run', { ...TAIL_CUT, status: 'timeout', exitCode: null }, false],
    ['cut short by the exit grace', { stdoutCutShort: true }, false],
    // Round 22: a version that let a failed run's cut-short output through passed every row (17 of 30 characters).
    ['cut short by the exit grace, a failed run', { status: 'error', exitCode: 3, stdoutCutShort: true }, false],
    ['ended by the cap', { status: 'timeout', exitCode: null, stdoutCutShort: true }, false],
    // Round 21: every cut row above had 9,000 characters — a rule that read "whole" as "at most 4,000 in all" passed;
    // `max_chars` can cut far below that.
    ['cut to a small max_chars', { stdoutTruncated: true, stdoutTotalChars: 151, stdoutKept: 'head' }, false],
    // Round 24 (Grok): a version that recorded a run marked both ways passed every row above, each marked one way.
    ['cut, and cut short by the exit grace', { ...TAIL_CUT, stdoutCutShort: true }, false],
    ['cut, and ended by the cap', { ...TAIL_CUT, status: 'timeout', exitCode: null, stdoutCutShort: true }, false],
    // Round 25: the reachable combinations no row held (a prompt run with `--help` keeps the head).
    ['cut, its head kept, a failed run', { ...HEAD_CUT, status: 'error', exitCode: 1 }, false],
    ['cut, its head kept, and cut short by the exit grace', { ...HEAD_CUT, stdoutCutShort: true }, false],
    ['cut, its head kept, a failed run cut short by the exit grace', { ...HEAD_CUT, status: 'error', exitCode: 3, stdoutCutShort: true }, false],
    ['cut, its head kept, and ended by the cap', { ...HEAD_CUT, status: 'timeout', exitCode: null, stdoutCutShort: true }, false],
    ['cut, a failed run cut short by the exit grace', { ...TAIL_CUT, status: 'error', exitCode: 3, stdoutCutShort: true }, false],
    // Round 26: a cancelled confirmation (exit 0, so `ok`) and a run killed by a signal (`error`, no exit code), each
    // whole, cut at either end, and cut short — grok_cli sets these flags apart from the others (grok-cli.ts).
    ['whole, a cancelled confirmation', { cancelled: true }, true],
    ['cut, a cancelled confirmation', { ...TAIL_CUT, cancelled: true }, false],
    ['cut, its head kept, a cancelled confirmation', { ...HEAD_CUT, cancelled: true }, false],
    ['cut short by the exit grace, a cancelled confirmation', { stdoutCutShort: true, cancelled: true }, false],
    ['cut, and cut short by the exit grace, a cancelled confirmation', { ...TAIL_CUT, stdoutCutShort: true, cancelled: true }, false],
    ['cut, its head kept, and cut short by the exit grace, a cancelled confirmation', { ...HEAD_CUT, stdoutCutShort: true, cancelled: true }, false],
    ['whole, killed by a signal', { status: 'error', exitCode: null }, true],
    ['cut, killed by a signal', { ...TAIL_CUT, status: 'error', exitCode: null }, false],
    ['cut, its head kept, killed by a signal', { ...HEAD_CUT, status: 'error', exitCode: null }, false],
    ['cut short by the exit grace, killed by a signal', { status: 'error', exitCode: null, stdoutCutShort: true }, false],
    ['cut, and cut short by the exit grace, killed by a signal', { ...TAIL_CUT, status: 'error', exitCode: null, stdoutCutShort: true }, false],
    ['cut, its head kept, and cut short by the exit grace, killed by a signal', { ...HEAD_CUT, status: 'error', exitCode: null, stdoutCutShort: true }, false],
  ] as const;
  it.each(ROWS)('records the output as the summary only when nothing was cut from it: %s', async (_label, cut, kept) => {
    // With a secret in stderr: a refused summary must not be replaced by another cut tail (round 23: a version that
    // fell back to stderr's last characters passed every row); and without one, or with an empty one (round 24).
    const stub = (out: string | undefined, err: string | undefined) => async () => ({
      status: 'ok', exitCode: 0, cwd: '/tmp/x', mode: 'subscription', billing: 'subscription', promptRun: true, filesChanged: [],
      ...(out !== undefined ? { stdoutTail: out } : {}), ...(err !== undefined ? { stderrTail: err } : {}), ...cut });
    const check = (row: { input: unknown; result: unknown }, [shape, out, err]: Cell, how: string) => {
      const where = `${shape}, stderr ${err === undefined ? 'absent' : `of ${err.length}`}, ${how}`;
      const summary = (row.result as Record<string, unknown>).summary;
      // No output, or an empty one, is no summary in any row — and stderr does not take its place.
      expect(kept && out ? [typeof summary === 'string' ? summary.length : summary, summary === out] : summary, where)
        .toEqual(kept && out ? [out.length, true] : undefined);
      // …and the prompt is the one given (round 26: a version that wrote a cut output into the prompt passed every cell).
      expect((row.input as Record<string, unknown>).prompt, where).toBe('deploy');
    };
    // The earlier outputs, each the first run of a fresh server.
    for (const [shape, out] of EARLIER_OUTS) {
      for (const err of EARLIER_STDERRS) {
        const rec = recorder();
        const client = await connect({ recordDelegation: rec.recordDelegation, runGrokCli: stub(out, err) } as unknown as Partial<ServerDeps>);
        await call(client, 'grok_cli', CALLS[0]);
        expect(rec.rows).toHaveLength(1);
        check(rec.rows[0], [shape, out, err], 'a fresh server');
      }
    }
    // Every shape, call form and stderr shape as a server's first run.
    for (const [c, form] of FIRST_RUNS) {
      const rec = recorder();
      const client = await connect({ recordDelegation: rec.recordDelegation, runGrokCli: stub(c[1], c[2]) } as unknown as Partial<ServerDeps>);
      await call(client, 'grok_cli', CALLS[form]);
      expect(rec.rows).toHaveLength(1);
      check(rec.rows[0], c, `a fresh server, call form ${form}`);
    }
    // Round 24's cells, on one connection, as it sent them.
    const rec24 = recorder();
    let cell24: Cell = CELLS_24[0];
    const client24 = await connect({
      recordDelegation: rec24.recordDelegation,
      runGrokCli: async () => stub(cell24[1], cell24[2])(),
    } as unknown as Partial<ServerDeps>);
    for (const [i, c] of CELLS_24.entries()) {
      cell24 = c;
      await call(client24, 'grok_cli', CALLS[0]);
      expect(rec24.rows).toHaveLength(i + 1);
      check(rec24.rows[i], c, 'as round 24 sent it');
    }
    // The grid, on one connection.
    const rec = recorder();
    let cell: Cell = CELLS[0];
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => stub(cell[1], cell[2])(),
    } as unknown as Partial<ServerDeps>);
    for (const [i, c] of CELLS.entries()) {
      cell = c;
      await call(client, 'grok_cli', CALLS[i % CALLS.length]);
      expect(rec.rows).toHaveLength(i + 1);
      check(rec.rows[i], c, `call form ${i % CALLS.length}`);
    }
    // 89 fresh servers, 3,060 calls on one connection and 11,604 on another a row; a starved CPU would pass the default 5 s.
  }, 60_000);

  // The recorders above copy what they are handed; history's own entry builder is what the file gets. Every row's flags
  // through it: a cut output leaves no summary preview, a whole one does, and the prompt is the one given (round 26).
  it.each(ROWS)('history\'s own entry keeps a preview of the output only when nothing was cut from it: %s', async (_label, cut, kept) => {
    const entries: Array<Record<string, unknown>> = [];
    const client = await connect({
      recordDelegation: ((input: never, result: never, meta: never) => { entries.push({ ...buildHistoryEntry(input, result, meta) }); }) as ServerDeps['recordDelegation'],
      runGrokCli: async () => ({ status: 'ok', exitCode: 0, cwd: '/tmp/x', mode: 'subscription', billing: 'subscription', promptRun: true,
        filesChanged: [], stdoutTail: 'Xk9mQ2vR7tLpW4nB8c then deployed', stderrTail: 'warn: password: Xk9mQ2vR7tLpW4nB8c', ...cut }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', CALLS[0]);
    expect(entries).toHaveLength(1);
    expect([entries[0].summaryPreview, entries[0].promptPreview]).toEqual([kept ? 'Xk9mQ2vR7tLpW4nB8c then deployed' : undefined, 'deploy']);
  });

  // The two flag families round 26 added are what the real grok_cli returns (only its spawn and git are fakes): a
  // confirmation nobody answered, and a run a signal killed, each with a long output cut to its tail.
  it.each([
    ['a cancelled confirmation', { code: 0, stdout: 'x'.repeat(3000) + '\npassword: Xk9mQ2vR7tLpW4nB8c\nContinue? [y/N] Cancelled.\n' + 'y'.repeat(2000) },
      { status: 'ok', exitCode: 0, cancelled: true }],
    ['a run killed by a signal', { code: null, stdout: 'password: Xk9mQ2vR7tLpW4nB8c ' + 'z'.repeat(5000) }, { status: 'error', exitCode: null }],
  ] as const)('the real grok_cli result for %s, cut, is recorded with no summary and the prompt as given', async (_label, spawned, flags) => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: (mode: AuthMode, args: string[], opts: Parameters<typeof runGrokCli>[3]) => runGrokCli(mode, args, {
        spawn: async () => ({ stderr: '', timedOut: false, ...spawned }), env: {}, gitChangedFiles: async () => [],
      } as unknown as GrokCliDeps, opts),
    } as unknown as Partial<ServerDeps>);
    const res = payload(await call(client, 'grok_cli', { args: ['-p', 'deploy', '--always-approve'], cwd: tmpdir() }));
    expect(res).toMatchObject({ ...flags, stdoutTruncated: true, stdoutKept: 'tail', promptRun: true });
    expect(rec.rows).toHaveLength(1);
    expect([(rec.rows[0].result as Record<string, unknown>).summary, (rec.rows[0].input as Record<string, unknown>).prompt]).toEqual([undefined, 'deploy']);
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
  // Spreading the fields (rather than rejecting them) is the direction that helps. worktree separates
  // a plan's edits for review but does not contain grok (a plan in a worktree still pushed per an
  // allow rule — contract §6); what stops a plan from acting is grok honouring the deny rules (A50).

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

describe('every tool enforces the additionalProperties:false it publishes (A21)', () => {
  // MEASURED 2026-09-06 against the shipped bundle: all nine tools advertise
  // `additionalProperties: false`, and exactly one — grok_build_route, the tool A1 made
  // `.strict()` — actually refused an unknown key. The other eight accepted it and dropped it.
  //
  // Measured end to end, delegate called with `worktreee` (three e's) in a throwaway repo:
  //   isError false · status completed · worktreePath absent · filesChanged ["typo-probe.txt"]
  // The caller asked for isolation, got none, and was told the run succeeded.
  //
  // Two fields cost a PROTECTION when a typo drops them, not just a preference: `worktree`
  // (grok edits the caller's cwd instead of an isolated copy) and `sandbox` (no filesystem or
  // network profile; kernel-enforced on Linux/macOS). Grok found the second one — I had claimed
  // worktree was the only one.
  const UNKNOWN = { totally_bogus: 1 };

  const CASES: [string, Record<string, unknown>][] = [
    ['grok_auth_check', {}],
    ['grok_build_delegate', { prompt: 'p', cwd: '/abs' }],
    ['grok_build_plan', { prompt: 'p', cwd: '/abs' }],
    ['grok_build_verify', { prompt: 'p', cwd: '/abs' }],
    ['grok_build_usage', {}],
    ['grok_build_status', {}],
    ['grok_build_worktree', { action: 'list', cwd: '/abs' }],
    ['grok_build_route', { task: 't' }],
    ['grok_cli', { args: ['--version'] }],
  ];

  for (const [name, base] of CASES) {
    it(`${name} refuses an unknown key`, async () => {
      const res = await call(await connect(), name, { ...base, ...UNKNOWN });
      expect(res.isError, `${name} accepted an unknown key`).toBe(true);
      expect(res.content[0].text).toMatch(/totally_bogus/);
    });
  }

  // The two that matter most, spelled out: a near-miss on a safety field must not be read as
  // "the caller did not ask for it".
  it('refuses a typo on the isolation flag rather than running without isolation', async () => {
    const res = await call(await connect(), 'grok_build_delegate', { prompt: 'p', cwd: '/abs', worktreee: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/worktreee/);
  });

  it('refuses a typo on the sandbox profile rather than running unsandboxed', async () => {
    const res = await call(await connect(), 'grok_build_delegate', { prompt: 'p', cwd: '/abs', sandboxx: 'read-only' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/sandboxx/);
  });

  // Guard the other direction: strictness must not start refusing legitimate calls.
  it('still accepts every documented field', async () => {
    const res = await call(await connect(), 'grok_build_delegate', {
      prompt: 'p', cwd: '/abs', timeout_ms: 1000, worktree: true, sandbox: 'workspace',
      model: 'grok-4.6', effort: 'high', resume: 'sess',
    });
    expect(res.isError).toBeFalsy();
  });

  // A46 (docs/10, MEASURED 2026-09-25): Node clamps a timer delay above 2^31-1 ms to 1 ms, and the
  // schema accepted any positive integer — so `timeout_ms: 3e9`, a caller asking for "effectively no
  // limit", killed grok about 1 ms after it started (measured: returned at 21 ms as timedOut).
  for (const tool of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify', 'grok_cli']) {
    it(`${tool}: refuses a timeout_ms no timer can hold, without running anything`, async () => {
      let ran = 0;
      const client = await connect({
        runDelegate: async () => { ran += 1; return completed; },
        runGrokCli: async () => { ran += 1; return { status: 'ok', exitCode: 0 }; },
      } as Partial<ServerDeps>);
      const args = tool === 'grok_cli' ? { args: ['--version'], timeout_ms: 3e9 } : { prompt: 'p', cwd: '/abs', timeout_ms: 3e9 };
      const res = await call(client, tool, args);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/timeout_ms/);
      expect(ran).toBe(0);
    });
  }
  it('accepts the largest delay a timer does hold', async () => {
    const res = await call(await connect(), 'grok_build_delegate', { prompt: 'p', cwd: '/abs', timeout_ms: 2_147_483_647 });
    expect(res.isError).toBeFalsy();
  });

  // MEASURED: `_meta` at the params level — where the MCP spec puts it — never reaches the
  // arguments object, so strictness cannot reject a spec-compliant client. Pinned because the
  // whole risk of this change lives in that one sentence.
  it('is unaffected by params-level _meta', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'grok_build_route',
      arguments: { task: 'backfill tests' },
      _meta: { progressToken: 'tok-1' },
    }) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
  });
});

// A25 (docs/10, MEASURED 2026-09-06 through the shipped bundle). Two prompt-carrying grok_cli
// calls, both of which actually ran in D:/Source/claude-grok-build-plugin (the server process's
// own directory); the only difference was that the second passed `cwd`:
//   row 1: {"cwd":"",                                 "via":"grok_cli"}
//   row 2: {"cwd":"D:/Source/claude-grok-build-plugin","via":"grok_cli"}
//   usage unfiltered -> 2   usage/status filtered to that directory -> 1
// The handler wrote `cwd ?? ''` while runGrokCli had already defaulted to process.cwd(), so a
// cwd-scoped dashboard could not see the run — A17's harm, from the writer's end instead of the
// reader's. Re-deriving the default here was rejected: A7 was caused by exactly that (two places
// deriving one default, then drifting), so the value comes back from the run that used it.
describe('A25 — a grok_cli row names the directory the run actually used', () => {
  const recorder = () => {
    const rows: { input: unknown }[] = [];
    return { rows, recordDelegation: (input: unknown) => { rows.push({ input }); } };
  };

  it('records the resolved cwd when the caller passed none', async () => {
    const rec = recorder();
    const client = await connect({
      recordDelegation: rec.recordDelegation,
      runGrokCli: async () => ({
        status: 'ok', exitCode: 0, mode: 'subscription', billing: 'subscription',
        promptRun: true, filesChanged: [], cwd: '/resolved/by/the/run',
      }),
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_cli', { args: ['-p', 'do the thing'] });
    expect(rec.rows).toHaveLength(1);
    const input = (rec.rows[0] as { input: Record<string, unknown> }).input;
    expect(input.cwd).toBe('/resolved/by/the/run');
  });
});

// A34 (docs/10, MEASURED 2026-09-24). grok loads installed Claude Code plugins as its own, so every
// worker this server starts gets a COPY of this server as an MCP tool source (every recorded worker
// session that set up MCP — contract §14). Through that copy a worker can start another grok:
//   before: outer grok_build_delegate -> filesChanged []   while the nested run wrote
//           m2c-B/nested.txt and its own history row (session 9820047c, 10.5 s, success: true)
// Real use got there three times on its own (grok 1.0.13) — review prompts forwarded to
// grok_build_verify, once aimed at the main repo from a worktree-isolated run — stopped only because
// those were plan runs and plan mode cancelled MCP calls. --always-approve runs execute them (9/9).
// The copy knows where it is from GROK_BUILD_WORKER, which buildGrokEnv sets on every grok it starts.
describe('A34 — inside a grok worker, every tool refuses and touches nothing', () => {
  /** Every dependency throws: a refusal that reached any of them is not a refusal. */
  const explodingDeps = (): Partial<ServerDeps> => {
    const boom = (name: string) => () => { throw new Error(`inside a worker, ${name} must not run`); };
    return Object.fromEntries(
      ['checkAuth', 'runDelegate', 'recordDelegation', 'readHistory', 'summarizeHistory', 'buildStatusSnapshot',
        'listRepoWorktrees', 'diffGrokWorktree', 'applyGrokWorktree', 'removeGrokWorktree', 'pruneGrokWorktrees',
        'routeTask', 'planNextAction', 'runGrokCli', 'billingCaveat', 'grokHomeNote'].map((k) => [k, boom(k)]),
    ) as Partial<ServerDeps>;
  };
  const inWorker = () => connect(explodingDeps(), 'subscription', { insideWorker: true });

  // The payloads real workers sent. The first is the reproduction's nested call verbatim (user
  // prefix of the temp path shortened); the second is the shape of the 2026-09-12 real-use call.
  const CASES: [string, Record<string, unknown>][] = [
    ['grok_build_delegate', {
      prompt: 'Create a file named nested.txt containing the single word hi. Do nothing else.',
      cwd: 'C:\\Users\\u\\AppData\\Local\\Temp\\claude\\scratchpad\\a34\\m2c-B',
      timeout_ms: 150000,
    }],
    ['grok_build_verify', {
      prompt: 'REVIEW ONLY — do not edit any file. Answer under 150 words.\n\nEvaluate exactly these three claims. Each CONFIRMED or DISCREPANCY.',
      cwd: 'D:\\Source\\Mathless',
      timeout_ms: 180000,
    }],
    ['grok_build_plan', { prompt: 'p', cwd: '/abs' }],
    ['grok_cli', { args: ['-p', 'Say ok and stop.'] }],
    ['grok_build_worktree', { action: 'remove', cwd: '/abs', worktree_path: '/abs/.grok-build/worktrees/x' }],
    ['grok_auth_check', {}],
    ['grok_build_usage', {}],
    ['grok_build_status', {}],
    ['grok_build_route', { task: 't' }],
  ];

  it('still lists all nine tools — a refusal ends the attempt, a missing tool starts a search', async () => {
    // MEASURED: with grok-build absent from the worker's tools, the worker searched for it for
    // 10 turns and ~380k tokens (M2, twice). Listed-and-refused is one call.
    const names = (await (await inWorker()).listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(CASES.map(([n]) => n).sort());
  });

  for (const [name, args] of CASES) {
    it(`${name} refuses as inside_grok_worker and runs nothing`, async () => {
      const res = await call(await inWorker(), name, args);
      expect(res.isError, `${name} ran inside a worker`).toBe(true);
      // A dependency that ran would have thrown, and a throw is also isError — the reason is what
      // tells the refusal apart from that.
      expect(payload(res)).toMatchObject({ status: 'blocked', reason: 'inside_grok_worker' });
    });
  }

  it('does not tell the worker which variable switched it off', async () => {
    // Review finding: the reader is the worker model, and naming the switch reads as a way past it.
    const res = await call(await inWorker(), 'grok_build_delegate', CASES[0][1]);
    expect(res.content[0].text).not.toContain('GROK_BUILD_WORKER');
  });

  it('outside a worker the same delegate call runs as before', async () => {
    let delegated = 0;
    const client = await connect({ runDelegate: async () => { delegated += 1; return completed; } } as Partial<ServerDeps>);
    const res = await call(client, 'grok_build_delegate', CASES[0][1]);
    expect(res.isError).toBe(false);
    expect(delegated).toBe(1);
  });
});

// v0.2.33 (docs/specs/2026-09-24-config-model-keys-billing-caveat.md): a model with its own key in
// grok's config.toml is used before the subscription session (contract §10, measured), while
// `billing` still says "subscription" because it is derived from the mode. The owner's decision:
// tell the user beside `billing`, and never stop the run for it.
describe('billingCaveat — config.toml per-model keys are reported beside billing, never blocking', () => {
  const caveat = {
    reason: 'config_model_keys',
    configPath: '/fake/.grok/config.toml',
    models: [{ model: 'grok-4.7', via: 'api_key' }],
    message: '<stub caveat message>',
  };

  for (const tool of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
    it(`${tool}: carries the caveat and leaves status, isError and the run untouched`, async () => {
      let delegated = 0;
      const client = await connect({
        runDelegate: async () => { delegated += 1; return completed; },
        billingCaveat: () => caveat,
      } as unknown as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(delegated, 'a caveat must never stop the run').toBe(1);
      expect(res.isError).toBe(false);
      expect(payload(res)).toMatchObject({ status: 'completed', billing: 'subscription', billingCaveat: caveat });
    });

    it(`${tool}: a failed run still carries it, and isError still follows the status`, async () => {
      const client = await connect({
        runDelegate: async () => failed,
        billingCaveat: () => caveat,
      } as unknown as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(res.isError).toBe(true);
      expect(payload(res)).toMatchObject({ status: 'grok_error', billingCaveat: caveat });
    });

    it(`${tool}: a detector that throws costs nothing — the run and its result go out as before`, async () => {
      const client = await connect({
        runDelegate: async () => completed,
        billingCaveat: () => { throw new Error('detector bug'); },
      } as unknown as Partial<ServerDeps>);
      const res = await call(client, tool, { prompt: 'p', cwd: '/tmp/x' });
      expect(res.isError).toBe(false);
      expect(payload(res)).toEqual(completed);
    });
  }

  it('asks with the server mode, and is not written to the delegation history', async () => {
    const modes: string[] = [];
    const recorded: unknown[] = [];
    const client = await connect({
      billingCaveat: (m: AuthMode) => { modes.push(m); return caveat; },
      recordDelegation: ((_i: unknown, r: unknown) => { recorded.push(r); }) as unknown as ServerDeps['recordDelegation'],
    } as unknown as Partial<ServerDeps>, 'api');
    await call(client, 'grok_build_delegate', { prompt: 'p', cwd: '/tmp/x' });
    expect(modes).toEqual(['api']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).not.toHaveProperty('billingCaveat');
  });

  // Review mutation-tested these two: moving the read after the run, or hardcoding the mode in the
  // status handler, left the suite green.
  it('reads the config BEFORE grok starts — the one grok starts with is the one that matters', async () => {
    const calls: string[] = [];
    const client = await connect({
      billingCaveat: () => { calls.push('caveat'); return caveat; },
      runDelegate: async () => { calls.push('run'); return completed; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_delegate', { prompt: 'p', cwd: '/tmp/x' });
    expect(calls).toEqual(['caveat', 'run']);
  });

  it('grok_build_status asks with the server mode, not a fixed one', async () => {
    const modes: string[] = [];
    const client = await connect({
      billingCaveat: (m: AuthMode) => { modes.push(m); return undefined; },
    } as unknown as Partial<ServerDeps>, 'api');
    await call(client, 'grok_build_status');
    expect(modes).toEqual(['api']);
  });

  it('is not computed when the auth pre-check stops the call — nothing ran, nothing to qualify', async () => {
    let asked = 0;
    const client = await connect({
      checkAuth: () => failAuth,
      billingCaveat: () => { asked += 1; return caveat; },
    } as unknown as Partial<ServerDeps>);
    const res = await call(client, 'grok_build_delegate', { prompt: 'p', cwd: '/tmp/x' });
    expect(res.isError).toBe(true);
    expect(asked).toBe(0);
  });

  it('grok_build_status hands the caveat to the snapshot builder', async () => {
    const client = await connect({
      billingCaveat: () => caveat,
      buildStatusSnapshot: (auth: unknown, usage: unknown, c: unknown) => ({ auth, usage, billingCaveat: c }),
    } as unknown as Partial<ServerDeps>);
    const res = await call(client, 'grok_build_status');
    expect(res.isError).toBeFalsy();
    expect(payload(res).billingCaveat).toEqual(caveat);
  });

  it('grok_build_status survives a detector that throws', async () => {
    const client = await connect({
      billingCaveat: () => { throw new Error('detector bug'); },
      buildStatusSnapshot: (auth: unknown, usage: unknown, c: unknown) => ({ auth, usage, billingCaveat: c ?? null }),
    } as unknown as Partial<ServerDeps>);
    const res = await call(client, 'grok_build_status');
    expect(res.isError).toBeFalsy();
    expect(payload(res).billingCaveat).toBeNull();
  });
});

// A35 (docs/10; MEASURED 2026-09-24, grok 1.0.41): grok resolves a relative GROK_HOME against the
// folder it runs in. Reproduced on the shipped v0.2.33 bundle: a delegation into <task> whose
// session sat in <task>/rel-home was refused in 129 ms as "not logged in", because the pre-check
// looked under the SERVER's folder. Every lookup that stands in for grok's must get the folder
// grok will run in.
describe('A35 — the task folder reaches every GROK_HOME lookup', () => {
  const TASK = '/tmp/a35-task';

  for (const tool of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
    it(`${tool}: the auth pre-check and the caveat both get the task folder`, async () => {
      const seenAuth: (string | undefined)[] = [];
      const seenCaveat: (string | undefined)[] = [];
      const client = await connect({
        checkAuth: (_m: AuthMode, base?: string) => { seenAuth.push(base); return okAuth; },
        billingCaveat: (_m: AuthMode, base?: string) => { seenCaveat.push(base); return undefined; },
      } as unknown as Partial<ServerDeps>);
      await call(client, tool, { prompt: 'p', cwd: TASK });
      expect(seenAuth).toEqual([TASK]);
      expect(seenCaveat).toEqual([TASK]);
    });
  }

  it('a relative cwd is not used as a folder — runDelegate refuses it later, as before', async () => {
    const seenAuth: (string | undefined)[] = [];
    const client = await connect({
      checkAuth: (_m: AuthMode, base?: string) => { seenAuth.push(base); return okAuth; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_delegate', { prompt: 'p', cwd: 'relative/task' });
    expect(seenAuth).toEqual([undefined]);
  });

  it('grok_build_status and grok_auth_check use the cwd they are given', async () => {
    const seen: (string | undefined)[] = [];
    const client = await connect({
      checkAuth: (_m: AuthMode, base?: string) => { seen.push(base); return okAuth; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_status', { cwd: TASK });
    await call(client, 'grok_auth_check', { cwd: TASK });
    await call(client, 'grok_auth_check', {});
    expect(seen).toEqual([TASK, TASK, undefined]);
  });

  it('both carry grokHomeNote when the answer depends on the folder', async () => {
    const note = '<stub grokHomeNote>';
    const client = await connect({
      grokHomeNote: () => note,
      buildStatusSnapshot: (auth: unknown, usage: unknown, _c: unknown, n: unknown) => ({ auth, usage, grokHomeNote: n }),
    } as unknown as Partial<ServerDeps>);
    expect(payload(await call(client, 'grok_build_status')).grokHomeNote).toBe(note);
    expect(payload(await call(client, 'grok_auth_check')).grokHomeNote).toBe(note);
    const quiet = await connect({ grokHomeNote: () => undefined } as unknown as Partial<ServerDeps>);
    expect(payload(await call(quiet, 'grok_auth_check'))).not.toHaveProperty('grokHomeNote');
  });

  // A worktree run's grok works in a new folder under ~/.grok-build/worktrees, not in the task folder
  // (delegate.ts passes `--cwd <worktree>`), so a relative GROK_HOME resolves in there — a fresh
  // checkout, which holds no session. Checking the task folder instead said "ready", then grok
  // started in the worktree without a session and the user was told to run `grok login`, which
  // cannot help: the next worktree is another new folder.
  for (const tool of ['grok_build_delegate', 'grok_build_plan', 'grok_build_verify']) {
    it(`${tool} with worktree: asks about the new worktree's folder, not the task folder`, async () => {
      const seenAuth: (string | undefined)[] = [];
      const seenCaveat: (string | undefined)[] = [];
      const client = await connect({
        checkAuth: (_m: AuthMode, base?: string) => { seenAuth.push(base); return okAuth; },
        billingCaveat: (_m: AuthMode, base?: string) => { seenCaveat.push(base); return undefined; },
      } as unknown as Partial<ServerDeps>);
      await call(client, tool, { prompt: 'p', cwd: TASK, worktree: true });
      expect(seenAuth).toHaveLength(1);
      expect(dirname(seenAuth[0] ?? '')).toBe(join(homedir(), '.grok-build', 'worktrees'));
      expect(seenCaveat).toEqual(seenAuth);
    });
  }

  // FOUND BY GROK (review of this fix, row B) and MEASURED on the built bundle: the stand-in used
  // to be one fixed folder, `(새 worktree)`. With a session planted there — the very path the
  // refusal message named — the pre-check passed, a worktree was created, and grok, working in a
  // DIFFERENT fresh folder, ended in auth_error. A real worktree's folder is fresh on every run, so
  // the stand-in must be too; then nothing can be waiting in it.
  it('a worktree run asks about a fresh folder every time', async () => {
    const seenAuth: (string | undefined)[] = [];
    const client = await connect({
      checkAuth: (_m: AuthMode, base?: string) => { seenAuth.push(base); return okAuth; },
    } as unknown as Partial<ServerDeps>);
    await call(client, 'grok_build_delegate', { prompt: 'p', cwd: TASK, worktree: true });
    await call(client, 'grok_build_delegate', { prompt: 'p', cwd: TASK, worktree: true });
    expect(seenAuth).toHaveLength(2);
    expect(seenAuth[0]).not.toBe(seenAuth[1]);
  });

  it('a refusal says which home it looked in when the answer depends on the folder', async () => {
    const client = await connect({
      checkAuth: () => failAuth,
      grokHomeNote: (base?: string) => `<note for ${base}>`,
    } as unknown as Partial<ServerDeps>);
    const res = await call(client, 'grok_build_delegate', { prompt: 'p', cwd: TASK });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(`${failAuth.message} <note for ${TASK}>`);
    const quiet = await connect({ checkAuth: () => failAuth } as unknown as Partial<ServerDeps>);
    expect((await call(quiet, 'grok_build_delegate', { prompt: 'p', cwd: TASK })).content[0].text).toBe(failAuth.message);
  });

  // Pre-merge review: the note explains WHERE a session was looked for, so it belongs only to the
  // refusal that is about a missing session. On "grok is not installed" or api mode's "no key" it
  // would point at a folder that has nothing to do with the problem.
  it('the note rides only on a missing-session refusal', async () => {
    for (const reason of ['grok_not_installed', 'no_api_key']) {
      const client = await connect({
        checkAuth: () => ({ ...failAuth, reason, message: `<${reason}>` }),
        grokHomeNote: () => '<note>',
      } as unknown as Partial<ServerDeps>);
      expect((await call(client, 'grok_build_delegate', { prompt: 'p', cwd: TASK })).content[0].text).toBe(`<${reason}>`);
    }
  });
});
