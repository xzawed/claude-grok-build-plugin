/**
 * Help-page bodies for probe-contract-drift.mjs — the surface its name lists cannot see.
 *
 * WHY. From grok 1.0.44 to 1.0.50 no flag or subcommand name changed, so the probe (names only) reported nothing, but
 * five help pages had changed — `clone`, `du`, `memory clear`, `worktree`, `worktree rm` — and two of those changes were
 * behaviour (A64: `memory clear` deletes whole scope directories; A65: `worktree rm -f`). So the probe keeps one hash
 * per page and names the pages whose text moved: where to re-measure.
 *
 * WHAT A PAGE DEPENDS ON besides the binary. Measured 2026-11-05 — the record, with versions, platforms and timings,
 * is docs/plans/2026-10-12-grok-enhancement-backlog.md "2026-10-12 추가":
 *  - The environment. An option an environment variable can set shows that variable's value on the page:
 *    `[env: GROK_AGENT_SECRET=<value>]`, in plain text for a secret (1.0.70; 1.0.44 carries the same markers). So the
 *    pages are read in `helpReadEnv`, and `normalizeHelp` drops any value that still shows.
 *  - Colour. `CLICOLOR_FORCE` puts ANSI codes into the page; `helpReadEnv` passes no such variable.
 *  - Not the home, the terminal width or the platform — measured, so nothing more is normalized.
 *
 * Kept out of the probe for the same reason as nested-subcommands.mjs: the probe does its work at import time, so only
 * a separate module can be unit-tested.
 */
import { createHash } from 'node:crypto';
import { throwawayHomeEnv } from './synthetic-auth.mjs';

/**
 * Code-unit order — what `.sort()` with no compare function gives strings — spelled out, because a compare function is
 * asked for (SonarCloud S2871) and `localeCompare` would make the order the snapshot and the report list pages in
 * depend on the locale.
 */
export function byCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// clap prints `[env: NAME=value]` for an option a variable can set — `[env: NAME=]` while it is unset, and no `=` at
// all for a variable whose value it hides (`[env: CURSOR_API_KEY]`).
const ENV_VALUE = /\[env: ([^\]=\s]+)=[^\]]*\]/g;

/**
 * The text a page is compared by. A variable's value is dropped (`[env: NAME=]`, as when it is unset); then every run
 * of whitespace (line ends and wrapping included) is one space, and the ends are trimmed. A change of words is a
 * change; a re-wrap, CRLF, trailing spaces or a variable set in the shell are not. A value that itself holds `]` is
 * not fully dropped — that page reads as changed, never the other way round.
 */
export function normalizeHelp(text) {
  return String(text).replace(ENV_VALUE, '[env: $1=]').replace(/\s+/g, ' ').trim();
}

/** A short, stable id for a page's text (16 hex characters of its SHA-256). */
export function helpHash(text) {
  return createHash('sha256').update(normalizeHelp(text)).digest('hex').slice(0, 16);
}

// What grok needs to start, and what decides which grok starts: the PATH (in whatever case the parent spells it), the
// win32 system folders and executable search rule, and the temp folders.
const START_ENV = new Set(['path', 'pathext', 'systemroot', 'windir', 'temp', 'tmp', 'tmpdir', 'nodefaultcurrentdirectoryinexepath']);

/**
 * The environment the pages are read in: `START_ENV` from `base`, and a throwaway home (`throwawayHomeEnv`). Nothing
 * else from the maintainer's shell reaches a page — no variable an option shows, no colour switch, no credential —
 * and a command that ran instead of printing its help would find no account to act on.
 */
export function helpReadEnv(base, home, platform = process.platform) {
  const kept = Object.fromEntries(Object.entries(base).filter(([k]) => START_ENV.has(k.toLowerCase())));
  return throwawayHomeEnv(kept, home, platform);
}

/**
 * The pages the probe reads, as argument paths: the top level (`[]`), each subcommand, and each subcommand one level
 * below it — the names the probe already lists, so a page set and its names never disagree. clap's own `help` entry
 * is skipped at both levels, as the nested capture does.
 */
export function helpPages(subcommands, nested) {
  const pages = [[]];
  for (const sub of [...(subcommands ?? [])].sort(byCodeUnit)) {
    if (sub === 'help') continue;
    pages.push([sub]);
    for (const child of [...(nested?.[sub] ?? [])].sort(byCodeUnit)) if (child !== 'help') pages.push([sub, child]);
  }
  return pages;
}

/**
 * Each page's body as a hash, by key (the path joined by spaces; `''` for the top level). `pageText` holds the pages
 * the caller already read, by key, and those are not read again. Neither is a page in `unreadable` — a subcommand
 * whose own `--help` already failed when its children were listed. Every other page is read once with `read(path)`.
 * A page that cannot be read is named in `helpUnreadable`, never hashed as if it were empty.
 */
