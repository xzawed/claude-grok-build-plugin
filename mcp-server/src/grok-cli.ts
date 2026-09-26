import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, posix } from 'node:path';
import { extractPromptRun } from './prompt-flags.js';
import { buildGrokEnv } from './env.js';
import {
  billingFor, defaultDirExists as dirExists, defaultGitChangedFiles, diffChangedFiles, longCwdHint, spawnErrorCode,
  type GitChangedFilesFn, type SpawnFn, type SpawnResult,
} from './delegate.js';
import type { AuthMode, Billing } from './types.js';

// Commands that can't run headless (TUI/server/shell). Spawning them would hang or be meaningless.
//
// A29: `cursor-worker` is new in 1.0.30 and belongs HERE, not in KNOWN_SUBCOMMANDS. It registers
// this machine as a Cursor private worker holding Cloud Agent claims, through the same `leader`
// daemon already on this list — remote-initiated work on the owner's subscription, started by one
// tool call. MEASURED 2026-09-22 through the shipped v0.2.25 bundle: it was refused only by the
// unknown-subcommand rule, and that rule stands down whenever an unrecognised flag makes the parse
// uncertain, so `["--minimal","cursor-worker","--help"]` spawned (exit 0). The denylist has no such
// hole — `["--minimal","leader","list"]` stayed blocked — because blockedGrokWord scans every
// positional rather than trusting the flag snapshot. Put a consequential subcommand in the set
// that fails CLOSED.
const NON_HEADLESS = new Set(['dashboard', 'agent', 'leader', 'completions', 'wrap', 'cursor-worker']);

// Not a real 1.0 subcommand — first positional is treated as a TUI prompt and hangs.
const MISSING_SUBCOMMANDS = new Set(['import']);

// grok global flags that consume the NEXT token as their value (measured from `grok --help` on
// 1.0.5, re-measured on 1.0.13 2026-09-03: no listed flag changed), so a bare token following
// one is that value — not the subcommand. Deliberately absent: `-r/--resume` and `-w/--worktree`
// take an OPTIONAL value in 1.0.13, so listing them could swallow a token that is not theirs;
// leaving them out makes the parse uncertain instead, which fails CLOSED. This snapshot tracks
// a CLI this repo does not ship, so assume it is ALWAYS one release from being stale:
// correctness of blocking must not depend on it (see isBlockedGrokCommand).
const VALUE_FLAGS = new Set([
  '--agent', '--agents', '--allow', '--allowedTools', '--deny', '--cwd', '--debug-file',
  '--disallowed-tools', '--disallowedTools', '--json-schema', '--leader-socket', '-m', '--model',
  '--max-turns', '--output-format', '-p', '--single', '--permission-mode', '--prompt-file',
  '--prompt-json', '--reasoning-effort', '--effort', '--ref', '--rules', '-s', '--sandbox',
  '--session-id', '--system-prompt', '--system-prompt-override', '--tools', '--worktree-ref',
]);

// All bare (non-flag) tokens, in order, plus whether the parse can be trusted.
//
// Options and the values of KNOWN value flags are skipped. A flag that is neither `--x=y`
// (self-contained) nor in VALUE_FLAGS is AMBIGUOUS: it may be a boolean flag, or it may be a
// value flag added after this snapshot was taken, in which case the token we are about to read
// as the subcommand is really its value — and the true subcommand sits further right. Seeing
// one before the first positional means the subcommand slot cannot be identified.
function grokPositionals(args: string[]): { positionals: string[]; subcommandCertain: boolean } {
  const positionals: string[] = [];
  let sawAmbiguousFlag = false;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok.startsWith('-')) {
      // `--flag=value` carries its own value; `--flag value` consumes the next token.
      if (tok.includes('=')) continue;
      if (VALUE_FLAGS.has(tok)) { i += 1; continue; }
      if (positionals.length === 0) sawAmbiguousFlag = true;
      continue;
    }
    positionals.push(tok);
  }
  return { positionals, subcommandCertain: !sawAmbiguousFlag };
}

// login is interactive: browser OAuth blocks, and --device-auth prints a device URL then blocks
// polling. Our buffered spawn only returns on process close, so the URL can't be surfaced in time
// — route login to the user's terminal instead of running it here.
const BLOCKED_WORDS = new Set([...NON_HEADLESS, ...MISSING_SUBCOMMANDS, 'login']);

