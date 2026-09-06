#!/usr/bin/env node
/**
 * Headless release acceptance — grade the bundle a user actually runs.
 *
 * Why this exists: `docs/09` §5 is a HUMAN GUI checklist, and a running Claude Code session
 * holds the MCP process it started with, so clicking through it right after an update grades the
 * OLD bundle. Every release since v0.2.17 has been accepted by driving the shipped bundle
 * directly instead — and until now that was done by hand with ad-hoc one-liners that lived only
 * in a session transcript. This file is that procedure, so the next session or a different
 * machine runs the same checks and gets the same evidence.
 *
 * Usage:
 *   node .claude/tools/accept-release.mjs              # grade the INSTALLED plugin cache
 *   node .claude/tools/accept-release.mjs --repo       # grade this repo's mcp-server/dist
 *   node .claude/tools/accept-release.mjs --version 0.2.22
 *
 * Exits 0 when every check passes, 1 otherwise. Spawns no grok process and spends no
 * subscription quota — including when grading an OLD bundle that still has the defect being
 * checked. That second half is easy to get wrong: the probes carry `best_of_n`, which every
 * 1.0 build refuses before spawning, so a bundle that strips the unknown key still stops there
 * instead of running a real delegation. Measured while writing this: without it, grading
 * 0.2.21 hung for 30s on a live grok run. An acceptance run must be safe to repeat anywhere.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const useRepo = args.includes('--repo');
const wantVersion = (() => {
  const i = args.indexOf('--version');
  return i !== -1 ? args[i + 1] : undefined;
})();

const declared = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')).version;
const expected = wantVersion ?? declared;

/** Where the plugin cache keeps each version, across marketplaces. */
function findCache(version) {
  const base = join(homedir(), '.claude', 'plugins', 'cache');
  if (!existsSync(base)) return undefined;
  for (const mk of readdirSync(base)) {
    const p = join(base, mk, 'grok', version);
    if (existsSync(join(p, 'mcp-server', 'dist', 'index.js'))) return p;
  }
  return undefined;
}

let root;
let label;
if (useRepo) {
  root = join(repoRoot, 'mcp-server');
  label = `repo working tree (${repoRoot})`;
} else {
  const cache = findCache(expected);
  if (!cache) {
    console.error(`no installed cache for ${expected}.`);
    console.error('  run:  claude plugin marketplace update grok-marketplace');
    console.error('        claude plugin update grok@grok-marketplace');
    console.error(`  or grade the working tree instead:  node ${'.claude/tools/accept-release.mjs'} --repo`);
    process.exit(1);
  }
  root = join(cache, 'mcp-server');
  label = `installed cache (${cache})`;
}

const SERVER = join(root, 'dist', 'index.js');
const HOOK = join(root, 'dist', 'hook.js');

