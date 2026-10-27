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
 *   - A throwaway GROK_HOME holding a SYNTHETIC auth.json (synthetic-auth.mjs), and grok's two API base URLs
 *     (GROK_CLI_CHAT_PROXY_BASE_URL, GROK_XAI_API_BASE_URL) pointed at a loopback here that answers 404 to everything.
 *     MEASURED 2026-10-27 (win32, grok 1.0.62 and 1.0.70): a session no server rejects is opened as it is, grok starts its
 *     MCP servers, and its model requests then end the run (exit 1, about 3 s). Without the loopback the real servers
 *     reject the synthetic token, and grok (1.0.62 and 1.0.70) SIGNS IN before starting any MCP server — in the browser, waiting
 *     for a person (A68, sign-in-stop.mjs): the watch saw nothing, and a window was left that a person could sign in
 *     through.
 *   - Every GROK_* and XAI_* variable of the parent is dropped (isolatedGrokEnv) — not just the two
 *     API keys: a second review found GROK_AUTH_PROVIDER_COMMAND, a token provider grok re-runs after
 *     a 401, which would have turned the rejected session into a real one.
 *   - If grok begins a sign-in anyway, it is stopped (with the browser it opened, on win32 — measured there), and the
 *     verdict says so.
 *   - And the probe checks its own promise afterwards: a session grok exited 0 on is reported as a failure of its own
 *     (`sessionAccepted`). The loopback answers no turn, so an exit 0 means either a turn completed against something
 *     else — some credential got through — or a grok that now exits 0 on a failed request (1.0.62 and 1.0.70 exited 1
 *     on the 404; contract §4 records exit 0 for a cancelled turn). On 2026-10-17 (1.0.62, before the loopback and the stop) it fired after a sign-in
 *     completed in the browser grok had opened — the only path of those measured on that binary that ends that way, and
 *     the owner confirmed signing in through that window (sign-in-stop.mjs).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syntheticAuth, isolatedGrokEnv } from './synthetic-auth.mjs';
import { signInLogFor, watchSignIn, stopTree, stopTreeOnSignal } from './sign-in-stop.mjs';

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

/**
 * The probe plugin, laid out the way a real Claude Code plugin is (contract §14) — including the
 * ${CLAUDE_PLUGIN_ROOT} indirection this plugin's own .mcp.json uses. Each server start leaves a
 * `seen-<pid>.json` next to server.mjs.
 */
export function writeProbePlugin(pluginDir) {
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'marker-probe', version: '0.0.0' }));
  writeFileSync(join(pluginDir, '.mcp.json'), JSON.stringify({
    mcpServers: { 'marker-probe': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs'] } },
  }));
  writeFileSync(join(pluginDir, 'server.mjs'), PROBE_SERVER);
}

/** The markers recorded by every probe-server start in `pluginDir`. */
export function readSeenMarkers(pluginDir) {
  return readdirSync(pluginDir)
    .filter((f) => f.startsWith('seen-'))
    .map((f) => JSON.parse(readFileSync(join(pluginDir, f), 'utf8')).marker);
}

/** The env the probe's grok runs with. Pure, so a test holds it to the no-real-account promise. */
export function buildProbeEnv(base, { home, claudeDir, grokHome, apiBase }, platform = process.platform) {
  const overrides = { HOME: home, USERPROFILE: home, GROK_HOME: grokHome, CLAUDE_CONFIG_DIR: claudeDir, [WORKER_MARKER]: '1' };
  if (apiBase) {
    overrides.GROK_CLI_CHAT_PROXY_BASE_URL = apiBase;
    overrides.GROK_XAI_API_BASE_URL = apiBase;
  }
  if (platform === 'win32') {
    overrides.APPDATA = join(home, 'AppData', 'Roaming');
    overrides.LOCALAPPDATA = join(home, 'AppData', 'Local');
  }
  return isolatedGrokEnv(base, overrides);
}

