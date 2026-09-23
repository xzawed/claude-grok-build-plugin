#!/usr/bin/env node
/**
 * Contract drift detector: does the grok CLI in front of you still look like the one this repo's
 * constants were measured against?
 *
 * WHY THIS EXISTS. On 2026-09-22 the contract SSOT said 1.0.13 while the machine ran 1.0.30 —
 * seventeen patch releases of drift, found by hand. In that gap grok had added `usage` and
 * `cursor-worker` (the wrapper refused the first and, behind an unrecognised flag, spawned the
 * second) and had reversed `--permission-mode plan` back to blocking writes. Nothing in this repo
 * could have noticed: no CI job runs the real CLI, and all ~600 unit tests are DI mocks that stay
 * green against any grok whatsoever.
 *
 * This reads three free surfaces — `--version`, `--help`, `models` — and diffs them against a
 * committed snapshot. It makes no billable model call, so it costs no subscription quota and no
 * money. The one session it opens is built to be rejected: worker-marker-probe.mjs starts grok with
 * a SYNTHETIC credential in a throwaway GROK_HOME to check the grok behaviour the A34 guard stands
 * on (the worker marker reaching the MCP servers grok starts), and the first request gets a 401.
 *
 * TWO QUESTIONS, KEPT APART. Grok was asked whether the paragraph above claims more than this
 * script measures and answered that it does not: `drifted` means "the CLI IN FRONT OF YOU has
 * moved away from the snapshot", and nothing more. That scoping is correct and is left alone.
 *
 * But it leaves a second question that nobody was asking — MEASURED 2026-09-23: the installer
 * announced `Fetching latest stable version... Installing Grok 1.0.41` while this machine AND the
 * snapshot both sat at 1.0.30, and this script answered `drifted: false`. Every word of that was
 * true and a reader could still come away believing the committed contract describes what a new
 * user gets. So `snapshotBehindLatest` now answers that second question separately, and the two
 * are never merged: a machine that has not moved is not the same fact as a contract that has not
 * caught up.
 *
 * Usage (from mcp-server/):
 *   node scripts/probe-contract-drift.mjs            # report drift, exit 0
 *   node scripts/probe-contract-drift.mjs --strict   # exit 1 on drift, or when the A34 worker-marker
 *                                                    # check fails (guard off, watch blind, or the
 *                                                    # probe session was accepted) — for CI/cron
 *   node scripts/probe-contract-drift.mjs --update   # accept the current CLI as the new snapshot
 *   node scripts/probe-contract-drift.mjs --offline  # skip both network checks (published version, worker marker)
 *
 * A drift report is NOT a failure. It is a prompt to go re-measure the affected contract section
 * and say so in docs/specs/grok-cli-contract.md — which is the step that was missing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { latestPublishedVersion, isSnapshotBehind, behindLatestNote } from './published-version.mjs';
import { probeWorkerMarker } from './worker-marker-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, 'contract-snapshot.json');

const strict = process.argv.includes('--strict');
const update = process.argv.includes('--update');
// For an air-gapped machine, or any run that must stay purely local: the published-version lookup
// and the worker-marker session are the only network calls this script makes.
const offline = process.argv.includes('--offline');

/**
 * The one option this wrapper sends on 100% of its spawns — and the one `--help` never mentions.
 *
 * MEASURED 2026-09-22: `grep -c no-auto-update` over grok 1.0.30's full help dump returns 0, while
 * `grok --no-auto-update --version` exits 0. So the flag is load-bearing (absolute principle #3:
 * a headless run must never block on an update check) and completely invisible to the surface this
 * probe diffs. If grok ever stops accepting it, every delegation exits 2 and the flag lists would
 * report no drift whatsoever.
 *
 * FOUND BY GROK reviewing the first version of this script, which also corrected how I had framed
 * it: the flag was never *unexercised* — `grok()` already prepended it to every call, so a
 * rejection would have thrown. The real gap is that the throw is UNCLASSIFIED. "option rejected",
 * "binary missing" and "timeout" all look identical, and none of them reaches the strict exit as a
 * named finding. So this is a caught, named boolean rather than a new parse.
 */
const REQUIRED_UNDOCUMENTED_FLAG = '--no-auto-update';

