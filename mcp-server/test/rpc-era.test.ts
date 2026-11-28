/**
 * MCP 2.0 plan, Task 2.4: the tools that ship in `.claude/tools/` speak both protocol eras over raw JSON-RPC lines,
 * with Node built-ins only (no SDK), through `openSession` in rpc-era.mjs. The 2025 era opens with `initialize`; the
 * 2026-07-28 era has none — it opens with `server/discover`, and every request carries the revision, the client's
 * info and its capabilities in `params._meta` (frames captured from the SDK v2 client, 2026-11-28, quota 0).
 *
 * The raw 2026 session must reach the SAME verdict as the SDK's on every check the acceptance grader runs, not on
 * two calls (review of the plan): `gradeEra` runs the grader's checks through whichever session opener it is given,
 * and here it gets the raw one and one built on the SDK client pinned to 2026-07-28. Both start the built bundle in
 * the grader's own isolation (no grok can be found), so nothing here reaches a model.
 */
import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LEGACY_VERSION, MODERN_VERSION, openSession } from '../../.claude/tools/rpc-era.mjs';
import { gradeEra, isolate, rawOpener } from '../../.claude/tools/accept-checks.mjs';
import { bundlePath, isolatedServerEnv, MODERN_REVISION } from './bundle-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const hookPath = join(dirname(bundlePath), 'hook.js');
const version = (JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string }).version;

type Session = { call: (n: string, a: unknown) => Promise<{ isError: boolean; text: string }>; listTools: () => Promise<{ name: string }[]>; close: () => Promise<void> };
type Row = { id: string; what: string; pass: boolean; evidence: string };
type Graded = { notServed?: boolean; reason?: string; rows?: Row[] };

/** The grader's session opener, built on the SDK v2 client instead of raw lines — the reference for the raw one. */
function sdkOpener(era: 'legacy' | 'modern') {
  return async (server: string, env: Record<string, string | undefined>, cwd: string): Promise<Session> => {
    // The SDK's stdio transport lays the parent's PATH (among a few others) under the env it is given, and on Windows
    // the uppercase spelling sorts first and wins, so the grader's filtered PATH goes in under that spelling only.
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) if (v !== undefined && k.toLowerCase() !== 'path') e[k] = v;
    const path = Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1];
    if (path !== undefined) e.PATH = path;
    const client = new Client({ name: 'accept', version: '0' },
      era === 'modern' ? { versionNegotiation: { mode: { pin: MODERN_REVISION } } } : {});
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: e, cwd, stderr: 'pipe' }));
    if (client.getProtocolEra() !== era) throw new Error(`asked for ${era}, connected in ${String(client.getProtocolEra())}`);
    return {
      async call(name, args) {
        const r = await client.callTool({ name, arguments: args as Record<string, unknown> });
        const content = r.content as { text?: string }[] | undefined;
        return { isError: Boolean(r.isError), text: content?.[0]?.text ?? '' };
      },
      async listTools() { return (await client.listTools()).tools; },
      async close() { await client.close(); },
    };
  };
}

/** A server that answers like an SDK v1 bundle: `initialize` works, `server/discover` is "Method not found". */
const V1_LIKE = String.raw`
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === undefined) continue;
    const reply = m.method === 'server/discover'
      ? { error: { code: -32601, message: 'Method not found' } }
      : { result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'v1-like', version: '0.2.55' } } };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...reply }) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`;

