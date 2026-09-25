/**
 * A36 re-measure: on Windows, does the plugin look for grok's session where grok itself opens it?
 *
 * WHY. grok opens <GROK_HOME>\auth.json through Windows path normalization. Node's fs turns drive and
 * UNC paths into the \\?\ form first, which skips it. src/env.ts (grokHome, grokHomeFor) applies the two
 * rules that explained every measured disagreement — contract §8, docs/10 A36. Those rules are Windows'
 * and grok's behaviour, so every unit test stays green if they change: a grok that started opening the
 * trimmed home `grok du` already reports would flip the trailing-space case. This asks the grok in front
 * of you. MEASURED 2026-09-25 on 1.0.41: 714 runs, v0.2.34 disagreed on 456, v0.2.35 on none.
 *
 * HOW, AND WHY IT COSTS NOTHING.
 *   - Oracle: `grok --cwd <folder> models`, started in that folder as runDelegate starts it. "You are
 *     logged in" means grok opened the session file. NOT `grok du` — du reports a trimmed home that is
 *     not where grok looks; A36 was first built on that report.
 *   - The session is SYNTHETIC (synthetic-auth.mjs) and every home and profile is a throwaway directory;
 *     isolatedGrokEnv drops every GROK_* / XAI_* variable, so no real credential is reachable and
 *     `models` makes no model call.
 *   - The plugin side is the SOURCE (src/auth.ts, src/env.ts), bundled by esbuild in memory and imported
 *     from a data: URL — CI keeps dist/ equal to it. Nothing is built on disk, so esbuild's service process
 *     never sits in the temp folder (a version that built there could not remove it: EBUSY).
 *   - Every spelling runs twice: the session where the plugin predicts grok looks (P), and at the literal
 *     spelling (L). P catches a place grok does not open; L catches a rename grok does not make.
 *   - A run whose session could not be placed, or would land outside the temp folder, is SKIPPED and
 *     counted out loud — the first version of this harness skipped half its runs silently and reported
 *     "0 mismatches" over the other half, and its committed first run wrote D:\Users\… on another drive.
 *
 * Usage: npm run probe:home   (a few minutes; on other platforms it prints a skip and exits 0)
 * Exit: 0 agreement · 1 any disagreement · 2 nothing trustworthy measured (no grok, a TEMP folder name
 * ending in one dot, setup failed, or 0 runs graded). A temp folder that cannot be removed is named, not fatal.
 * Built without escape sequences on purpose (CHANGELOG 2026-09-24): special characters are fromCharCode.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticAuth, isolatedGrokEnv } from './synthetic-auth.mjs';

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);
const bail = (code, message) => { console.error(`probe:home: ${message}`); process.exit(code); };

if (process.platform !== 'win32') {
  console.log(`probe:home: skipped on ${process.platform} — the rules it checks are Windows path normalization.`);
  process.exit(0);
}
const grokVersion = () => spawnSync('grok', ['--no-auto-update', '--version'], { encoding: 'utf8', windowsHide: true, env: isolatedGrokEnv(process.env, {}) });
if (grokVersion().status !== 0) bail(2, 'grok is not on PATH — nothing to measure against.');
// A reason fit for one line. It must not throw itself: a value that cannot become a string (a null-prototype
// object, a throwing getter) would otherwise turn the exit-2 path into an uncaught exit 1 (re-review).
const short = (e) => {
  try {
    return String(e instanceof Error ? e.message : e).split(NL)[0].slice(0, 300);
  } catch {
    return '(an error that could not be printed)';
  }
};
// esbuild puts "Build failed with N errors:" on its first line and the reason after it — say the reason.
const buildReason = (e) => {
  try {
    const first = Array.isArray(e?.errors) ? e.errors[0] : undefined;
    if (first && typeof first.text === 'string') {
      const at = first.location ? `${first.location.file}:${first.location.line}:${first.location.column}: ` : '';
      return `${at}${first.text}`.slice(0, 300);
    }
  } catch { /* fall back to the message */ }
  return short(e);
};
// mkdtemp goes through Windows' normalization and Node's other fs calls do not. Under a TEMP whose path has
// a folder name ending in exactly one dot (R1 renames it), the two disagree about where the temp folder even
// is: mkdtemp creates it under the renamed name, the rest looks under the original and cannot find it.
// Resolved first, so `/` and `..` are read the way Windows reads them (re-review: a `/` spelling got past).
if (win32.resolve(tmpdir()).split(BS).some((s) => s.length > 1 && s.endsWith('.') && !s.endsWith('..'))) {
  bail(2, `TEMP (${tmpdir()}) has a folder name ending in one dot, which Windows renames — set TEMP to a plainer folder.`);
}

