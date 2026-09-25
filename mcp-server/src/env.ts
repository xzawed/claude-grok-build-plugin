import { homedir } from 'node:os';
import { join, delimiter, posix, win32 } from 'node:path';
import type { AuthMode } from './types.js';

/*
 * The pay-as-you-go credentials a subscription run must not hold.
 *
 * FOUND BY GROK auditing this file (2026-09-22): the deletion below is the single most
 * consequential thing this module does and it was the only thing here with no comment, while the
 * HOME fallback eight lines down carried a measured eight-line rationale. Verified — the reasoning
 * existed only in root CLAUDE.md, which by its own header is NOT delivered to installed users and
 * loads only when developing in this repo. So whoever read the shipped source, or reviewed a diff
 * to this file, saw an unexplained `delete`.
 *
 * WHY (SSOT: docs/02-auth-strategy.md, and grok-cli-contract.md §10 for the measurement):
 * it is NOT that the key would outrank a live session — measured on 1.0.13, grok goes
 * `auth_type=SessionToken` and never tries the env key while a session is valid. It is that the
 * moment the session is absent or expired, an env key becomes a FALLBACK credential and a run the
 * user believes is on their subscription is silently billed as metered API usage. Stripping the
 * keys converts that silent charge into an explicit `auth_error`. Subscription mode therefore
 * never holds a metered credential at all — a policy guarantee, not an optimisation.
 *
 * Pinned by test/env.test.ts (both modes, mixed case, and the api-mode passthrough). If you are
 * here to simplify this loop: removing it re-opens silent metered billing, and the tests will say
 * so before CI does.
 */
const API_KEY_VARS = ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'] as const;
// Case-insensitive on purpose: Windows env vars are case-insensitive, so a `xai_api_key` set in a
// user shell would survive an exact-match filter and become exactly the fallback described above.
const API_KEY_VARS_LOWER = new Set(API_KEY_VARS.map((k) => k.toLowerCase()));

/*
 * A34 (docs/10; measured 2026-09-24 — contract §14 has the evidence and its versions): every grok
 * this module starts is a worker that runs A COPY OF THIS SERVER. grok loads installed Claude Code
 * plugins as its own — this one included — and starts their MCP servers inside each worker (every
 * recorded session that set up MCP, back to grok 1.0.13). Through that copy a worker can start yet
 * another grok: reproduced, the outer delegate reported `filesChanged: []` while the nested run
 * wrote a file in another directory, and real use tried it three times unprompted (stopped only
 * because those were plan runs).
 *
 * The copy cannot tell where it runs except from its environment, and grok hands the worker's
 * environment to the MCP servers it starts — measured for a plugin-sourced server in a headless
 * session on 1.0.30 (win32) and 1.0.41 (Linux, sandboxed or not). So every grok gets this marker,
 * and a server that finds it refuses everything — see `insideWorker` in server.ts.
 *
 * Why not switch grok's loading off instead: the only switches found (GROK_CLAUDE_MCPS_ENABLED and
 * siblings, undocumented, in the binary) disable ~/.claude.json servers only — plugin-sourced ones,
 * this one among them, are untouched (measured with `grok inspect`).
 *
 * What this still rests on: that env inheritance is GROK's behaviour, so a grok update could take it
 * away and every test here would stay green (they set the marker by hand). `npm run probe:contract`
 * re-checks it on the grok in front of you (scripts/worker-marker-probe.mjs) and fails --strict if
 * the marker stops arriving.
 */
export const WORKER_ENV_VAR = 'GROK_BUILD_WORKER';

/** True when this process was started, directly or not, by a grok that grok-build launched. */
export function insideGrokWorker(env: NodeJS.ProcessEnv): boolean {
  return env[WORKER_ENV_VAR] === '1';
}

