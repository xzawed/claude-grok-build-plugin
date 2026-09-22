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
 * committed snapshot. It makes NO model call, so it costs no subscription quota and no money.
 *
 * Usage (from mcp-server/):
 *   node scripts/probe-contract-drift.mjs            # report drift, exit 0
 *   node scripts/probe-contract-drift.mjs --strict   # exit 1 when anything drifted (for CI/cron)
 *   node scripts/probe-contract-drift.mjs --update   # accept the current CLI as the new snapshot
 *
 * A drift report is NOT a failure. It is a prompt to go re-measure the affected contract section
 * and say so in docs/specs/grok-cli-contract.md — which is the step that was missing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, 'contract-snapshot.json');

const strict = process.argv.includes('--strict');
const update = process.argv.includes('--update');

function grok(args) {
  // `--no-auto-update` on every call: this probe must describe the binary that is installed, not
  // trigger the self-update it exists to detect.
  return execFileSync('grok', ['--no-auto-update', ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
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

const drifted = versionMoved
  || flags.added.length || flags.removed.length
  || subs.added.length || subs.removed.length
  || models.added.length || models.removed.length;

console.log(JSON.stringify({
  snapshotVersion: was.version,
  installedVersion: now.version,
  versionMoved,
  flags,
  subcommands: subs,
  models,
  ...(now.modelsNote ? { modelsNote: now.modelsNote } : {}),
  drifted: Boolean(drifted),
}, null, 2));

if (drifted) {
  console.error('');
  console.error('CONTRACT DRIFT. What to do, in this order:');
  console.error('  1. A NEW SUBCOMMAND IS NOT AUTOMATICALLY SAFE. Decide which set in');
  console.error('     src/grok-cli.ts it belongs to. NON_HEADLESS fails closed and survives an');
  console.error('     unrecognised leading flag; KNOWN_SUBCOMMANDS only lifts a false block and');
  console.error('     stands down on an uncertain parse. Anything that cannot run headless, or');
  console.error('     outlives the call, or acts on the account, belongs in NON_HEADLESS (A29).');
  console.error('  2. Re-measure the contract sections the delta touches and date them in');
  console.error('     docs/specs/grok-cli-contract.md. Each section carries its own version.');
  console.error('  3. Only then accept the new baseline: --update.');
  if (strict) process.exit(1);
}