// The plugin's lookup, from source. Every step that can fail here exits 2 — 1 means a disagreement.
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
let esbuild;
try { esbuild = await import('esbuild'); } catch (e) { bail(2, `esbuild is not installed — run npm ci in mcp-server (${short(e)}).`); }
let bundle;
let bundleError;
try {
  const out = await esbuild.build({
    stdin: {
      contents: ["export { authFilePath } from './src/auth.ts';", "export { grokHomeFor } from './src/env.ts';"].join(NL),
      resolveDir: src, sourcefile: 'probe-home-lookup-entry.js', loader: 'js',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  });
  bundle = out.outputFiles[0].text;
} catch (e) {
  bundleError = e;
} finally {
  await esbuild.stop();
}
if (bundleError) bail(2, `could not bundle src/ — ${buildReason(bundleError)}`);
let lookup;
try {
  lookup = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
} catch (e) {
  bail(2, `could not load the bundled lookup — ${short(e)}`);
}
const { authFilePath, grokHomeFor } = lookup;
if (typeof authFilePath !== 'function' || typeof grokHomeFor !== 'function') bail(2, 'the lookup exports are missing from src/.');

const slash = (p) => p.split(BS).join('/');
const mk = (dir) => { try { mkdirSync(dir, { recursive: true }); return true; } catch { return false; } };
const noTrailingSeparator = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === BS || s[e - 1] === '/')) e -= 1; return s.slice(0, e); };
const plainSegment = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === ' ' || s[e - 1] === '.')) e -= 1; return s.slice(0, e) || s; };
/** \\localhost\C$\x names C:\x — the only UNC form this probe writes through. */
const asLocal = (p) => {
  const unc = `${BS}${BS}localhost${BS}`;
  return p.toLowerCase().startsWith(unc) && p[unc.length + 1] === '$' ? `${p[unc.length]}:${p.slice(unc.length + 2)}` : p;
};

// Spellings: every ending x position x kind (the matrix of the A36 measurement), plus folders whose
// names really end in dots or spaces (they pin R1: `h.` loses its dot, `h..` does not).
function spellings() {
  const E = ['', '.', '..', '...', ' ', '. ', ' .', '.. .'];
  const cases = [];
  const add = (kind, home, folder, relative, literal) => cases.push({ kind, home, folder, relative, literal });
  for (const e1 of E) for (const e2 of E) for (const tail of ['', BS]) {
    add('drive', (D) => `${D}${BS}a${e1}${BS}h${e2}${tail}`, (D) => D, false);
  }
  for (const e1 of E) for (const e2 of E) add('slash', (D) => slash(`${D}${BS}a${e1}${BS}h${e2}`), (D) => D, false);
  for (const s of ['...', ' ', '. ', ' .', '....']) add('oddseg', (D) => `${D}${BS}${s}${BS}h`, (D) => D, false);
  for (const e2 of E) add('unc', (D) => `${BS}${BS}localhost${BS}${D[0]}$${D.slice(2)}${BS}h${e2}`, (D) => D, false);
  for (const e2 of E) add('rooted', (D) => `${D.slice(2)}${BS}h${e2}`, (D) => D, true);
  for (const e2 of E) for (const e3 of E) for (const tail of ['', BS]) {
    add('relative', () => `h${e2}`, (D) => `${D}${BS}w${e3}${tail}`, true);
  }
  for (const e1 of E) add('relmid', () => `m${e1}${BS}h`, (D) => `${D}${BS}w`, true);
  for (const e1 of E) add('foldermid', () => 'h', (D) => `${D}${BS}p${e1}${BS}w`, true);
  for (const [home, lit] of [['h..', 'h.'], ['h...', 'h..'], ['h ', 'h '], ['h.', 'h.'], ['h. ', 'h. '], ['h .', 'h '], ['h...', 'h...']]) {
    add('literal', (D) => `${D}${BS}${home}`, (D) => D, false, lit);
  }
  return cases;
}

function grokFound(home, folder, profile) {
  const env = isolatedGrokEnv(process.env, { GROK_HOME: home, USERPROFILE: profile, HOME: profile });
  return new Promise((done) => {
    let out = '';
    let child;
    try {
      child = spawn('grok', ['--no-auto-update', '--cwd', folder, 'models'], { cwd: folder, env, windowsHide: true });
    } catch { done(false); return; }
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); done(false); });
    child.on('close', () => { clearTimeout(timer); done(out.includes('You are logged in')); });
  });
}