/** A loopback that answers every request 404, so no server ever rejects the synthetic session. */
export function startApiLoopback() {
  return new Promise((resolve, reject) => {
    let requests = 0;
    const server = createServer((req, res) => {
      requests += 1;
      req.resume();
      req.on('end', () => {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"not found"}');
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        requests: () => requests,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

const REJECTED = /401|invalid or expired credentials|not signed in|not authenticated/i;

/**
 * reached  — true: every probe-server start saw the marker; false: one did not (THE finding — the
 *            guard is off); null: nothing was judged.
 * blind    — grok ran but started no plugin server, so this watch can see nothing. Not "fine": grok
 *            may have stopped loading Claude plugins, or now checks auth before starting MCP servers.
 * signInStarted — grok began an interactive sign-in and was stopped (blind as well, unless markers were already seen):
 *            the session was rejected although grok's API URLs point at the loopback, so some request went elsewhere.
 * sessionAccepted — grok exited 0, and the loopback answers no turn: either a turn completed against something else (a
 *            credential got through the isolation) or grok now exits 0 on a failed request. The probe's own promise is in
 *            doubt; say so before anything else.
 */
export function workerMarkerVerdict({ ran, seen, exitCode = null, output = '', signInStarted = false }) {
  const base = {
    blind: false, sessionAccepted: ran && exitCode === 0, authRejected: REJECTED.test(output), signInStarted: ran && signInStarted,
  };
  if (!ran) return { ...base, reached: null, reason: 'grok did not run, so nothing was measured' };
  const accepted = base.sessionAccepted
    ? 'grok exited 0 on the probe session — the loopback answers no turn, so either one completed against something else (a credential got past the isolation) or grok now exits 0 on a failed request; do not run this again until you know which. '
    : '';
  if (seen.length === 0) {
    if (base.signInStarted) {
      return { ...base, reached: null, blind: true, reason: `${accepted}grok began an interactive sign-in, so the probe session was rejected although grok's API URLs point at the loopback — find the request it sent elsewhere; grok signs in before it starts MCP servers, so this watch is blind (contract §7, §14)` };
    }
    return { ...base, reached: null, blind: true, reason: `${accepted}grok ran but started no plugin MCP server, so this watch is blind — re-measure contract §14 (plugin loading, or MCP start order)` };
  }
  // Marker starts seen before a sign-in are still the measurement; the sign-in is said after them.
  const later = base.signInStarted
    ? " — then grok began an interactive sign-in and was stopped: the probe session was rejected although grok's API URLs point at the loopback — find the request it sent elsewhere (contract §7)"
    : '';
  if (seen.every((v) => v === '1')) return { ...base, reached: true, reason: `${accepted}the marker reached all ${seen.length} plugin MCP server start(s)${later}` };
  return { ...base, reached: false, reason: `${accepted}grok started the plugin MCP server WITHOUT the marker, so the A34 guard cannot fire (contract §14)${later}` };
}

function runGrok(env, cwd, timeoutMs, grokHome) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let signInStarted = false;
    let child;
    const keep = (d) => { output = (output + d).slice(-4000); };
    // POSIX: grok leads its own process group, so a stop reaches what it started too (measured by the pre-merge review:
    // without it a child holding grok's pipes kept the probe 20 s past a 5 s cap).
    const detached = process.platform !== 'win32';
    // Before the spawn, so grok's line cannot be behind the watch's starting point; not matched once grok has exited. The
    // cap stops the same tree: a browser grok opened keeps its pipes open (measured, 1.0.62), and 'close' would wait for it.
    const alive = () => (child && child.exitCode === null && child.signalCode === null ? child.pid : undefined);
    const signIn = watchSignIn(signInLogFor(grokHome), alive, () => { signInStarted = true; stopTree(child, { detached }); }, 250);
    // grok gets no Ctrl+C or hang-up from the terminal (POSIX: it leads its own session; win32: hidden with piped stdio it
    // runs in a hidden console of its own) — this stops it, so an interrupted probe leaves no grok waiting at a sign-in.
    const offSignal = stopTreeOnSignal(() => child, { detached });
    child = spawn('grok', ['--no-auto-update', '--always-approve', '--cwd', cwd, '--single', 'Say ok.', '--output-format', 'json'],
      { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached });
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => stopTree(child, { detached }), timeoutMs);
    const done = (ran, code) => {
      clearTimeout(timer);
      signIn.stop();
      offSignal();
      resolve({ ran, code, output, signInStarted, elapsedMs: Date.now() - started });
    };
    child.on('error', () => done(false, null));
    child.on('close', (code) => done(true, code));
  });
}

export async function probeWorkerMarker({ timeoutMs = 120_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-marker-probe-'));
  let api;
  try {
    api = await startApiLoopback();
    const home = join(root, 'home');
    const claudeDir = join(home, '.claude');
    const pluginDir = join(root, 'plugin');
    const grokHome = join(root, 'grokhome');
    const cwd = join(root, 'cwd');
    for (const d of [join(claudeDir, 'plugins'), grokHome, cwd]) mkdirSync(d, { recursive: true });

    // The same registry shape a real Claude Code install has (contract §14).
    writeFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'marker-probe@local': [{ scope: 'user', installPath: pluginDir, version: '0.0.0' }] },
    }));
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'marker-probe@local': true } }));
    writeProbePlugin(pluginDir);
    writeFileSync(join(grokHome, 'auth.json'), JSON.stringify(syntheticAuth(Math.floor(Date.now() / 1000) + 3600)), { mode: 0o600 });

    const env = buildProbeEnv(process.env, { home, claudeDir, grokHome, apiBase: api.base });
    if (env.APPDATA) mkdirSync(env.APPDATA, { recursive: true });
    if (env.LOCALAPPDATA) mkdirSync(env.LOCALAPPDATA, { recursive: true });

    const run = await runGrok(env, cwd, timeoutMs, grokHome);
    const verdict = workerMarkerVerdict({
      ran: run.ran, seen: readSeenMarkers(pluginDir), exitCode: run.code, output: run.output, signInStarted: run.signInStarted,
    });
    return { ...verdict, grokExit: run.code, elapsedMs: run.elapsedMs, loopbackRequests: api.requests() };
  } finally {
    await api?.close();
    try { rmSync(root, { recursive: true, force: true }); } catch { /* a child may still hold a file on win32 */ }
  }
}