// ── a tiny MCP client over stdio ───────────────────────────────────────────
function mcpSession() {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '';
  let nextId = 2;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const r = pending.get(j.id);
      if (r) { pending.delete(j.id); r(j); }
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'accept', version: '0' } },
  });
  return {
    call(name, args_) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, (j) => {
          const text = j.result?.content?.[0]?.text ?? '';
          resolve({ isError: Boolean(j.result?.isError), text, raw: j });
        });
        setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${name}`)); }, 30_000);
        send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args_ } });
      });
    },
    listTools() {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, (j) => resolve(j.result?.tools ?? []));
        setTimeout(() => { pending.delete(id); reject(new Error('timeout: tools/list')); }, 30_000);
        send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
      });
    },
    close() { child.kill(); },
  };
}

function runHook(payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, ...env },
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(out.trim()));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function runServerWithBadMode() {
  return new Promise((resolve) => {
    const env = { ...process.env, GROK_BUILD_AUTH_MODE: 'nonsense-for-acceptance' };
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err: err.trim() }));
    child.stdin.end();
  });
}

// ── checks ─────────────────────────────────────────────────────────────────
const results = [];
const check = (id, what, pass, evidence) => results.push({ id, what, pass, evidence });

const session = mcpSession();
// A grok home with no auth.json, so the hook's subscription branch has something to deny on.
const emptyGrokHome = mkdtempSync(join(tmpdir(), 'accept-grokhome-'));

try {
  // identity — everything below is meaningless if this grades the wrong artifact
  {
    const r = await session.call('grok_auth_check', {});
    const v = JSON.parse(r.text).serverVersion;
    check('identity', `bundle reports ${expected}`, v === expected, `serverVersion=${v}`);
  }

  // A7 — the PreToolUse deny branch must be armed in the SHIPPED configuration (no env set)
  {
    const denied = await runHook(
      { tool_name: 'mcp__plugin_grok_grok-build__grok_build_delegate', tool_input: { task: 'x' } },
      { GROK_BUILD_AUTH_MODE: undefined, GROK_HOME: emptyGrokHome },
    );
    check('A7', 'hook denies a delegation while logged out, with no env set',
      denied.includes('"deny"'), denied ? 'deny emitted' : 'NO OUTPUT (branch not armed)');
  }

  // A7/A2 — and must NOT block the read-only commands you run to diagnose being logged out
  {
    const out = await runHook(
      { tool_name: 'mcp__plugin_grok_grok-build__grok_cli', tool_input: { args: ['--version'] } },
      { GROK_BUILD_AUTH_MODE: undefined, GROK_HOME: emptyGrokHome },
    );
    check('A2', 'hook lets a read-only grok_cli query through while logged out',
      out === '', out === '' ? 'allowed' : `DENIED: ${out.slice(0, 80)}`);
  }

  // A21 — every tool enforces the additionalProperties:false it publishes
  {
    const cases = [
      ['grok_auth_check', {}],
      // best_of_n is refused before anything spawns (removed in CLI 1.0). On a bundle that
      // already has the fix the call dies on the unknown key; on one that does not, the key is
      // stripped and best_of_n stops it anyway. Without this the probe would run a REAL
      // delegation against exactly the bundles it is meant to catch — measured, it hung for 30s.
      ['grok_build_delegate', { prompt: 'x', cwd: repoRoot, best_of_n: 2 }],
      ['grok_build_plan', { prompt: 'x', cwd: repoRoot, best_of_n: 2 }],
      ['grok_build_verify', { prompt: 'x', cwd: repoRoot, best_of_n: 2 }],
      ['grok_build_usage', {}],
      ['grok_build_status', {}],
      ['grok_build_worktree', { action: 'list', cwd: repoRoot }],
      ['grok_build_route', { task: 'x' }],
      ['grok_cli', { args: ['--version'] }],
    ];
    const accepted = [];
    for (const [name, base] of cases) {
      const r = await session.call(name, { ...base, totally_bogus: 1 });
      if (!r.text.includes('unrecognized_keys')) accepted.push(name);
    }
    check('A21', 'all 9 tools refuse an unknown key', accepted.length === 0,
      accepted.length ? `still accepting: ${accepted.join(', ')}` : '9/9 refused');
  }

  // A21 — and a typo on an isolation flag is refused rather than silently run without isolation
  {
    // best_of_n for the same reason as above: on a pre-fix bundle `worktreee` is stripped and
    // this would otherwise become a real delegation.
    const r = await session.call('grok_build_delegate', { prompt: 'x', cwd: repoRoot, worktreee: true, best_of_n: 2 });
    check('A21', 'a typo on `worktree` is refused, not silently ignored',
      r.isError && r.text.includes('worktreee'), r.isError ? 'refused by name' : 'ACCEPTED — would run without isolation');
  }

  // A14 — plan takes the same fields as verify (schema advertised == schema meant)
  {
    const tools = await session.listTools();
    const props = (n) => Object.keys(tools.find((t) => t.name === n)?.inputSchema?.properties ?? {}).sort();
    const plan = props('grok_build_plan');
    const verify = props('grok_build_verify');
    check('A14', 'plan advertises the same fields as verify',
      JSON.stringify(plan) === JSON.stringify(verify), `plan=${plan.length} verify=${verify.length}`);
  }

  // A11 + A10 — an unknown subcommand is refused without spawning, and reads as an error
  {
    const t0 = Date.now();
    const r = await session.call('grok_cli', { args: ['sesions'] });
    const ms = Date.now() - t0;
    const body = (() => { try { return JSON.parse(r.text); } catch { return {}; } })();
    check('A11', 'a one-word typo is blocked without spawning (was a 60s timeout)',
      body.status === 'blocked' && ms < 10_000, `status=${body.status} in ${ms}ms`);
    check('A10', 'a blocked command reads as isError', r.isError === true, `isError=${r.isError}`);
  }

  // A17 — an empty SCOPED result must not read as an empty history
  {
    const nowhere = join(tmpdir(), 'accept-no-history-here');
    const r = await session.call('grok_build_usage', { cwd: nowhere });
    const headline = JSON.parse(r.text).insights?.headline ?? '';
    check('A17', 'a cwd-scoped empty result names the directory',
      headline.includes(nowhere) || headline.includes('디렉터리'),
      headline.slice(0, 90));
  }

  // A12 — a bad mode env produces one actionable line, not a stack
  {
    const { code, err } = await runServerWithBadMode();
    const oneLine = err.split('\n').length === 1 && !err.includes('    at ');
    check('A12', 'an invalid GROK_BUILD_AUTH_MODE gives one line and exit 1',
      code === 1 && oneLine, `exit=${code} lines=${err.split('\n').length}`);
  }
} catch (e) {
  // A check that threw is a check that failed — say so and keep the report readable.
  check('harness', 'all checks ran to completion', false, e instanceof Error ? e.message : String(e));
} finally {
  session.close();
  rmSync(emptyGrokHome, { recursive: true, force: true });
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`grading: ${label}`);
console.log(`expected version: ${expected}${wantVersion ? '' : '  (from mcp-server/package.json)'}\n`);
let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(9)} ${r.what}`);
  console.log(`        ${r.evidence}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) {
  console.log('\nA failure here usually means one of two things: the cache holds an older bundle');
  console.log('(re-run marketplace update + plugin update), or a released fix regressed.');
}
console.log('\nStill needs a human: restart Claude Code and run /grok:status once, to prove the GUI');
console.log('path loads this same bundle (docs/10 B4). A running session holds the process it');
console.log('started with, so that one cannot be checked from inside a session.');
process.exit(failed ? 1 : 0);