// grok's config dir. `GROK_HOME` relocates it wholesale — grok's own README documents
// "GROK_HOME — Override config directory (default: ~/.grok)". Measured on 1.0.5 (2026-09-02)
// and re-measured unchanged on 1.0.13 (2026-09-03):
// `GROK_HOME=<dir> grok du --json` reports grok_home=<dir> while auth resolves
// ONLY there: `grok models` under a fresh GROK_HOME says "not authenticated" even with a valid
// ~/.grok/auth.json. There is no fallback, so anything looking for grok state must ask here.
// Deliberately independent of grokBinDir: the binary's location comes from GROK_BIN_DIR /
// install.sh, which GROK_HOME was not measured to move.
export function grokHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const raw = env.GROK_HOME;
  if (!raw || raw.length === 0) return join(homedir(), '.grok');
  return platform === 'win32' ? win32DirAsOpened(raw) : raw;
}

/*
 * A36 (docs/10; MEASURED 2026-09-25, grok 1.0.41 on win32 — oracles `grok models` and a delegate-shaped
 * headless run, on a synthetic session, quota 0): grok opens <home>\auth.json (and config.toml, sessions\)
 * through Windows path normalization. Node's fs converts drive and UNC paths to the \\?\ form first, and
 * \\?\ skips normalization — so wherever normalization renames a segment, the plugin looked for the session
 * somewhere grok does not. v0.2.34 disagreed with grok on 24 of 81 hand-picked spellings and 456 of 714
 * generated runs (CHANGELOG v0.2.35); this code on none of either — `npm run probe:home` re-asks the grok in
 * front of you. Two rules explain every disagreement:
 *   R1  a segment followed by another one loses its trailing dot when it ends in exactly ONE
 *       (h. -> h, "h ." -> "h "; h.. and h... are kept — shown with folders literally named h. and h..)
 *   R2  the folder grok works in loses the trailing spaces and dots of its last segment, unless the path
 *       ends in a separator — Windows does it when grok enters the folder (`grok inspect` reports it trimmed)
 * A trailing SPACE on GROK_HOME is changed by neither: grok opens "<home> \auth.json" and says "Not signed in"
 * (measured), so "not logged in" stays the answer and grokHomeNote says why. `grok du` does report the
 * folder trimmed — the A36 entry was first built on that report, which is not where grok looks.
 *
 * Nothing here is a guess at the whole of Windows' normalization: these are the two rules the matrix needed.
 * \\?\ is left alone because Windows normalizes it for nobody; \\.\ gets the rules, which changes nothing —
 * Node's fs does not re-prefix it, so Windows already normalizes it for both. POSIX has no such thing.
 */

/** R1: the one trailing dot of a segment that ends in exactly one. */
function dropLoneTrailingDot(segment: string): string {
  return segment.length > 1 && segment.endsWith('.') && !segment.endsWith('..') ? segment.slice(0, -1) : segment;
}

/**
 * A directory as Windows opens `<dir>\<name>` for grok: every segment of it is followed by another (R1).
 * A value R1 does not touch comes back exactly as given. The root (drive, share, device) is not rewritten.
 */
function win32DirAsOpened(dir: string): string {
  if (dir.startsWith('\\\\?\\')) return dir;
  const rest = dir.slice(win32.parse(dir).root.length);
  if (!rest.split(/[\\/]/).some((s) => dropLoneTrailingDot(s) !== s)) return dir;
  const normalized = win32.normalize(dir);
  const { root } = win32.parse(normalized);
  return root + normalized.slice(root.length).split('\\').map(dropLoneTrailingDot).join('\\');
}

/**
 * The folder grok works in, as Windows makes it current (R2, then R1). `.` and `..` are resolved first, as
 * Windows resolves them before trimming: `C:\x\..` is C:\, not C:\x.
 */
