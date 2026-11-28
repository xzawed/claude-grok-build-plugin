/**
 * Connect an MCP SDK v2 Client to the BUILT bundle (`dist/index.js`, or `GROK_BUILD_TEST_DIST`) over real stdio, in
 * either protocol era. Shared by the dual-era tests (MCP 2.0 plan, Task 2.3; the ledger's ruling puts it here so the
 * grader's cross-check, Task 2.4, uses the same connection).
 *
 * `legacy` is the plain 2025 connect sequence (`initialize`). `modern` PINS revision 2026-07-28: `mode: 'auto'` falls
 * back to 2025 whenever its probe is not conclusive — a stdio timeout included — so a "modern" test could pass while
 * speaking the old protocol (review of the plan, 2026-11-28). The pin fails loudly instead, and `connectBundle` checks
 * `getProtocolEra()` as well.
 *
 * The server runs in a throwaway home with no API key and no grok on PATH, so nothing it does can reach a model.
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Era = 'legacy' | 'modern';
export const MODERN_REVISION = '2026-07-28';

const here = dirname(fileURLToPath(import.meta.url));
export const bundlePath = process.env.GROK_BUILD_TEST_DIST ?? join(here, '../dist/index.js');

/** The environment the bundle runs in: a fresh home, no API keys, PATH reduced to the folder of this Node. */
export function isolatedServerEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    USERPROFILE: home,
    GROK_HOME: join(home, '.grok'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    PATH: dirname(process.execPath),
  };
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:\\Windows';
    env.SystemRoot = root;
    env.PATH = [dirname(process.execPath), join(root, 'System32'), root].join(';');
    env.PATHEXT = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  }
  return { ...env, ...extra };
}

export interface BundleConnection {
  client: Client;
  home: string;
  close: () => Promise<void>;
}

/**
 * The bundle over raw JSON-RPC lines, opened with `initialize` at `protocolVersion` — the shape the repo's own harnesses
 * (accept-release, stdio-limit, worker-guard) and older clients send. `request` waits for the reply with that id.
 */
export async function rawLegacySession(protocolVersion: string, home: string): Promise<{
  init: { protocolVersion?: string; serverInfo?: { name?: string } };
  request: (method: string, params?: unknown) => Promise<{ result?: unknown; error?: { code: number } }>;
  close: () => Promise<void>;
}> {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [bundlePath], { env: isolatedServerEnv(home), cwd: home, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  // Watched from the spawn, so an exit before any await below is not missed. win32 keeps the folder busy until the
  // child is gone, so the caller may remove the home only after `exit`.
  const exited = new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.once('error', () => resolve()); });
  const waiting = new Map<number, (msg: { result?: unknown; error?: { code: number } }) => void>();
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    for (let nl = buf.indexOf('\n'); nl !== -1; nl = buf.indexOf('\n')) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { code: number } };
      if (typeof msg.id === 'number') waiting.get(msg.id)?.(msg);
    }
  });
  let next = 1;
  const request = (method: string, params?: unknown) => new Promise<{ result?: unknown; error?: { code: number } }>((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`${method}: no reply within 15s`)), 15_000);
    waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
  });
  let opened: { result?: unknown; error?: { code: number } };
  try {
    opened = await request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'raw-legacy', version: '0' } });
  } catch (e) {
    // a bundle that never answers: stop it here, so the caller's cleanup can remove the home (review of PR #231)
    child.kill();
    await exited;
    throw e;
  }
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return {
    init: (opened.result ?? {}) as { protocolVersion?: string },
    request,
    close: async () => { child.stdin.end(); child.kill(); await exited; },
  };
}

export async function connectBundle(
  era: Era | 'auto',
  opts: { env?: Record<string, string> } = {},
): Promise<BundleConnection> {
  const home = mkdtempSync(join(tmpdir(), 'dual-era-home-'));
  const client = new Client(
    { name: 'dual-era-test', version: '0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: MODERN_REVISION } } }
      : era === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {},
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundlePath],
    env: isolatedServerEnv(home, opts.env),
    stderr: 'pipe',
    cwd: home,
  });
  try {
    await client.connect(transport);
    const got = client.getProtocolEra();
    if (era !== 'auto' && got !== era) {
      throw new Error(`asked for the ${era} era, connected in ${String(got)} (${String(client.getNegotiatedProtocolVersion())})`);
    }
  } catch (e) {
    // A failed or wrong-era connect still stops its server and removes its home (review of PR #231). Best effort: on
    // win32 a server still exiting can keep the folder busy, and that must not hide the error itself.
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    try { rmSync(home, { recursive: true, force: true }); } catch { /* left for the OS temp cleanup */ }
    throw e;
  }
  return {
    client,
    home,
    close: async () => {
      await client.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
