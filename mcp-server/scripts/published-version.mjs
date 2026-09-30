/**
 * "What version would a NEW install get?" — the half of contract drift nobody was measuring.
 *
 * Split out of probe-contract-drift.mjs for the same reason `.claude/tools/rpc-timeout.mjs` is
 * split out of mcpcall.mjs: that script runs its work at import time, so nothing inside it can be
 * unit-tested. The branch that matters most here is the one that never fires in a green run —
 * "could not ask" — and it has to be pinned by a test rather than by hoping the network fails.
 *
 * MEASURED 2026-09-23 by reading `https://x.ai/cli/install.sh`: the installer GETs
 * `<base>/<channel>`, takes the first line stripped of whitespace, and validates it against the
 * semver shape below. It tries the Cloudflare-fronted x.ai first and falls back to GCS. Reading
 * the same pointer is deliberate — a releases page or changelog would be a SECOND source that can
 * disagree with what users actually receive.
 */

export const CHANNEL_POINTERS = [
  'https://x.ai/cli',
  'https://storage.googleapis.com/grok-build-public-artifacts/cli',
];

/** The installer's own validation, copied verbatim from install.sh. */
export const SEMVER_ONLY = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._]+)?$/;

export const LOOKUP_TIMEOUT_MS = 8000;

/** `grok 1.0.30 (04b7ffed98c6) [stable]` -> `1.0.30`; null when the shape is unrecognised. */
export function semverOf(versionLine) {
  // Quadratic backtracking measured 2026-09-25 (A43): an unanchored `[0-9]+` retries a long digit
  // run from every digit. A digit before the candidate means this is not where a version starts.
  const m = /(?<![0-9])([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9._]+)?)/.exec(versionLine || '');
  return m ? m[1] : null;
}

/**
 * The version line without grok's trailing channel label: `grok 1.0.44 (5b807183dd79) [stable]` ->
 * `grok 1.0.44 (5b807183dd79)`.
 *
 * The label does not name the binary — grok derives it from the `stable_version` cached in
 * `<GROK_HOME>/version.json`. MEASURED 2026-09-30 with the win32 grok 1.0.44 (5b807183dd79) binary,
 * changing only that file in a throwaway GROK_HOME: no version.json -> no label; a cached stable older
 * than the binary -> `[alpha]`; the same or newer -> `[stable]`. On this win32 machine (`auto_update =
 * false` in its grok config) the same binary printed `[alpha]` right after `grok update --version 1.0.44`
 * and `[stable]` once `grok update --check` had refreshed the cache. The linux build of the same commit,
 * updated with `grok update --version` in a container whose home had no version.json, also printed no
 * label. Comparing whole lines reported a move for a binary that had not moved.
 *
 * Only a trailing `[<letters>]` goes: a bracket holding anything else (a version, a hash) stays part of
 * the line, and every other difference still counts as a move. String operations, not a regex over the
 * line: a trailing-bracket pattern with `\s*` on both sides backtracks quadratically on a run of spaces —
 * A43's class. The one regex here runs on the bracket's contents only, anchored.
 */
export function withoutChannelLabel(versionLine) {
  const line = String(versionLine ?? '').trim();
  if (!line.endsWith(']')) return line;
  const open = line.lastIndexOf('[');
  if (open <= 0 || !/^[A-Za-z]+$/.test(line.slice(open + 1, -1))) return line;
  return line.slice(0, open).trimEnd();
}

/**
 * The probe's `versionMoved`: did the binary change between two `grok --version` lines? Here rather than
 * inline in the probe so a test can pin the rule the probe actually applies (the probe does its work at
 * import time and cannot be imported by a test).
 */
export function versionMoved(snapshotVersionLine, installedVersionLine) {
  return withoutChannelLabel(snapshotVersionLine) !== withoutChannelLabel(installedVersionLine);
}