export function hashPages(pages, pageText, unreadable, read) {
  const helpHashes = {};
  const helpUnreadable = [];
  for (const path of pages) {
    const key = path.join(' ');
    let text = Object.hasOwn(pageText, key) ? pageText[key] : undefined;
    if (text === undefined && !unreadable.includes(key)) {
      try { text = read(path); } catch { /* named below */ }
    }
    if (text === undefined) helpUnreadable.push(key);
    else helpHashes[key] = helpHash(text);
  }
  return { helpHashes, helpUnreadable };
}

/**
 * The pages, by key (`''` for the top level, else the path joined by spaces), whose body changed between the snapshot
 * and now, sorted.
 *
 * Returns null — not an empty list — when the snapshot has no hashes (it predates this check), or holds something
 * other than a map of them: "not compared" must not read as "unchanged". Only a page hashed on both sides is
 * compared. One that appears or disappears is a name change, which the name lists report; one whose `--help` could
 * not be read has no hash on that side (the probe lists it as unreadable instead), so a failed read never reads as a
 * change — the report names those pages as not compared.
 */
export function helpBodyDiff(wasHashes, nowHashes) {
  if (!wasHashes || typeof wasHashes !== 'object' || Array.isArray(wasHashes)) return null;
  return Object.keys(nowHashes ?? {})
    .filter((k) => Object.hasOwn(wasHashes, k) && wasHashes[k] !== nowHashes[k])
    .sort(byCodeUnit);
}

const pageName = (key) => key || '(top level)';

// A subcommand's nested pages are found from its own page, so when that page is unread its children are unread too.
function underUnread(pages) {
  const parents = pages.filter((p) => p && !p.includes(' '));
  return parents.length ? [`       Nor were the pages under ${parents.join(', ')}: nested pages are found from their parent's page.`] : [];
}

/**
 * What the probe reports about page bodies, from the snapshot (`was`) and this run's capture (`now`):
 *  - `changed`: the pages whose body changed (helpBodyDiff), or null when nothing was compared — the snapshot has no
 *    hashes, or grok rejected `--no-auto-update` and nothing was read;
 *  - `notCompared`: the pages unread on each side, sorted (`snapshot` is null when the snapshot has no hashes), and
 *    `anyNotCompared`; null when nothing was read;
 *  - `drifts`: whether a page changed, which `drifted` (and so `--strict`) counts like a name change;
 *  - `note` and `guidance`: the lines the probe prints — a NOTE for what was not compared, and step 1b of the drift
 *    guidance naming the changed pages.
 */
export function helpBodyReport(was, now) {
  if (!now.acceptsRequiredFlag) {
    return { changed: null, notCompared: null, anyNotCompared: false, drifts: false, note: [], guidance: [] };
  }
  const changed = helpBodyDiff(was.helpHashes, now.helpHashes);
  const notCompared = {
    now: [...(now.helpUnreadable ?? [])].sort(byCodeUnit),
    snapshot: changed ? [...(was.helpUnreadable ?? [])].sort(byCodeUnit) : null,
  };
  const anyNotCompared = Boolean(notCompared.now.length || notCompared.snapshot?.length);
  const note = [];
  if (changed === null) {
    note.push(
      'NOTE — the snapshot has no help-page hashes, so page bodies were not compared ("not compared",',
      '       not "unchanged"). Accept a baseline with --update once the contract is re-measured.',
    );
    if (notCompared.now.length) {
      note.push(
        `       The --help of ${notCompared.now.map(pageName).join(', ')} could not be read in this run, so an --update`,
        '       now would record them as unreadable. Find out why first.',
      );
    }
  } else if (anyNotCompared) {
    note.push('NOTE — some help-page bodies were not compared ("not compared", not "unchanged"):');
    if (notCompared.now.length) {
      note.push(`       now: the --help of ${notCompared.now.map(pageName).join(', ')} could not be read in this run.`, ...underUnread(notCompared.now));
    }
    if (notCompared.snapshot.length) {
      note.push(`       snapshot: the --help of ${notCompared.snapshot.map(pageName).join(', ')} could not be read when the snapshot was taken.`,
        ...underUnread(notCompared.snapshot));
    }
  }
  const guidance = changed?.length
    ? [
        `  1b. THE TEXT OF THESE HELP PAGES CHANGED: ${changed.map(pageName).join(', ')}.`,
        '     No name has to move for this — 1.0.50 changed `memory clear` and `worktree rm` this way, and both',
        '     were behaviour (A64, A65) — and a changed global option shows on every page. Read what each page',
        '     now says against what this plugin relies on.',
      ]
    : [];
  return { changed, notCompared, anyNotCompared, drifts: Boolean(changed?.length), note, guidance };
}
