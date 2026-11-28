#!/usr/bin/env node
/**
 * AUDITED BY GROK 2026-09-23, in two parts because the file's command arrays make a whole-file
 * review time out (CLAUDE.md §5).
 *
 *   Quota promise — ONE FINDING, fixed elsewhere. The "spends no subscription quota" claim below
 *   rested on `best_of_n` being refused before any spawn, and that refusal lives in
 *   `validateDelegateOptions` in another package, which did not know it was holding this up.
 *   delegate.ts now says so and a test reads these probe payloads to keep the two in step. Since
 *   docs/10 A61 the claim rests first on the env every server starts in (below); `best_of_n` is
 *   the second stop.
 *
 *   Scoring — NO FINDING. Claim put to Grok: "a graded item that never ran would be
 *   indistinguishable here from one that passed." Verdict False, and I had suspected otherwise:
 *   a skipped item pushes no row, so it is absent rather than counted as a pass, and the catch
 *   below turns any throw into a FAILED `harness` row. A partial run therefore exits 1 rather
 *   than printing a short, clean-looking score.
 *
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
 * checked. That second half is easy to get wrong, and it was wrong until 2026-11-05 (docs/10
 * A61): every server and hook inherited this script's env and folder, so an old bundle found
 * the maintainer's grok. They now start where grok cannot be found (accept-checks.mjs, "where grok
 * cannot be found"), which also keeps this machine's install out of the verdicts (A76). Measured on win32
 * with grok 1.0.70, quota 0 — a tripwire named grok.exe that records its start and exits, first
 * on PATH, under each PATH shape Windows' spawn search reads differently from Node, in the
 * parent's GROK_BIN_DIR, in the home's .grok/bin and in this script's folder (with the
 * working-folder lookup on, as in a maintainer's shell); synthetic sessions; both grok API URLs
 * on a loopback answering 404 — in a home laid out like a signed-in maintainer's: grading the
 * tags v0.1.0, v0.2.18 and v0.2.20 started grok 6, 3 and 3 times before (the plan probe,
 * `grok_cli ["sesions"]` and v0.1.0's delegations reached the model when the real grok ran
 * their arguments) and never after, with no request sent. The env, the folders and the
 * placeholder are checked on Linux and Windows by `mcp-server/test/accept-release.test.ts`. The
 * delegate, plan and verify probes still carry `best_of_n`, which every build from v0.2.21 on
 * refuses before spawning — the second stop (measured while writing this: without it, grading
 * 0.2.21 hung for 30s on a live grok run). An acceptance run must be safe to repeat anywhere.
 *
 * Two protocol eras (MCP 2.0 plan, Task 2.4). The checks run in the 2025 era as they always have, and again in the
 * 2026-07-28 era (rpc-era.mjs — no `initialize`, `server/discover` first). The three checks that open no MCP session
 * (A7, A2, A12) run once. A bundle built on SDK v1 does not serve the 2026 era: that is a failure when grading this
 * repo's bundle or the installed one this repo declares (the release being accepted), and only a note when
 * `--version` names another one, which may predate the 2026 era — its 2025 rows are graded as they always were. The
 * checks and the isolation live in accept-checks.mjs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeEra, isolate, rawOpener } from './accept-checks.mjs';
import { MODERN_VERSION } from './rpc-era.mjs';

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
// The release being accepted serves the 2026 era; a bundle `--version` names may predate it.
const modernRequired = useRepo || wantVersion === undefined || wantVersion === declared;

// ── checks ─────────────────────────────────────────────────────────────────
const iso = isolate();
const options = { server: SERVER, hook: HOOK, iso, expected };
const results = [];
let notServed;
const leftBehind = [];
try {
  const legacy = await gradeEra({ ...options, era: 'legacy', open: rawOpener('legacy'), includeEraFree: true });
  if (legacy.notServed) results.push({ id: 'harness', what: 'the bundle opens a 2025-era session', pass: false, evidence: legacy.reason });
  for (const r of legacy.rows ?? []) results.push(r);
  leftBehind.push(...(legacy.leftBehind ?? []));
  const modern = await gradeEra({ ...options, era: 'modern', open: rawOpener('modern'), includeEraFree: false });
  if (modern.notServed) {
    notServed = modern.reason;
    if (modernRequired) results.push({ id: 'era', what: `[${MODERN_VERSION}] the bundle serves the ${MODERN_VERSION} era`, pass: false, evidence: modern.reason });
  }
  for (const r of modern.rows ?? []) results.push({ ...r, what: `[${MODERN_VERSION}] ${r.what}` });
  leftBehind.push(...(modern.leftBehind ?? []));
} catch (e) {
  // A check that threw is a check that failed — say so and keep the report readable.
  results.push({ id: 'harness', what: 'all checks ran to completion', pass: false, evidence: e instanceof Error ? e.message : String(e) });
}
// Best effort, and never at the cost of the report: Windows refuses to remove a folder a process is
// still in, so a folder left here is reported below instead of thrown.
leftBehind.push(...iso.cleanup());

// ── report ─────────────────────────────────────────────────────────────────
console.log(`grading: ${label}`);
console.log(`expected version: ${expected}${wantVersion ? '' : '  (from mcp-server/package.json)'}\n`);
let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(9)} ${r.what}`);
  console.log(`        ${r.evidence}`);
}
if (notServed && !modernRequired) {
  console.log(`  ----  era       [${MODERN_VERSION}] not served by this bundle — graded in the 2025 era only (not counted)`);
  console.log(`        ${notServed}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) {
  console.log('\nA failure here usually means one of two things: the cache holds an older bundle');
  console.log('(re-run marketplace update + plugin update), or a released fix regressed.');
}
if (leftBehind.length) console.log(`\nCould not remove, delete by hand: ${leftBehind.join(', ')}`);
// The one thing this script cannot grade is which bundle a *session* loads: a session holds the
// MCP process it started with, so a session that was already running when the update landed would
// answer for whatever was installed back then. That is a stale-process problem, not a human-only
// step — it read as the latter until 2026-09-06 and the phantom item sat open for four releases.
// Any session that started after the update settles it, because /grok:status is one call to
// grok_build_status. See docs/09 §5.
console.log('\nOne step left, and an agent can do it — no human required. In a session that started');
console.log(`AFTER the update, call grok_build_status and confirm serverVersion is ${expected};`);
console.log('that call is the entire body of /grok:status. A session that was already running when');
console.log('you updated still holds the old MCP process, so its answer proves nothing — restart');
console.log('first in that case. Record the result in docs/09 §5.');
process.exit(failed ? 1 : 0);