// Two regimes, because the snapshot above is not trustworthy forever.
//
// CERTAIN parse (nothing ambiguous precedes the first positional): that token IS the subcommand
// and everything after it is that subcommand's argument. Only the subcommand slot is checked, so
// `sessions search dashboard` runs — measured on 1.0.13, grok returns a real hit for that query,
// and `/grok:sessions` passes a user-supplied search term straight through.
//
// UNCERTAIN parse (a flag we do not recognise came first): its value may be masquerading as the
// subcommand, hiding the real one behind it. Measured on 1.0.5, `grok --sandbox workspace
// dashboard` parses as flag-value + COMMAND, and back then --sandbox was missing from the list —
// so testing only the first positional let a TUI command through while the comment above it
// claimed the parser erred toward blocking. Here every positional is refused instead.
//
// Staleness therefore fails CLOSED: a value flag added after this snapshot makes the parse
// uncertain, which widens blocking rather than opening a hole. The cost is refusing an argument
// that happens to equal one of seven reserved words when an unrecognised flag precedes it — a
// clear refusal naming the word, never a hung spawn.
export function blockedGrokWord(args: string[]): string | undefined {
  const { positionals, subcommandCertain } = grokPositionals(args);
  const scanned = subcommandCertain ? positionals.slice(0, 1) : positionals;
  return scanned.find((tok) => BLOCKED_WORDS.has(tok));
}

// Every subcommand `grok --help` lists on 1.0.30 (measured 2026-09-22; was 1.0.13 2026-09-06),
// plus the aliases it documents beside them (`du` -> disk-usage, `version` -> v).
//
// Read the staleness of this list the OPPOSITE way from BLOCKED_WORDS above. That one is a
// denylist: going stale makes it over-block, which is safe. This one is an allowlist, so a
// subcommand grok adds after this snapshot would be REFUSED here — a false block on a working
// command. Two things keep that cheap: the rule stands down whenever the subcommand slot is
// uncertain (see below), and the refusal names the token and says to run it in a terminal, so
// the user is never left without a path.
//
// ⚠️ When grok adds a subcommand, DECIDE WHICH SET IT BELONGS IN — do not reflexively add it here.
// Adding it here only lifts a false block. If the subcommand cannot run headless, or starts
// something that outlives the call, or acts on the owner's account, it belongs in NON_HEADLESS,
// which fails closed and survives an unrecognised leading flag. A29 is exactly that mistake made
// concrete: the earlier wording of this line said "add it here", and `cursor-worker` — remote
// work on the owner's subscription — is precisely what must not go here.
//
// A30 (measured 2026-09-22): `usage` was missing, so `grok usage <SESSION_ID>` — the one CLI
// surface carrying real per-session tokens and cost, and a pure read of ~/.grok that spends
// nothing — was refused without spawning, while every delegation row already stores that id.
const KNOWN_SUBCOMMANDS = new Set([
  'agent', 'clone', 'completions', 'dashboard', 'doctor', 'du', 'disk-usage', 'export', 'help',
  'inspect', 'leader', 'login', 'logout', 'mcp', 'memory', 'models', 'plugin', 'sessions',
  'setup', 'trace', 'update', 'usage', 'version', 'v', 'worktree', 'wrap',
]);

/**
 * The first positional, when it is not a subcommand grok knows.
 *
 * A11 (docs/10, MEASURED 2026-09-06 through the shipped bundle):
 *   ["sesions"]          -> status timeout, the whole 60s budget burned, and a stderrTail of
 *                           unreadable ANSI TUI frames
 *   ["sesions", "list"]  -> status error, exit 2, 793ms, "unexpected argument 'list' found"
 *
 * grok's usage is `grok [OPTIONS] [PROMPT] [COMMAND]`. A lone unknown token is therefore a
 * PROMPT, and a prompt with no `-p` opens the interactive UI, which a buffered spawn can only
 * wait out. That is the same mechanism `import` was already blocked for; this generalises it
 * rather than keeping one hand-picked word special.
 *
 * Returns undefined — do not block — when:
 *   - there is no positional (`grok --help`, `--version`, a `-p` prompt run: the prompt is a
 *     flag VALUE, not a positional), or
 *   - the parse could not identify the subcommand slot, because an unrecognised flag came first
 *     and the token may be its value. Blocking a working command to save one slow failure is
 *     the wrong trade.
 */
