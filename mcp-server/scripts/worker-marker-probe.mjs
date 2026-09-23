/**
 * A34 premise watch: does grok still hand GROK_BUILD_WORKER to the MCP servers it starts inside a
 * headless worker?
 *
 * WHY. The A34 guard (src/env.ts marks every grok, src/server.ts refuses when marked) is only as
 * real as that inheritance — and the inheritance is GROK's behaviour, not ours. A grok that started
 * MCP servers with a cleared or allowlisted env would switch the guard off with every test still
 * green, because every test sets the marker by hand. An adversarial review of the fix said exactly
 * that, and it was right. MEASURED 2026-09-24: the marker reached a plugin-sourced MCP server in a
 * headless `--single` session on 1.0.30 (win32) and on 1.0.41 (Linux, with and without
 * GROK_SANDBOX=workspace). This module re-asks that question every time probe:contract runs.
 *
 * HOW, AND WHY IT COSTS NOTHING.
 *   - A throwaway Claude config (CLAUDE_CONFIG_DIR, plus HOME/USERPROFILE) whose only installed
 *     plugin is a tiny stdio server that records the marker it inherited. Measured: with that
 *     redirect grok started that server and nothing else — not the real plugins, not ~/.claude.json.
 *   - A throwaway GROK_HOME holding a SYNTHETIC auth.json (synthetic-auth.mjs). grok opens the
 *     session and starts its MCP servers first; the first model request is then rejected (401).
 *     Nothing is billed.
 *   - XAI_API_KEY / GROK_CODE_XAI_API_KEY removed case-insensitively, so there is no metered
 *     fallback; GROK_SANDBOX removed, so the default path is what gets measured.
 *   - The real ~/.grok and ~/.claude are never read or written. buildProbeEnv is pure so a test
 *     holds it to all of the above.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticAuth } from './synthetic-auth.mjs';

/** Must equal WORKER_ENV_VAR in src/env.ts — test/worker-marker-probe.test.ts pins the two. */
export const WORKER_MARKER = 'GROK_BUILD_WORKER';

const NL = String.fromCharCode(10);

// The probe server: writes down the marker it was started with, then answers just enough MCP for
// grok to count it as connected. Built without a single escape sequence on purpose — the authoring
// tools in this repo's sessions have decoded escapes inside file content twice (CHANGELOG 2026-09-24).
const PROBE_SERVER = [
  "import { writeFileSync } from 'node:fs';",
  "import { dirname, join } from 'node:path';",
  "import { fileURLToPath } from 'node:url';",
  'const NL = String.fromCharCode(10);',
  'const here = dirname(fileURLToPath(import.meta.url));',
  `writeFileSync(join(here, 'seen-' + process.pid + '.json'), JSON.stringify({ marker: process.env.${WORKER_MARKER} ?? null }));`,
  'const send = (m) => process.stdout.write(JSON.stringify(m) + NL);',
  "let buf = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (d) => {",
  '  buf += d;',
  '  let i;',
  '  while ((i = buf.indexOf(NL)) !== -1) {',
  '    const line = buf.slice(0, i).trim();',
  '    buf = buf.slice(i + 1);',
  '    if (!line) continue;',
  '    let m;',
  '    try { m = JSON.parse(line); } catch { continue; }',
  "    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'worker-marker-probe', version: '0' } } });",
  "    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [] } });",
  "    else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not supported' } });",
  '  }',
  '});',
].join(NL);

const OVERRIDDEN = ['HOME', 'USERPROFILE', 'GROK_HOME', 'CLAUDE_CONFIG_DIR', 'APPDATA', 'LOCALAPPDATA', WORKER_MARKER];
const DROPPED = ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY', 'GROK_SANDBOX'];

/**
 * The env the probe's grok runs with. Keys are matched case-insensitively (Windows env names are),
 * so a stray `xai_api_key` or `UserProfile` cannot slip past as a second spelling.
 */
