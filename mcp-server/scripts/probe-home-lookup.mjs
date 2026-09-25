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
 *   - The plugin side is the SOURCE (src/auth.ts, src/env.ts), bundled with esbuild into the temp dir —
 *     CI keeps dist/ equal to it.
 *   - Every spelling runs twice: the session where the plugin predicts grok looks (P), and at the literal
 *     spelling (L). P catches a place grok does not open; L catches a rename grok does not make.
 *   - A run whose session could not be placed is SKIPPED and counted out loud — the first version of this
 *     harness skipped half its runs silently and reported "0 mismatches" over the other half.
 *   - Everything happens inside one temp folder, which is removed at the end whatever happened. The first
 *     run of this file put drive-less sessions on THIS process's drive (D:\Users\…); see below.
 *
 * Usage: npm run probe:home   (win32 only; a few minutes)
 * Exit: 0 agreement · 1 any disagreement · 2 nothing could be measured (no grok, setup failed, 0 graded).
 * Built without escape sequences on purpose (CHANGELOG 2026-09-24): special characters are fromCharCode.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syntheticAuth, isolatedGrokEnv } from './synthetic-auth.mjs';

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

if (process.platform !== 'win32') {
  console.log(`probe:home: skipped on ${process.platform} — the rules it checks are Windows path normalization.`);
  process.exit(0);
}
if (spawnSync('grok', ['--no-auto-update', '--version'], { encoding: 'utf8', windowsHide: true }).status !== 0) {
  console.error('probe:home: grok is not on PATH — nothing to measure against.');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const slash = (p) => p.split(BS).join('/');
const mk = (dir) => { try { mkdirSync(dir, { recursive: true }); return true; } catch { return false; } };
const noTrailingSeparator = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === BS || s[e - 1] === '/')) e -= 1; return s.slice(0, e); };
const plainSegment = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === ' ' || s[e - 1] === '.')) e -= 1; return s.slice(0, e) || s; };

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

/** Everything that touches the disk happens under `root`; returns the exit code. */
async function measure(root) {
  const profile = join(root, 'profile');
  mkdirSync(profile);
  const AUTH = JSON.stringify(syntheticAuth(Math.floor(Date.now() / 1000) + 3600));

  // The plugin's lookup, from source.
  const entry = join(root, 'lookup-entry.mjs');
  writeFileSync(entry, [
    `export { authFilePath } from '${slash(join(here, '..', 'src', 'auth.ts'))}';`,
    `export { grokHomeFor } from '${slash(join(here, '..', 'src', 'env.ts'))}';`,
  ].join(NL));
  const esbuild = await import('esbuild');
  const bundled = join(root, 'lookup.mjs');
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundled, logLevel: 'warning' });
  } finally {
    // esbuild keeps a service process alive, started in THIS folder — the temp root. Left running it holds
    // the root, and the removal at the end failed with EBUSY (measured, second version of this file).
    await esbuild.stop();
  }
  const { authFilePath, grokHomeFor } = await import(pathToFileURL(bundled).href);
  if (typeof authFilePath !== 'function' || typeof grokHomeFor !== 'function') {
    console.error('probe:home: the lookup exports are missing from src/.');
    return 2;
  }
  // P placements go where the plugin says grok looks. If the temp folder's own path had a segment R1
  // renames (a lone trailing dot), those would land OUTSIDE it (re-review) — so do not run there.
  const own = `${root}${BS}h`;
  if (grokHomeFor({ GROK_HOME: own }, root) !== own) {
    console.error(`probe:home: the temp folder ${root} has a segment Windows would rename; set TEMP to a plainer folder.`);
    return 2;
  }

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
    // to Node it lands on THIS process's drive — the first run did that and created D:\Users\… (measured).
    else if (home.startsWith(BS) && !home.startsWith(BS + BS)) where = `${D.slice(0, 2)}${home}`;
    else where = c.relative && !/^[A-Za-z]:/.test(home) ? `${noTrailingSeparator(folder)}${BS}${home}` : home;
    if (!mk(where)) { results.push({ id, kind: c.kind, skipped: true, home, folder }); return; }
    try { writeFileSync(`${noTrailingSeparator(where)}${BS}auth.json`, AUTH); } catch { results.push({ id, kind: c.kind, skipped: true, home, folder }); return; }
    const plugin = existsSync(authFilePath(env, folder));
    const grok = await grokFound(home, folder, profile);
    results.push({ id, kind: c.kind, home, folder, where, grok, plugin });
  };
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (next < jobs.length) await run(jobs[next++]); }));

  const graded = results.filter((r) => !r.skipped);
  const bad = graded.filter((r) => r.grok !== r.plugin);
  const byKind = {};
  for (const r of graded) {
    byKind[r.kind] ??= { runs: 0, grokFound: 0, disagree: 0 };
    byKind[r.kind].runs += 1;
    if (r.grok) byKind[r.kind].grokFound += 1;
    if (r.grok !== r.plugin) byKind[r.kind].disagree += 1;
  }
  const version = spawnSync('grok', ['--no-auto-update', '--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  console.log(`probe:home — ${version}`);
  for (const [kind, s] of Object.entries(byKind)) console.log(`  ${kind.padEnd(10)} runs ${String(s.runs).padStart(4)}  grok found ${String(s.grokFound).padStart(4)}  disagree ${s.disagree}`);
  console.log(`${graded.length} runs graded, ${results.length - graded.length} SKIPPED (session could not be placed), ${bad.length} disagreements`);
  for (const r of bad.slice(0, 30)) {
    console.log(`  DIFF ${r.id}: GROK_HOME=${JSON.stringify(r.home)} folder=${JSON.stringify(r.folder)} session=${JSON.stringify(r.where)} grok=${r.grok} plugin=${r.plugin}`);
  }
  if (graded.length === 0) return 2;
  return bad.length > 0 ? 1 : 0;
}

const root = mkdtempSync(join(tmpdir(), 'probe-home-'));
let exitCode = 2;
try {
  // Work from inside the temp root, so anything resolved against this process's folder or drive lands in
  // what gets removed below.
  process.chdir(root);
  exitCode = await measure(root);
} finally {
  // Step back out first: Windows will not remove a process's own folder. Retries ride out a grok child
  // still letting go of its folder.
  process.chdir(tmpdir());
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.exit(exitCode);