export function unknownGrokSubcommand(args: string[]): string | undefined {
  const { positionals, subcommandCertain } = grokPositionals(args);
  if (!subcommandCertain || positionals.length === 0) return undefined;
  const first = positionals[0];
  return KNOWN_SUBCOMMANDS.has(first) ? undefined : first;
}

// A2: the prompt-flag parser lives in its own leaf module so the PreToolUse hook bundle can
// import it without inlining this file and everything it depends on. Re-exported for callers.
export { extractPromptRun } from './prompt-flags.js';

export function isBlockedGrokCommand(args: string[]): boolean {
  return blockedGrokWord(args) !== undefined;
}

export interface GrokCliDeps {
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to the same porcelain reader runDelegate uses. */
  gitChangedFiles?: GitChangedFilesFn;
  /** Injected for tests; defaults to `defaultFolderStarts`. Asked only for a start failure a folder can cause. */
  folderStarts?: FolderStartsFn;
  /** Injected for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

export interface GrokCliResult {
  status: 'ok' | 'error' | 'blocked' | 'timeout';
  exitCode: number | null;
  /**
   * A25 (docs/10, MEASURED 2026-09-06): the directory this call resolved to — `opts.cwd` when the
   * caller gave one, `process.cwd()` otherwise. Required, not optional: the caller that writes the
   * delegation history had to guess it and guessed `''`, which no cwd-scoped dashboard can match.
   * Re-deriving the default at the call site was rejected — A7 came from exactly that (one default
   * defined in two places, then drifting), so the run reports the directory it used.
   */
  cwd: string;
  stdoutTail?: string;
  /** Set only when stdout was cut. Absent means stdoutTail IS the whole output. */
  stdoutTruncated?: boolean;
  /** Original stdout length in characters, present only alongside stdoutTruncated. */
  stdoutTotalChars?: number;
  stderrTail?: string;
  mode: AuthMode;
  billing: Billing;
  message?: string;
  /** True when the args carried a prompt — a real grok turn, not a read-only query (A2). */
  promptRun?: boolean;
  /** Prompt runs only: git porcelain delta (after \ before) around the spawn, as delegate does. */
  filesChanged?: string[];
  /** Which end of a truncated stdout `stdoutTail` holds. Absent when nothing was cut (A15). */
  stdoutKept?: 'head' | 'tail';
  /** True when a confirmation prompt went unanswered: the command ran and did NOTHING (A9). */
  cancelled?: boolean;
}

/**
 * Clip the output and SAY SO when something was dropped. The cap itself is a deliberate token
 * budget (docs/04), but an unmarked fragment is indistinguishable from the whole answer — and
 * some subcommands genuinely exceed it: `grok inspect --json` measured ~81 KB, of which any
 * 4000-char slice is under 5% and does not parse as JSON.
 */
export const STDOUT_TAIL_CHARS = 4000;
/** Ceiling for an explicit max_chars. Big enough for `inspect --json` (~81 KB), and no bigger. */
export const MAX_STDOUT_CHARS = 100_000;

/**
 * Which end of the output carries the meaning.
 *
 * A15 (docs/10, MEASURED 2026-09-06 through the shipped bundle): `grok inspect` printed 7269
 * characters and we kept the last 4000, so the slice began mid-line inside a plugin command
 * list. Everything inspect exists to report — grok home, model, auth, where each setting came
 * from — is printed FIRST, and was exactly what got thrown away. Help output is the same shape,
 * and `grok --help` lost its head to this rule in the very session that fixed it.
 *
 * Everything else keeps the tail, because a command log ends with its outcome.
 */
export function keepsHead(args: string[]): boolean {
  if (args.some((a) => a === '--help' || a === '-h')) return true;
  const { positionals, subcommandCertain } = grokPositionals(args);
  if (!subcommandCertain || positionals.length === 0) return false;
  return positionals[0] === 'inspect' || positionals[0] === 'help';
}

/** An explicit cap, clamped: nonsense and absurd values fall back to the default budget. */
function resolveMaxChars(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 1) return STDOUT_TAIL_CHARS;
  return Math.min(Math.floor(requested), MAX_STDOUT_CHARS);
}

