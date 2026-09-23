/**
 * Contract for `scripts/worker-marker-probe.mjs` — probe:contract's watch over the one grok behaviour
 * the A34 guard stands on: grok handing its env (and so GROK_BUILD_WORKER) to the MCP servers it
 * starts inside a worker. The live half needs a grok binary, so it runs from probe:contract, not
 * here; what is pinned here is what keeps that live half honest and free.
 *
 *   - isolatedGrokEnv / buildProbeEnv are the quota promise. The first version dropped only the two
 *     API keys; a review found GROK_AUTH_PROVIDER_COMMAND, which grok re-runs after a 401 — the
 *     "rejected synthetic session" could have authenticated for real.
 *   - workerMarkerVerdict is the finding. "Nothing to judge" must never read as "fine" — the
 *     b721433 / check-release-tag lesson again — and a probe session that got ACCEPTED is its own alarm.
 *   - the generated probe server is code built from strings; a mistake there would silently blind
 *     the watch, so it is run here under plain node.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildProbeEnv, workerMarkerVerdict, writeProbePlugin, readSeenMarkers, WORKER_MARKER,
} from '../scripts/worker-marker-probe.mjs';
import { isolatedGrokEnv } from '../scripts/synthetic-auth.mjs';
import { WORKER_ENV_VAR, insideGrokWorker } from '../src/env.js';

const dirs = { home: '/tmp/p/home', claudeDir: '/tmp/p/home/.claude', grokHome: '/tmp/p/grokhome' };
const lowerKeys = (env: Record<string, unknown>) => Object.keys(env).map((k) => k.toLowerCase());

describe('the marker the probe sets is the marker the server reads', () => {
  it('names the same variable as src/env.ts, with the value insideGrokWorker accepts', () => {
    expect(WORKER_MARKER).toBe(WORKER_ENV_VAR);
    expect(insideGrokWorker(buildProbeEnv({}, dirs, 'linux'))).toBe(true);
  });
});

describe('isolatedGrokEnv — a probe must not be able to reach a real account', () => {
  it("drops every GROK_* and XAI_* variable in any spelling, including ones this code never heard of", () => {
    const env = isolatedGrokEnv({
      XAI_API_KEY: 'a', xai_api_key: 'b', Grok_Code_Xai_Api_Key: 'c',
      GROK_AUTH_PROVIDER_COMMAND: '/usr/local/bin/mint-token', grok_auth_path: '/real/auth.json',
      GROK_DEPLOYMENT_KEY: 'd', XAI_SOMETHING_NEW: 'e', GROK_SANDBOX: 'workspace',
      PATH: '/usr/bin', SystemRoot: 'C:\\Windows',
    }, { GROK_HOME: '/tmp/p/grokhome' });
    expect(lowerKeys(env).filter((k) => k.startsWith('grok_') || k.startsWith('xai_'))).toEqual(['grok_home']);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.SystemRoot).toBe('C:\\Windows');
  });

  it('lets an override replace a parent value spelled differently, leaving one key', () => {
    const env = isolatedGrokEnv({ UserProfile: 'C:\\Users\\real', home: '/home/real' }, { USERPROFILE: '/tmp/h', HOME: '/tmp/h' });
    expect(lowerKeys(env).filter((k) => k === 'userprofile')).toHaveLength(1);
    expect(lowerKeys(env).filter((k) => k === 'home')).toHaveLength(1);
    expect(env.USERPROFILE).toBe('/tmp/h');
    expect(env.HOME).toBe('/tmp/h');
  });
});

describe('buildProbeEnv — every home points at the throwaway dirs', () => {
  it('redirects GROK_HOME, HOME, USERPROFILE and CLAUDE_CONFIG_DIR, and the win32 app-data dirs', () => {
    const env = buildProbeEnv({ GROK_HOME: '/real/.grok', UserProfile: 'C:\\Users\\real', claude_config_dir: '/real/.claude' }, dirs, 'win32');
    expect(env.GROK_HOME).toBe('/tmp/p/grokhome');
    expect(env.HOME).toBe('/tmp/p/home');
    expect(env.USERPROFILE).toBe('/tmp/p/home');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/p/home/.claude');
    expect(env.APPDATA).toBe(join('/tmp/p/home', 'AppData', 'Roaming'));
    expect(env.LOCALAPPDATA).toBe(join('/tmp/p/home', 'AppData', 'Local'));
    for (const k of ['grok_home', 'home', 'userprofile', 'claude_config_dir']) {
      expect(lowerKeys(env).filter((x) => x === k), `${k} appears once`).toHaveLength(1);
    }
  });
});

describe('workerMarkerVerdict — "nothing to judge" is not "fine"', () => {
  const REJECTED_OUTPUT = 'Unauthorized (401) from https://cli-chat-proxy.grok.com/v1/responses: Invalid or expired credentials';
  type Case = [string, Parameters<typeof workerMarkerVerdict>[0], { reached: boolean | null; blind: boolean; sessionAccepted: boolean }];
  const cases: Case[] = [
    ['grok did not run', { ran: false, seen: [], exitCode: null }, { reached: null, blind: false, sessionAccepted: false }],
    ['grok ran but started no plugin server', { ran: true, seen: [], exitCode: 1, output: REJECTED_OUTPUT }, { reached: null, blind: true, sessionAccepted: false }],
    ['the one start saw the marker', { ran: true, seen: ['1'], exitCode: 1, output: REJECTED_OUTPUT }, { reached: true, blind: false, sessionAccepted: false }],
    ['the one start did not', { ran: true, seen: [null], exitCode: 1 }, { reached: false, blind: false, sessionAccepted: false }],
    ['a restart lost it', { ran: true, seen: ['1', null], exitCode: 1 }, { reached: false, blind: false, sessionAccepted: false }],
    ['a different value is not the marker', { ran: true, seen: ['0'], exitCode: 1 }, { reached: false, blind: false, sessionAccepted: false }],
    ['grok ACCEPTED the session', { ran: true, seen: ['1'], exitCode: 0, output: '{"type":"result"}' }, { reached: true, blind: false, sessionAccepted: true }],
  ];
  for (const [name, input, want] of cases) {
    it(`${name}`, () => {
      const v = workerMarkerVerdict(input);
      expect({ reached: v.reached, blind: v.blind, sessionAccepted: v.sessionAccepted }).toEqual(want);
      expect(v.reason.length).toBeGreaterThan(0);
    });
  }
  it('reports whether grok actually rejected the credential', () => {
    expect(workerMarkerVerdict({ ran: true, seen: ['1'], exitCode: 1, output: REJECTED_OUTPUT }).authRejected).toBe(true);
    expect(workerMarkerVerdict({ ran: true, seen: ['1'], exitCode: 1, output: 'connection refused' }).authRejected).toBe(false);
  });
});

describe('the generated probe server — run under plain node, no grok', () => {
  const root = mkdtempSync(join(tmpdir(), 'probe-plugin-test-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('records the inherited marker and answers initialize and tools/list', async () => {
    writeProbePlugin(root);
    const child = spawn(process.execPath, [join(root, 'server.mjs')], {
      env: { ...process.env, [WORKER_MARKER]: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => { out += d; });
    const nl = String.fromCharCode(10);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + nl);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + nl);
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));

    const replies = out.split(nl).filter(Boolean).map((l) => JSON.parse(l));
    expect(replies.find((r) => r.id === 1)?.result?.serverInfo?.name).toBe('worker-marker-probe');
    expect(replies.find((r) => r.id === 2)?.result?.tools).toEqual([]);
    expect(readSeenMarkers(root)).toEqual(['1']);
  }, 20_000);
});