/**
 * Returns `{ version, source }` when the channel pointer answered, or `{ version: null, reason }`
 * when it could not be reached or did not answer with a version.
 *
 * THE POINT OF THE SHAPE: a lookup that could not be PERFORMED and a lookup that came back "you
 * are current" are different facts. `check-release-tag.mjs` collapsed exactly that distinction
 * (b721433) and turned every gh outage into "no GitHub release" — a gate that cries wolf is a
 * gate people learn to ignore. So there is no boolean here to misread: absence of a version is
 * always accompanied by the reason it is absent.
 *
 * `fetchImpl` is injectable so the failure branches can be exercised without an outage.
 */
export async function latestPublishedVersion(channel, fetchImpl = globalThis.fetch) {
  const tried = [];
  for (const base of CHANNEL_POINTERS) {
    const url = `${base}/${channel}`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), redirect: 'follow' });
      if (!res.ok) { tried.push(`${url} -> HTTP ${res.status}`); continue; }
      const first = (await res.text()).replace(/\r/g, '').split('\n')[0].trim();
      if (!SEMVER_ONLY.test(first)) {
        // A Cloudflare challenge or an error page is a 200 with HTML in it. Say that, rather than
        // parsing a version out of something that is not one.
        tried.push(`${url} -> not a version string (${JSON.stringify(first.slice(0, 40))})`);
        continue;
      }
      return { version: first, source: url };
    } catch (err) {
      tried.push(`${url} -> ${String(err && err.message).split('\n')[0]}`);
    }
  }
  return { version: null, reason: `could not ask: ${tried.join('; ')}` };
}

/**
 * THREE states, never two. `null` means nobody asked or nobody answered, and it must not be
 * readable as "no" — that collapse is the defect this whole module is shaped around.
 */
export function isSnapshotBehind(snapshotVersionLine, latest) {
  const snap = semverOf(snapshotVersionLine);
  if (!latest || !latest.version || !snap) return null;
  return latest.version !== snap;
}

/**
 * The lines printed under the JSON report. Pure, and here rather than in the probe, because the
 * first draft of it shipped a false sentence and nothing could have caught that: the probe runs
 * its work at import time, so a test can never reach the branch selection. Same lesson as
 * `server.ts` ("do not put the handlers back in an anonymous closure — then the whole suite stays
 * green while the contract is inverted").
 *
 * The false sentence was "nothing on this machine moved", printed unconditionally whenever the
 * snapshot was behind the published version. It is wrong in exactly the case where the machine
 * HAS updated — which is also the case where the drift report above it fires, so the two blocks
 * contradicted each other. Grok, given that scenario and that sentence alone, returned
 * SENTENCE_FALSE.
 *
 * Returns [] when there is nothing to say, so the caller prints nothing rather than a blank note.
 */
export function behindLatestNote({ behind, channel, snapshotVersionLine, installedVersionLine, latest }) {
  const snap = semverOf(snapshotVersionLine);
  const installed = semverOf(installedVersionLine);
  const tail = 'Re-measure the contract sections that matter, not all of them reflexively.';

  if (behind === null) {
    return [
      `could not check what a new install would get (${channel}).`,
      (latest && latest.reason) || 'no reason recorded',
      'This is "did not ask", not "up to date" — do not read it as either.',
    ];
  }
  if (behind !== true) return [];

  const head = [
    `the contract snapshot (${snap}) is not what a new install gets`,
    `(${channel} channel publishes ${latest.version}, per ${latest.source}).`,
  ];
  // Snapshot-vs-published says NOTHING about the local binary. Only this comparison may.
  const moved = installed !== null && snap !== null && installed !== snap;
  return moved
    ? [...head,
      `The drift above is a separate fact: this machine moved to ${installed}.`,
      'Accepting the new baseline (--update) settles both only if those match.',
      tail]
    : [...head,
      `This machine did not move — it is still on ${installed}, so the report above is`,
      'silent while end users receive something else entirely.',
      tail];
}