function clipStdout(
  stdout: string,
  keep: 'head' | 'tail',
  maxChars: number,
): Pick<GrokCliResult, 'stdoutTail' | 'stdoutTruncated' | 'stdoutTotalChars' | 'stdoutKept'> {
  const s = stdout || '';
  if (s.length <= maxChars) return { stdoutTail: s };
  return {
    stdoutTail: keep === 'head' ? s.slice(0, maxChars) : s.slice(-maxChars),
    stdoutTruncated: true,
    stdoutTotalChars: s.length,
    stdoutKept: keep,
  };
}

/**
 * A confirmation prompt that nobody answered.
 *
 * A9 (docs/10, MEASURED 2026-09-06 through the shipped bundle). `grok memory clear --global`
 * with no stdin returns:
 *   status "ok", exitCode 0, isError false
 *   stdoutTail "…\nAre you sure? [y/N] Cancelled.\n"
 * The exit code is honest — grok did exit 0 — but a destructive command that deleted nothing is
 * not the same event as one that succeeded, and the wrapper offered no way to tell them apart
 * except by reading prose. Worse, `stdoutTail` keeps only the LAST 4000 characters, so a long
 * "the following will be deleted" list pushes the one piece of evidence out of the response.
 *
 * So the detection runs on the WHOLE stdout+stderr, before any truncation, and reports a field.
 *
 * Both markers are required. `Cancelled.` alone appears in ordinary output (`sessions search
 * cancelled` returns matching sessions), and a prompt alone may have been answered — measured
 * with `-y`, grok prints the same prompt line followed by the completion, not by a cancel.
 * Requiring the pair means a false positive needs BOTH strings, and a future grok that cancels
 * without printing `[y/N]` degrades to today's behaviour rather than to a wrong claim.
 */
const CONFIRM_PROMPT_RE = /\[y\/n\]/i;
const CANCELLED_RE = /(^|[^A-Za-z])cancelled\.?(\s|$)/i;

export function detectCancelledConfirmation(stdout: string, stderr: string): boolean {
  const all = (stdout || '') + '\n' + (stderr || '');
  return CONFIRM_PROMPT_RE.test(all) && CANCELLED_RE.test(all);
}

export const CANCELLED_MESSAGE =
  '확인 프롬프트가 취소되어 아무것도 변경되지 않았습니다. 헤드리스 실행에는 stdin이 없어 기본값 N이 선택됩니다 — '
  + '의도한 작업이면 범위를 확인한 뒤 그 서브커맨드의 확인 플래그(예: `-y`)를 붙여 다시 실행하세요.';

/**
 * grok never started. A grok that is missing, or found but not a program this machine will run, is the install
 * or PATH — each code measured in rounds 7 to 9: ENOENT (missing, `.cmd`-only on Windows, a dangling link, a bad
 * interpreter line), ENOTDIR (missing, and the last PATH entry is a file — Linux), EACCES (no execute permission, a
 * directory named grok, a noexec mount), EPERM (an ACL that denies execute), EFTYPE and UNKNOWN (a zero-byte,
 * truncated, text or other-architecture grok.exe), ENOEXEC (a zero-byte, shebang-less or truncated grok on musl —
 * glibc hands those to /bin/sh), ELOOP (a symlink loop), and off Windows ENAMETOOLONG (a PATH folder name over 255
 * bytes, or a PATH folder so long that grok's path passes 4,096 — arguments give E2BIG there; on Windows it is an
 * argument too long for the command line, and is named as it is). The working folder can give the same codes — too
 * long (ENOENT on Windows, round 3: the hint), not to be entered (EACCES on Linux, round 7), a file or gone by the time
 * of the start (ENOTDIR, ENOENT — round 9) — so a code a folder can cause is put to the folder first (`folderStarts`).
 * Any other failure is named as it is: A39 made every start failure this structured error, and it had said "설치/PATH
 * 확인" for all of them — v0.2.35 returned the errors spawn throws bare, and ended the server on EMFILE (round 6). The
 * code comes from Node's wording (`spawnErrorCode`), never from a search of the text: the NUL error quotes the argument.
 */
