/**
 * MCP 2.0 plan, Task 2.3: the built bundle serves the 2025 era (`initialize`) and revision 2026-07-28 (`server/discover`)
 * side by side (`serveStdio`), and a client sees the same server in both. Runs the committed bundle over real stdio —
 * `npm run build` first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession } from '../../.claude/tools/rpc-era.mjs';
import { bundlePath, connectBundle, isolatedServerEnv, rawLegacySession, MODERN_REVISION, type BundleConnection, type Era } from './bundle-client.js';

const TOOLS = [
  'grok_auth_check', 'grok_build_delegate', 'grok_build_plan', 'grok_build_route', 'grok_build_status',
  'grok_build_usage', 'grok_build_verify', 'grok_build_worktree', 'grok_cli',
];

/** Valid arguments for every tool on a path that never spawns grok: no grok is on PATH, and best_of_n is refused
 *  before any spawn (the grader's quota-0 shapes, `.claude/tools/accept-release.mjs` A21). */
function quotaZeroCalls(home: string): Array<[string, Record<string, unknown>]> {
  return [
    ['grok_auth_check', {}],
    ['grok_build_delegate', { prompt: 'x', cwd: home, best_of_n: 2 }],
    ['grok_build_plan', { prompt: 'x', cwd: home, best_of_n: 2 }],
    ['grok_build_verify', { prompt: 'x', cwd: home, best_of_n: 2 }],
    ['grok_build_usage', {}],
    ['grok_build_status', {}],
    ['grok_build_worktree', { action: 'list', cwd: home }],
    ['grok_build_route', { task: 'x' }],
    ['grok_cli', { args: ['--version'] }],
  ];
}

const textOf = (r: { content?: unknown }) => (r.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? '';

/**
 * The bundle over raw lines in `era` (rpc-era's session — no SDK in between), with the id of every line it writes.
 * Each request gives up after RAW_REPLY_MS, inside the RAW_TEST_MS its test may take, so a bundle that never answers
 * fails the test with a reason and `close()` still removes the home (review of PR #231 — with rpc-era's 30 s default
 * the run ended at vitest's 5 s and left it behind).
 */
const RAW_REPLY_MS = 10_000;
const RAW_TEST_MS = 30_000;
async function rawEraSession(era: Era) {
  const home = mkdtempSync(join(tmpdir(), `dual-era-raw-${era}-`));
  const child = spawn(process.execPath, [bundlePath], { env: isolatedServerEnv(home), cwd: home, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const gone = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  const close = async () => {
    child.kill();
    await gone;
    rmSync(home, { recursive: true, force: true });
  };
  const ids: unknown[] = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) ids.push((() => { try { return (JSON.parse(line) as { id?: unknown }).id; } catch { return `unparsed: ${line}`; } })());
    }
  });
  try {
    return { child, s: await openSession(child, era, { timeoutFor: () => RAW_REPLY_MS }), ids, close };
  } catch (e) {
    await close();
    throw e;
  }
}

const open: BundleConnection[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close();
});
async function connect(era: Era | 'auto'): Promise<BundleConnection> {
  const c = await connectBundle(era);
  open.push(c);
  return c;
}