/** Everything written goes under `root`; returns the exit code. */
async function measure(root) {
  const profile = join(root, 'profile');
  mkdirSync(profile);
  const AUTH = JSON.stringify(syntheticAuth(Math.floor(Date.now() / 1000) + 3600));
  const inside = (p) => win32.resolve(asLocal(p)).toLowerCase().startsWith(`${root.toLowerCase()}${BS}`);

  const jobs = [];
  spellings().forEach((c, i) => { for (const placement of ['P', 'L']) jobs.push({ c, id: `${c.kind}${i}${placement}`, placement }); });
  const results = [];
  const run = async ({ c, id, placement }) => {
    const D = join(root, id);
    mk(D);
    const home = c.home(D);
    const folder = c.folder(D);
    // The folder exists spelled literally, and in its plain form — what Windows enters for most spellings.
    mk(folder);
    if (c.relative) mk(`${D}${BS}${folder.slice(D.length + 1).split(BS).map(plainSegment).join(BS)}`);
    const env = { GROK_HOME: home };
    let where;
    // The literal-folder rows name their two placements outright: the real folder, and the raw spelling.
    if (c.literal !== undefined) where = placement === 'P' ? `${D}${BS}${c.literal}` : home;
    else if (placement === 'P') where = grokHomeFor(env, folder);
    // A rooted value with no drive is placed on the case folder's drive, which is where grok puts it. Left
    // to Node it lands on THIS process's drive — a first run did that and created D:\Users\… (measured).
    else if (home.startsWith(BS) && !home.startsWith(BS + BS)) where = `${D.slice(0, 2)}${home}`;
    else where = c.relative && !/^[A-Za-z]:/.test(home) ? `${noTrailingSeparator(folder)}${BS}${home}` : home;
    const skip = (why) => results.push({ id, kind: c.kind, skipped: why, home, folder, where });
    if (!inside(where)) { skip('outside the temp folder'); return; }
    if (!mk(where)) { skip('could not be created'); return; }
    try { writeFileSync(`${noTrailingSeparator(where)}${BS}auth.json`, AUTH); } catch { skip('could not be written'); return; }
    const plugin = existsSync(authFilePath(env, folder));
    const grok = await grokFound(home, folder, profile);
    results.push({ id, kind: c.kind, home, folder, where, grok, plugin });
  };
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < jobs.length) await run(jobs[next++]); }));

  const graded = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const bad = graded.filter((r) => r.grok !== r.plugin);
  const byKind = {};
  for (const r of graded) {
    byKind[r.kind] ??= { runs: 0, grokFound: 0, disagree: 0 };
    byKind[r.kind].runs += 1;
    if (r.grok) byKind[r.kind].grokFound += 1;
    if (r.grok !== r.plugin) byKind[r.kind].disagree += 1;
  }
  console.log(`probe:home — ${(grokVersion().stdout || '').trim() || 'grok (version unreadable)'}`);
  for (const [kind, s] of Object.entries(byKind)) console.log(`  ${kind.padEnd(10)} runs ${String(s.runs).padStart(4)}  grok found ${String(s.grokFound).padStart(4)}  disagree ${s.disagree}`);
  console.log(`${graded.length} runs graded, ${skipped.length} SKIPPED, ${bad.length} disagreements`);
  for (const r of skipped.slice(0, 10)) console.log(`  SKIP ${r.id} (${r.skipped}): GROK_HOME=${JSON.stringify(r.home)} session=${JSON.stringify(r.where)}`);
  for (const r of bad.slice(0, 30)) {
    console.log(`  DIFF ${r.id}: GROK_HOME=${JSON.stringify(r.home)} folder=${JSON.stringify(r.folder)} session=${JSON.stringify(r.where)} grok=${r.grok} plugin=${r.plugin}`);
  }
  if (graded.length === 0) return 2;
  return bad.length > 0 ? 1 : 0;
}

/** rmSync's own retries skip EBUSY, and a grok child can still be letting go of a folder — wait it out. */
function removeTree(dir) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { rmSync(dir, { recursive: true, force: true }); return true; } catch { Atomics.wait(pause, 0, 0, 250); }
  }
  return false;
}

let root;
// Resolved: with a relative TEMP, mkdtemp answers relative, and every placement would compare as "outside".
try { root = win32.resolve(mkdtempSync(join(tmpdir(), 'probe-home-'))); } catch (e) { bail(2, `could not create a temp folder under ${tmpdir()} — ${short(e)}`); }
// Ctrl+C skips `finally`, and the folders left behind have names Explorer cannot delete (`h.`, `h `).
process.on('SIGINT', () => {
  if (!removeTree(root)) console.error(`probe:home: could not remove ${root} — remove it by hand.`);
  process.exit(130);
});
let exitCode = 2;
try {
  exitCode = await measure(root);
} catch (e) {
  console.error(`probe:home: stopped before a result — ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 2;
} finally {
  if (!removeTree(root)) console.error(`probe:home: could not remove ${root} — remove it by hand.`);
}
process.exit(exitCode);
