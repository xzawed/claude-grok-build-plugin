/**
 * Contract for `scripts/worker-marker-probe.mjs` — probe:contract's watch over the one grok behaviour
 * the A34 guard stands on: grok handing its env (and so GROK_BUILD_WORKER) to the MCP servers it
 * starts inside a worker. The live half needs a grok binary, so it runs from probe:contract, not
 * here; what is pinned here is what keeps that live half honest and free.
 *
 *   - buildProbeEnv is the quota promise. If it ever let an API key or the real GROK_HOME through,
 *     the "rejected synthetic session" would become a real, possibly metered one.
 *   - workerMarkerVerdict is the finding. "Nothing to judge" must never read as "fine" — the
 *     b721433 / check-release-tag lesson again.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { buildProbeEnv, workerMarkerVerdict, WORKER_MARKER } from '../scripts/worker-marker-probe.mjs';
import { WORKER_ENV_VAR, insideGrokWorker } from '../src/env.js';

const dirs = { home: '/tmp/p/home', claudeDir: '/tmp/p/home/.claude', grokHome: '/tmp/p/grokhome' };
const lowerKeys = (env: Record<string, unknown>) => Object.keys(env).map((k) => k.toLowerCase());

describe('the marker the probe sets is the marker the server reads', () => {
  it('names the same variable as src/env.ts, with the value insideGrokWorker accepts', () => {
    expect(WORKER_MARKER).toBe(WORKER_ENV_VAR);
    expect(insideGrokWorker(buildProbeEnv({}, dirs, 'linux'))).toBe(true);
  });
});

describe('buildProbeEnv — the probe must not be able to reach a real account', () => {
  it('drops both API keys in any spelling, so a rejected session has no metered fallback', () => {
    const env = buildProbeEnv({ XAI_API_KEY: 'sk-a', xai_api_key: 'sk-b', Grok_Code_Xai_Api_Key: 'sk-c', PATH: '/usr/bin' }, dirs, 'win32');
    expect(lowerKeys(env)).not.toContain('xai_api_key');
    expect(lowerKeys(env)).not.toContain('grok_code_xai_api_key');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('points every home at the throwaway dirs, whatever spelling the parent used', () => {
    const env = buildProbeEnv({ GROK_HOME: '/real/.grok', UserProfile: 'C:\\Users\\real', HOME: '/home/real', claude_config_dir: '/real/.claude' }, dirs, 'win32');
    expect(env.GROK_HOME).toBe('/tmp/p/grokhome');
    expect(env.HOME).toBe('/tmp/p/home');
    expect(env.USERPROFILE).toBe('/tmp/p/home');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/p/home/.claude');
    for (const k of ['grok_home', 'home', 'userprofile', 'claude_config_dir']) {
      expect(lowerKeys(env).filter((x) => x === k), `${k} appears once`).toHaveLength(1);
    }
    expect(env.APPDATA).toBe(join('/tmp/p/home', 'AppData', 'Roaming'));
    expect(env.LOCALAPPDATA).toBe(join('/tmp/p/home', 'AppData', 'Local'));
  });

  it("drops an operator's GROK_SANDBOX, so the default path is what gets measured", () => {
    expect(lowerKeys(buildProbeEnv({ grok_sandbox: 'workspace' }, dirs, 'linux'))).not.toContain('grok_sandbox');
  });
});

describe('workerMarkerVerdict — "nothing to judge" is not "fine"', () => {
  const cases: [string, { ran: boolean; seen: (string | null)[] }, boolean | null][] = [
    ['grok did not run', { ran: false, seen: [] }, null],
    ['grok ran but started no plugin server', { ran: true, seen: [] }, null],
    ['the one start saw the marker', { ran: true, seen: ['1'] }, true],
    ['the one start did not', { ran: true, seen: [null] }, false],
    ['a restart lost it', { ran: true, seen: ['1', null] }, false],
    ['a different value is not the marker', { ran: true, seen: ['0'] }, false],
  ];
  for (const [name, input, reached] of cases) {
    it(`${name} -> ${String(reached)}`, () => {
      const v = workerMarkerVerdict(input);
      expect(v.reached).toBe(reached);
      expect(v.reason.length).toBeGreaterThan(0);
    });
  }
});