const NOT_A_RUNNABLE_GROK = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EFTYPE', 'UNKNOWN', 'ENOEXEC', 'ELOOP']);
// What a child's chdir into its working folder fails with — for these codes the folder itself is asked first.
const FOLDER_CAN_CAUSE = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP']);
async function startFailure(cwd: string, stderr: string | undefined, folderStarts: FolderStartsFn, platform: NodeJS.Platform): Promise<string> {
  const reason = (stderr ?? '').trim();
  const hint = longCwdHint(cwd, reason, platform);
  if (hint) return `grok 실행에 실패했습니다: ${hint}`;
  const code = spawnErrorCode(reason);
  if (code !== undefined && FOLDER_CAN_CAUSE.has(code)) {
    const answer = await folderStarts(cwd);
    if (answer === false) return `grok 실행에 실패했습니다: 작업 폴더에서 프로세스를 시작할 수 없습니다(${code}) — ${cwd}`;
    // The check's Node reached the chdir and the chdir had not returned at the cap: the folder is slow or hung, which is
    // itself worth looking at, so it is named first and the install second — a judgement, not a measurement (round 11:
    // pointed at the install alone, a slow mount that refused grok read as if the folder had been cleared; with only a
    // note that it was not checked, Grok's classification still judged it misleading).
    if (answer === 'unanswered') {
      return `grok 실행에 실패했습니다: 작업 폴더가 ${FOLDER_PROBE_MS / 1000}초 안에 열리지 않았습니다(${code}) — ${cwd}. 폴더가 정상이면 설치/PATH를 확인하세요.`;
    }
  }
  const install = reason === ''
    || (code !== undefined && (NOT_A_RUNNABLE_GROK.has(code) || (code === 'ENAMETOOLONG' && platform !== 'win32')));
  return install ? 'grok 실행에 실패했습니다 (설치/PATH 확인).' : `grok 실행에 실패했습니다: ${reason}`;
}

/** Can a process start in this folder? — injectable (GrokCliDeps.folderStarts). 'unanswered': its chdir did not return. */
export type FolderAnswer = boolean | 'unanswered';
export type FolderStartsFn = (dir: string) => FolderAnswer | Promise<FolderAnswer>;
const FOLDER_PROBE_MS = 5_000;
/**
 * Start this same Node and let it change into the folder: its chdir is the one grok's start made — the same syscall,
 * the same credentials, through the filesystem's own check. Each cheaper stand-in disagreed with a real chdir
 * somewhere: access(2) uses the real ids and drops capabilities (round 8); a stat of `<dir>/.` passed a FUSE mount
 * that refused the child, and failed a 4,094-byte folder the child entered (round 9). The child starts from `/` and
 * changes into the folder itself — started IN the folder, Node's spawn() waits for the chdir before it returns, and a
 * slow FUSE mount held this whole server 12 s, 24 s where it also refused grok, the cap never running (round 10).
 * spawn() still waits for this Node's own file to be found and exec'd: a Node on a slow mount holds the server that
 * long (round 11, measured; the server itself runs from that file).
 *
 * Its environment is the server's as a subscription-mode grok would get it (without the API-key variables
 * buildGrokEnv strips), without NODE_OPTIONS — a `--require` there would run the server's preload code again. Emptied
 * entirely (rounds 9–10), a Node that needs LD_LIBRARY_PATH to load did not start, and a folder no one could enter was
 * pointed at as the install (round 11). A relative LD_LIBRARY_PATH still fails from `/` (round 12 — not measured
 * worth more). A folder named under `/proc` or `/dev/fd` is not checked: those name a process, the child reading them
 * is another one, and the server's own entries may not be readable by it (a non-dumpable server, a PID namespace,
 * hidepid — round 12: rewriting them to `/proc/<pid>` named fine folders there).
 *
 * The child writes `>` just before its chdir, then `ok;` or the error code and `;` — and the answer is taken from that,
 * not from the child's exit (a Node writing coverage to a slow mount at exit held the answer, round 12). Two windows,
 * each the cap: reaching the chdir (a Node slow to start — an env path on a slow mount, a starved CPU — has learned
 * nothing about the folder, so yes: round 12 found a fine folder called "did not open" 15 times in 40 at a quarter
 * CPU), then the chdir returning (not returning is 'unanswered'). Once answered, or at either cap, the child is killed,
 * released so a child stuck in the kernel keeps neither the call nor the server alive, and the answer is given there
 * and then (rounds 11–12). Only a code a folder can cause answers no. A check that cannot start (this Node's file
 * removed by an upgrade while the server ran, or without its execute bit — round 9 follow-up, round 10) or ends
 * without an answer says yes. On Windows no permission on the folder stopped a start (round 8), so the answer is yes
 * there.
 */