function win32FolderAsEntered(dir: string): string {
  if (dir.startsWith('\\\\?\\')) return dir;
  const endsInSeparator = dir.endsWith('\\') || dir.endsWith('/');
  const resolved = win32.resolve(dir);
  if (endsInSeparator) return win32DirAsOpened(resolved);
  // A loop, not /[ .]+$/: that regex backtracks quadratically on a long run of spaces that does not end
  // the string, and this runs before every gated call on a caller-supplied folder.
  let end = resolved.length;
  while (end > 0 && (resolved[end - 1] === ' ' || resolved[end - 1] === '.')) end -= 1;
  return win32DirAsOpened(resolved.slice(0, end));
}

/*
 * A35 (docs/10; MEASURED 2026-09-24, grok 1.0.41 on win32, `grok du --json`): grok resolves a
 * RELATIVE GROK_HOME against the directory it RUNS in — its `--cwd` when given, which wins over the
 * folder it was started in — and does not expand `~` (`~/.x` is just a relative path to it).
 * `grokHome` above knows no folder, so a relative one was resolved against whatever process
 * asked: the MCP server or the hook. Reproduced on the shipped v0.2.33 bundle: the session sat in
 * <task>/rel-home, and a delegation into <task> was refused in 129 ms as "not logged in" (the hook
 * denied it too) — grok never started.
 *
 * So anything that stands in for grok's own lookup asks with the folder grok will run in. A value
 * that names one place wherever grok runs is returned as before (on Windows, as Windows opens it —
 * A36); so is the default. `~`
 * is deliberately NOT expanded: expanding it would make the plugin agree with a user's intent and
 * disagree with grok, which is the failure this fixes. With no GROK_HOME, the home comes from
 * os.homedir(), which on win32 reads USERPROFILE — and USERPROFILE moves grok's home too (measured;
 * HOME does not).
 */
export function grokHomeFor(env: NodeJS.ProcessEnv, baseDir: string, platform: NodeJS.Platform = process.platform): string {
  const raw = env.GROK_HOME;
  if (raw && raw.length > 0) {
    if (platform !== 'win32') return grokHomeDependsOnFolder(raw, platform) ? posix.resolve(baseDir, raw) : raw;
    // A36: named as Windows will open it for grok — see win32DirAsOpened / win32FolderAsEntered above.
    if (!grokHomeDependsOnFolder(raw, platform)) return win32DirAsOpened(raw);
    return win32DirAsOpened(win32.resolve(win32FolderAsEntered(baseDir), raw));
  }
  return join(homedir(), '.grok');
}

/**
 * Whether GROK_HOME names a different place depending on the folder grok runs in (A35). A relative
 * path does. So, on Windows, does a rooted path with no drive (`\x`, `/x`) and a drive with no root
 * (`C:x`): Node's isAbsolute calls the first absolute, but grok puts it on the drive of its working
 * folder (MEASURED 2026-09-24, 1.0.41, `grok du --json`: started on C: → C:\<p>\gh, on D: → D:\<p>\gh,
 * `--cwd <D: folder>` from C: → D:\<p>\gh, and the same for `/p/gh` — found by the adversarial
 * pre-merge review). A drive with its root, or a UNC/device path, names one place there.
 *
 * Classified by the leading characters, not by win32.parse().root: the first version required that
 * root to end in a separator, and a share root written without one (`\\srv\share`) failed it — the
 * re-review showed a grok_cli prompt run main denied getting through. A rooted path with no drive is
 * the absolute one that starts with exactly ONE separator; two mean UNC or a device path.
 */
export function grokHomeDependsOnFolder(raw: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return !posix.isAbsolute(raw);
  if (!win32.isAbsolute(raw)) return true; // relative, or a drive with no root (C:x)
  const isSep = (c: string | undefined) => c === '\\' || c === '/';
  return isSep(raw[0]) && !isSep(raw[1]);
}

/** What a stretch of whitespace is, in words — a tab or a line break shows as nothing inside quotes. */
function whitespaceKinds(s: string): string {
  const kinds = new Set<string>();
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    kinds.add(code === 32 ? '스페이스' : code === 9 ? '탭' : code === 10 || code === 13 ? '줄바꿈' : '특수 공백 문자');
  }
  return [...kinds].join('·');
}

