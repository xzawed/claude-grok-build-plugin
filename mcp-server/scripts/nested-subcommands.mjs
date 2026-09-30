/**
 * Drift one level below grok's top-level subcommands — the surface probe-contract-drift.mjs could not see.
 *
 * MEASURED 2026-09-30: grok 1.0.44 added `grok worktree create` under the existing `worktree`. The probe
 * compared only the top-level `--help`, so it reported the CLI surface unchanged; a hand-run diff of every
 * subcommand's `--help` found it. This plugin classifies grok_cli calls by the top-level subcommand only, so
 * a nested addition inherits its parent's class without anyone deciding — the A29 question, one level down.
 *
 * Kept out of the probe for the same reason as published-version.mjs: the probe does its work at import time,
 * so only a separate module can be unit-tested.
 */

/** `{ worktree: ['create', 'list'] }` -> `['worktree create', 'worktree list']`, sorted. */
export function flattenNested(nested) {
  const out = [];
  for (const [parent, children] of Object.entries(nested ?? {})) {
    for (const child of children ?? []) out.push(`${parent} ${child}`);
  }
  return out.sort();
}

/**
 * Nested subcommands added and removed between the snapshot and the CLI in front of us.
 *
 * Returns null — not an empty diff — when the snapshot has no nested map (it predates this check): "not
 * compared" must not read as "unchanged". A parent whose `--help` could not be read — now, or when the
 * snapshot was taken — is left out of the comparison, so a failed read is never reported as its children
 * being removed (unreadable now) or added (unreadable then). The caller names those parents as not compared.
 * A removed top-level subcommand is reported at both levels: as a subcommand and as each of its children.
 */
export function nestedDiff(wasNested, nowNested, unreadableNow = [], unreadableThen = []) {
  if (!wasNested || typeof wasNested !== 'object') return null;
  const skip = new Set([...(unreadableNow ?? []), ...(unreadableThen ?? [])]);
  const keep = (entry) => !skip.has(entry.split(' ')[0]);
  const was = new Set(flattenNested(wasNested).filter(keep));
  const now = new Set(flattenNested(nowNested).filter(keep));
  return {
    added: [...now].filter((x) => !was.has(x)),
    removed: [...was].filter((x) => !now.has(x)),
  };
}
