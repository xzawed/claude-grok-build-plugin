#!/usr/bin/env node
/**
 * AUDITED BY GROK 2026-09-23, one finding, fixed below. Claim put to it, over this header and
 * accept-release.mjs's together: "a reader of these two headers would not learn that running the
 * second one can cost money." Upheld — and Grok added the sharper point, that the one line a
 * reader might take for a cost note ("GROK_BUILD_AUTH_MODE is forwarded so the api-mode branch can
 * be exercised") never says exercising that branch means metered billing. The cost paragraph below
 * is the fix.
 *
 * Drive the SHIPPED MCP bundle over stdio, exactly the way `.mcp.json` does.
 *
 * The session's own MCP process is pinned to whatever version was installed when the session
 * started, so auditing through it would grade the wrong artifact. This launches
 * mcp-server/dist/index.js from the repo — what a fresh installer actually gets.
 *
 * ⚠️ THIS SPENDS REAL QUOTA. Its neighbour accept-release.mjs promises the opposite — "spawns no
 * grok process and spends no subscription quota" — and the two sit in the same shipped directory,
 * so that promise reads as covering both. It does not. `call grok_build_delegate` (or plan, or
 * verify, or a grok_cli passthrough carrying a prompt) runs a real headless grok turn against
 * whatever credentials the environment holds, exactly as a user's own delegation would.
 *
 * The free calls are the read-only ones: `list`, `grok_build_route` (a pure local decision),
 * `grok_build_usage`, `grok_build_status`, `grok_auth_check`, `grok_build_worktree`, and a
 * `grok_cli` passthrough with no prompt flag. If you only need to prove a bundle is wired up,
 * accept-release.mjs does that and is safe to repeat.
 *
 * Usage:
 *   node mcpcall.mjs list
 *   node mcpcall.mjs call <toolName> '<json args>'
 *   node mcpcall.mjs call grok_build_route '{"task":"add tests"}'
 *   node mcpcall.mjs --era modern list      # the 2026-07-28 era (rpc-era.mjs); the default is --era legacy
 *
 * Env: the WHOLE parent environment is handed to the server (`env: process.env` below), not one
 * variable — so `GROK_BUILD_AUTH_MODE=api` in your shell makes every delegation here metered, and
 * `GROK_SANDBOX` reaches the grok child too. The server still applies buildGrokEnv, so
 * subscription mode strips the API keys before grok sees them; the mode itself is yours to set.
 * Prints the raw JSON-RPC result to stdout. Exit 0 on a response, 1 on transport failure.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rpcTimeoutMs, harnessTimeoutMessage } from './rpc-timeout.mjs';
import { openSession } from './rpc-era.mjs';

// Resolve the bundle relative to this file so the tool works from any cwd and any clone.
const SERVER = fileURLToPath(new URL('../../mcp-server/dist/index.js', import.meta.url));

const argv = process.argv.slice(2);
let era = 'legacy';
const eraAt = argv.indexOf('--era');
if (eraAt !== -1) { era = argv[eraAt + 1]; argv.splice(eraAt, 2); }
const [mode, toolName, argsJson] = argv;
if (!mode || (mode === 'call' && !toolName) || (era !== 'legacy' && era !== 'modern')) {
  console.error('usage: mcpcall.mjs [--era legacy|modern] list | mcpcall.mjs [--era legacy|modern] call <tool> <jsonArgs>');
  process.exit(2);
}

const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
  windowsHide: true,
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => { stderr += d; });

/*
 * MEASURED 2026-09-13: this used a bare 240 s literal and never looked at the tool arguments,
 * so `timeout_ms: 900000` was cut at exactly 240 s and reported as a plain transport timeout —
 * unreadable as "the harness gave up" rather than "the server hung". The rule now lives in
 * rpc-timeout.mjs and is pinned by mcp-server/test/mcpcall-timeout.test.ts.
 *
 * A26 (MEASURED 2026-09-12): the child can die BEFORE it answers, and nothing here noticed. An invalid
 * GROK_BUILD_AUTH_MODE makes the server print one line to stderr and exit 1 in under 100ms; with no rejector but
 * the 240s timer, this tool sat silent for four minutes with the diagnosis already sitting in `stderr`, unprinted.
 * openSession (rpc-era.mjs) rejects every pending request when the server exits ("server exited before answering"),
 * and the catch below prints the stderr tail.
 */
try {
  const session = await openSession(child, era, {
    clientInfo: { name: 'service-audit', version: '1.0.0' },
    timeoutFor: (method, params) => rpcTimeoutMs(method, params?.arguments),
    timeoutMessage: (method, capMs) => harnessTimeoutMessage(method, capMs),
  });

  let out;
  if (mode === 'list') {
    out = await session.request('tools/list', {});
    out = (out.result?.tools || []).map((t) => t.name);
  } else {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const r = await session.request('tools/call', { name: toolName, arguments: args });
    // isError is the only signal a client has that the delegation failed — keep it visible.
    out = { isError: r.result?.isError ?? null, text: r.result?.content?.[0]?.text ?? null, error: r.error ?? null };
  }
  console.log(JSON.stringify(out, null, 2));
  child.kill();
  process.exit(0);
} catch (err) {
  console.error('TRANSPORT FAILURE:', err.message, '\nstderr:', stderr.slice(-500));
  child.kill();
  process.exit(1);
}