/**
 * Sentences for an answer about grok's home that "run grok login" alone would not fix. Attached to status
 * and auth-check answers, and appended to a refusal (server) or deny (hook).
 *  - A36: GROK_HOME has whitespace at either end. grok uses it as part of the path (a trailing space: it
 *    looks under "<home> \auth.json" and is not signed in; a tab, CR or LF, or a space before a drive
 *    path: `grok du` and `models` exit 1, os error 123 — measured 2026-09-25, 1.0.41), so a login in the
 *    folder the user meant is not used. Said with or without a folder when the home is absolute; the hook
 *    lets a folder-dependent value through when it cannot name the folder (see decideHook). A value that
 *    is only whitespace (cmd's `set GROK_HOME= && …` leaves one space — measured) is not "unset" to grok,
 *    as an empty one is; the note says to remove the variable.
 *  - A35: GROK_HOME depends on the folder (see grokHomeDependsOnFolder) and `baseDir` is known: names the
 *    home it resolved to — a login run elsewhere lands in whatever folder the user's terminal is in.
 */
export function grokHomeNote(env: NodeJS.ProcessEnv, baseDir: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  const raw = env.GROK_HOME;
  if (!raw) return undefined;
  const notes: string[] = [];
  const trimmed = raw.trim();
  // The cmd cause only fits spaces at the END: `set GROK_HOME=C:\x && …` keeps the space before `&&`
  // (measured), and nothing in that form puts one in front or adds a tab.
  const onlySpaces = (s: string) => s.length > 0 && [...s].every((c) => c === ' ');
  if (trimmed === '') {
    // `set GROK_HOME= && claude` in cmd — an attempt to unset it — leaves one space. grok is not signed in
    // with that value either (measured). The fix is to remove the variable, so no home is named for it.
    notes.push(`GROK_HOME이 ${whitespaceKinds(raw)} ${raw.length}자뿐입니다. grok도 이 값으로는 로그인 상태가 되지 `
      + '않습니다 — 기본 홈(~/.grok)을 쓰려던 것이라면 GROK_HOME 변수를 지우고 Claude Code를 재시작하세요.'
      + (platform === 'win32' && onlySpaces(raw) ? ' (cmd의 `set GROK_HOME= && …`는 `&&` 앞의 공백을 값으로 넣습니다.)' : ''));
    return notes[0];
  }
  if (trimmed !== raw) {
    // FOUND BY GROK (message review, 2026-09-25, measured facts given): the first version said "공백 문자"
    // for a tab, sent a leading space to the cmd cause, and never said to restart — the value is read when
    // Claude Code starts. "Cannot use the session" covers both measured outcomes: a trailing space sends
    // grok to another folder name, a tab/CR/LF or a leading space makes grok fail (os error 123).
    const head = raw.slice(0, raw.length - raw.trimStart().length);
    const tail = raw.slice(raw.trimEnd().length);
    const where = [
      head ? `앞에 ${whitespaceKinds(head)} ${head.length}자` : '',
      tail ? `끝에 ${whitespaceKinds(tail)} ${tail.length}자` : '',
    ].filter(Boolean).join(', ');
    // Worded to hold when the check PASSED too (review finding, reproduced): a folder whose name really
    // ends in that space can hold the session, and "fix it" would then move a working user off it.
    notes.push(`GROK_HOME('${raw}')의 ${where}가 붙어 있습니다. grok은 이 값을 그 문자까지 그대로 경로로 쓰므로 `
      + `'${trimmed}'의 세션은 쓰이지 않습니다 — 의도한 문자가 아니라면 GROK_HOME을 '${trimmed}'로 고친 뒤 Claude Code를 `
      + '재시작하세요(`grok login`보다 먼저).'
      + (platform === 'win32' && onlySpaces(tail) ? ' (cmd의 `set GROK_HOME=C:\\x && …`는 `&&` 앞의 공백까지 값에 넣습니다.)' : ''));
  }
  // The folder note only for a value that depends on the folder without its whitespace too: a leading space
  // makes `C:\x` relative to Node, and "relative to the folder" would send the user after the wrong thing.
  if (baseDir !== undefined && grokHomeDependsOnFolder(raw, platform) && grokHomeDependsOnFolder(trimmed, platform)) {
    notes.push(`GROK_HOME('${raw}')은 상대 경로라(Windows에서는 \\grok처럼 드라이브 없이 루트부터 쓴 경로도) grok이 실행되는 작업 폴더에 따라 `
      + `달라지고, ~도 풀리지 않습니다. 이 답은 ${grokHomeFor(env, baseDir, platform)} 기준입니다. 위임은 각자의 작업 `
      + '폴더 기준으로 다시 확인합니다 — 폴더마다 다른 홈을 의도한 게 아니라면 GROK_HOME을 절대 경로(Windows는 드라이브 '
      + '문자부터)로 설정하세요.');
  }
  return notes.length > 0 ? notes.join(' ') : undefined;
}