export function buildProbeEnv(base, { home, claudeDir, grokHome }, platform = process.platform) {
  const skip = new Set([...OVERRIDDEN, ...DROPPED].map((k) => k.toLowerCase()));
  const env = {};
  for (const [k, v] of Object.entries(base)) if (!skip.has(k.toLowerCase())) env[k] = v;
  env.HOME = home;
  env.USERPROFILE = home;
  env.GROK_HOME = grokHome;
  env.CLAUDE_CONFIG_DIR = claudeDir;
  env[WORKER_MARKER] = '1';
  if (platform === 'win32') {
    env.APPDATA = join(home, 'AppData', 'Roaming');
    env.LOCALAPPDATA = join(home, 'AppData', 'Local');
  }
  return env;
}

/**
 * true  — every probe server grok started saw the marker: the guard can fire.
 * false — grok started a probe server WITHOUT it: the guard is switched off. The finding.
 * null  — nothing to judge (grok did not run, or started no plugin server). Not "fine".
 */
export function workerMarkerVerdict({ ran, seen }) {
  if (!ran) return { reached: null, reason: 'grok did not run, so nothing was measured' };
  if (seen.length === 0) {
    return { reached: null, reason: 'grok started no plugin MCP server, so there was nothing to check — plugin loading itself may have changed (contract §14)' };
  }
  if (seen.every((v) => v === '1')) return { reached: true, reason: `the marker reached all ${seen.length} plugin MCP server start(s)` };
  return { reached: false, reason: 'grok started the plugin MCP server WITHOUT the marker, so the A34 guard cannot fire (contract §14)' };
}

function runGrok(env, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('grok', ['--no-auto-update', '--always-approve', '--cwd', cwd, '--single', 'Say ok.', '--output-format', 'json'],
      { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume();
    child.stderr.resume();
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ ran: false, code: null, elapsedMs: Date.now() - started }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ran: true, code, elapsedMs: Date.now() - started }); });
  });
}

export async function probeWorkerMarker({ timeoutMs = 120_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-marker-probe-'));
  try {
    const home = join(root, 'home');
    const claudeDir = join(home, '.claude');
    const pluginDir = join(root, 'plugin');
    const grokHome = join(root, 'grokhome');
    const cwd = join(root, 'cwd');
    for (const d of [join(claudeDir, 'plugins'), join(pluginDir, '.claude-plugin'), grokHome, cwd]) mkdirSync(d, { recursive: true });

    // The same registry shape and plugin layout a real Claude Code install has (contract §14),
    // including the ${CLAUDE_PLUGIN_ROOT} indirection this plugin's own .mcp.json uses.
    writeFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'marker-probe@local': [{ scope: 'user', installPath: pluginDir, version: '0.0.0' }] },
    }));
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'marker-probe@local': true } }));
    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'marker-probe', version: '0.0.0' }));
    writeFileSync(join(pluginDir, '.mcp.json'), JSON.stringify({
      mcpServers: { 'marker-probe': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs'] } },
    }));
    writeFileSync(join(pluginDir, 'server.mjs'), PROBE_SERVER);
    writeFileSync(join(grokHome, 'auth.json'), JSON.stringify(syntheticAuth(Math.floor(Date.now() / 1000) + 3600)), { mode: 0o600 });

    const env = buildProbeEnv(process.env, { home, claudeDir, grokHome });
    if (env.APPDATA) mkdirSync(env.APPDATA, { recursive: true });
    if (env.LOCALAPPDATA) mkdirSync(env.LOCALAPPDATA, { recursive: true });

    const run = await runGrok(env, cwd, timeoutMs);
    const seen = readdirSync(pluginDir)
      .filter((f) => f.startsWith('seen-'))
      .map((f) => JSON.parse(readFileSync(join(pluginDir, f), 'utf8')).marker);
    return { ...workerMarkerVerdict({ ran: run.ran, seen }), grokExit: run.code, elapsedMs: run.elapsedMs };
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* a child may still hold a file on win32 */ }
  }
}