const CHDIR_PROBE = "process.stdout.write('>'); let r = 'ok'; try { process.chdir(process.argv[1]); } catch (e) { r = String(e.code); } process.stdout.write(r + ';');";
export function defaultFolderStarts(
  dir: string,
  platform: NodeJS.Platform = process.platform,
  capMs = FOLDER_PROBE_MS,
  start: typeof spawn = spawn,
): Promise<FolderAnswer> {
  if (platform === 'win32') return Promise.resolve(true);
  if (/^\/(?:proc|dev\/fd)(?:\/|$)/.test(posix.normalize(dir))) return Promise.resolve(true);
  const env = buildGrokEnv('subscription', process.env);
  delete env.NODE_OPTIONS;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = start(process.execPath, ['-e', CHDIR_PROBE, '--', dir], { cwd: '/', stdio: ['ignore', 'pipe', 'ignore'], env });
    } catch {
      resolve(true);
      return;
    }
    let reported = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (answer: FolderAnswer, abandon: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (abandon) {
        child.kill('SIGKILL');
        child.unref();
        child.stdout?.destroy();
      }
      resolve(answer);
    };
    timer = setTimeout(() => settle(true, true), capMs);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      const reachedBefore = reported.startsWith('>');
      reported += chunk;
      if (!reported.startsWith('>')) return;
      const end = reported.indexOf(';');
      if (end >= 0) {
        settle(!FOLDER_CAN_CAUSE.has(reported.slice(1, end)), true);
      } else if (!reachedBefore) {
        clearTimeout(timer);
        timer = setTimeout(() => settle('unanswered', true), capMs);
      }
    });
    child.on('error', () => settle(true, false));
    child.on('close', () => settle(true, false));
  });
}

// Runs an arbitrary grok subcommand under the billing-safe env (subscription strips API keys +
// prepends the grok bin dir). Non-headless commands are refused (no spawn) instead of hanging.
/*
 * AUDITED BY GROK 2026-09-23, no finding. Claim put to it: "this function can hand the child process
 * credentials the configured mode says it must not have." Verdict False — the one spawn takes the
 * env from buildGrokEnv(mode, deps.env) and nothing adds to it afterwards; every other return
 * happens before a child exists. The denylist/allowlist halves of this file were audited
 * separately in v0.2.26 (A29/A30). Since v0.2.36 a failed start may start one more child, the folder
 * check (`defaultFolderStarts`): this Node on a fixed chdir script, its env built by
 * buildGrokEnv('subscription', …) — it never runs grok, and never holds the API-key variables buildGrokEnv strips
 * (a key a config.toml `env_key` names is passed on, as it is to a subscription-mode grok — contract §10).
 */