function spawnServer(file: string, home: string) {
  return spawn(process.execPath, [file], { env: isolatedServerEnv(home), cwd: home, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}
const exited = (child: ReturnType<typeof spawn>) => new Promise<void>((r) => { if (child.exitCode !== null) r(); else child.once('exit', () => r()); });

describe('rpc-era.mjs — the 2025 and the 2026-07-28 era over raw lines (MCP 2.0 plan, Task 2.4)', () => {
  it.each(['legacy', 'modern'] as const)('opens the built bundle in the %s era and lists the nine tools', async (era) => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-'));
    const child = spawnServer(bundlePath, home);
    try {
      const s = await openSession(child, era);
      expect(s.era).toBe(era);
      expect(s.protocolVersion).toBe(era === 'modern' ? MODERN_VERSION : LEGACY_VERSION);
      expect(s.serverInfo).toMatchObject({ name: 'grok-build', version });
      const listed = await s.request('tools/list', {});
      expect((listed.result.tools as { name: string }[]).map((t) => t.name).sort()).toHaveLength(9);
      // the revision travels with every 2026 request: a call answers in the same era
      const call = await s.request('tools/call', { name: 'grok_build_route', arguments: { task: 'x' } });
      expect(call.result.isError).toBeFalsy();
      expect(JSON.parse(call.result.content[0].text)).toHaveProperty('risk');
    } finally {
      child.kill();
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('says a bundle from before the 2026 era does not serve it (server/discover -> -32601), and its 2025 opening still works', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-v1-'));
    const file = join(home, 'v1-like.cjs');
    writeFileSync(file, V1_LIKE);
    const modern = spawnServer(file, home);
    const legacy = spawnServer(file, home);
    try {
      await expect(openSession(modern, 'modern')).rejects.toMatchObject({ notServed: true });
      const s = await openSession(legacy, 'legacy');
      expect(s.serverInfo).toMatchObject({ name: 'v1-like' });
    } finally {
      for (const c of [modern, legacy]) { c.kill(); await exited(c); }
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects the 2026 opening when discover answers without that revision (a stand-in that answers everything alike)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-standin-'));
    const file = join(home, 'standin.cjs');
    writeFileSync(file, V1_LIKE.replace("m.method === 'server/discover'", 'false'));
    const child = spawnServer(file, home);
    try {
      await expect(openSession(child, 'modern')).rejects.toMatchObject({ notServed: true });
    } finally {
      child.kill();
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);

  // The stdio binding's probe rules (2026-07-28, basic/transports/stdio "Backward Compatibility"): a server that gives
  // no reply to server/discover within a timeout is a legacy one — some answer an unknown pre-initialize request with
  // an error, some not at all (review of PR #231).
  it('says a server that never answers server/discover does not serve the 2026 era', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-silent-'));
    const file = join(home, 'silent.cjs');
    writeFileSync(file, "process.stdin.resume();\nprocess.stdin.on('end', () => process.exit(0));\n");
    const child = spawnServer(file, home);
    try {
      await expect(openSession(child, 'modern', { timeoutFor: () => 500 }))
        .rejects.toMatchObject({ notServed: true, message: expect.stringMatching(/not served: server\/discover: no reply within 500 ms/) });
    } finally {
      child.kill();
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  // The grader's timeout evidence names the tool it was waiting for, as the tool before rpc-era did ("timeout: <tool>").
  it('names the tool a tools/call timed out on', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-mute-'));
    const file = join(home, 'mute.cjs');
    // answers initialize like V1_LIKE, and nothing after it
    writeFileSync(file, V1_LIKE.replace('if (m.id === undefined) continue;', "if (m.id === undefined || m.method !== 'initialize') continue;"));
    const child = spawnServer(file, home);
    try {
      const s = await openSession(child, 'legacy', { timeoutFor: (method: string) => (method === 'tools/call' ? 500 : 30_000) });
      await expect(s.request('tools/call', { name: 'grok_auth_check', arguments: {} }))
        .rejects.toThrow('tools/call grok_auth_check: no reply within 500 ms');
    } finally {
      child.kill();
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects every pending request when the server exits before answering', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-exit-'));
    const file = join(home, 'dies.cjs');
    writeFileSync(file, 'process.exit(3);\n');
    const child = spawnServer(file, home);
    try {
      await expect(openSession(child, 'legacy')).rejects.toThrow(/exited before answering/);
    } finally {
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  // Only silence and an answer make a server "not served": one that exits while asked server/discover is broken, and
  // must stay a failure even where the grader only notes an unserved era (--version for another bundle) — review of
  // PR #231.
  it('a server that exits while asked server/discover is a failure, not an unserved era', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rpc-era-exit-discover-'));
    const file = join(home, 'dies-on-a-line.cjs');
    writeFileSync(file, "process.stdin.once('data', () => process.exit(3));\n");
    const child = spawnServer(file, home);
    try {
      const err = await openSession(child, 'modern').then(() => undefined, (e: Error & { notServed?: boolean }) => e);
      expect(err?.message).toMatch(/^server exited before answering \(code=3/);
      expect(err?.notServed).toBeUndefined();
    } finally {
      await exited(child);
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  // Review of the plan: comparing two calls would not show the raw session grades like the SDK's. So every check the
  // grader runs in an era goes through both, and each verdict (id, what, pass) must agree — all of them passing.
  it.each(['legacy', 'modern'] as const)('the grader reaches the same verdict on every check over raw lines as over the SDK client (%s)', async (era) => {
    const iso = isolate();
    try {
      const options = { era, server: bundlePath, hook: hookPath, iso, expected: version, includeEraFree: false };
      const raw = await gradeEra({ ...options, open: rawOpener(era) }) as Graded;
      const sdk = await gradeEra({ ...options, open: sdkOpener(era) }) as Graded;
      expect(raw.notServed, raw.reason).toBeFalsy();
      expect(sdk.notServed, sdk.reason).toBeFalsy();
      const verdicts = (rows: Row[] = []) => rows.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} ${r.what}`);
      expect(verdicts(raw.rows)).toEqual(verdicts(sdk.rows));
      expect(raw.rows?.length).toBe(13);
      expect(raw.rows?.filter((r) => !r.pass).map((r) => `${r.id}: ${r.evidence}`)).toEqual([]);
    } finally {
      iso.cleanup();
    }
  }, 240_000);

  // Task 2.4 Step 4: the audit harness takes the era too (`list` spends no quota).
  it.each(['legacy', 'modern'] as const)('mcpcall.mjs --era %s lists the nine tools of the built bundle', (era) => {
    const r = spawnSync(process.execPath, [join(repoRoot, '.claude/tools/mcpcall.mjs'), '--era', era, 'list'],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env, GROK_BUILD_AUTH_MODE: 'subscription' } });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toHaveLength(9);
  }, 60_000);

  // ...and really opens that era: in a layout whose bundle is the SDK-v1-like stand-in, the 2026 era is not served.
  it('mcpcall.mjs opens the era it is given (a bundle that only serves 2025: legacy lists, modern fails)', () => {
    const t = mkdtempSync(join(tmpdir(), 'mcpcall-era-'));
    try {
      const tools = join(t, '.claude', 'tools');
      const dist = join(t, 'mcp-server', 'dist');
      for (const d of [tools, dist]) mkdirSync(d, { recursive: true });
      for (const f of ['mcpcall.mjs', 'rpc-era.mjs', 'rpc-timeout.mjs']) writeFileSync(join(tools, f), readFileSync(join(repoRoot, '.claude', 'tools', f)));
      writeFileSync(join(dist, 'package.json'), '{ "type": "commonjs" }\n');
      writeFileSync(join(dist, 'index.js'), V1_LIKE.replace("? { error: { code: -32601, message: 'Method not found' } }",
        "? { error: { code: -32601, message: 'Method not found' } } : m.method === 'tools/list' ? { result: { tools: [] } }"));
      const run = (era: string) => spawnSync(process.execPath, [join(tools, 'mcpcall.mjs'), '--era', era, 'list'], { encoding: 'utf8', timeout: 60_000 });
      const legacy = run('legacy');
      expect(legacy.status, legacy.stderr).toBe(0);
      expect(JSON.parse(legacy.stdout)).toEqual([]);
      const modern = run('modern');
      expect(modern.status).toBe(1);
      expect(modern.stderr).toMatch(/2026-07-28 era is not served: server\/discover answered -32601/);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  }, 60_000);
});