describe('the bundle serves both protocol eras', () => {
  it.each(['legacy', 'modern'] as const)('%s: connects in that era', async (era) => {
    const { client } = await connect(era);
    expect(client.getProtocolEra()).toBe(era);
    if (era === 'modern') expect(client.getNegotiatedProtocolVersion()).toBe(MODERN_REVISION);
  });

  it('lists the same nine tools with the same input schemas in both eras', async () => {
    const legacy = await connect('legacy');
    const modern = await connect('modern');
    const [a, b] = await Promise.all([legacy.client.listTools(), modern.client.listTools()]);
    const byName = (r: typeof a) => Object.fromEntries(r.tools.map((t) => [t.name, t.inputSchema]));
    expect(Object.keys(byName(a)).sort()).toEqual(TOOLS);
    expect(byName(b)).toEqual(byName(a));
  });

  it('advertises the same capabilities in both eras', async () => {
    const legacy = await connect('legacy');
    const modern = await connect('modern');
    const caps = legacy.client.getServerCapabilities();
    expect(caps?.tools).toBeDefined();
    expect(modern.client.getServerCapabilities()).toEqual(caps);
  });

  // Every tool, on a path that never spawns grok: the same isError, the same top-level keys, and the same mode and
  // billing in both eras.
  it('answers all nine tools with the same result shape in both eras', async () => {
    const shape = async (c: BundleConnection) => {
      const out: Record<string, unknown> = {};
      for (const [name, args] of quotaZeroCalls(c.home)) {
        const r = await c.client.callTool({ name, arguments: args });
        const text = textOf(r);
        let body: Record<string, unknown> | undefined;
        try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = undefined; }
        out[name] = { isError: r.isError === true, keys: body ? Object.keys(body).sort() : 'not json', mode: body?.mode, billing: body?.billing };
      }
      return out;
    };
    const a = await shape(await connect('legacy'));
    const b = await shape(await connect('modern'));
    expect(Object.keys(a).sort()).toEqual(TOOLS);
    expect(b).toEqual(a);
  });

  it.each(['legacy', 'modern'] as const)('%s: an unknown tool is a JSON-RPC -32602 error', async (era) => {
    const { client } = await connect(era);
    await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toMatchObject({ code: -32602 });
  });

  it.each(['legacy', 'modern'] as const)('%s: an unknown argument key is refused, naming the key (A21)', async (era) => {
    const { client } = await connect(era);
    const r = await client.callTool({ name: 'grok_build_route', arguments: { task: 'x', totally_bogus: 1 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('totally_bogus');
  });

  // Review Focus 2: the repo's own harnesses open with a raw `initialize` at 2024-11-05 (accept-release) or 2025-06-18.
  // rawLegacySession's requests give up after 15 s, inside RAW_TEST_MS, and the session opens inside the try, so a
  // bundle that never answers fails with a reason and leaves no home (review of PR #231).
  it.each(['2024-11-05', '2025-06-18'])('a raw initialize at %s still opens a 2025-era session with the nine tools', async (version) => {
    const home = mkdtempSync(join(tmpdir(), 'dual-era-raw-'));
    let s: Awaited<ReturnType<typeof rawLegacySession>> | undefined;
    try {
      s = await rawLegacySession(version, home);
      expect(s.init.protocolVersion).toBe(version);
      const listed = await s.request('tools/list');
      expect(((listed.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name).sort()).toEqual(TOOLS);
    } finally {
      await s?.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, RAW_TEST_MS);

  // Review Focus 1: a v2 client in `auto` mode probes a stdio server on a short-lived SIBLING process before it starts
  // the real one (SDK client docs). That probe must find the modern era here and leave nothing behind in the home —
  // no history row, no file — exactly like a session that only connected. Compared file by file with its line count:
  // a bundle that wrote one row per process start passed a comparison of names (review of PR #231).
  it('auto negotiation picks the modern era, and its probe process leaves the home as empty as a plain connect', async () => {
    const plain = await connect('legacy');
    const auto = await connect('auto');
    expect(auto.client.getProtocolEra()).toBe('modern');
    await auto.client.listTools();
    const contents = (home: string) => readdirSync(home, { recursive: true }).map(String).sort().map((p) => {
      const full = join(home, p);
      return statSync(full).isFile() ? `${p}: ${readFileSync(full, 'utf8').split('\n').filter(Boolean).length} lines` : `${p}/`;
    });
    expect(contents(auto.home)).toEqual(contents(plain.home));
  });

  // docs/04 "SDK v1 번들과 달라진 것", pinned: the advertised schemas name JSON Schema 2020-12 and no longer carry
  // `execution`; a validation error reads `<path>: <message>`, joined by ", ", with no "MCP error -32602: " in front;
  // a tools/call with no params is -32602 (SDK v1: -32603). Measured 2026-11-28 against the v0.2.55 bundle too.
  it.each(['legacy', 'modern'] as const)('%s: advertises JSON Schema 2020-12 and no execution field (raw tools/list)', async (era) => {
    const r = await rawEraSession(era);
    try {
      const { tools } = (await r.s.request('tools/list', {})).result as { tools: Array<{ name: string; inputSchema: { $schema?: string } }> };
      expect(tools).toHaveLength(TOOLS.length);
      for (const t of tools) {
        expect(t.inputSchema.$schema, t.name).toBe('https://json-schema.org/draft/2020-12/schema');
        expect(t, t.name).not.toHaveProperty('execution');
      }
    } finally {
      await r.close();
    }
  }, RAW_TEST_MS);

  it.each(['legacy', 'modern'] as const)('%s: a validation error names each path first and joins the errors with a comma', async (era) => {
    const { client } = await connect(era);
    const r = await client.callTool({ name: 'grok_build_route', arguments: { task: 123, bogus: 1 } });
    expect(r.isError).toBe(true);
    const text = textOf(r);
    expect(text).toMatch(/^Input validation error: Invalid arguments for tool grok_build_route: task: Invalid input: /);
    expect(text).toContain(', Unrecognized key: "bogus"');
    expect(text).not.toContain('\n');
  });

  // ...and what did not change: other malformed frames get no answer (SDK v1 dropped them too), and the server goes on
  // answering. The request after them is the barrier — the server reads its stdin in order — plus a moment for a late
  // error frame.
  it.each(['legacy', 'modern'] as const)('%s: drops malformed frames without an answer and answers the next request', async (era) => {
    const r = await rawEraSession(era);
    try {
      for (const frame of [
        'this is not json',
        JSON.stringify({ id: 10, method: 'tools/list', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 11, method: 123 }),
        JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: 'x' }),
        JSON.stringify([{ jsonrpc: '2.0', id: 13, method: 'tools/list', params: {} }]),
      ]) r.child.stdin.write(frame + '\n');
      const after = await r.s.request('tools/list', {});
      expect((after.result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);
      await new Promise((resolve) => setTimeout(resolve, 500));
      // 1 = the opening (initialize or server/discover), 2 = the tools/list after the frames
      expect(r.ids).toEqual([1, 2]);
    } finally {
      await r.close();
    }
  }, RAW_TEST_MS);

  it('a raw tools/call with no params is a JSON-RPC -32602 error', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dual-era-noparams-'));
    let s: Awaited<ReturnType<typeof rawLegacySession>> | undefined;
    try {
      s = await rawLegacySession('2025-06-18', home);
      expect((await s.request('tools/call')).error?.code).toBe(-32602);
    } finally {
      await s?.close();
      rmSync(home, { recursive: true, force: true });
    }
  }, RAW_TEST_MS);

  it.each(['legacy', 'modern'] as const)('%s: inside a grok worker every tool is refused (A34)', async (era) => {
    const c = await connectBundle(era, { env: { GROK_BUILD_WORKER: '1' } });
    open.push(c);
    for (const [name, args] of quotaZeroCalls(c.home)) {
      const r = await c.client.callTool({ name, arguments: args });
      expect(r.isError, name).toBe(true);
      expect(textOf(r), name).toContain('inside_grok_worker');
    }
  });
});
