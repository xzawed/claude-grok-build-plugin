#!/usr/bin/env node
/**
 * Drive the SHIPPED MCP bundle over stdio, exactly the way `.mcp.json` does.
 *
 * The session's own MCP process is pinned to whatever version was installed when the session
 * started (0.2.17 here), so auditing through it would grade the wrong artifact. This launches
 * mcp-server/dist/index.js from the repo — what a fresh installer actually gets.
 *
 * Usage:
 *   node mcpcall.mjs list
 *   node mcpcall.mjs call <toolName> '<json args>'
 *   node mcpcall.mjs call grok_build_route '{"task":"add tests"}'
 *
 * Env passthrough: GROK_BUILD_AUTH_MODE is forwarded so the api-mode branch can be exercised.
 * Prints the raw JSON-RPC result to stdout. Exit 0 on a response, 1 on transport failure.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve the bundle relative to this file so the tool works from any cwd and any clone.
const SERVER = fileURLToPath(new URL('../../mcp-server/dist/index.js', import.meta.url));

const [, , mode, toolName, argsJson] = process.argv;
if (!mode || (mode === 'call' && !toolName)) {
  console.error('usage: mcpcall.mjs list | mcpcall.mjs call <tool> <jsonArgs>');
  process.exit(2);
}

const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
  windowsHide: true,
});

let buf = '';
let stderr = '';
const pending = new Map();
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => { stderr += d; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 240_000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'service-audit', version: '1.0.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  let out;
  if (mode === 'list') {
    out = await rpc('tools/list', {});
    out = (out.result?.tools || []).map((t) => t.name);
  } else {
    const args = argsJson ? JSON.parse(argsJson) : {};
    const r = await rpc('tools/call', { name: toolName, arguments: args });
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