export async function runGrokCli(
  mode: AuthMode,
  args: string[],
  deps: GrokCliDeps,
  opts: { cwd?: string; timeoutMs?: number; maxChars?: number } = {},
): Promise<GrokCliResult> {
  const billing = billingFor(mode);
  // A25: resolved ONCE, here, so every return below reports the same directory the spawn uses.
  // The refusals report it too — when a path is the reason for the refusal, naming it is the
  // actionable half of the message.
  const cwd = opts.cwd ?? process.cwd();
  const blocked = blockedGrokWord(args);
  if (blocked !== undefined) {
    // Name the word that actually tripped the denylist — with any-positional scanning it is
    // not necessarily the first positional, and a message pointing at the wrong token is
    // unactionable.
    const sub = blocked;
    const message = sub === 'import'
      ? '`grok import`는 CLI 1.0에 서브커맨드가 없습니다 (위치 인자면 TUI가 떠서 행합니다). 세션은 `grok sessions list` 또는 `/grok:sessions` / `/grok:resume`을 쓰세요.'
      : `\`grok ${sub}\`는 대화형/서버 모드라 헤드리스로 실행할 수 없습니다. 터미널에서 직접 실행하세요.`;
    return { status: 'blocked', exitCode: null, cwd, mode, billing, message };
  }
  // A11: after the denylist, so a word that is BOTH unknown and denylisted keeps the specific
  // reason. An unknown first positional is a prompt to grok, and a prompt without -p opens the
  // interactive UI — measured at the full 60s timeout, returning ANSI frames nobody can read.
  const unknownSub = unknownGrokSubcommand(args);
  if (unknownSub !== undefined) {
    return {
      status: 'blocked', exitCode: null, cwd, mode, billing,
      message:
        `\`grok ${unknownSub}\`는 이 래퍼가 아는 1.0 서브커맨드가 아닙니다.`
        + ' 알 수 없는 첫 인자는 grok에게 프롬프트로 전달돼 대화형 UI가 뜨므로, spawn하지 않고 거부했습니다'
        + ' (그대로 실행하면 timeout까지 매달립니다). 오타라면 `grok --help`의 Commands 목록에서 확인하세요.'
        + ' 최근에 추가된 서브커맨드라면 이 래퍼가 아직 모르는 것이니 터미널에서 직접 실행하세요.',
    };
  }
  // A relative cwd resolves against the MCP server's own directory, not the caller's
  // project — the same guard runDelegate already applies. Fail before spawning so the
  // caller gets an actionable message instead of a generic "grok 실행에 실패했습니다".
  if (opts.cwd !== undefined && !isAbsolute(opts.cwd)) {
    return {
      status: 'error', exitCode: null, cwd, mode, billing,
      message: 'cwd는 절대 경로여야 합니다.',
    };
  }
  // ...and that it exists, which runDelegate has always checked and this path did not. A missing
  // directory surfaced as `spawn grok ENOENT`, reported as "설치/PATH 확인" — sending the user
  // after their grok installation when the fault is the path they passed.
  if (opts.cwd !== undefined && !dirExists(opts.cwd)) {
    return {
      status: 'error', exitCode: null, cwd, mode, billing,
      message: `디렉토리가 존재하지 않습니다: ${opts.cwd}`,
    };
  }
  const timeoutMs = opts.timeoutMs ?? 60000;
  const keep: 'head' | 'tail' = keepsHead(args) ? 'head' : 'tail';
  const maxChars = resolveMaxChars(opts.maxChars);
  const env = buildGrokEnv(mode, deps.env);
  // A2: a passthrough carrying a prompt edits files and spends quota exactly like a delegation,
  // so it gets the same porcelain delta (after  before) — otherwise the history row we are now
  // writing would claim every passthrough changed nothing. A read-only query runs no git at all.
  const promptRun = extractPromptRun(args);
  const gitChangedFiles = deps.gitChangedFiles ?? defaultGitChangedFiles;
  const beforeFiles = promptRun ? await gitChangedFiles(cwd) : undefined;
  const r: SpawnResult = await deps.spawn(['--no-auto-update', ...args], cwd, env, timeoutMs);
  const changed = beforeFiles
    ? { promptRun: true, filesChanged: diffChangedFiles(beforeFiles, await gitChangedFiles(cwd)) }
    : {};
  if (r.spawnError) {
    // spawn never started: nothing ran, so no promptRun/filesChanged claim is warranted.
    const platform = deps.platform ?? process.platform;
    const folderStarts = deps.folderStarts ?? ((dir: string) => defaultFolderStarts(dir, platform));
    const message = await startFailure(cwd, r.stderr, folderStarts, platform);
    return { status: 'error', exitCode: r.code, cwd, mode, billing, stderrTail: (r.stderr || '').slice(-500), message };
  }
  if (r.timedOut) {
    return {
      status: 'timeout', exitCode: null, cwd, mode, billing, ...changed,
      ...clipStdout(r.stdout, keep, maxChars), stderrTail: (r.stderr || '').slice(-1000),
      message: `grok 명령이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다.`,
    };
  }
  // Detected on the FULL output, not on the tail that is about to be cut from it.
  const cancelled = r.code === 0 && detectCancelledConfirmation(r.stdout, r.stderr);
  return {
    status: r.code === 0 ? 'ok' : 'error',
    exitCode: r.code,
    cwd,
    ...changed,
    ...clipStdout(r.stdout, keep, maxChars),
    stderrTail: (r.stderr || '').slice(-1000),
    mode, billing,
    ...(cancelled ? { cancelled: true, message: CANCELLED_MESSAGE } : {}),
  };
}