// grok's install.sh puts the binary in $GROK_BIN_DIR (default $HOME/.grok/bin) and adds
// that dir to PATH in shell profiles. A GUI/Dock-launched Claude Code doesn't source those
// profiles, so its PATH — inherited by the MCP server and hook subprocesses — may omit it.
export function grokBinDir(env: NodeJS.ProcessEnv): string {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0
    ? env.GROK_BIN_DIR
    : join(homedir(), '.grok', 'bin');
}

// Returns a copy of env with the grok bin dir prepended to PATH so `grok` is discoverable
// even under a minimal PATH. Idempotent (skips if already present); does not mutate input.
// The PATH key is located case-insensitively: Windows spells it `Path`, and writing a fresh
// uppercase `PATH` beside it leaves two keys that differ only in case. The child process
// keeps only one of them, so the real PATH is silently dropped and grok inherits nothing but
// its own bin dir. Mirrors the case-insensitive handling buildGrokEnv already uses for keys.
export function prependGrokBin(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = grokBinDir(env);
  // When both spellings somehow coexist in a hand-built env, prefer the exact uppercase
  // key: measured on win32 that is the one the child process keeps.
  const pathKey = Object.hasOwn(env, 'PATH')
    ? 'PATH'
    : Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const current = env[pathKey] ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };
  return { ...env, [pathKey]: current ? `${dir}${delimiter}${current}` : dir };
}

export function buildGrokEnv(
  mode: AuthMode,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  if (mode === 'subscription') {
    for (const key of Object.keys(copy)) {
      if (API_KEY_VARS_LOWER.has(key.toLowerCase())) delete copy[key];
    }
  }
  // Kept as a POSIX belt-and-braces for a launch env with no HOME at all. On win32 it does NOT
  // steer where grok looks (measured below); what decides the home on POSIX is unmeasured
  // (contract §8). Re-measured on 1.0.13 (win32, 2026-09-02) — the 2026-08-14 note that
  // grok "requires HOME or GROK_HOME" does not hold:
  //   env -u HOME -u GROK_HOME grok du --json  -> grok_home C:\Users\dirtc\.grok  (works)
  //   env -u GROK_HOME HOME=<tmp> grok du --json -> grok_home UNCHANGED
  // HOME does not relocate the config dir — GROK_HOME does (see `grokHome`), and on win32 so does
  // USERPROFILE when GROK_HOME is unset (re-measured on 1.0.41, 2026-09-24; the older note here said
  // "only GROK_HOME", which USERPROFILE disproves). Do not read this line as "HOME redirects grok" —
  // that assumption is exactly what left scripts/probe-unauth-device-flow.mjs isolating nothing
  // while believing it did.
  if (!copy.HOME && !copy.GROK_HOME) {
    copy.HOME = homedir();
  }
  copy[WORKER_ENV_VAR] = '1'; // A34 — see WORKER_ENV_VAR above
  return prependGrokBin(copy);
}
