/**
 * `.claude/tools/accept-release.mjs` grades a bundle where grok cannot be found (docs/10 A61 and A76, fixed
 * 2026-11-05 — the tool's header says how, and what was measured).
 *
 * A61, measured before the fix (win32, grok 1.0.70, quota 0 — every grok.exe a run could reach first was a tripwire
 * that records its start and exits, the sessions synthetic, both grok API URLs on a loopback answering 404): in a
 * home laid out like a signed-in maintainer's, grading the tags v0.2.18 and v0.2.20 started grok three times each
 * (the plan probe, `grok_cli ["--version"]`, `grok_cli ["sesions"]`) and v0.1.0 six times, through the home's
 * .grok/bin, which those bundles put in front of PATH. Run by the real grok, the plan, `sesions` and v0.1.0's
 * delegation argument lists each reached the model (`POST /v1/responses`). The first test therefore grades a
 * stand-in bundle whose servers and hooks start grok the way a bundle does — by name, with GROK_BIN_DIR and the
 * home's .grok/bin in front of PATH, from their own folder and from each probe's `cwd` — while a runnable grok
 * stand-in waits in every place the parent env reaches: PATH entries of the shapes a spawn search reads differently
 * from Node (on Windows quotes, a `;` inside them, a trailing dot, an unclosed quote; on POSIX `link/..` past a
 * symlink), GROK_BIN_DIR, the home's .grok/bin, the tool's working folder and its repo root. None may run. The same
 * records also show the env, the folders and the placeholder each process got, and the tool's cleanup.
 *
 * A76, measured the same day: where grok could not be found, the tool graded the v0.2.54 bundle 13/16 (A2, A35 and
 * A36 failed) and passed A7 on a deny that was the install hint, not the logged-out one. The second test grades the
 * committed bundle where grok cannot be found; the first also checks that A7 fails on an install-hint deny.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const tool = join(repoRoot, '.claude/tools/accept-release.mjs');
const win = process.platform === 'win32';
const GROK_FILES = ['grok', 'grok.exe', 'grok.cmd', 'grok.bat', 'grok.com', 'grok.ps1'];
// The lookup leaves `..` to the system, as a spawn does (path.join would fold it before a POSIX kernel follows a link).
const holdsGrok = (dir: string) => dir !== '' && GROK_FILES.some((n) => existsSync(win ? join(dir, n) : `${dir}/${n}`));
// The entries the tool may keep: those whose folder Node's literal lookup sees as a spawn does — on Windows a plain
// drive path (no quote, no folder name ending in a dot or a space), elsewhere an absolute path.
const plainEntry = (d: string) => (win
  ? /^[A-Za-z]:[\\/]/.test(d) && !/["']/.test(d) && d.split(/[\\/]/).every((s) => s === '.' || s === '..' || !/[. ]$/.test(s))
  : d.startsWith('/'));
const values = (env: Record<string, string | undefined>, name: string) =>
  Object.entries(env).filter(([k]) => k.toLowerCase() === name).map(([, v]) => v ?? '');
const without = (env: NodeJS.ProcessEnv, drop: (lowerName: string) => boolean): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([k]) => !drop(k.toLowerCase())));
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';

// The stand-in bundle (CommonJS — its folder's package.json says so). Each process writes records to the `envlog`
// folder beside `mcp-server`: the env it was given, its folder and home, what GROK_BIN_DIR and the home's .grok/bin
// hold, and what happened when it started grok the way a bundle does. The server answers every request with a fixed
// text and also tries grok from each probe's `cwd`; the hook denies the delegation payload with the install hint.
const RECORD = String.raw`
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const LOG = path.join(__dirname, '..', '..', 'envlog');
function list(dir) {
  try {
    return fs.readdirSync(dir).map((n) => { const s = fs.statSync(path.join(dir, n)); return { n, size: s.size, mode: s.mode }; });
  } catch { return null; }
}
// By name, GROK_BIN_DIR and the home's .grok/bin in front of PATH (as bundles do), with the current-folder lookup a
// maintainer's shell has (the variable that turns it off is removed from this process first).
function tryGrok(cwd) {
  if (!fs.existsSync(cwd)) return { cwd, error: 'NO_CWD', status: null, out: '' };
  for (const k of Object.keys(process.env)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete process.env[k];
  const env = {};
  let p = '';
  for (const [k, v] of Object.entries(process.env)) { if (k.toLowerCase() === 'path') p = v; else env[k] = v; }
  const front = [process.env.GROK_BIN_DIR, path.join(os.homedir(), '.grok', 'bin')].filter(Boolean);
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = [...front, p].join(path.delimiter);
  const r = spawnSync('grok', ['--version'], { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return { cwd, error: r.error ? String(r.error.code) : null, status: r.status, out: String(r.stdout || '').slice(0, 40) };
}
function record(role, tries) {
  fs.mkdirSync(LOG, { recursive: true });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (['path', 'grok_bin_dir', 'grok_home', 'home', 'userprofile'].includes(k.toLowerCase())) env[k] = v;
  }
  const bin = process.env.GROK_BIN_DIR;
  fs.writeFileSync(path.join(LOG, role + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json'),
    JSON.stringify({ role, env, cwd: process.cwd(), home: os.homedir(), binDir: bin || null, bin: bin ? list(bin) : null,
      homeBin: list(path.join(os.homedir(), '.grok', 'bin')), tries }));
}
`;
const FAKE_SERVER = String.raw`${RECORD}
record('server', [tryGrok(process.cwd())]);
const tried = new Set();
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
    const cwd = m.params && m.params.arguments && m.params.arguments.cwd;
    if (typeof cwd === 'string' && !tried.has(cwd)) { tried.add(cwd); record('probe', [tryGrok(cwd)]); }
    const result = m.method === 'tools/list' ? { tools: [] }
      : m.method === 'tools/call' ? { content: [{ type: 'text', text: '{"serverVersion":"9.9.9"}' }] }
      : { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'stand-in', version: '9.9.9' } };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
`;
const FAKE_HOOK = String.raw`${RECORD}
record('hook', [tryGrok(process.cwd())]);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(input); } catch {}
  if (p.tool_name === 'mcp__plugin_grok_grok-build__grok_build_delegate') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Grok Build CLI를 PATH에서 찾을 수 없습니다. (install hint from the stand-in)' } }));
  }
  process.exit(0);
});
`;

type Try = { cwd: string; error: string | null; status: number | null; out: string };
type Rec = {
  role: string; env: Record<string, string>; cwd: string; home: string; binDir: string | null;
  bin: { n: string; size: number; mode: number }[] | null; homeBin: { n: string }[] | null; tries: Try[];
};

describe('accept-release.mjs grades where grok cannot be found (docs/10 A61, A76)', () => {
  it('starts every server and hook where no grok the parent env reaches can run (A61)', () => {
    const t = mkdtempSync(join(tmpdir(), 'accept-release-a61-'));
    try {
      // A grok stand-in that runs: on Windows a copy of this node.exe named grok.exe (`grok --version` then prints
      // node's version), hard-linked where the volume allows it; elsewhere a shell script.
      const runnableSource = join(t, 'runnable.exe');
      if (win) copyFileSync(process.execPath, runnableSource);
      const plantRunnable = (dir: string) => {
        mkdirSync(dir, { recursive: true });
        if (win) {
          try { linkSync(runnableSource, join(dir, 'grok.exe')); } catch { copyFileSync(runnableSource, join(dir, 'grok.exe')); }
        } else {
          writeFileSync(join(dir, 'grok'), '#!/bin/sh\necho grok-stand-in\n');
          chmodSync(join(dir, 'grok'), 0o755);
        }
        return dir;
      };
      // PATH: a runnable stand-in under each shape, and one folder per other file name the install probe or a shell
      // would take (those only have to be dropped). The unclosed quote goes last: it reaches to the end of PATH.
      const front: string[] = [plantRunnable(join(t, 'plain')), `"${plantRunnable(join(t, 'double-quoted'))}"`];
      for (const n of ['grok.cmd', 'grok.bat', 'grok.ps1', ...(win ? ['grok', 'grok.com'] : ['grok.exe'])]) {
        const d = join(t, `name-${n.replace('.', '-')}`);
        mkdirSync(d);
        writeFileSync(join(d, n), '');
        front.push(d);
      }
      let last: string[] = [];
      if (win) {
        // libuv also drops a quote that only ends an entry; Windows drops a lone trailing dot from a folder name.
        front.push(`'${plantRunnable(join(t, 'single-quoted'))}'`, `"${plantRunnable(join(t, 'semi;colon'))}"`,
          `${plantRunnable(join(t, 'trailing-quote'))}"`, `${plantRunnable(join(t, 'trailing-single'))}'`,
          `${plantRunnable(join(t, 'dotted'))}.`, '.');
        // Not a drive path (the tool drops such entries without looking them up); empty, so only the rule sees it.
        mkdirSync(join(t, 'verbatim'));
        front.push(`\\\\?\\${join(t, 'verbatim')}`);
        last = [`"${plantRunnable(join(t, 'open-quote'))}`];
      } else {
        front.push(''); // an empty entry: the spawn's own folder
        // `link/..` where link -> real/inner: the kernel follows the link first and lands in real, which holds one.
        plantRunnable(join(t, 'dotdot', 'real'));
        mkdirSync(join(t, 'dotdot', 'real', 'inner'));
        symlinkSync(join(t, 'dotdot', 'real', 'inner'), join(t, 'dotdot', 'link'));
        front.push(`${join(t, 'dotdot', 'link')}/..`);
      }
      // A relative entry is searched from the spawn's folder, not the tool's (where this one names nothing).
      front.push('relative-entry');
      const decoyBin = plantRunnable(join(t, 'decoy-bin'));
      const home = join(t, 'home');
      plantRunnable(join(home, '.grok', 'bin'));
      const parentGrokHome = join(t, 'parent-grok-home');
      mkdirSync(parentGrokHome);
      // The tool runs from a copy of its repo layout whose root holds a stand-in, from a folder that holds one too.
      const layout = join(t, 'layout');
      mkdirSync(join(layout, '.claude', 'tools'), { recursive: true });
      mkdirSync(join(layout, 'mcp-server'));
      copyFileSync(tool, join(layout, '.claude', 'tools', 'accept-release.mjs'));
      copyFileSync(join(repoRoot, 'mcp-server', 'package.json'), join(layout, 'mcp-server', 'package.json'));
      plantRunnable(layout);
      const toolCwd = plantRunnable(join(t, 'tool-cwd'));
      const bundle = join(home, '.claude', 'plugins', 'cache', 'accept-test', 'grok', '9.9.9', 'mcp-server');
      mkdirSync(join(bundle, 'dist'), { recursive: true });
      writeFileSync(join(bundle, 'package.json'), '{ "type": "commonjs" }\n');
      writeFileSync(join(bundle, 'dist', 'index.js'), FAKE_SERVER);
      writeFileSync(join(bundle, 'dist', 'hook.js'), FAKE_HOOK);
      // On Windows the search path is spelled `Path` here whatever the shell that started the test exported
      // (Git Bash exports `PATH`): env names are case-insensitive there, so the tool must strip every spelling.
      const env = {
        ...without(process.env, (k) => ['path', 'home', 'userprofile', 'grok_home', 'grok_bin_dir'].includes(k)),
        HOME: home, USERPROFILE: home, GROK_HOME: parentGrokHome, GROK_BIN_DIR: decoyBin,
        [win ? 'Path' : 'PATH']: [...front, process.env[pathKey] ?? '', ...last].join(delimiter),
      };

      const r = spawnSync(process.execPath, [join(layout, '.claude', 'tools', 'accept-release.mjs'), '--version', '9.9.9'],
        { env, cwd: toolCwd, encoding: 'utf8', timeout: 120_000 });
      expect(r.stdout, r.stderr).toContain(`grading: installed cache (${join(home, '.claude', 'plugins', 'cache', 'accept-test', 'grok', '9.9.9')})`);

      const log = join(bundle, '..', 'envlog');
      const records = readdirSync(log).map((f) => JSON.parse(readFileSync(join(log, f), 'utf8')) as Rec);
      // Every server the tool starts (the shared session, one per isolated cell, the bad-mode run), every hook run,
      // and the probes' folders.
      expect(records.filter((x) => x.role === 'server').length).toBeGreaterThanOrEqual(8);
      expect(records.filter((x) => x.role === 'hook').length).toBeGreaterThanOrEqual(3);
      expect(records.filter((x) => x.role === 'probe').length).toBeGreaterThanOrEqual(1);

      // Started = no spawn error (whatever it exited with), or killed at the cap after starting. A file that is found
      // but cannot run (the placeholder: EACCES on POSIX) and a file that is not found (ENOENT) did not start.
      const ran = records.flatMap((x) => x.tries.filter((y) => y.error === null || y.error === 'ETIMEDOUT')
        .map((y) => `${x.role} in ${y.cwd}: ${y.error ?? `exit ${y.status}`} ${y.out}`));
      expect(ran, 'a grok the parent env reaches started').toEqual([]);
      const wrong: string[] = [];
      for (const x of records) {
        for (const p of values(x.env, 'path')) {
          for (const d of p.split(delimiter)) if (!plainEntry(d) || holdsGrok(d)) wrong.push(`${x.role}: PATH entry ${JSON.stringify(d)}`);
        }
        // Only an empty extensionless placeholder may sit in GROK_BIN_DIR, not executable: the install probe accepts
        // it, nothing can run it.
        const bin = x.bin ?? [];
        const placeholderOnly = bin.length === 1 && bin[0].n === 'grok' && bin[0].size === 0 && (win || (bin[0].mode & 0o111) === 0);
        if (!placeholderOnly || x.binDir === decoyBin) wrong.push(`${x.role}: GROK_BIN_DIR ${x.binDir} holds ${JSON.stringify(bin)}`);
        if (x.home === home || (x.homeBin ?? []).some((f) => GROK_FILES.includes(f.n))) wrong.push(`${x.role}: home ${x.home}`);
        for (const g of values(x.env, 'grok_home')) if (g === parentGrokHome) wrong.push(`${x.role}: the parent's GROK_HOME`);
        for (const y of x.tries) if (y.cwd === toolCwd || holdsGrok(y.cwd)) wrong.push(`${x.role}: started in ${y.cwd}`);
      }
      expect(wrong).toEqual([]);
      // The tool removes what it made.
      const made = [...new Set(records.map((x) => x.binDir).filter((b): b is string => b !== null).map((b) => dirname(b)))];
      expect(made.filter((d) => existsSync(d)), 'left behind').toEqual([]);
      // A7 is graded on WHY the hook denies: the stand-in's install-hint deny must not pass it.
      expect(r.stdout).toMatch(/^\s+FAIL\s+A7\s/m);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  }, 120_000);

  it('gives the committed bundle full marks on a machine where grok cannot be found (A76)', () => {
    const t = mkdtempSync(join(tmpdir(), 'accept-release-a76-'));
    try {
      const home = join(t, 'home');
      mkdirSync(home);
      const env = {
        ...without(process.env, (k) => k.startsWith('grok_') || k.startsWith('xai_') || ['path', 'home', 'userprofile'].includes(k)),
        HOME: home, USERPROFILE: home,
        [pathKey]: (process.env[pathKey] ?? '').split(delimiter).filter((d) => !holdsGrok(d.replace(/^"(.*)"$/, '$1'))).join(delimiter),
      };
      const where = win
        ? spawnSync('where', ['grok'], { env, encoding: 'utf8' })
        : spawnSync('sh', ['-c', 'command -v grok'], { env, encoding: 'utf8' });
      expect(where.status, `grok is still findable: ${where.stdout}`).not.toBe(0);

      const r = spawnSync(process.execPath, [tool, '--repo'], { env, cwd: repoRoot, encoding: 'utf8', timeout: 180_000 });
      const score = r.stdout.match(/(\d+)\/(\d+) passed/);
      expect(score, r.stdout + r.stderr).not.toBeNull();
      expect(score?.[1], r.stdout).toBe(score?.[2]);
      expect(r.status, r.stdout).toBe(0);
      // A7 passes on the logged-out deny (the install hint would fail it — the test above).
      expect(r.stdout).toMatch(/^\s+PASS\s+A7\s/m);
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  }, 180_000);
});