function grok(args) {
  // `--no-auto-update` on every call: this probe must describe the binary that is installed, not
  // trigger the self-update it exists to detect.
  return execFileSync('grok', [REQUIRED_UNDOCUMENTED_FLAG, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * Is the undocumented flag still accepted? Costs nothing: `--version` is a local read, and the
 * flag is the only thing under test.
 *
 * Deliberately does NOT retry without the flag. Dropping it to "check whether the binary works"
 * would invite the auto-update this whole file exists to observe rather than cause — so a
 * rejection is reported as a rejection, and the rest of the capture is skipped rather than
 * gathered from a grok that may have just updated itself mid-probe.
 */
function acceptsRequiredFlag() {
  try {
    execFileSync('grok', [REQUIRED_UNDOCUMENTED_FLAG, '--version'], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Long-option names from a clap help dump.
 *
 * Deliberately naive and deliberately NOT a regex over the whole file: help text wraps, indents
 * and embeds prose that mentions flags (`compat alias: --allowedTools`), so anything clever here
 * invents flags that do not exist. Only a line whose first non-space token starts with `--`, or
 * whose second token does after a short option, counts as a declaration.
 */
function parseFlags(help) {
  const out = new Set();
  for (const raw of help.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('-')) continue;
    for (const tok of line.split(/[\s,=<[]+/)) {
      if (tok.startsWith('--') && tok.length > 2) out.add(tok.replace(/[^A-Za-z0-9-]/g, ''));
      else if (!tok.startsWith('-')) break; // past the option column, into the description
    }
  }
  out.delete('--');
  return [...out].filter(Boolean).sort();
}

/** Subcommand names: the `Commands:` block, first token of each indented line. */
function parseSubcommands(help) {
  const lines = help.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'Commands:');
  if (start < 0) return [];
  const out = [];
  for (const raw of lines.slice(start + 1)) {
    if (!raw.startsWith(' ') || !raw.trim()) break;
    const name = raw.trim().split(/\s+/)[0];
    if (name && !name.startsWith('-')) out.push(name);
  }
  return out.sort();
}

/** Model ids from `grok models`: the bulleted lines, minus the "(default)" annotation. */
function parseModels(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('*') && !line.startsWith('-')) continue;
    const name = line.replace(/^[*-]\s*/, '').split(/\s+/)[0];
    if (name) out.push(name);
  }
  return out.sort();
}

function capture() {
  // Checked FIRST: every call below sends the flag, so if it is gone they would all throw with no
  // way to say why. Reporting it is the whole point of this addition.
  const acceptsRequiredFlag_ = acceptsRequiredFlag();
  if (!acceptsRequiredFlag_) {
    return { version: '(unreadable — the required flag was rejected)', flags: [], subcommands: [], models: [], acceptsRequiredFlag: false };
  }
  const help = grok(['--help']);
  const version = grok(['--version']).trim();
  let models = [];
  let modelsNote = null;
  try {
    models = parseModels(grok(['models']));
  } catch (err) {
    // `grok models` needs a login. A signed-out machine can still detect flag/subcommand drift,
    // which is the part that decides whether this wrapper blocks or spawns the wrong thing.
    modelsNote = `models unavailable: ${String(err && err.message).split('\n')[0]}`;
  }
  return {
    version,
    flags: parseFlags(help),
    subcommands: parseSubcommands(help),
    models,
    acceptsRequiredFlag: true,
    ...(modelsNote ? { modelsNote } : {}),
  };
}

function diffLists(was, now) {
  const a = new Set(was ?? []);
  const b = new Set(now ?? []);
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
  };
}

const now = capture();

if (update || !existsSync(SNAPSHOT)) {
  writeFileSync(SNAPSHOT, `${JSON.stringify({ measuredAgainst: now.version, ...now }, null, 2)}\n`);
  console.log(`snapshot written for ${now.version}`);
  console.log('Re-measure the affected sections of docs/specs/grok-cli-contract.md before trusting it.');
  process.exit(0);
}

const was = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const flags = diffLists(was.flags, now.flags);
const subs = diffLists(was.subcommands, now.subcommands);
const models = diffLists(was.models, now.models);
const versionMoved = was.version !== now.version;

// A baseline written before this check existed has no bit to compare, so treat "absent" as "was
// accepted" rather than announcing a removal that never happened.
const wasAccepted = was.acceptsRequiredFlag !== false;
const requiredFlagLost = wasAccepted && now.acceptsRequiredFlag === false;

const drifted = versionMoved
  || requiredFlagLost
  || flags.added.length || flags.removed.length
  || subs.added.length || subs.removed.length
  || models.added.length || models.removed.length;

// The channel the installer would use for this machine, so an alpha user is not told about stable.
const channel = process.env.GROK_CHANNEL || 'stable';
const latest = offline
  ? { version: null, reason: 'skipped: --offline' }
  : await latestPublishedVersion(channel);

const snapshotBehindLatest = isSnapshotBehind(was.version, latest);

// A34's premise, which no unit test can see (they all set the marker by hand). Not part of
// `drifted` — the CLI surface can be identical while this behaviour changes — but a guard that is
// off, a watch that went blind, or a probe session that got ACCEPTED each fail --strict below.
// A crash inside the probe is caught: it must not take the rest of this report down with it.
let workerMarker;
if (offline) {
  workerMarker = { reached: null, blind: false, sessionAccepted: false, reason: 'skipped: --offline' };
} else {
  try {
    workerMarker = await probeWorkerMarker();
  } catch (err) {
    workerMarker = { reached: null, blind: false, sessionAccepted: false, reason: `probe error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

console.log(JSON.stringify({
  snapshotVersion: was.version,
  installedVersion: now.version,
  versionMoved,
  flags,
  subcommands: subs,
  models,
  requiredFlag: { name: REQUIRED_UNDOCUMENTED_FLAG, accepted: now.acceptsRequiredFlag, lost: requiredFlagLost },
  ...(now.modelsNote ? { modelsNote: now.modelsNote } : {}),
  drifted: Boolean(drifted),
  publishedChannel: { channel, ...latest },
  snapshotBehindLatest,
  workerMarker,
}, null, 2));

// Deliberately NOT part of `drifted`, and deliberately NOT a --strict failure. grok publishes
// often, so a gate that goes red on every upstream release is one people learn to ignore — the
// failure mode b721433 was about. This is a standing note that the contract describes an older
// CLI than a new user receives, which is true far more often than it is urgent.
const note = behindLatestNote({
  behind: snapshotBehindLatest,
  channel,
  snapshotVersionLine: was.version,
  installedVersionLine: now.version,
  latest,
});
if (note.length) {
  console.error('');
  console.error(`NOTE — ${note[0]}`);
  for (const line of note.slice(1)) console.error(`       ${line}`);
}

if (drifted) {
  console.error('');
  console.error('CONTRACT DRIFT. What to do, in this order:');
  if (requiredFlagLost) {
    console.error(`  0. STOP — grok no longer accepts ${REQUIRED_UNDOCUMENTED_FLAG}, which every`);
    console.error('     delegation sends. Every spawn will exit 2 until src/delegate.ts and');
    console.error('     src/grok-cli.ts stop sending it. Absolute principle #3 (no update check in');
    console.error('     a headless run) needs a replacement before that flag is dropped.');
  }
  console.error('  1. A NEW SUBCOMMAND IS NOT AUTOMATICALLY SAFE. Decide which set in');
  console.error('     src/grok-cli.ts it belongs to. NON_HEADLESS fails closed and survives an');
  console.error('     unrecognised leading flag; KNOWN_SUBCOMMANDS only lifts a false block and');
  console.error('     stands down on an uncertain parse. Anything that cannot run headless, or');
  console.error('     outlives the call, or acts on the account, belongs in NON_HEADLESS (A29).');
  console.error('  2. Re-measure the contract sections the delta touches and date them in');
  console.error('     docs/specs/grok-cli-contract.md. Each section carries its own version.');
  console.error('  3. Only then accept the new baseline: --update.');
}

// Every warning prints BEFORE any --strict exit. A marker regression arrives with a grok update,
// which also drifts the version — exiting inside the drift block would have swallowed the one
// message that says a shipped protection is off (review finding).
if (workerMarker.sessionAccepted) {
  console.error('');
  console.error('STOP — THE PROBE SESSION WAS ACCEPTED. grok ran a model request that succeeded, so a');
  console.error('credential got past the isolation in scripts/worker-marker-probe.mjs. Find it in this');
  console.error('environment before running probe:contract again.');
}
if (workerMarker.reached === false) {
  console.error('');
  console.error('A34 GUARD IS OFF. grok started a plugin MCP server without GROK_BUILD_WORKER, so the');
  console.error('copy of this server inside a worker cannot tell that it should refuse, and a worker');
  console.error('can start a second grok run through it again. Re-measure docs/specs/grok-cli-contract.md');
  console.error('§14 and replace the mechanism in src/env.ts before the next release.');
} else if (workerMarker.blind) {
  console.error('');
  console.error(`A34 WATCH IS BLIND — ${workerMarker.reason}`);
} else if (workerMarker.reached === null) {
  console.error('');
  console.error(`NOTE — the worker marker was not judged: ${workerMarker.reason}`);
}

const markerFailed = workerMarker.sessionAccepted || workerMarker.reached === false || workerMarker.blind;
if (strict && (drifted || markerFailed)) process.exit(1);
