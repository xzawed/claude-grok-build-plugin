import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, statSync, lstatSync, existsSync, readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { lstat, open, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, win32 } from 'node:path';
import { buildGrokEnv, grokHome, grokHomeFor } from './env.js';
import { normalizeCwd } from './usage.js';
import { isSuccessfulStopReason, parseGrokResult } from './grok-result.js';
import { createGrokWorktree } from './worktree.js';
import { parsePorcelain, untrackedPaths } from './git-porcelain.js';
import { startSignInWatch, signInLogForRun } from './sign-in-watch.js';
import type { AuthMode, Billing, DelegateInput, DelegateResult, GrokResult } from './types.js';

const execFileAsync = promisify(execFile);

// Auth-failure detection (high-specificity; avoid ordinary code/output false positives).
//
// MEASURED 2026-07-13 (docs/specs/grok-cli-contract.md §7): missing session sometimes
// starts device-OAuth on stderr and BLOCKS → wrapper timeout. For timed-out runs, ONLY
// these high-specificity stderr markers reclassify as auth_error (never scan stdout —
// partial thoughts/code can mention "grok login" and false-positive).
//
// MEASURED 2026-07-25 (isolated USERPROFILE/HOME, no API key, Windows): modern grok often
// exits immediately with JSON {"type":"error","message":"Not signed in..."} — no timeout.
// That path uses looksLikeAuthFailure on non-timeout branches.
export const DEVICE_AUTH_SIGNALS = [
  /accounts\.x\.ai\/oauth2\/device/i,
  /waiting for authorization/i,
];
// MEASURED 2026-09-05 (1.0.13, win32, isolated GROK_HOME holding a REJECTED auth.json —
// contract §7 path C): an expired/revoked session does NOT wait and does NOT say "not signed
// in". It exits 1 after ~25-30s (contract §7 C records 10-20 s to first output for the same
// measurement; the raw timings were not kept) with a 401 envelope whose only auth wording is "Invalid or
// expired credentials", followed by xAI's boilerplate "Your session is still signed in ... no
// need to run /login". Without the last signal below, that classified as grok_error and handed
// the user advice that is the exact opposite of what they must do. Re-measured 2026-09-30: on
// 1.0.41/1.0.44 the envelope arrives in about 2-5 s (1.95-5.3 s), and the trailer is printed only when
// grok cannot clear the rejected credential (contract §7 D) — `invalid or expired credentials` is still
// the one signal these envelopes match.
//
// Non-timeout auth text (parse fail, type:error JSON, non-EndTurn). Broad 401/403 still
// excluded — this matches the credential phrase, not the status code.
export const AUTH_ERROR_SIGNALS = [
  /not signed in/i,
  /not authenticated/i,
  /grok login --device-code/i,
  /grok login/i,
  /set the xai_api_key/i,
  /invalid or expired credentials/i,
];

// A33 — MEASURED 2026-09-23 (Linux/Docker, grok 1.0.41), the Linux half of docs/10 B4.
//
// grok fails CLOSED on a sandbox it cannot enforce: it prints one line and exits 1 with an
// empty stdout, BEFORE it ever contacts the API. That is good behaviour by grok, but it lands
// in the "no envelope" branch below, which used to answer "output could not be interpreted" —
// a cause nobody established, for three different real failures.
//
// What makes it worth its own signal rather than a generic pointer: `--sandbox` has an env
// alias (`[env: GROK_SANDBOX=]`), so a delegation that passed NO sandbox option still dies
// this way if the operator's shell happens to export it. Measured: with GROK_SANDBOX unset
// the same call reached auth; with GROK_SANDBOX=workspace it never started; with
// GROK_SANDBOX=off it reached auth again. The caller cannot guess that from "could not be
// interpreted", and the variable is not in the request they sent.
//
// stderr ONLY, deliberately. These phrases are ordinary English that a successful run's
// assistant text could easily contain, and misreading that as a sandbox refusal would hand
// the user a remedy for a problem they do not have.
//
// The bwrap line is anchored to the start of the WHOLE stderr, not to any line (`m` flag).
// FOUND BY GROK reviewing this fix: with `m`, a delegation in which grok itself ran a
// `bwrap ...` command as a tool call and forwarded its stderr matched — grok HAD started, and
// the user was told it had refused to. A refusal preceded by other output now degrades to the
// generic message instead, which names no cause. That is the direction to fail in: this whole
// item exists because a message asserted a cause nobody established.
export const SANDBOX_ERROR_SIGNALS = [
  /sandbox could not enforce/i,
  /sandbox profile resolve failed/i,
  /refusing to start with denied paths unprotected/i,
  /sandbox initialization failed/i,
  /^\s*bwrap: /i,
];

/** Pure: does this run's stderr say grok refused to start over its sandbox? */
export function looksLikeSandboxRefusal(stderr: string): boolean {
  return SANDBOX_ERROR_SIGNALS.some((re) => re.test(stderr || ''));
}

export function sandboxRefusalMessage(): string {
  return 'grok이 샌드박스 프로파일을 적용하지 못해 **시작을 거부**했습니다 (모델 호출 전이라 과금 없음). '
    + '`sandbox`를 넘기지 않았더라도 환경변수 `GROK_SANDBOX`가 설정돼 있으면 grok이 스스로 읽습니다 — '
    + '`sandbox: "off"`로 덮거나 그 변수를 해제하세요. 정확한 사유는 rawStderrTail에 있습니다 '
    + '(Linux에서 deny 목록이 있는 프로파일은 bubblewrap이 필요합니다).';
}

/** Pure: does combined text look like an auth failure (non-timeout paths). */
export function looksLikeAuthFailure(...chunks: string[]): boolean {
  const text = chunks.filter(Boolean).join('\n');
  if (!text) return false;
  return AUTH_ERROR_SIGNALS.some((re) => re.test(text))
    || DEVICE_AUTH_SIGNALS.some((re) => re.test(text));
}

/** Pure: timed-out run reclassifies to auth only on device-flow markers in stderr. */
export function isTimedOutDeviceAuth(stderr: string): boolean {
  return DEVICE_AUTH_SIGNALS.some((re) => re.test(stderr || ''));
}

export function authNeededMessage(mode: AuthMode, opts?: { timedOutDeviceFlow?: boolean }): string {
  if (mode === 'subscription') {
    return opts?.timedOutDeviceFlow
      ? '구독 세션 인증이 필요/만료됐습니다 (grok이 재로그인을 기다리다 타임아웃). `grok login`을 실행한 뒤 다시 시도하세요.'
      : '구독 세션 인증이 필요/만료됐습니다. 터미널에서 `grok login`을 실행한 뒤 다시 시도하세요.';
  }
  return 'API 인증에 실패했습니다. `XAI_API_KEY`가 유효한지 확인하세요.';
}

/**
 * A68: the run ended because grok began an interactive browser sign-in (sign-in-watch.ts) and the wrapper stopped it.
 * The window grok opened may still be on screen; signing in there completes nothing — the grok that would have received
 * the callback is gone — so the advice is the usual terminal login.
 */
export function signInStartedMessage(mode: AuthMode): string {
  return 'grok이 인증에 실패해 브라우저 로그인을 시작했으므로 래퍼가 기다리지 않고 grok을 멈췄습니다 — 브라우저에 로그인 창이 '
    + `열렸을 수 있으며, 그 창에서 로그인해도 이 실행은 이어지지 않으니 닫아도 됩니다. ${authNeededMessage(mode)}`;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  // True when the process could not be started at all (ENOENT/EACCES/bad cwd), as
  // opposed to a normal exit — lets runDelegate give an actionable message.
  spawnError?: boolean;
  // True when the read stopped at the exit grace before stdout ended — something grok started still held it (A41):
  // the output may end mid-text. Absent when stdout reached its end.
  cutShort?: boolean;
  // A68: true when grok's log said this grok began an interactive sign-in and the run was stopped there (not by the cap —
  // `timedOut` stays false). Absent otherwise.
  signInStarted?: boolean;
}

export type SpawnFn = (
  args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
) => Promise<SpawnResult>;

export type GitChangedFilesFn = (cwd: string) => string[] | Promise<string[]>;
export type DirExistsFn = (cwd: string) => boolean;
/** Hash of the working tree's dirty state, or null when it cannot be determined. */
export type GitDirtyFingerprintFn = (cwd: string) => Promise<string | null>;
/** A32: current commit id, or null when there is no repo/HEAD to read. */
export type GitHeadFn = (cwd: string) => Promise<string | null>;

export interface DelegateDeps {
  spawn?: SpawnFn;
  /** A3: where grok keeps its sessions, so a resume that relocates the work can be seen. */
  sessionsIndex?: SessionsIndex;
  gitChangedFiles?: GitChangedFilesFn;
  gitDirtyFingerprint?: GitDirtyFingerprintFn;
  gitHead?: GitHeadFn;
  dirExists?: DirExistsFn;
  env?: NodeJS.ProcessEnv;
  createWorktree?: (cwd: string) => Promise<string>;
}

// A3 (docs/10, MEASURED 2026-09-05): `--resume` OVERRIDES `--cwd`. A delegation asking for dirA
// while resuming a session born in dirB wrote a.txt into dirB and came back `completed` with
// `filesChanged: []` — the caller was told nothing, and the history row said dirA.
//
// grok keeps sessions at <grokHome>/sessions/<url-encoded cwd>/<sessionId>, so the owning
// directory is recoverable. This reads a layout this repo does NOT own and grok updates itself
// (1.0.5 -> 1.0.13 mid-session, measured), so every failure here must yield NO claim rather than a
// wrong one: an unreadable or renamed layout simply restores the old, silent behaviour.
export interface SessionsIndex {
  /** Raw (still url-encoded) directory names under <grokHome>/sessions. */
  listSessionDirs: () => string[];
  sessionDirHasId: (encodedDir: string, sessionId: string) => boolean;
  /** A59: the session's own folder on disk. An index without it makes no claim about what grok did with a prompt. */
  sessionFolder?: (encodedDir: string, sessionId: string) => string;
  /**
   * A69: the cwd grok writes to `<dir>/.cwd` when the url-encoded cwd topped 255 bytes and grok named
   * the dir `<slug>-<16hex>` instead (contract §12). Undefined when there is no readable, absolute cwd
   * there. The index owns this fs read (regular file, size cap) so resolveSessionCwd stays pure and mockable.
   */
  readLongNameCwd?: (encodedDir: string) => string | undefined;
}

// A69 (contract §12): beside a `<slug>-<16hex>` session dir grok writes the real cwd to `.cwd` in
// UTF-8. Read it defensively — a regular file within a sane size, absolute once a trailing newline is
// dropped — else make no claim. This reads a layout grok owns, so any surprise yields undefined, never
// a wrong directory. A path cannot contain a newline, so stripping trailing ones is loss-free.
const DOT_CWD_MAX_BYTES = 8192;
function readLongNameCwdFile(path: string): string | undefined {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > DOT_CWD_MAX_BYTES) return undefined;
    const cwd = readFileSync(path, 'utf8').replace(/[\r\n]+$/, '');
    return win32.isAbsolute(cwd) ? cwd : undefined;
  } catch {
    return undefined;
  }
}

// `baseDir` is the folder grok runs in: a relative GROK_HOME — sessions included — resolves there
// (A35, measured on 1.0.41). Without it the old behaviour stands.
export function defaultSessionsIndex(env: NodeJS.ProcessEnv = process.env, baseDir?: string): SessionsIndex {
  const root = join(baseDir === undefined ? grokHome(env) : grokHomeFor(env, baseDir), 'sessions');
  return {
    listSessionDirs: () => {
      try { return readdirSync(root); } catch { return []; }
    },
    sessionDirHasId: (dir, id) => {
      try { return existsSync(join(root, dir, id)); } catch { return false; }
    },
    sessionFolder: (dir, id) => join(root, dir, id),
    readLongNameCwd: (dir) => readLongNameCwdFile(join(root, dir, '.cwd')),
  };
}

/** The raw (still encoded) name of the directory holding a session, or undefined. */
function findSessionDir(sessionId: string | undefined, index: SessionsIndex): string | undefined {
  if (!sessionId) return undefined;
  return index.listSessionDirs().find((dir) => index.sessionDirHasId(dir, sessionId));
}

/** The directory a session belongs to, or undefined when it cannot be established. */
export function resolveSessionCwd(sessionId: string | undefined, index: SessionsIndex): string | undefined {
  const dir = findSessionDir(sessionId, index);
  if (dir === undefined) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(dir); } catch { return undefined; }
  // A normal session dir name is encodeURIComponent(cwd), so the decode IS the cwd. A69 (contract
  // §12): once that encoding tops 255 bytes grok names the dir `<slug>-<16hex>` and stores the cwd in
  // `<dir>/.cwd` instead. The slug-hash is not a path, so the decode is not absolute — then read
  // `.cwd`; a missing/unreadable/non-absolute one makes no claim, never the slug (which v0.2.45
  // reported as the cwd, falsely saying grok worked there). The test is `win32.isAbsolute` because its
  // rule is a superset of posix's (a leading `/` counts too), so a real cwd of either flavour is taken
  // as a cwd on either host, while the slug — absolute on neither — still falls through to `.cwd`.
  if (win32.isAbsolute(decoded)) return decoded;
  return index.readLongNameCwd?.(dir);
}

/**
 * Same directory, however it was spelled. The request goes out with forward slashes and grok
 * stores backslashes, so a raw string compare would call every Windows resume a relocation.
 */
export function sameDirectory(a: string, b: string): boolean {
  return normalizeCwd(a) === normalizeCwd(b);
}
export function billingFor(mode: AuthMode): Billing {
  return mode === 'api' ? 'metered_api' : 'subscription';
}

/**
 * Caps for the subprocess output defaultSpawn accumulates in memory. It buffers the whole
 * stream, so an unbounded run (a huge `grok export`, a `--debug` flood through grok_cli) grows
 * the MCP server heap until V8 throws inside the 'data' handler and takes the server with it.
 * The execFileAsync siblings in this file and in worktree.ts already bound themselves at 16MB;
 * these match that convention.
 */
export const STDOUT_CAP_BYTES = 16 * 1024 * 1024;
// Only the last 500-1000 chars of stderr are ever surfaced (rawStderrTail), so 1MB is generous.
export const STDERR_CAP_BYTES = 1024 * 1024;

/**
 * Append `chunk` to `buf` without letting it pass `limit`.
 * `head` keeps the earliest bytes — stdout carries the result JSON, and a small valid object
 * must survive intact no matter what follows it.
 * `tail` keeps the latest bytes — only the end of stderr is ever read.
 */
export function appendBounded(
  buf: string,
  chunk: string,
  limit: number,
  keep: 'head' | 'tail',
): string {
  if (!chunk) return buf;
  if (keep === 'tail') {
    const joined = buf + chunk;
    return joined.length > limit ? joined.slice(-limit) : joined;
  }
  if (buf.length >= limit) return buf;
  const room = limit - buf.length;
  return buf + (chunk.length > room ? chunk.slice(0, room) : chunk);
}
/** A46: the longest delay a Node timer holds — beyond it the delay silently becomes 1 ms. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * A41: once grok itself has EXITED, how long its descendants may keep our pipes open. The call used
 * to settle on 'close' — every holder of grok's stdout/stderr gone — so a grandchild grok left behind
 * held a 2 s cap open for 8.1 s (measured) and turned a clean exit into `timedOut`; on win32, where the
 * cap kills grok alone, for as long as the grandchild lived. Output grok wrote before exiting is
 * already in the pipe and is read during this grace.
 */
export const EXIT_GRACE_MS = 2_000;

/** What a bounded run watches besides its own pipes (A68). */
export interface SpawnWatch {
  /** grok's log file — when a line in it says THIS grok began an interactive sign-in, the run is stopped there. */
  signInLog?: string;
  /** How often that file is read (tests pass a short one). */
  pollMs?: number;
}

/** The bounded subprocess runner behind `defaultSpawn`; the command is a parameter so tests can run it. */
export function spawnBounded(
  command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
  graceMs: number = EXIT_GRACE_MS, watch: SpawnWatch = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    // A68: the watch takes the log's size BEFORE the spawn, so the line grok writes cannot be behind its starting point.
    let signInStarted = false;
    let onSignIn = () => {};
    const signIn = watch.signInLog
      ? startSignInWatch(watch.signInLog, () => child?.pid, () => onSignIn(), watch.pollMs)
      : undefined;
    // detached (POSIX) makes grok a process-group leader so a timeout can kill its
    // whole subtree (git/LSP/sub-agents), not just the grok PID leaving orphans.
    // stdin is /dev/null on purpose: this wrapper is headless-only (prompts arrive as
    // --single=/--prompt-file argv), and a live stdin pipe turns any grok confirmation prompt into
    // a wait for input that nothing will ever write — measured on 1.0.5 and re-measured on
    // 1.0.13 (2026-09-03) under an isolated GROK_HOME: `memory clear` without -y sat on
    // "Are you sure? [y/N]" until the 10 s cap killed it, having cleared nothing. With stdin
    // at EOF the same run printed the prompt then "Cancelled." and exited 0 in ~1 s, leaving
    // the file in place — an unguarded prompt fails fast instead of hanging.
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd, env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      // A39: spawn THROWS, instead of emitting 'error', for ENAMETOOLONG / E2BIG and for a NUL in an
      // argument — measured: a 40,000-char prompt on win32 left the promise rejected past every
      // classification, and the caller got a bare "spawn ENAMETOOLONG" with no mode or billing.
      signIn?.stop();
      resolve({ code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e), timedOut: false, spawnError: true });
      return;
    }
    const { stdout: outPipe, stderr: errPipe } = child;
    if (!outPipe || !errPipe) {
      // Out of file descriptors (EMFILE) spawn neither throws nor starts: it returns a child with NO
      // pipes and emits 'error' on the next tick. Nothing may touch the pipes, and that 'error' needs a
      // listener — without one it ended the whole server (pre-merge review, measured under `ulimit -n`).
      let reason = 'grok could not be started: no stdio pipes';
      child.on('error', (err) => { reason = err.message; });
      signIn?.stop();
      setImmediate(() => resolve({ code: -1, stdout: '', stderr: reason, timedOut: false, spawnError: true }));
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let started = false;
    let settled = false;
    let exitCode: number | null | undefined;
    let grace: NodeJS.Timeout | undefined;
    // setEncoding routes chunks through a StringDecoder that buffers partial multi-byte
    // UTF-8 across 'data' events, so CJK/emoji spanning a chunk boundary is not garbled.
    outPipe.setEncoding('utf8');
    errPipe.setEncoding('utf8');
    // The child's own events report every outcome; a pipe's 'error' adds nothing but must be heard.
    // Measured (re-review, win32): with an existing cwd of 260+ characters the child emits ENOENT and its
    // pipes then emit ENOTCONN — unheard, that 'error' ended the whole MCP server.
    outPipe.on('error', () => { /* reported through the child */ });
    errPipe.on('error', () => { /* reported through the child */ });
    const killTree = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };
    const settle = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      signIn?.stop();
      resolve(signInStarted ? { ...result, signInStarted: true } : result);
    };
    // Once grok has exited — or the cap has fired — the call ends within `graceMs` whatever still holds
    // the pipes: descendants are taken down as the cap would have (POSIX; win32 reaches grok alone —
    // the documented limit), then reading stops. Started from the cap too, so a kill that FAILS (the
    // 'error' after start is ignored below) cannot leave the call waiting for an exit that never comes.
    const startGrace = (code: number | null) => {
      if (grace) return;
      grace = setTimeout(() => {
        // Stdout read to its end before now is whole, whatever still holds stderr (round 22: a grandchild holding
        // only stderr had a whole output marked cut short) — unless the cap killed grok, which `timedOut` says.
        const stdoutEnded = outPipe.readableEnded;
        killTree();
        outPipe.destroy();
        errPipe.destroy();
        // Otherwise what was read may end mid-text — a descendant can be printing when the grace runs out (v0.2.36
        // pre-merge review, round 21: grok_cli recorded 17 of 30 characters of a key as a run's summary).
        settle({ code: exitCode === undefined ? code : exitCode, stdout, stderr, timedOut, ...(stdoutEnded ? {} : { cutShort: true }) });
      }, graceMs);
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); startGrace(null); }, Math.min(timeoutMs, MAX_TIMEOUT_MS));
    // A68: stopped where the cap would stop it, without the cap's verdict — grok was not slow, it was waiting for a person.
    // The cap is cleared so `timedOut` keeps meaning "the cap fired". On win32 this ends grok alone (the documented limit
    // above): a browser grok opened stays, and if it holds the pipes the grace ends the read (measured: the throwaway-profile
    // Chrome grok 1.0.62 launched held them until it was closed).
    onSignIn = () => {
      if (settled || signInStarted) return;
      signInStarted = true;
      clearTimeout(timer);
      killTree();
      startGrace(null);
    };
    outPipe.on('data', (d) => { stdout = appendBounded(stdout, String(d), STDOUT_CAP_BYTES, 'head'); });
    errPipe.on('data', (d) => { stderr = appendBounded(stderr, String(d), STDERR_CAP_BYTES, 'tail'); });
    child.on('spawn', () => { started = true; });
    child.on('exit', (code) => {
      exitCode = code;
      clearTimeout(timer); // grok is gone: nothing left for the cap to kill, and it did not time out
      startGrace(code);
    });
    child.on('close', (code) => settle({ code: exitCode === undefined ? code : exitCode, stdout, stderr, timedOut }));
    child.on('error', (err) => {
      // 'error' also fires when a KILL fails; only a process that never started is a spawn error.
      if (started) return;
      settle({ code: -1, stdout, stderr: stderr || err.message, timedOut, spawnError: true });
    });
  });
}

export const defaultSpawn: SpawnFn = (args, cwd, env, timeoutMs) => spawnBounded('grok', args, cwd, env, timeoutMs,
  EXIT_GRACE_MS, { signInLog: signInLogOf(env, cwd) });

/**
 * A68: the log of the grok this spawn starts — its home asked for the spawn folder, as the rest of the wrapper asks
 * (A35·A36). Undefined when the home cannot be named; then nothing is watched and the run ends as it did before A68.
 */
function signInLogOf(env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  try { return signInLogForRun(env, cwd); } catch { return undefined; }
}

/**
 * Round 3: on Windows a start from a working folder of 259 or more characters fails, and Node reports it as
 * `spawn grok ENOENT` — "not found": grok_cli said to check the install or PATH, and delegate passed on the
 * bare `spawn grok ENOENT`. Measured with node itself, spawnBounded and spawnSync alike: 258 characters
 * start, 259 do not. From 260 the pipes also emitted ENOTCONN, which ended the server until round 2 heard it.
 */
export const WIN32_CWD_MAX = 258;
// A plain UNC folder (`\\server\share\…`) fails from 259 like a drive path. An extended-length `\\?\` folder
// fails at exactly 259 characters, prefix counted, and from 260 when its 8.3 short form is 259 or more — so on a
// volume without short names, from 259 like a drive path (round 6, every length from 250 to 272 probed three times
// on two volumes; round 4's samples — 254, 260–265 and 274 — all started on C:, a volume with short names, and never
// tried 259, and round 5's "never under 259 without the prefix" was one folder shape whose short name happened to
// save the prefix's four characters). Node cannot read the short form, so from 259 a `\\?\` folder gets a hint
// that names both causes.
const EXTENDED_PATH = '\\\\?\\';

/**
 * The code of a start that failed, read from Node's fixed wording: `spawn <file> <CODE>` when the failure comes as
 * an 'error' event (ENOENT, EACCES, EAGAIN, EMFILE, ENFILE), `spawn <CODE>` when spawn throws it (EPERM, EFTYPE,
 * UNKNOWN, ELOOP, ENAMETOOLONG, E2BIG, …). Anything else has no code, and its text is not searched for one: a NUL
 * in an argument is a TypeError that QUOTES the argument, and a prompt about "the ENOENT in loader.ts" from a long
 * folder got the long-folder hint (round 7; an argument holding "EACCES" read as the install in grok_cli).
 */
export function spawnErrorCode(stderr: string): string | undefined {
  return /^spawn (?:\S+ )?([A-Z][A-Z0-9]*)$/.exec(stderr.trim())?.[1];
}

export function longCwdHint(cwd: string, stderr: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32' || cwd.length <= WIN32_CWD_MAX || spawnErrorCode(stderr) !== 'ENOENT') return undefined;
  if (cwd.startsWith(EXTENDED_PATH)) {
    return `작업 폴더 경로가 ${cwd.length}자입니다 — Windows는 \\\\?\\ 경로도 ${WIN32_CWD_MAX + 1}자에서, 그보다 길면 짧은(8.3) `
      + `이름이 ${WIN32_CWD_MAX + 1}자 이상일 때 프로세스를 시작하지 못하고, 그 실패를 ENOENT로 알립니다. `
      + 'grok 설치/PATH가 맞다면 더 짧은 경로에서 실행하세요.';
  }
  return `작업 폴더 경로가 ${cwd.length}자입니다 — Windows는 ${WIN32_CWD_MAX + 1}자 이상인 작업 폴더에서 프로세스를 `
    + '시작하지 못하고, 그 실패를 ENOENT로 알립니다. 더 짧은 경로에서 실행하세요.';
}

function startFailureMessage(cwd: string, stderr: string): string {
  return `Grok Build 프로세스를 시작할 수 없습니다: ${longCwdHint(cwd, stderr) ?? stderr}`.trim();
}

// The parser lives in git-porcelain.ts (shared with worktree.ts); re-exported here because this
// module is where callers and tests have always found it.
export { parsePorcelain };

export const defaultGitChangedFiles: GitChangedFilesFn = async (cwd) => {
  try {
    // -uall, not git's default: without it an untracked DIRECTORY collapses to one `?? dir/`
    // entry, so every file grok creates inside a new directory is invisible here. Worse, once
    // that directory is in the before-snapshot too, before and after are byte-identical and the
    // diff reports nothing changed — and since this plugin never commits, the directory stays
    // untracked for every follow-up delegation into the same cwd.
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z', '-uall'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return parsePorcelain(stdout as string);
  } catch {
    return []; // not a git repo, git unavailable, timeout, or huge output
  }
};

/**
 * A42: how much of the untracked set one fingerprint reads. EVERY untracked file is `lstat`ed — its size
 * and mtime go into the hash — and the first UNTRACKED_HASH_MAX_FILES (in listing order) also have their
 * CONTENT read while the byte budget lasts. So a rewrite anywhere is seen through size or mtime; within
 * the first files and the budget it is seen even when size and mtime are put back. What is left unseen
 * (round 3 measured each): past the first files or the budget, a rewrite of the same size whose mtime was
 * restored (or fell in the same tick of a coarse clock); a write THROUGH an untracked symlink (the link is
 * hashed, not what it points at); an edit below the top of an untracked nested repo (git lists the repo,
 * not its files); on Linux, a name that is not UTF-8 (git's bytes are decoded, so the lstat misses).
 *
 * History: the unbounded read stat'ed and read every file one at a time — 20,000 of them (an unignored
 * node_modules) took 7.2–8.4 s per fingerprint, twice per plan run, outside timeout_ms. The first cap then
 * read NOTHING past the first files, and in that very layout every source file sorts after node_modules/:
 * a plan that edited an untracked src/feature.ts reported planWroteFiles:false (re-review). Stat-ing all
 * 20,000 costs about 0.15 s (measured on win32).
 */
export const UNTRACKED_HASH_MAX_FILES = 1_000;
const UNTRACKED_HASH_BUDGET_BYTES = 32 * 1024 * 1024;
const UNTRACKED_READ_BATCH = 32;

/**
 * A fingerprint of the working tree, used only to answer "did a read-only run write anything?".
 *
 * `diffChangedFiles` cannot answer that on its own: it is a set difference over PATHS, so a run
 * that edits a file which was ALREADY dirty produces before === after and reports nothing. That is
 * precisely the common case here — plan-before-delegate on work in progress — so the path list
 * would go quiet exactly when the answer matters most.
 *
 * Hashing the porcelain listing plus `git diff HEAD` covers both halves: the listing catches new
 * and deleted paths (including untracked, via -uall), the diff catches content changes to paths
 * that were already listed.
 *
 * A42: … except untracked ones — `git diff HEAD` never shows an untracked file, so a plan that
 * rewrote a file that was ALREADY untracked produced the same fingerprint (reproduced in review).
 * Their contents are hashed too. Porcelain paths are relative to the repository ROOT, not to `cwd`
 * (git documents this for --porcelain), hence --show-toplevel.
 *
 * Returns null when the cwd is not a git repo — then nothing can be verified, and callers must say
 * so rather than reporting a clean tree.
 */
export const defaultGitDirtyFingerprint = async (
  cwd: string, maxUntrackedFiles: number = UNTRACKED_HASH_MAX_FILES,
): Promise<string | null> => {
  try {
    const [status, diff, top] = await Promise.all([
      execFileAsync('git', ['-C', cwd, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z', '-uall'],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }),
      execFileAsync('git', ['-C', cwd, 'diff', 'HEAD'],
        { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }),
      execFileAsync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10_000 }),
    ]);
    // Only the line end comes off: a folder name may END in a space, and `.trim()` took it — every
    // stat then failed and both fingerprints hashed the same `(unreadable)` (pre-merge review, Linux).
    const root = (top.stdout as string).replace(/\r?\n$/, '');
    return createHash('sha256')
      .update(status.stdout as string)
      .update('|separator|')
      .update(diff.stdout as string)
      .update('|separator|')
      .update(await untrackedState(root, status.stdout as string, maxUntrackedFiles))
      .digest('hex');
  } catch {
    return null; // not a git repo, no HEAD yet, git unavailable, timeout, huge output, or any other git error
  }
};

async function untrackedState(root: string, statusZ: string, maxFiles: number): Promise<string> {
  const hash = createHash('sha256');
  let budget = UNTRACKED_HASH_BUDGET_BYTES;
  const paths = untrackedPaths(statusZ);
  for (let i = 0; i < paths.length; i += UNTRACKED_READ_BATCH) {
    const batch = paths.slice(i, i + UNTRACKED_READ_BATCH);
    // lstat, not stat: a symlink is hashed by its target text (as git keeps it), never read through.
    // Through `/proc/self/pagemap` stat said "regular file, size 0" and the read never ended — 10 GiB in
    // 30 s on Linux (re-review).
    const stats = await Promise.all(batch.map((rel) => lstat(join(root, rel)).catch(() => null)));
    // The budget is spent in listing order, so the same tree always reads the same files.
    const bodies = await Promise.all(batch.map((rel, k): Promise<Buffer | string | null> | null => {
      const st = stats[k];
      if (!st) return null;
      if (st.isSymbolicLink()) return readlink(join(root, rel)).catch(() => null);
      if (i + k >= maxFiles || !st.isFile() || st.size > budget) return null;
      budget -= st.size;
      return readExactly(join(root, rel), st.size);
    }));
    batch.forEach((rel, k) => {
      const st = stats[k];
      const body = bodies[k];
      hash.update(rel).update('\0');
      if (st) hash.update(`${st.size}:${st.mtimeMs}`);
      else hash.update('(unreadable)'); // vanished or locked: still a stable, comparable token
      if (body !== null) hash.update('\0').update(body);
      hash.update('\0');
    });
  }
  return hash.digest('hex');
}

// The path was lstat'ed as a regular file, but it can change before the open. Swapped for a FIFO, a
// blocking open waited for a writer — 28 s and counting on Linux, outside timeout_ms, and the process then
// ignored process.exit (round 3). So: open without blocking and without following a link, then read only
// what is still a regular file. win32 has neither flag (and no such swap); `?? 0` leaves them out there.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/** The first `size` bytes — what stat said. `readFile` reads to the end, and a file may lie about it. */
export async function readExactly(path: string, size: number): Promise<Buffer | null> {
  try {
    const fh = await open(path, READ_FLAGS);
    try {
      if (!(await fh.stat()).isFile()) return null;
      const buf = Buffer.alloc(size);
      let got = 0;
      while (got < size) {
        const { bytesRead } = await fh.read(buf, got, size - got, got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      return buf.subarray(0, got);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * A32: the commit id, so a delegation that committed can be NAMED rather than inferred.
 *
 * `filesChanged` cannot see a commit — it is a porcelain set difference, and committing cleans
 * the tree, so a run that edited a tracked file and then committed it reports an empty list
 * (MEASURED 2026-09-22: grok committed `f.txt` and porcelain no longer listed it). HEAD is the
 * one thing a commit cannot move without changing.
 *
 * Returns null outside a git repo or before the first commit — then nothing can be verified, and
 * the caller must say "unknown" rather than "did not commit".
 *
 * WHAT `committed: false` DOES NOT PROMISE (found by Grok reviewing this detector, 2026-09-22).
 * Only this directory's own HEAD is read, so these leave it unmoved and report false:
 *   - a commit on another ref (side branch, `git commit-tree`, `git stash`)
 *   - a commit followed by `git reset`/checkout back to the pre-run id
 *   - a commit inside a nested repository or submodule under this cwd
 * `git stash` is the one of these an ordinary, non-evasive agent might actually reach for, and it
 * also empties the porcelain listing, so `filesChanged` goes quiet with it. Left uncovered on
 * purpose: the threat here is an over-eager worker committing its own work on the branch it was
 * given, which HEAD does catch. Widening this to every ref would cost a `for-each-ref` scan on
 * every delegation to defend against evasion that is not the failure mode being guarded.
 */
export const defaultGitHead: GitHeadFn = async (cwd) => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
    const head = (stdout as string).trim();
    return head.length > 0 ? head : null;
  } catch {
    return null; // not a git repo, no commits yet, git unavailable, or timeout
  }
};

export const defaultDirExists: DirExistsFn = (cwd) => {
  try { return statSync(cwd).isDirectory(); } catch { return false; }
};

interface ClassifyCtx {
  mode: AuthMode;
  billing: Billing;
  timeoutMs: number;
  filesChanged: string[];
  worktreePath?: string;
  planWroteFiles?: boolean;
  committed?: boolean;
  /** Each folder whose HEAD moved, and from what — the commit notice names them (A49 round 2). */
  moved: MovedHead[];
  /** B1: the id this wrapper minted, used when grok never printed one (timeout, parse failure). */
  mintedSessionId?: string;
}

// Safe tokens for opt-in CLI flags (model / effort / session id / sandbox profile).
// Hyphen allowed (built-in sandbox profile `read-only`). Reject shell-ish chars.
// Length cap avoids pathological argv. Exported for unit tests.
export const SAFE_CLI_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._@+/-]{0,127}$/;
// `BEST_OF_N_MIN`/`MAX` lived here until 2026-09-22. They were the 0.2.x range check for
// `--best-of-n`, which CLI 1.0 removed (2026-08-14). Since then `validateDelegateOptions` rejects
// ANY `bestOfN` outright, so the bounds were read by nothing: measured, two occurrences in the
// whole repo — their own declarations — and zero in the shipped bundle, esbuild having dropped
// them. They are named here only so the next reader does not reintroduce a range check for a flag
// that no longer exists.

/**
 * A32: appended to EVERY run, because the no-auto-commit invariant applied to none of them.
 *
 * The only anti-commit sentence this file had lived in VERIFY_PROMPT_SUFFIX, which is sent only
 * when `input.check` is set — and `check` is not even an input on `grok_build_delegate`, so no
 * caller could reach it. MEASURED 2026-09-22: asked to commit, grok 1.0.30 committed. Given this
 * suffix and the same prompt, it made the edit and refused the commit.
 *
 * Deliberately NOT `--rules` (1.0.30, measured working): a suffix cannot break any CLI version.
 * (`--rules` is in 1.0.13's `--help` too — re-checked 2026-10-04; the 2026-09-22 note that the
 * 1.0.13 snapshot lacked it was wrong.)
 *
 * Instruction is persuasion. `committed` (git HEAD before/after) is the part that verifies.
 *
 * FOUND BY GROK reviewing the first version of this constant: it also said "do NOT stage changes",
 * which refuses a task that legitimately asks only to stage. Staging protects nothing here —
 * MEASURED 2026-09-22: a staged edit still appears in `git status --porcelain -uall` (as `M ` in
 * the index column, which is what `filesChanged` reads) and HEAD does not move, so the diff-review
 * gate is fully intact. The invariant is about COMMITS. Widening it past what it protects just
 * makes the wrapper refuse work the user asked for.
 */
export const NO_COMMIT_PROMPT_SUFFIX = [
  '',
  '---',
  'Constraint for this run: do NOT create a git commit. Leave your work uncommitted so a human can',
  'review the diff first. If the task asked for a commit, make the edit and say that committing is',
  'not permitted here. Staging is fine.',
].join('\n');

/**
 * A50: passed right after `--permission-mode plan`, and only there.
 *
 * `--permission-mode plan` is not a write barrier. Headless grok runs every tool call the user's own
 * allow rules approve — grok's `[permission] allow`, remembered approvals, and Claude Code's
 * `~/.claude/settings.json` — and cancels only the rest. MEASURED 2026-09-30 (grok 1.0.41/1.0.44) and
 * again 2026-10-04 through the shipped v0.2.38 bundle on 1.0.44 and 1.0.46, with a mock model forcing
 * the calls: a plan run pushed to a remote, called `gh api` and an MCP tool, and still returned
 * `completed` with `planWroteFiles: false` and `committed: false` — none of those effects is visible to
 * the tree checks. These four rules closed every measured path (contract §1, §6) — except
 * `scheduler_create` and `workflow` on grok 1.0.13/1.0.30, below.
 *
 * The cost, accepted by the owner on 2026-10-04: a plan cannot run read-only shell commands such as
 * `git status` either. Reading files still works. `web_fetch`, `web_search`, image and video generation
 * and `send_feedback` were not measured. Scheduled and background tools were (2026-10-04/05):
 * 1.0.44/1.0.46 refuse `scheduler_create` and `workflow` ("deny rule on edit"), but on 1.0.13/1.0.30
 * these rules do not cover them, and a task a plan scheduled there ran when an approving run resumed the
 * session (contract §6, docs/10 A60 — closing it is the owner's call).
 *
 * Rule names are case-sensitive and grok drops an unknown one without a word (`bash`, `Bsh` —
 * contract §1), so the spelling is pinned by a test against literals. `--deny` is in `grok --help`
 * from 1.0.13 (the oldest version this wrapper still supports, measured 2026-10-04) through 1.0.46,
 * so it cannot make a plan exit 2 the way an unknown flag would. `planWroteFiles` and `committed`
 * stay: they are facts about the run, whatever the current grok does with these rules.
 */
export const PLAN_DENY_ARGS: readonly string[] = ['--deny', 'Bash', '--deny', 'Edit', '--deny', 'Write', '--deny', 'MCPTool(*)'];

/** Appended when `input.check` is set. CLI 1.0 removed `--check` (2026-08-14). */
export const VERIFY_PROMPT_SUFFIX = [
  '',
  '---',
  'After you finish the task, verify your own work before ending the turn:',
  '1. Re-read every file you changed.',
  '2. Run the project\'s relevant tests or typecheck if they exist and are cheap; if none, say so.',
  '3. In your final reply, include a short Verification checklist (item / pass|fail / note) and any remaining risks.',
  'Do not commit. Do not start unrelated work.',
].join('\n');

/** Measured 2026-08-14: `grok models` lists grok-4.6 / grok-4.5. `grok-build` is unknown. */
export const RETIRED_MODEL_ALIASES: Readonly<Record<string, null>> = {
  'grok-build': null,
};

/**
 * Built-in grok `--sandbox` profiles (measured from grok user-guide 18-sandbox.md,
 * 2026-07-25). Custom names from ~/.grok/sandbox.toml are still allowed if they
 * match SAFE_CLI_TOKEN. Enforcement is Linux Landlock / macOS Seatbelt; on Windows
 * the flag may be accepted without kernel enforcement (headless `--sandbox workspace`
 * returned EndTurn on Win32NT 2026-07-25).
 */
export const KNOWN_SANDBOX_PROFILES = [
  'off',
  'workspace',
  'devbox',
  'read-only',
  'strict',
] as const;

/** Paths that appear in `after` but not in `before` (set difference). */
export function diffChangedFiles(before: string[], after: string[]): string[] {
  if (before.length === 0) return after.slice();
  const prior = new Set(before);
  return after.filter((p) => !prior.has(p));
}

export type ValidateDelegateOptionsResult =
  | { ok: true; extraArgs: string[] }
  | { ok: false; message: string };

/**
 * Validate opt-in CLI strength fields and build extra argv. Fail closed (no spawn) on bad input.
 * Does not include base flags (--no-auto-update, -p, etc.).
 */
export function validateDelegateOptions(input: DelegateInput): ValidateDelegateOptionsResult {
  const extraArgs: string[] = [];

  if (input.model !== undefined) {
    if (typeof input.model !== 'string' || !SAFE_CLI_TOKEN.test(input.model)) {
      return { ok: false, message: 'model 값이 올바르지 않습니다 (영숫자·._@+/- 및 하이픈, 1–128자).' };
    }
    // Object.hasOwn, not `in`: `in` walks the prototype chain, so a model literally named
    // "toString"/"constructor"/… matched and silently dropped --model.
    if (!Object.hasOwn(RETIRED_MODEL_ALIASES, input.model)) {
      extraArgs.push('--model', input.model);
    }
  }
  if (input.effort !== undefined) {
    if (typeof input.effort !== 'string' || !SAFE_CLI_TOKEN.test(input.effort)) {
      return { ok: false, message: 'effort 값이 올바르지 않습니다 (영숫자·._@+/- 및 하이픈, 1–128자).' };
    }
    extraArgs.push('--effort', input.effort);
  }
  // B2: a work budget, as opposed to `timeout_ms`, which is a wall clock enforced by SIGKILL.
  // MEASURED 2026-09-22 on 1.0.30: `--max-turns 1` on a three-file task wrote the first file and
  // stopped — exit 1, stopReason `cancelled`, stderr "Error: max turns reached". That classifies
  // as grok_error here, with the partial edits still reported in filesChanged, which is the
  // honest shape: the run did not finish and the caller can see exactly how far it got.
  if (input.maxTurns !== undefined) {
    if (typeof input.maxTurns !== 'number' || !Number.isInteger(input.maxTurns) || input.maxTurns < 1) {
      return { ok: false, message: 'max_turns 는 1 이상의 정수여야 합니다.' };
    }
    extraArgs.push('--max-turns', String(input.maxTurns));
  }
  // ⚠️ LOAD-BEARING FOR `.claude/tools/accept-release.mjs`, which ships to every user.
  //
  // That tool promises "spawns no grok process and spends no subscription quota", and it keeps the
  // promise by sending `best_of_n: 2` on its delegate/plan/verify probes. `best_of_n` is a DECLARED
  // input (server.ts strengthFields), so it passes the tool schema and is stopped HERE — measured
  // 2026-09-23 through the shipped bundle, which returned this branch's message. Soften this to a
  // warning, or drop it as dead 1.0-compat code, and every release acceptance run starts making
  // three real billed delegations.
  //
  // The two files never import each other, so the link is a test:
  // delegate.test.ts "the acceptance tool still relies on this rejection to stay quota-free"
  // reads the probe payloads out of that tool, so changing them there fails here.
  if (input.bestOfN !== undefined) {
    return {
      ok: false,
      message:
        'best_of_n 은 Grok Build CLI 1.0에서 제거되었습니다 (--best-of-n 없음). ' +
        '한 번 위임하거나 Grok 내부 subagent에 맡기세요.',
    };
  }
  if (input.resumeSessionId !== undefined && input.continueSession) {
    return { ok: false, message: 'resume 과 continue 는 동시에 쓸 수 없습니다.' };
  }
  if (input.resumeSessionId !== undefined) {
    if (typeof input.resumeSessionId !== 'string' || !SAFE_CLI_TOKEN.test(input.resumeSessionId)) {
      return { ok: false, message: 'resume 세션 ID가 올바르지 않습니다.' };
    }
    extraArgs.push('--resume', input.resumeSessionId);
  }
  if (input.continueSession) {
    extraArgs.push('--continue');
  }
  if (input.sandbox !== undefined) {
    if (typeof input.sandbox !== 'string' || !SAFE_CLI_TOKEN.test(input.sandbox)) {
      return {
        ok: false,
        message:
          `sandbox 프로필 이름이 올바르지 않습니다. 내장: ${KNOWN_SANDBOX_PROFILES.join(', ')} ` +
          '(또는 sandbox.toml 커스텀 이름; 영숫자·._@+/-·하이픈).',
      };
    }
  }

  return { ok: true, extraArgs };
}

function withSession(result: DelegateResult, sessionId?: string): DelegateResult {
  if (sessionId) result.sessionId = sessionId;
  return result;
}

/**
 * B3: carry the run's own accounting onto the result.
 *
 * Applied to every branch that managed to PARSE an envelope, not just the successful one — a run
 * that ended `cancelled` (a --max-turns cap, a plan refusal) still spent those tokens, and a
 * caller deciding whether to retry needs to know what the attempt cost in turns.
 */
function withUsage(result: DelegateResult, parsed: GrokResult): DelegateResult {
  if (parsed.tokens) result.tokens = parsed.tokens;
  if (parsed.turns !== undefined) result.turns = parsed.turns;
  if (parsed.model) result.model = parsed.model;
  return result;
}

/**
 * The human half of a plan result — `planWroteFiles`/`committed` are the machine half. A commit
 * comes first: its edits are gone from the working tree, so pointing at `git status`/`git diff` (the
 * dirty-tree message) would send the reader to look where nothing is.
 */
function planMessage(
  planWroteFiles: boolean | undefined, committed: boolean | undefined, moved: MovedHead[], worktreePath: string | undefined,
): { message?: string } {
  if (committed === true) return { message: commitNotice(moved, worktreePath, true) };
  if (planWroteFiles === true) return { message: PLAN_WROTE_MESSAGE };
  if (planWroteFiles === undefined) {
    // A49 round 2: "the cwd is not a git repo" was the only reason given, and after A49 it was often false — the folder
    // left unread can be the one a resume ran in, or the requested cwd may be a repo that grok never worked in. Round 2
    // of the pre-merge review: the fingerprint is also null when git times out or its output is too large, while HEAD
    // still reads (`committed: false` beside "not a repo") — so the causes are possibilities, never an assertion. Round 3:
    // any git error does it too (measured: a missing blob), which the list left out — "git failed" covers them all.
    return {
      message:
        'plan 실행 중 파일이 변경됐는지 확인할 수 없었습니다 (grok이 일했을 수 있는 폴더의 작업 트리를 읽지 못했습니다 — '
        + 'git 저장소가 아니거나, 커밋이 없거나, git이 실패했거나(오류·출력 한도) 제시간에 답하지 못했을 수 있습니다). '
        + 'plan 모드가 쓰기를 막아준다고 가정하지 말고 직접 확인하세요.',
    };
  }
  return {};
}

const PLAN_WROTE_MESSAGE =
  '⚠️ plan은 읽기 전용이어야 하지만 작업 트리가 변경됐습니다. '
  + '커밋 전에 `git status`/`git diff`로 직접 확인하세요. 격리가 필요하면 '
  + '`grok_build_delegate`를 `worktree: true`로 쓰세요.';

/**
 * The session id comes back only when this wrapper minted it (a fresh run — B1); a timed-out resume/continue printed
 * none, and the sentence used to promise one anyway (v0.2.37 pre-merge review).
 */
function timeoutMessage(timeoutMs: number, mintedSessionId: string | undefined): string {
  const base = `Grok Build 작업이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다. 범위를 줄이거나 timeout_ms를 늘려 다시 시도하세요.`;
  return mintedSessionId ? `${base} 이 실행의 세션 id가 sessionId로 함께 반환되므로, \`/grok:resume\`으로 이어갈 수 있습니다.` : base;
}

/** A folder whose HEAD moved across the run, and the commit it moved from. */
interface MovedHead { dir: string; before: string }

/**
 * A32: what a run that moved HEAD tells the caller. A49 round 2 (pre-merge review, three reviewers): it used to say
 * `git show HEAD` and `git reset --soft HEAD~1` with no folder — for a worktree run, or a resume that worked in its
 * session's folder, run in the project those commands show and UNDO THE USER'S OWN COMMIT; and HEAD~1 undoes one commit
 * of however many grok made. So it names each folder whose HEAD moved and the commit it moved from, and says that a
 * worktree's commit is on its branch, where `grok_build_worktree` diff/apply (uncommitted changes only) do not see it.
 */
function commitNotice(moved: MovedHead[], worktreePath: string | undefined, plan: boolean): string {
  const lead = plan
    ? '⚠️ plan은 읽기 전용이어야 하지만 이 실행이 git 커밋을 만들었습니다(또는 HEAD를 다른 커밋으로 옮겼습니다). '
    : '⚠️ 이 위임이 git 커밋을 만들었습니다(또는 HEAD를 다른 커밋으로 옮겼습니다). ';
  const folders = moved.map(({ dir, before }) => {
    const inWorktree = worktreePath !== undefined && sameDirectory(dir, worktreePath)
      ? ' 이 폴더는 격리 worktree라 커밋은 그 브랜치에 있고, `grok_build_worktree` diff/apply는 커밋된 내용을 가져오지 않습니다.'
      : '';
    const undo = '(브랜치가 바뀌었다면 reset 대신 원래 브랜치로 checkout).';
    const quoted = shellDir(dir);
    // No inline command for a folder no quoting survives in both shells — it is named, and the commands are to be run
    // inside it (see shellDir).
    const how = quoted
      ? `\`git -C ${quoted} log --stat ${before}..HEAD\`로 확인하고, 의도한 커밋이 아니라면 \`git -C ${quoted} reset --soft ${before}\`로 `
        + `되돌리세요${undo}`
      : `그 폴더 안에서 \`git log --stat ${before}..HEAD\`로 확인하고, 의도한 커밋이 아니라면 그 폴더 안에서 \`git reset --soft ${before}\`로 `
        + `되돌리세요${undo} (폴더 이름에 따옴표나 제어 문자가 있어 명령에 폴더를 넣지 않았습니다.)`;
    return `${dir}의 HEAD가 ${before.slice(0, 12)}에서 움직였습니다 — ${how}${inWorktree}`;
  });
  return `${lead}이 래퍼는 자동 커밋을 하지 않으며, 커밋된 파일은 작업 트리에서 사라져 filesChanged가 과소보고합니다. `
    + folders.join(' ');
}

/**
 * v0.2.37 pre-merge review, round 2: a folder as it goes into a command the reader will paste — or undefined when no
 * form is read literally by both shells a Claude Code user pastes into (Git Bash and PowerShell). MEASURED on a4005a3
 * with the notice's own text in both: inside DOUBLE quotes `a$b` became `a` (and `reset --soft` undid the user's commit
 * in a clone at `a`), `$(…)` ran, a backtick became an escape, and a trailing backslash left the quote open (bash) or,
 * with a space in the path, folded the rest of the command into -C (PowerShell 5.1 re-quoting a native argument).
 * Single quotes are literal in both. On win32 the path goes out with forward slashes, which git accepts, so no
 * backslash is left to meet a quote; a POSIX backslash is an ordinary name character and is kept.
 *
 * A single quote itself has no quoting that works in both (bash has no escape inside '…', PowerShell doubles it), and
 * PowerShell also ends a single-quoted string on the typographic quotes U+2018..U+201B; a control character breaks the
 * line the command is shown on. cmd.exe is not served — it has no single quotes, and Claude Code runs Bash or PowerShell.
 *
 * Round 3: a rooted win32 path with no drive (`\Users\…`, which `isAbsolute` accepts) went out as `/Users/…`, and Git
 * Bash's path conversion rewrote that to `C:/Program Files/Git/Users/…` (measured: exit 128, HEAD untouched). It now
 * gets the root it was resolved against — the server cwd's drive, or its share when that cwd is UNC — as `dirExists`
 * and the spawn resolved it. UNC (`\\…`) keeps its two leading slashes, which Git Bash leaves alone.
 */
export function shellDir(dir: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const rooted = platform === 'win32' && /^[\\/](?![\\/])/.test(dir) ? win32.resolve(dir) : dir;
  const path = platform === 'win32' ? rooted.split('\\').join('/') : dir;
  for (const ch of path) {
    const c = ch.codePointAt(0)!;
    if (ch === "'" || (c >= 0x2018 && c <= 0x201b) || c < 0x20 || c === 0x7f) return undefined;
  }
  return `'${path}'`;
}

// Turns a completed (non-spawn-error) grok spawn result into a DelegateResult:
// timeout → parse (auth_error/grok_error) → plan-success → EndTurn success/failure.
function classifySpawnResult(r: SpawnResult, input: DelegateInput, ctx: ClassifyCtx): DelegateResult {
  const {
    mode, billing, timeoutMs, filesChanged, worktreePath, planWroteFiles, committed, mintedSessionId,
  } = ctx;

  // B1: a killed or unparseable run printed no envelope, so `sid` below never exists for it.
  // The minted id is the only handle those branches can offer — and they are precisely the
  // expensive ones (82 of the owner's 845 recorded delegations timed out with nothing to resume).
  const handle = (res: DelegateResult): DelegateResult => {
    if (!res.sessionId && mintedSessionId) res.sessionId = mintedSessionId;
    return res;
  };

  // A68: grok began an interactive sign-in and was stopped there (sign-in-watch.ts) — ahead of the cap, which may also
  // have been reported. No session id: grok had started no session (measured, 1.0.70: no session folder), so offering
  // the minted one for resume would be A53's defect.
  if (r.signInStarted) {
    return {
      status: 'auth_error', mode, billing, message: signInStartedMessage(mode),
      ...(r.stderr ? { rawStderrTail: r.stderr.slice(-500) } : {}), filesChanged, worktreePath,
    };
  }

  if (r.timedOut) {
    // Device-OAuth block → timeout (2026-07-13). stderr-only device markers — never stdout.
    if (isTimedOutDeviceAuth(r.stderr)) {
      return handle({
        status: 'auth_error', mode, billing,
        message: authNeededMessage(mode, { timedOutDeviceFlow: true }),
        rawStderrTail: (r.stderr || '').slice(-500), filesChanged, worktreePath,
      });
    }
    return handle({
      status: 'timeout', mode, billing,
      message: timeoutMessage(timeoutMs, mintedSessionId),
      filesChanged, worktreePath,
    });
  }

  let parsed;
  try {
    parsed = parseGrokResult(r.stdout);
  } catch {
    const tail = (r.stderr || r.stdout).slice(-500);
    if (looksLikeAuthFailure(r.stderr, r.stdout)) {
      return handle({
        status: 'auth_error', mode, billing, message: authNeededMessage(mode),
        rawStderrTail: tail, filesChanged, worktreePath,
      });
    }
    // A33: auth is checked first on purpose — a 401 means the run REACHED the model layer, so
    // whatever the sandbox did, it is not what stopped it.
    if (looksLikeSandboxRefusal(r.stderr)) {
      return handle({
        status: 'grok_error', mode, billing, message: sandboxRefusalMessage(),
        rawStderrTail: tail, filesChanged, worktreePath,
      });
    }
    // A33: the old text here named a cause this branch never established. All the code knows is
    // that the run ended without a result envelope — stdout may have been malformed, or (far
    // more often, measured) empty because grok died before producing one. Point at the evidence
    // instead of inventing an explanation for it.
    return handle({
      status: 'grok_error', mode, billing,
      message: 'Grok Build가 결과를 반환하지 않았습니다 (출력에 결과 envelope이 없음). 실제 사유는 rawStderrTail을 확인하세요.',
      rawStderrTail: tail, filesChanged, worktreePath,
    });
  }

  const sid = parsed.sessionId;

  // B3: every branch below has a PARSED envelope, so every one of them can report what the run
  // spent. `finish` exists so a future branch cannot be added that quietly drops it — the old
  // shape (`withSession({...}, sid)` at each site) is exactly how `sessionId` came to be missing
  // from the pre-parse branches.
  const finish = (res: DelegateResult) => handle(withUsage(withSession(res, sid), parsed));

  // Auth on the measured error envelope only — never scan successful assistant text.
  // A completed/plan summary can mention `grok login` (docs, comments) without being unauth.
  if (parsed.isError && looksLikeAuthFailure(r.stderr, r.stdout, parsed.text)) {
    return finish({
      status: 'auth_error', mode, billing,
      message: authNeededMessage(mode),
      rawStderrTail: (r.stderr || '').slice(-500) || undefined,
      filesChanged, worktreePath,
    });
  }

  // Other CLI error envelopes (not auth) — never treat as a successful plan/delegate.
  if (parsed.isError) {
    return finish({
      status: 'grok_error', mode, billing,
      message: (parsed.text || 'Grok Build가 오류로 종료했습니다.').trim(),
      rawStderrTail: (r.stderr || '').slice(-500) || undefined,
      filesChanged, worktreePath,
    });
  }

  // Plan mode: 1.0.3 ends `end_turn` + text and does not edit; 0.2.x used `Cancelled` + text.
  // Any parsed result WITH text is a successful plan (not an error). A42: both returns go through
  // `finish` — they used withSession, so a plan never reported what it spent (B3) and a plan whose
  // envelope named no session lost the id it was started under (B1).
  if (input.plan) {
    const planText = (parsed.text ?? '').trim();
    if (!planText) {
      return finish({
        status: 'grok_error', mode, billing, message: 'Grok Build가 계획을 반환하지 않았습니다.', filesChanged, worktreePath,
      });
    }
    // A plan that edited the tree is still a plan the caller asked for, so the status stays
    // `completed` — but it must never look clean. `planWroteFiles` is the machine signal and the
    // message is the human one, because a caller reading only `status` would otherwise proceed to
    // delegate on top of writes it does not know happened.
    //
    // C1: these two messages used to ASSERT that grok 1.0.13 ignores `--permission-mode plan`.
    // That was measured then; on 1.0.30 (re-measured 2026-09-22) plan refused the write (no file
    // created, stopReason `cancelled`), and whether the version or the allow rules of the day made
    // that difference can no longer be told — allow rules approved writes under plan on 1.0.41/1.0.44
    // too (contract §6). Since A50 a plan also carries PLAN_DENY_ARGS, which closed every measured path
    // but `scheduler_create` and `workflow` on grok 1.0.13/1.0.30 (docs/10 A60);
    // the check stays exactly as it is anyway, and only the blame was removed. A
    // user-facing string must not pin a version claim about a CLI that updates itself, because
    // `planWroteFiles === true` is a fact about THIS run whatever the current grok does with the flag.
    return finish({
      status: 'completed', mode, billing, summary: parsed.text, filesChanged, worktreePath,
      planWroteFiles,
      ...(committed === undefined ? {} : { committed }),
      ...planMessage(planWroteFiles, committed, ctx.moved, worktreePath),
    });
  }

  // Exit code is 0 even on cancel — success is decided by stopReason
  // (1.0 `end_turn` or legacy `EndTurn`; see isSuccessfulStopReason).
  // Non-success: only stderr auth markers (same rule as timeout — do not scan text).
  if (!isSuccessfulStopReason(parsed.stopReason)) {
    if (looksLikeAuthFailure(r.stderr)) {
      return finish({
        status: 'auth_error', mode, billing,
        message: authNeededMessage(mode),
        rawStderrTail: r.stderr.slice(-500) || undefined,
        filesChanged, worktreePath,
      });
    }
    return finish({
      status: 'grok_error', mode, billing,
      message: `Grok Build가 완료되지 않았습니다 (stopReason: ${parsed.stopReason || 'unknown'}). ${parsed.text}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      filesChanged, worktreePath,
    });
  }

  return finish({
    status: 'completed', mode, billing,
    summary: parsed.text || '(no summary)',
    filesChanged, worktreePath,
    // A32: `committed` is stated whenever it could be read, so a caller can gate on the machine
    // signal instead of parsing prose. The message fires only on true — a run that behaved needs
    // no warning, and undefined means unverifiable, which must not read as either answer.
    ...(committed === undefined ? {} : { committed }),
    ...(committed === true ? { message: commitNotice(ctx.moved, worktreePath, false) } : {}),
  });
}

/**
 * A49 (docs/10, MEASURED 2026-09-28 through the v0.2.36 bundle with a stand-in grok that committed and then ended): the
 * branches above state `committed` on completed runs only. A grok that committed and then exited 1 came back as
 * `grok_error`, one that ran past the cap as `timeout` — neither with `committed`, neither message naming the commit, and
 * the history row recorded nothing. Every shipped prompt stops on a non-completed status and shows only the message, so
 * a commit, which bypasses the diff-review gate, went unreported exactly when the run also failed. HEAD is read around
 * every spawn that ran, so the fact exists whatever the ending: state it on every status, `false` included ("could be
 * read" — as A32 says of completed runs), and name a commit after the failure's own message, which stays first.
 * A49 round 2: the plan's `planWroteFiles` had the same gap (measured around every plan spawn, reported on a completed
 * plan only) — a plan that rewrote a file and then timed out said nothing. It is stated on every ending too.
 */
function noteMeasurements(result: DelegateResult, m: {
  committed: boolean | undefined; planWroteFiles: boolean | undefined; moved: MovedHead[];
  worktreePath: string | undefined; plan: boolean;
}): DelegateResult {
  let out = result;
  if (m.committed !== undefined && out.committed === undefined) {
    out = { ...out, committed: m.committed };
    if (m.committed) out.message = joinMessage(out.message, commitNotice(m.moved, m.worktreePath, m.plan));
  }
  if (m.plan && m.planWroteFiles !== undefined && out.planWroteFiles === undefined) {
    out = { ...out, planWroteFiles: m.planWroteFiles };
    if (m.planWroteFiles && !m.committed) out.message = joinMessage(out.message, PLAN_WROTE_MESSAGE);
  }
  return out;
}

const joinMessage = (first: string | undefined, next: string): string => (first ? `${first} ${next}` : next);

/**
 * A39: how long a prompt may be and still go on argv, per platform — a longer one reaches grok through
 * `--prompt-file`. That file puts the whole prompt on disk for the run, so the bound stays close to what
 * argv can carry (the first limit, 8,000 everywhere, sent far more through it — pre-merge review).
 * Measured 2026-09-25 with `--single=<prompt>` as one argument:
 *   win32  ONE command line of at most 32,767 UTF-16 units, and quoting can double an argument (each
 *          `"` becomes `\"`): an all-quote prompt started at 16,300 and failed at 20,000; plain ASCII
 *          and Hangul started at 32,000. 15,000 is sized for that doubled worst case plus grok's other
 *          arguments — so plain text between 15,000 and about 32,000 units takes the file although argv
 *          would hold it. A 40,000-char prompt could not start at all (ENAMETOOLONG).
 *   Linux  one argument of at most 131,072 BYTES (MAX_ARG_STRLEN): 131,060 started and 131,072 failed
 *          (E2BIG); 60,000 Hangul characters (180 KB) failed. Almost exact here: the ~60 bytes between
 *          131,000 and what started take the file although argv held them.
 *   macOS  NOT measured. It limits the total of arguments and environment (ARG_MAX), not one argument,
 *          so the Linux figure is conservative there: prompts from 131,000 bytes up to that total take
 *          the file although argv would likely hold them.
 */
export const ARGV_PROMPT_LIMIT_WIN32_UNITS = 15_000;
export const ARGV_PROMPT_LIMIT_POSIX_BYTES = 131_000;

export function promptFitsArgv(prompt: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? prompt.length <= ARGV_PROMPT_LIMIT_WIN32_UNITS
    : Buffer.byteLength(prompt, 'utf8') <= ARGV_PROMPT_LIMIT_POSIX_BYTES;
}

type PromptArgv = { ok: true; args: string[]; dir?: string } | { ok: false; message: string };

function promptArgv(prompt: string): PromptArgv {
  // `--single=<value>`, not `-p <value>`: as a bare option value clap refuses anything
  // starting with `-`, so a prompt like "- Refactor the module" exited 2 with empty stdout
  // and no model call, which this wrapper then reported as unparseable grok output.
  // Measured 1.0.13: `-p "- Refactor"` → exit 2; `"--single=- Refactor"` → exit 0, and the
  // equals form is identical for ordinary, multi-line and quoted prompts.
  if (promptFitsArgv(prompt)) return { ok: true, args: [`--single=${prompt}`] };
  // `--prompt-file` takes the text, a leading `-` included (contract §1, measured 2026-09-22); like `--single=`, grok
  // trims leading and trailing whitespace from it (measured 2026-09-30).
  // The file holds the whole prompt, so it goes in a private directory (0700 from mkdtemp), is
  // written 0600, and is removed as soon as the run returns.
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'grok-prompt-'));
    const file = join(dir, 'prompt.txt');
    writeFileSync(file, prompt, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, args: ['--prompt-file', file], dir };
  } catch (e) {
    if (dir) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    const cause = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `긴 프롬프트(${prompt.length}자)를 임시 파일로 grok에 넘기지 못했습니다: ${cause}` };
  }
}

/** The run, then the prompt file removed whatever happened: it holds the whole prompt (contract §1, Grok's review). */
async function spawnThenRemove(
  spawnFn: SpawnFn, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, promptDir: string | undefined,
): Promise<SpawnResult> {
  try {
    return await spawnFn(args, cwd, env, timeoutMs);
  } finally {
    if (promptDir) {
      try { rmSync(promptDir, { recursive: true, force: true }); } catch { /* a scanner may hold it on win32 */ }
    }
  }
}

/**
 * A59 (docs/10; contract §1 ③ — MEASURED 2026-09-30 on grok 1.0.41/1.0.44 and 2026-10-12/13 on 1.0.50 and 1.0.52,
 * win32 and Linux, zero quota, a loopback recording what grok sent the model): a prompt of 99,977 bytes or more, counted
 * after grok trims its ends, is not sent whole. grok writes it to <session>/prompts/prompt_<N>.txt (N is the turn's
 * prompt_index, so a resumed or continued turn writes prompt_1, prompt_2…) and sends the model the beginning, the end and a
 * note — a pointer to the missing lines in that file, or, when it could not hand the file over (on win32 every path of
 * 260+ characters), that the excerpt is all there is. Either way the result said `completed` and nothing else, and grok's
 * file note tells the model not to mention the omission to the user. Files the prompt @-mentions count too, and when
 * they overflow the request grok keeps the prompt whole (up to about 75 KB) and cuts the files at their end (MEASURED on
 * 1.0.52, review round 8); so does the block of a skill the prompt invokes as `/name`, which repeats the prompt twice
 * (MEASURED on 1.0.52, review round 13: a 52,010-byte prompt and a 3 KB skill were cut).
 *
 * This adds a warning to `message`, and only that (owner, 2026-10-12): status, isError and the history row stay as they
 * were. An auth_error gets none: on the measured path the first request was refused before the model saw anything, and a
 * run that ends in auth_error has to be repeated after a login — that run reports it. Other failures after grok wrote the
 * file and the turn do get it — 1.0.52 ends a refused session in a timeout (review round 6), a 429 ends in an error, a
 * 500 in a timeout (round 7) — so the sentences speak of what grok put in its request, not of what the model got. A
 * continue that ends with no envelope names no session and gets none.
 * - The gate (mayBeCut) counts the string handed to grok — suffix in, untrimmed. Trimming only removes bytes, so this
 *   never counts less than grok did, except for what grok adds to the prompt and counts too (MEASURED, rounds 7 and 13):
 *   a prompt that may mention a file (MENTION) or invoke a skill (mayInvokeSkill) is looked at whatever its size. The same
 *   gate decides whether a listing is taken before the spawn, where the folder can be named then (below).
 * - Files an @-mention attached follow the frame in a reminder block — in the prompt file after "\n</user_query>", in the
 *   history line before grok's note, on turns grok did not cut as well (MEASURED on 1.0.50 and 1.0.52, review round 7).
 *   grok numbers each line of an attached file (MEASURED on 1.0.52), so neither the block nor grok's note holds a line
 *   that starts with the closing tag; the prompt can. So the last such line ends the query. The block's end is its end
 *   tag after an empty line — its other empty lines, between entries and in an empty file's, are followed by other tags;
 *   in a history line it has lost that end where grok cut the files, and grok's note follows the cut after an empty line
 *   (MEASURED on 1.0.52, review round 8). No comparison reads the block. grok's note is the last of its marks that starts
 *   a line after the query — a mark an attached file quotes sits inside a numbered line (review round 10).
 * - A skill the prompt invokes follows the frame in its own block, ahead of any reminder: "\n<skill_information>\n" up to
 *   a line "</skill_information>", in the prompt file and the history line (MEASURED on 1.0.52, review round 13). grok
 *   runs `/name` as a skill only where the trimmed prompt starts with it, in any case; the block holds the skill's text
 *   and the prompt again, twice, unnumbered. So for a prompt that may invoke one the query ends where that block opens,
 *   and what follows the query is read after the block's last line that starts with its end tag: grok kept that end when
 *   it cut the block's middle (its note names "skill instructions lines …"), and neither the reminder after it nor the
 *   note holds such a line. Such a turn needs a known mark to be cut, as after a reminder; one with no line that starts
 *   with the end tag is never whole (a prompt that quotes that line at a line start stands in for a lost one — a later
 *   layout's case: grok kept the end on 1.0.52, review round 14). In a history line a block that kept its end is not
 *   read; one that lost it is (below). In a prompt file that ends in the attached files' block, a frame that holds
 *   the two lines that open a skill's block is not taken for another prompt's by its length where this prompt may
 *   invoke a skill, and, for any prompt, a frame of exactly this prompt that they follow is not taken for this prompt's
 *   (holdsPrompt).
 * - The prompt is compared as grok keeps it (MEASURED): its ends trimmed of Unicode White_Space, as Rust's trim() does —
 *   space, TAB, LF, VT, FF, CR, U+0085, U+00A0, U+1680, U+2003, U+2028 and U+3000 went from the front; U+200B and the
 *   controls tried outside White_Space (U+0001, U+001B, U+007F) stayed. A leading run of White_Space and U+FEFF is left out
 *   of every side of a comparison (leadTrimmed): grok versions differ inside it. Nothing else changes: a CRLF or a lone CR
 *   inside stays as it was in the file and in the history. Removing more than that let a prompt that differs only in its
 *   spacing pass for this one (review round 3).
 * - A prompt file is this run's when this run wrote it and it holds this prompt. grok saves the whole request in it
 *   verbatim, "<user_query>\n" + prompt + "\n</user_query>" (MEASURED), so the file says whose prompt it is. The recorded
 *   query does not: it is the beginning, a short omission mark and the end, and every prompt ends in the same suffix — two
 *   prompts that differ only in lines grok left out were recorded alike (MEASURED). Two runs can share a session at once
 *   (MEASURED: a second resume ran to completion and recorded its turn while the first waited for the model), and two that
 *   start together get the same prompt_index, the later file replacing the earlier one (MEASURED on 1.0.50 and 1.0.52: two
 *   resumes 23–24 ms apart both wrote prompt_1).
 * - In the folder of the id minted for this run, this run's turn is prompt_index 0 — a concurrent --continue can join
 *   that session, and its turns come later — so prompt_0.txt is this run's unless holdsPrompt finds it cannot hold this
 *   prompt (too short, or grok's frame around text without this prompt in it or longer than this prompt's file can be).
 *   One that holds this prompt with more around it still is (a later layout, or a run that joined in the same instant
 *   with a prompt containing this one: the file holds this prompt whole), and so is one that holds less of it at an end
 *   (a grok that trims more than this wrapper does — or, not told apart, a joined run whose prompt is part of this one).
 *   With line 0 recorded, no other number's file is this run's; without it (a later grok that numbers otherwise) the
 *   content decides there too (review round 5).
 * - "This run wrote it": against a listing taken before the spawn wherever the folder can be named then (a minted id
 *   holds nothing yet; a resume the index finds — a new name, or one rewritten by a rewound session that reuses a number).
 *   Otherwise by its time (writtenByTime): from the spawn, minus 100 ms for a file system's coarser clock (file times
 *   trailed the process clock by up to 3.45 ms, review round 3) or 2 s for a time in whole seconds (FAT keeps 2-second
 *   times), to 3 s after the check (FAT may round a time up; later is a skewed clock). A file dated before that is an
 *   earlier run's — the same prompt re-sent right after an earlier run put that run's file 1.4–1.5 s before this one's
 *   (MEASURED); with whole-second times both files fall inside it and both are named, attributed to nothing.
 * - Exactly one such file is named as this run's — unless another cut turn of this prompt, among the lines read, left no
 *   file: the same prompt sent at once by another run, whose file this may be, so it is named without being called this
 *   run's (review round 4); nor when a later turn of this prompt was kept whole: this run's turn may be that one — grok
 *   cuts a prompt by the files it @-mentions too, and those change between runs (review round 9). Under a listing any
 *   other turn of this prompt kept whole counts, the lines read being those grok appended during the run (below; review
 *   round 10: two resumes of one prompt at once, the files grown between their reads). A number has a file only by one
 *   read here — under a listing, one written during the run, so a turn recorded during the run over an older file left
 *   none (review round 5). In the minted folder with line 0 recorded only that line is looked at, here and below. More
 *   than one such file (the same prompt sent at once) are named without calling any of them this run's.
 * - What grok's request told the model is grok's note on that file's turn — the last of its marks that starts a line
 *   after the query, in the query's own text part — on the latest chat_history.jsonl line of that prompt_index whose
 *   query can be this prompt (whole, or at least 1,000 characters of its beginning and of its end with a short mark
 *   between). No such line: nothing is said about what the request held. That line holds the prompt whole and no note
 *   follows it, nor a block that lost its end: grok cut neither the prompt nor its files, and nothing is said at all.
 *   Otherwise the line shows what grok left out — the prompt's middle where the query is cut; the files' end where grok's
 *   file note names attached lines ("attached context lines …", MEASURED on 1.0.52), or its not-saved note follows a
 *   block that lost its end before it — where the prompt may mention a file (MENTION) and the attached files' tag comes
 *   before the note (review rounds 11–12: an @ that attaches nothing, such as an annotation, is no file, and a quoted tag
 *   where nothing could be attached is none) — and the sentence for grok's file note or its not-saved note names that
 *   (a note on a line that shows neither: "part of the request"); with no note this wrapper knows, no part is named —
 *   such a line is no proof of a cut, as a shorter look-alike prompt recorded whole matches it the same way (Grok's
 *   step-5 follow-up on review round 9). Never inferred from the path's length: the 260 rule is grok-version behaviour
 *   (measured 1.0.41 to 1.0.52) that a later grok can drop, and the joined path is not grok's own for a \\?\ home, a `.`
 *   segment or an 8.3 name (Grok, rounds 1–2).
 * - The history is read from its size before the spawn where a listing was taken — the lines written during the run,
 *   however much follows them (review round 4: a turn further back than the last 8 MiB was not seen) — and otherwise in its
 *   last 8 MiB. That rests on grok appending to it (MEASURED: when a second run found the first run's turn unanswered,
 *   grok added a reminder line after it and left that turn's line as it was); one shorter than before the spawn is read in
 *   its last 8 MiB, where lines from before the run pass for ones written during it under the listing rules below — an
 *   earlier turn of this prompt can then doubt this run's file, or decide whether a run whose own turn shows no cut gets
 *   the hedged sentence or nothing (review rounds 12–13). A line counts as cut only when grok's note follows the query — a
 *   known mark, or, where what follows the query opens with neither a reminder nor a skill's block, any text (review round
 *   7: a note in other words); grok adds a note only when it cut (MEASURED). Where it opens with one, text that holds no
 *   known mark is no note: a later layout's trailer would otherwise read as a cut on every mention (review rounds 9–10),
 *   and a block that lost its end with no known mark after the query (a later layout, or a reworded note) leaves the line
 *   neither cut nor whole (review round 9).
 * - No file of this run:
 *   - a line of this prompt holds it whole and — without a listing — has a higher prompt_index than any cut line of it,
 *     or — under one — no line of it is cut: grok did not cut it, nothing is said, and other runs' files are theirs
 *     (review round 10: cut on an earlier run, the files made smaller as the advice says, kept whole on this one; round
 *     11: under a listing the lines read are those grok appended during the run, so their order does not say which is
 *     this run's). A cut line after it may be this run's: the files an @-mention prompt attaches can grow between runs,
 *     so grok cuts one run's request and not another's (review round 9);
 *   - in the minted folder, turn 0 says the file was not saved: what grok left out was lost (prompt_0.txt is missing or
 *     cannot hold this prompt, whatever another run's file holds — review round 5);
 *   - otherwise, named without calling them this run's: outside the minted folder, the files that hold this prompt but
 *     were not written during the run where no listing could tell (a skewed clock, an earlier turn of the same prompt —
 *     such a file is read only when a line of this prompt carries its number), and those written during the run that
 *     could not be read for the prompt;
 *   - none of those but a cut line of this prompt (in the minted folder with line 0 recorded, turn 0's) — its file
 *     replaced, or never written: the same sentence without a file. Where a listing was taken only lines written during
 *     the run count, so a run grok refused before its turn says nothing (review round 4).
 * - Not covered: a continue that ends with no envelope names no session, so nothing is looked for. Without a listing (a
 *   continue, a resume the index did not find before the spawn, a run whose envelope names another session) the last
 *   8 MiB can hold an earlier cut turn of the same prompt — a run grok refused before its turn then gets the hedged
 *   sentence, and if that turn's file is gone, this run's own file is named without being called this run's. Runs that
 *   send one session the same prompt, or prompts that differ only where grok cuts, at the same time can be told another
 *   one's file or note when one of them failed before its turn or grok gave two of them one number (review rounds 5–6:
 *   nothing a run sees tells them apart) — or nothing, where grok's record lost the earlier run's line in that race
 *   (MEASURED once on 1.0.52, review round 9's final re-run: only the later run's turn was left, and its file). Without
 *   a listing an earlier whole turn of this prompt does not doubt the file, so two such runs at once can give the one
 *   grok kept whole the other's file and note, and a later whole turn silences the one grok cut that left no file
 *   (review rounds 10–11). Turns are ordered by prompt_index: a rewound session that records a lower number after a
 *   higher one is ordered by number, not by time (not measured — rewind is not reachable headless). In the minted folder
 *   without line 0, a joined run's whole turn of this prompt doubts this run's own prompt_0.txt (the hedge stays true).
 *   A history that shrank during the run is read in its last 8 MiB, as above (not seen: grok appended).
 *   The last mark that starts a line decides, so one in text grok put after its note would (none follows the note on
 *   1.0.52, MEASURED by review round 11). A grok that cuts below 99,977 bytes a prompt the gate does not take, or
 *   rewrites the prompt's content (its line ends, say), is not recognised: nothing is said — or, where
 *   the rewrite falls only in what grok left out of the recorded query, the hedged sentence without a file. Files grok
 *   never attached are not seen: it attaches the first 32 files a prompt @-mentions and drops the rest with no note and
 *   no file (MEASURED on 1.0.52, review round 9), so nothing is said of them, and a saved file holds the files grok
 *   attached, not every file the prompt names. Where what follows the query opens with a reminder or a skill's block, a
 *   note in other words or one that does not start a line leaves the turn not cut: neither cut nor whole where the query
 *   is cut or a block lost its end (this run's file is named without saying what grok's request held, and without one
 *   that turn says nothing), whole where both are whole. Where the block's end changed, a not-saved note, which does not
 *   say what grok left out, names the files' end. A skill's block that lost its end (a later layout) is read for grok's
 *   note, its text and the prompt in it too; a prompt that may invoke a skill and quotes the two lines that open the
 *   block ends its query there, so that turn is not this prompt's. Outside the minted folder a prompt file with a skill's
 *   block is named without being called this run's.
 */
export const OFFLOAD_MIN_BYTES = 99_977;
const OFFLOADED_MARK = '[Full request offloaded to file]';
const NOT_SAVED_MARK = '[Full request could not be saved to a file';
const QUERY_START = '<user_query>';
const QUERY_END = '</user_query>';
/** How grok frames the prompt in a prompt file and around the query in a history line (measured on 1.0.50 and 1.0.52). */
const FRAME_START = `${QUERY_START}\n`;
const FRAME_END = `\n${QUERY_END}`;
/**
 * What grok puts after the frame when the prompt @-mentions files (MEASURED on 1.0.50 and 1.0.52, review round 7): a
 * reminder block holding each file — inline, or a placeholder when it is too large — in the prompt file after
 * "\n</user_query>", and in the history line between that tag and grok's note. Its own end is the end tag after an empty
 * line (BLOCK_END): the block has empty lines between its entries and in an empty file's, but grok numbers each attached
 * line, so no other empty line is followed by that tag (review round 9); in a history line grok drops it with the files'
 * end when it cut them (MEASURED on 1.0.52, review round 8).
 */
const REMINDER_OPEN = '<system-reminder>';
const ATTACHED_START = `\n\n${REMINDER_OPEN}\n`;
const ATTACHED_END = '</system-reminder>';
const BLOCK_END = `\n\n${ATTACHED_END}`;
/** What grok's file note says when it left attached files' lines out (MEASURED on 1.0.52: "attached context lines …"). */
const ATTACHED_LINES = 'attached context lines';
/** The tag that holds the attached files inside that block (MEASURED on 1.0.50 and 1.0.52: "\n\n<attached_files>\n\n"). */
const ATTACHED_FILES = '<attached_files>';
/** How much of a prompt file that ends in that block is read beyond the frame: room for the attached files. */
const ATTACHED_ROOM_BYTES = 8 * 1024 * 1024;
/**
 * A prompt that may @-mention a file: grok counts the block it attaches, so such a prompt can be cut under 99,977 bytes
 * (MEASURED on 1.0.52: 99,976 bytes and a mentioned file were cut, review round 7). grok attached the file named by the
 * word after an @ that no letter, digit or underscore precedes — not x@f, _@f, 1@f or an @ after a Hangul or accented
 * letter; it did after a space, a TAB, U+3000, ":", ".", "#", "/", "-", "@" and at the start (MEASURED on 1.0.52) — and
 * it skips White_Space between the @ and the word: a space or two, a TAB, U+00A0, U+3000, U+0085, a line break and an
 * empty line all attached the word after them (MEASURED on 1.0.52, review round 13: "@ f.txt" attached f.txt). This
 * blocks fewer characters than grok and skips what \s does (U+0085, no \s, is a \S itself), so it errs toward looking:
 * a prompt it matches is looked at whatever its size.
 */
const MENTION = /(?<![\p{L}\p{Nd}_])@\s*\S/u;
/** The line that opens a skill's block after the frame, and its end tag (MEASURED on 1.0.52, review round 13). */
const SKILL_OPEN = '<skill_information>\n';
const SKILL_END = '</skill_information>';

/**
 * Where a skill's block opens after the query: the first "\n</user_query>" from `start` that the block's opening line
 * follows — after however many line breaks and spaces, as a reminder may follow it (opensWithReminder; review round 14:
 * matched only as grok 1.0.52 lays it out, one more line break read every uncut skill turn as cut). The first, not the
 * last: the block repeats the prompt and holds the skill's text, either of which can quote both lines. -1: none.
 */
function skillSeam(text: string, start: number): number {
  for (let at = text.indexOf(FRAME_END, start); at >= 0; at = text.indexOf(FRAME_END, at + FRAME_END.length)) {
    let i = at + FRAME_END.length;
    while (i < text.length && (text[i] === '\n' || text[i] === '\r' || text[i] === ' ' || text[i] === '\t')) i += 1;
    if (text.startsWith(SKILL_OPEN, i)) return at;
  }
  return -1;
}

/**
 * A prompt that may invoke a skill: grok runs `/name …` as the user-invocable skill of that name where the trimmed prompt
 * starts with it — after leading spaces or a U+FEFF and in any case, not on a later line or after other words — and
 * counts its block, which repeats the prompt twice (MEASURED on 1.0.52, review round 13: 35 bytes and a 120 KB skill,
 * 52,010 bytes and a 3 KB one were cut). Commands and Claude Code's skills get the same block — a command file in grok's
 * home or ~/.claude/commands, a skill in ~/.claude/skills, a `/user:` name (MEASURED on 1.0.44, 1.0.50 and 1.0.52, review
 * rounds 14–15). A "/" that names no skill only makes the wrapper look.
 */
function mayInvokeSkill(prompt: string): boolean {
  return leadTrimmed(prompt).startsWith('/');
}

/** Whether grok may have cut this prompt: 99,977 bytes or more as handed to it, or what grok may have added to it. */
function mayBeCut(prompt: string): boolean {
  return Buffer.byteLength(prompt, 'utf8') >= OFFLOAD_MIN_BYTES || MENTION.test(prompt) || mayInvokeSkill(prompt);
}
/** How much of chat_history.jsonl is read: what was written after its size before the spawn, or its end. */
const HISTORY_READ_BYTES = 8 * 1024 * 1024;
/** How long before the spawn a file of this run may be dated where no listing was taken, when its time is in whole
 * seconds — FAT keeps 2-second times. */
const MTIME_SLACK_MS = 2_000;
/** The same for a finer time: a file system stamps with a coarser clock than the one this process reads. */
const FILE_CLOCK_LAG_MS = 100;
/** How long after the check a file of this run may be dated — FAT may round a time up; later is a skewed clock. */
const CLOCK_TOLERANCE_MS = 3_000;
/** The longest omission mark grok may put between the beginning and the end it kept (measured: 65, line breaks in). */
const OMISSION_MAX_CHARS = 200;
/** The least of the prompt a cut query keeps at each end: grok kept about 94 KB and 4 KB (measured). A shorter match is
 * a query that only shares a first label and the wrapper's suffix — a one-line seed passed (found fixing review round 3). */
const KEPT_MIN_CHARS = 1_000;
/** What a prompt file may hold beyond the prompt: its <user_query> lines (27 bytes measured), with room for a later
 * layout's additions (review round 4: 2,000 bytes more inside the frame were taken for another prompt's file). */
const PROMPT_FILE_SLACK_BYTES = 64 * 1024;
/** How much shorter than this prompt a file may be and still hold it — grok may trim the ends a little differently. */
const PROMPT_END_SLACK_BYTES = 1024;
/** How many of the files a sentence that attributes nothing names — the latest. */
const NAMED_FILES_MAX = 3;
const PROMPT_FILE = /^prompt_(\d+)\.txt$/;

/** 'unattributed': files that could be this run's prompt file, none of them known to be — or none at all. */
export type OffloadTold = 'not_saved' | 'file' | 'unknown' | 'unattributed';

/** Unicode White_Space: what Rust's str::trim() takes off both ends. */
function isWhiteSpace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x85 || code === 0xa0 || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f
    || code === 0x3000;
}

/**
 * The text without its leading run of White_Space and U+FEFF. grok versions differ inside that run (MEASURED): 1.0.50
 * keeps every U+FEFF and trims only what comes before the first; 1.0.52 drops a U+FEFF at the start, trims, then drops
 * one more — so of a space, a U+FEFF and a space 1.0.50 keeps the U+FEFF and a space, 1.0.52 a space. No comparison
 * looks at that run (review round 5: a U+FEFF then a blank first line lost grok's note).
 */
function leadTrimmed(text: string): string {
  let start = 0;
  while (start < text.length && (isWhiteSpace(text.charCodeAt(start)) || text.charCodeAt(start) === 0xfeff)) start += 1;
  return start === 0 ? text : text.slice(start);
}

/**
 * What UTF-8 gave grok (a lone surrogate is U+FFFD) with both ends trimmed of White_Space — Rust's trim(), and so the
 * most of the prompt a measured grok keeps: 1.0.50 stops at a U+FEFF and keeps it and all after it, 1.0.52 keeps less.
 * A loop, not a regex: a `[…]+$` alternative backtracks over a long inner run of spaces (review round 4: 160,000 of them
 * took 14.7 s and held the server).
 */
function trimmedOfWhiteSpace(prompt: string): string {
  const text = Buffer.from(prompt, 'utf8').toString('utf8');
  let start = 0;
  let end = text.length;
  while (end > start && isWhiteSpace(text.charCodeAt(end - 1))) end -= 1;
  while (start < end && isWhiteSpace(text.charCodeAt(start))) start += 1;
  return text.slice(start, end);
}

/** The prompt as compared: trimmedOfWhiteSpace without its leading run of White_Space and U+FEFF (leadTrimmed). */
export function keptByGrok(prompt: string): string {
  return leadTrimmed(trimmedOfWhiteSpace(prompt));
}

/**
 * Whether a file's time puts it within the run, where no listing was taken: from the spawn — minus 100 ms for a time
 * finer than seconds (a file system's coarser clock), 2 s for one in whole seconds (FAT) — to 3 s after the check.
 */
export function writtenByTime(mtimeMs: number, spawnedAtMs: number, checkedAtMs: number): boolean {
  const slack = mtimeMs % 1000 === 0 ? MTIME_SLACK_MS : FILE_CLOCK_LAG_MS;
  return mtimeMs >= spawnedAtMs - slack && mtimeMs <= checkedAtMs + CLOCK_TOLERANCE_MS;
}

/**
 * Whether a recorded query can be this prompt: the same, or — grok cut it — at least the prompt's first and last
 * KEPT_MIN_CHARS with a short mark between. Of the mark only its length is assumed, so another prompt can pass (one that
 * differs only where grok cut): this pairs a note with a file already known to be this run's, and says no more than
 * "may have been cut" without one.
 */
function isThisPrompt(query: string, prompt: string): boolean {
  if (query === prompt) return true;
  if (query.length >= prompt.length) return false;
  let head = 0;
  while (head < query.length && query.charCodeAt(head) === prompt.charCodeAt(head)) head += 1;
  let tail = 0;
  while (tail < query.length - head
    && query.charCodeAt(query.length - 1 - tail) === prompt.charCodeAt(prompt.length - 1 - tail)) tail += 1;
  return head >= KEPT_MIN_CHARS && tail >= KEPT_MIN_CHARS && query.length - head - tail <= OMISSION_MAX_CHARS;
}

/**
 * What grok's record of a turn shows it left out of its request: the prompt's middle (the recorded query is cut), the end
 * of the attached files (their block is cut off — MEASURED on 1.0.52, review round 8), or both.
 */
export interface CutParts { prompt: boolean; files: boolean }

/**
 * What grok added to the prompt that a sentence names as long with it: the files an @-mention attached, the block of a
 * skill the prompt invoked (review round 13).
 */
export interface Added { files: boolean; skill: boolean }

/**
 * How the sentences name what grok left out — unnamed when grok's note follows a turn that shows neither cut. `skill`:
 * a skill's block was part of what was long, so where neither the prompt nor the files were cut the advice is about it —
 * and about the prompt, which the block holds twice besides the skill's text (review round 14: a 52 KB prompt and a 3 KB
 * skill, where shortening the skill could not help).
 */
function cutWords(cut: CutParts | undefined, skill: boolean): { put: string; putPast: string; lost: string; advice: string } {
  const prompt = cut === undefined || cut.prompt;
  const files = cut?.files === true;
  const advice = files
    ? '프롬프트를 나누거나, 붙이는 파일을 줄이거나 @ 없이 경로만 적어 grok이 직접 읽게 해 다시 실행하세요.'
    : skill && !prompt
      ? '프롬프트나 /로 부른 스킬을 줄이거나, 그 스킬 없이 다시 실행하세요.'
      : '프롬프트를 나누거나, 긴 자료는 작업 폴더의 파일로 두고 그 경로를 프롬프트에 적어 다시 실행하세요.';
  if (prompt && files) {
    return {
      put: '요청에 프롬프트의 앞부분과 끝부분만 넣고 @로 붙인 파일의 뒷부분은 빼고',
      putPast: '요청에 프롬프트의 앞부분과 끝부분만 넣고 @로 붙인 파일의 뒷부분은 뺐으며',
      lost: '프롬프트의 가운데와 붙인 파일의 뒷부분은 모델에 닿지 않았습니다',
      advice,
    };
  }
  if (files) {
    return {
      put: '요청에서 @로 붙인 파일의 뒷부분을 빼고', putPast: '요청에서 @로 붙인 파일의 뒷부분을 뺐고',
      lost: '붙인 파일의 뒷부분은 모델에 닿지 않았습니다', advice,
    };
  }
  if (prompt) {
    return {
      put: '요청에 앞부분과 끝부분만 넣고', putPast: '요청에 앞부분과 끝부분만 넣었고',
      lost: '프롬프트의 가운데는 모델에 닿지 않았습니다', advice,
    };
  }
  return { put: '요청을 줄이고', putPast: '요청을 줄였고', lost: '요청의 일부는 모델에 닿지 않았습니다', advice };
}

/**
 * The sentence for a run whose request grok cut: what the files and grok's record of this run show, and no more. The record
 * says what grok put in its request to the model, not that the model got it — a request refused or never answered is
 * recorded the same way (review round 7: a 429 and a 500), so the sentences speak of the request. `cut` is what the
 * record of the tied turn shows grok left out (undefined: the prompt's middle, as before attached files were seen);
 * `added` what the subject names besides the prompt — by default the attached files, where grok cut them or under the
 * boundary, where only what grok added can have taken the request over it.
 */
export function offloadNote(
  promptBytes: number, files: readonly string[], told: OffloadTold, cut?: CutParts,
  added: Added = { files: cut?.files === true || promptBytes < OFFLOAD_MIN_BYTES, skill: false },
): string {
  const size = `프롬프트(${promptBytes.toLocaleString('en-US')}바이트)`;
  const subject = added.skill && added.files ? `${size}와 /로 부른 스킬, @로 붙인 파일이`
    : added.skill ? `${size}와 /로 부른 스킬이` : added.files ? `${size}와 @로 붙인 파일이` : `${size}가`;
  const { put, putPast, lost, advice } = cutWords(cut, added.skill);
  const unconfirmed = '이 실행의 프롬프트가 잘렸는지와 모델이 프롬프트를 다 받았는지는 확인하지 못했습니다.';
  if (told === 'unattributed' && files.length === 0) {
    return `${subject} 길어 grok이 잘랐을 수 있습니다 — 이 세션의 grok 기록에 이 프롬프트로 보이는 잘린 턴이 있지만 이 실행이 쓴 `
      + `파일을 찾지 못해, ${unconfirmed}`;
  }
  if (told === 'unattributed') {
    const shown = files.slice(-NAMED_FILES_MAX);
    const more = files.length > shown.length ? ` 외 ${files.length - shown.length}개` : '';
    return `${subject} 길어 grok이 잘랐을 수 있습니다 — 이 세션에 grok이 프롬프트 전문을 저장한 파일이 있지만(${shown.join(', ')}${more}) `
      + `그중 이 실행이 쓴 것을 하나로 가려내지 못해, ${unconfirmed}`;
  }
  if (files.length === 0) {
    return `${subject} 길어 grok이 잘랐습니다 — 이 실행의 grok 기록에 따르면 grok은 모델에 보낼 ${putPast} 전문을 파일로 넘기지 `
      + `못했습니다: ${lost}. ${advice}`;
  }
  const saved = `${subject} 길어 grok이 전문을 ${files[0]}에 따로 저장했습니다`;
  // After "@로 붙인 파일" a bare "그 파일" reads as the attached file: name the saved one (review round 9).
  const savedFile = cut?.files === true ? '저장한 파일' : '그 파일';
  if (told === 'not_saved') {
    return `${saved} — 이 실행의 grok 기록에 따르면 grok은 모델에 보낼 ${putPast} ${savedFile}은 넘기지 못했습니다: ${lost}. ${advice}`;
  }
  if (told === 'file') {
    return `${saved} — 이 실행의 grok 기록에 따르면 grok은 모델에 보낼 ${put} 빠진 줄은 ${savedFile}에서 읽으라고 적었습니다. `
      + '모델이 그 줄을 읽었는지는 확인하지 않았습니다.';
  }
  return `${saved}. 모델이 프롬프트를 다 받았는지는 확인하지 못했습니다.`;
}

/**
 * A session's own folder, when the index can name one. The id is joined into a path, so only a single path segment is
 * an id (review round 2: an envelope's `../../..` read a history outside sessions/).
 */
function sessionFolderOf(sessionId: string | undefined, index: SessionsIndex): string | undefined {
  if (sessionId === undefined || sessionId === '.' || sessionId === '..' || /[\\/]/.test(sessionId)) return undefined;
  const dir = findSessionDir(sessionId, index);
  return dir === undefined || !index.sessionFolder ? undefined : index.sessionFolder(dir, sessionId);
}

function promptFileNames(folder: string): string[] {
  try { return readdirSync(join(folder, 'prompts')).filter((name) => PROMPT_FILE.test(name)); } catch { return []; }
}

/** A prompt file's size and time — a regular file only (a link or a folder by that name is not grok's file). */
function stampOf(path: string): { stamp: string; mtimeMs: number } | undefined {
  try {
    const st = lstatSync(path);
    return st.isFile() ? { stamp: `${st.size}:${st.mtimeMs}`, mtimeMs: st.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/** The size of a session's chat_history.jsonl before the spawn — 0 when there is none yet, or it is no regular file. */
function historySize(folder: string): number {
  try {
    const st = lstatSync(join(folder, 'chat_history.jsonl'));
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

/** What one session's folder held before the spawn: each prompt file with its size and time, and the history's size. */
interface OffloadSnapshot { sessionId: string; minted: boolean; files: ReadonlyMap<string, string>; historyBytes: number }

/**
 * The listing taken before the spawn, wherever the folder can be named then — undefined otherwise. A minted id can hold
 * nothing yet; a resume's folder is listed. It speaks for its own session id only.
 */
function offloadSnapshot(
  mintedSessionId: string | undefined, resumeSessionId: string | undefined, index: SessionsIndex,
): OffloadSnapshot | undefined {
  if (mintedSessionId !== undefined) return { sessionId: mintedSessionId, minted: true, files: new Map(), historyBytes: 0 };
  const folder = sessionFolderOf(resumeSessionId, index);
  if (folder === undefined || resumeSessionId === undefined) return undefined;
  const files = new Map<string, string>();
  for (const name of promptFileNames(folder)) {
    const s = stampOf(join(folder, 'prompts', name));
    if (s) files.set(name, s.stamp);
  }
  return { sessionId: resumeSessionId, minted: false, files, historyBytes: historySize(folder) };
}

/**
 * A regular file, opened as readExactly opens one, handed to `read` with its size and a reader of byte ranges; null
 * when it cannot be read. lstat first: win32 has neither O_NOFOLLOW nor O_NONBLOCK, so the flags alone would follow a
 * link there (Grok, step 5). Only the file itself is checked — a linked GROK_HOME has to keep working.
 */
async function readRegular<T>(
  path: string, read: (size: number, range: (start: number, length: number) => Promise<string>) => Promise<T>,
): Promise<T | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    const fh = await open(path, READ_FLAGS);
    try {
      const st = await fh.stat();
      if (!st.isFile()) return null;
      return await read(st.size, async (start, length) => {
        const buf = Buffer.alloc(length);
        let got = 0;
        while (got < length) {
          const { bytesRead } = await fh.read(buf, got, length - got, start + got);
          if (bytesRead === 0) break;
          got += bytesRead;
        }
        return buf.toString('utf8', 0, got);
      });
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * The part of chat_history.jsonl to look at: what was written after `fromByte` (its size before the spawn), up to
 * HISTORY_READ_BYTES of it — or, without that or when the file shrank, its last HISTORY_READ_BYTES. A cut first line is
 * dropped: it is cut JSON.
 */
function readHistory(path: string, fromByte: number | undefined): Promise<string | null> {
  return readRegular(path, async (size, range) => {
    if (fromByte !== undefined && fromByte <= size) {
      const start = Math.max(0, fromByte - 1); // the byte before tells whether `fromByte` starts a line
      const text = await range(start, Math.min(size, fromByte + HISTORY_READ_BYTES) - start);
      return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    }
    const length = Math.min(size, HISTORY_READ_BYTES);
    const text = await range(size - length, length);
    return length < size ? text.slice(text.indexOf('\n') + 1) : text;
  });
}

/**
 * Whether a prompt file holds this prompt (as grok keeps it). true: grok's frame around exactly this prompt — followed,
 * when the prompt @-mentions files, by the block grok attaches them in (review round 7). false: a file too short to hold
 * it (empty, or cut off while written), that frame around nothing or around something without this prompt in it, or a
 * frame longer than this prompt's can be. In a file that ends in the attached files' block, the two lines a skill's
 * block opens with make two of these null: for a prompt that may invoke a skill, a frame longer than this prompt's can
 * be that holds them (it may have ended in the block — review rounds 14–15); for any prompt, a frame around exactly
 * this prompt that they follow (the file's frame may go on to them — review round 16). null: unreadable, another layout
 * (a later grok's), a file with the block too long to read, or this prompt with something around it — more inside the
 * frame, or less at the ends than this wrapper trims (review rounds 3–4).
 */
async function holdsPrompt(path: string, prompt: string, minBytes: number, maxBytes: number): Promise<boolean | null> {
  type Seen = { kind: 'short' } | { kind: 'long'; framed: boolean } | { kind: 'text'; text: string; attached: boolean };
  const seen = await readRegular<Seen>(path, async (size, range) => {
    if (size < minBytes) return { kind: 'short' };
    // A file that ends in the block of attached files is read whole, with room for them: its frame ends at the last
    // "\n</user_query>" followed by the block's opening, which a prompt can quote before it (review round 8: read only up
    // to the bound, a quote of that pair in another run's longer prompt was taken for the frame's end).
    if (size >= ATTACHED_END.length && await range(size - ATTACHED_END.length, ATTACHED_END.length) === ATTACHED_END) {
      return size > maxBytes + ATTACHED_ROOM_BYTES ? { kind: 'long', framed: false }
        : { kind: 'text', text: await range(0, size), attached: true };
    }
    if (size > maxBytes) {
      const framed = await range(0, FRAME_START.length) === FRAME_START
        && await range(size - FRAME_END.length, FRAME_END.length) === FRAME_END;
      return { kind: 'long', framed };
    }
    return { kind: 'text', text: await range(0, size), attached: false };
  });
  if (seen === null) return null;
  if (seen.kind === 'short') return false;
  if (seen.kind === 'long') return seen.framed ? false : null;
  let { text } = seen;
  let past = false;
  if (seen.attached) {
    const at = text.lastIndexOf(FRAME_END + ATTACHED_START);
    if (at < 0) return null;
    text = text.slice(0, at + FRAME_END.length);
    // The frame is bounded as a file without the block is: longer than this prompt's can be is another prompt's — but,
    // where this prompt may invoke a skill, not a frame that holds the two lines a skill's block opens with: the block's
    // copies of the prompt and the skill's text are not numbered, so a quote there of the frame's end and the attached
    // files' opening ended the frame inside the block — longer than this prompt's can be, and this run's own file was
    // denied (review round 14). The two lines past the frame do not count: a frame cut before the block is part of the
    // file's real one, so one longer than this prompt's can be is another prompt's (review round 15: such a file was
    // named as perhaps this run's). Under the bound it is compared as any frame is: the two lines may be the prompt's own
    // quote, with no block (review round 15: a prompt that starts with a path was not tied to its file), and a frame that
    // ends in a block holds this prompt at its start, or is another prompt's.
    const skilled = mayInvokeSkill(prompt) && skillSeam(text, FRAME_START.length) >= 0;
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return text.startsWith(FRAME_START) && !skilled ? false : null;
    // The two lines after the frame as cut: the file's frame may go on to them. A block that repeats no prompt (a later
    // layout's) leaves a prompt's own quote of the pair the last one, and another prompt that begins with this one and
    // quotes it was cut to exactly this prompt's frame and tied to this run (review round 16). Any prompt: one that
    // cannot invoke a skill gets no block, so the two lines there are never its own file's.
    past = skillSeam(seen.text, at + FRAME_END.length) >= 0;
  }
  if (text.length < FRAME_START.length + FRAME_END.length || !text.startsWith(FRAME_START) || !text.endsWith(FRAME_END)) {
    return null;
  }
  const inner = leadTrimmed(text.slice(FRAME_START.length, text.length - FRAME_END.length));
  if (inner === prompt) return past ? null : true;
  if (inner === '') return false; // an empty frame holds no prompt, however short this one is (review round 8)
  return inner.includes(prompt) || prompt.includes(inner) ? null : false;
}

/** The text of the content part that holds the query — grok's note follows the query in that same part. */
function queryPart(content: unknown): string | undefined {
  if (typeof content === 'string') return content.includes(QUERY_START) ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    const text = (part as { text?: unknown } | null)?.text;
    if (typeof text === 'string' && text.includes(QUERY_START)) return text;
  }
  return undefined;
}

/**
 * grok's note in what follows the query: the last of its marks there that starts a line, and where it starts. The query,
 * which can quote either note, is not read (Grok, round 2); an attached file's lines are numbered (MEASURED on 1.0.52),
 * so a mark one quotes never starts a line (review round 10: read after a block's last empty line instead, a note
 * followed by an empty line was missed, and one with an empty line inside it).
 */
function lastNote(text: string): { told: OffloadTold; at: number } {
  const where = (mark: string) => {
    const at = text.lastIndexOf(`\n${mark}`);
    return at >= 0 ? at : text.startsWith(mark) ? 0 : -1;
  };
  const offloaded = where(OFFLOADED_MARK);
  const notSaved = where(NOT_SAVED_MARK);
  if (offloaded < 0 && notSaved < 0) return { told: 'unknown', at: -1 };
  return notSaved > offloaded ? { told: 'not_saved', at: notSaved } : { told: 'file', at: offloaded };
}

/** Whether what follows the query opens with a reminder block, after however many line breaks and spaces. */
function opensWithReminder(rest: string): boolean {
  let i = 0;
  while (i < rest.length && (rest[i] === '\n' || rest[i] === '\r' || rest[i] === ' ' || rest[i] === '\t')) i += 1;
  return rest.startsWith(REMINDER_OPEN, i);
}

/**
 * A user turn grok recorded: its prompt_index, whether its query can be this prompt (isThisPrompt), whether grok kept
 * this prompt and its attached files whole (the query is this prompt, no note follows it, nor a block that lost its
 * end), whether grok cut the turn (its note follows — review round 4: a shorter prompt recorded whole was read as cut;
 * round 8: grok cut the attached files of a prompt it kept whole), what it cut, what grok's note says, and what grok
 * added to the prompt there (attached files, a skill's block — review round 13). A turn whose block lost its end with no
 * known mark after it is neither whole nor cut (review round 9).
 */
interface RecordedTurn {
  index: number; mine: boolean; whole: boolean; cut: boolean; parts: CutParts; told: OffloadTold; added: Added;
}

/**
 * The user turns grok recorded in a session's chat_history.jsonl (readHistory), last first, each matched against
 * `prompt` (as grok keeps it); null when the file cannot be read. A turn's prompt_index only pairs it with a file the
 * folder lists, so no number builds a path (review round 1: 1e400 once named prompt_Infinity.txt).
 */
async function recordedTurns(folder: string, prompt: string, fromByte: number | undefined): Promise<RecordedTurn[] | null> {
  const text = await readHistory(join(folder, 'chat_history.jsonl'), fromByte);
  if (text === null) return null;
  const mentions = MENTION.test(prompt);
  const invokes = prompt.startsWith('/'); // the prompt as grok keeps it: mayInvokeSkill
  const turns: RecordedTurn[] = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"prompt_index"')) continue;
    let entry: { type?: unknown; prompt_index?: unknown; content?: unknown } | null;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    const promptIndex = entry?.prompt_index;
    if (entry?.type !== 'user' || typeof promptIndex !== 'number') continue;
    const part = queryPart(entry.content);
    if (part === undefined) continue;
    const start = part.indexOf(QUERY_START) + QUERY_START.length;
    // The query ends at the last closing tag that starts a line: the prompt can quote one, but neither grok's note nor
    // the block of attached files after it holds one — grok numbers each attached line (MEASURED on 1.0.52, review
    // rounds 7–8: a file whose lines are grok's tags left them all inside numbered lines). A skill's block repeats the
    // prompt unnumbered, so for a prompt that may invoke a skill the query ends where that block opens (review round 13).
    const seam = invokes ? skillSeam(part, start) : -1;
    const end = seam >= 0 ? seam : part.lastIndexOf(FRAME_END);
    if (end < start) continue; // no closing tag: nothing is known to follow the query
    let query = part.slice(start, end);
    if (query.startsWith('\n')) query = query.slice(1); // the frame's own line break
    query = leadTrimmed(query);
    // After it: a skill's block where the prompt invoked one, read past its last line that starts with the end tag —
    // grok kept that end when it cut the block's middle, and nothing after it holds such a line (MEASURED on 1.0.52,
    // review round 13); then reminder blocks — the one of attached files, if the prompt mentioned files, on turns grok did
    // not cut as well — then grok's note (lastNote). Where grok cut the attached files, their block has lost its end
    // before the note (MEASURED on 1.0.52, review round 8). When what follows the query opens with either block, only a
    // known mark makes the turn cut — anything else there is a later layout or a reworded note — and a block that lost its
    // end is never whole (review rounds 9–10: the first would otherwise hedge on every mention, the second hide this run's
    // file; round 13: on every skill). When it opens otherwise, any text is grok's note (review round 7: one in words this
    // wrapper does not know).
    let rest = part.slice(end + FRAME_END.length);
    const skill = seam >= 0;
    let skillOpen = false;
    if (skill) {
      const close = rest.lastIndexOf(`\n${SKILL_END}`);
      if (close >= 0) rest = rest.slice(close + 1 + SKILL_END.length);
      else skillOpen = true;
    }
    const { told, at } = lastNote(rest);
    const before = at < 0 ? rest : rest.slice(0, at);
    const reminder = opensWithReminder(rest);
    const filesOpen = reminder && !before.includes(BLOCK_END);
    const cut = told !== 'unknown' || (!skill && !reminder && rest.trim() !== '');
    // What was left out: the prompt's middle where the query is cut; the files' end where grok's file note names
    // attached lines, or — its not-saved note naming none — where their block lost its end before it. Only a turn of a
    // prompt that may mention a file (MENTION matches more than grok attaches) whose attached files' tag comes before the
    // note had files attached: each guard alone let a turn name files never attached (review round 11: an @Override in a
    // long prompt; round 12: a reminder quoting the tag ahead of the note of a prompt with no @).
    const attached = mentions && before.includes(ATTACHED_FILES);
    const files = attached && (told === 'file' ? rest.includes(ATTACHED_LINES, at) : told === 'not_saved' && filesOpen);
    turns.push({
      index: promptIndex,
      mine: isThisPrompt(query, prompt),
      whole: query === prompt && !skillOpen && !filesOpen && !cut,
      cut,
      parts: { prompt: query !== prompt, files },
      told,
      added: { files: attached, skill },
    });
  }
  return turns;
}

/**
 * A59: the file grok cut this run's prompt into and what grok told the model; with no file known to be this run's, the
 * files that could be — or none — attributed to nothing. undefined when there is nothing to say. `shown`: what grok
 * added to the prompt on the tied turn, or on any turn of this prompt read when none is tied — undefined without one.
 */
async function findOffload(
  index: SessionsIndex, sessionIds: Array<string | undefined>, snapshot: OffloadSnapshot | undefined,
  spawnedAtMs: number, prompt: string, mostKeptBytes: number,
): Promise<{ files: string[]; told: OffloadTold; cut?: CutParts; shown?: Added } | undefined> {
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  // A file holds at most what a grok keeps of the prompt — 1.0.50 keeps a U+FEFF and all after it, which the comparison
  // leaves out (review round 6: 70 KiB of spaces after it), but no blank run before it (round 7) — plus frame and room.
  const maxBytes = mostKeptBytes + PROMPT_FILE_SLACK_BYTES;
  for (const sessionId of new Set(sessionIds.filter((id): id is string => id !== undefined))) {
    const folder = sessionFolderOf(sessionId, index);
    if (folder === undefined) continue;
    const listing = snapshot !== undefined && snapshot.sessionId === sessionId ? snapshot : undefined;
    const minted = listing?.minted === true;
    const checkedAtMs = Date.now();
    const fresh = (name: string, now: { stamp: string; mtimeMs: number }) => (listing
      ? listing.files.get(name) !== now.stamp
      : writtenByTime(now.mtimeMs, spawnedAtMs, checkedAtMs));
    // The latest line of each prompt_index whose query can be this prompt (a rewound session records a number again).
    const lines = new Map<number, RecordedTurn>();
    for (const turn of await recordedTurns(folder, prompt, listing?.historyBytes) ?? []) {
      if (turn.mine && !lines.has(turn.index)) lines.set(turn.index, turn);
    }
    // The files written during the run and those of this prompt's turns, each read for this prompt.
    const held: Array<{ path: string; index: number; fresh: boolean; holds: boolean | null }> = [];
    for (const name of promptFileNames(folder)) {
      const path = join(folder, 'prompts', name);
      const now = stampOf(path);
      if (now === undefined) continue;
      const n = Number(PROMPT_FILE.exec(name)?.[1]);
      const written = fresh(name, now);
      // An older file is read only where no listing says it was there before the spawn, and a line of this prompt names it.
      if (!written && (listing !== undefined || !lines.has(n))) continue;
      held.push({
        path, index: n, fresh: written,
        // At least the frame and one byte, however short the prompt (review round 8: an empty file passed for a short one's).
        holds: await holdsPrompt(path, prompt,
          Math.max(promptBytes - PROMPT_END_SLACK_BYTES, FRAME_START.length + FRAME_END.length + 1), maxBytes),
      });
    }
    // A number has a file only by one read here: written during the run, or — without a listing — named by a line of this
    // prompt. Under a listing a turn recorded during the run whose number holds only an older file left none of its own
    // (review round 5).
    const filed = new Set(held.map((file) => file.index));
    // In the minted folder this run's turn is 0: prompt_0.txt is its file unless it cannot hold this prompt, and with line
    // 0 recorded no other number's file is (review round 5). The content decides there only without line 0 (a later grok
    // that numbers otherwise).
    const zero = minted ? held.find((file) => file.fresh && file.index === 0) : undefined;
    const mine = zero !== undefined && zero.holds !== false ? [zero]
      : minted && lines.has(0) ? []
        : held.filter((file) => file.fresh && file.holds === true);
    const turns = minted && lines.has(0) ? [lines.get(0)!] : [...lines.values()];
    // Another cut turn of this prompt whose number has no file: the same prompt sent at once by another run, and the one
    // file found may be that run's (review round 4). A turn of this prompt kept whole: this run's may be that one — grok
    // cuts a prompt with @-mentions by its files too, which change between runs (review round 9). Without a listing only
    // a later one counts, an earlier one being an earlier run's as likely; under a listing the lines read were appended
    // during the run, so any does (review round 10: two resumes of one prompt at once, the files grown in between).
    const doubted = mine.length === 1
      && turns.some((turn) => turn.index !== mine[0].index
        && ((turn.cut && !filed.has(turn.index)) || (turn.whole && (listing !== undefined || turn.index > mine[0].index))));
    if (mine.length === 1) {
      const line = lines.get(mine[0].index);
      if (line?.whole) return undefined; // grok kept the prompt and its files whole: nothing was cut
      if (!doubted) return { files: [mine[0].path], told: line?.told ?? 'unknown', cut: line?.parts, shown: line?.added };
    }
    // A turn of this prompt kept whole says nothing was cut — unless another was cut: without a listing a later one, by
    // prompt_index as above (review round 9: kept whole on an earlier run, its files cut on this one; round 10: cut on an
    // earlier run, the files made smaller as the advice says, kept whole on this one); under a listing any, since the
    // lines read were appended during the run and either may be this run's (review round 11).
    const lastCut = turns.reduce((most, turn) => (turn.cut && turn.index > most ? turn.index : most), -1);
    if (mine.length === 0
      && turns.some((turn) => turn.whole && (listing === undefined ? turn.index > lastCut : lastCut < 0))) return undefined;
    // No file is this run's. In the minted folder line 0 is this run's own turn: its note that the file was not saved means
    // what grok left out was lost, whatever any prompt_0.txt or another run's file holds (review round 5).
    if (minted && turns[0]?.index === 0 && turns[0].told === 'not_saved') {
      return { files: [], told: 'not_saved', cut: turns[0].parts, shown: turns[0].added };
    }
    const shown = turns.length === 0 ? undefined
      : { files: turns.some((turn) => turn.added.files), skill: turns.some((turn) => turn.added.skill) };
    const files = minted ? mine : held.filter((file) => file.holds === true || (file.fresh && file.holds === null));
    if (files.length > 0) {
      return { files: files.map((file) => file.path).sort((a, b) => fileNumber(a) - fileNumber(b)), told: 'unattributed', shown };
    }
    if (turns.some((turn) => turn.cut)) return { files: [], told: 'unattributed', shown };
  }
  return undefined;
}

const fileNumber = (path: string): number => Number(PROMPT_FILE.exec(basename(path))?.[1] ?? 0);

/** A59: the warning for a run whose request grok cut — appended after every other notice. */
async function noteOffload(
  result: DelegateResult, prompt: string, index: SessionsIndex, sessionIds: Array<string | undefined>,
  snapshot: OffloadSnapshot | undefined, spawnedAtMs: number,
): Promise<DelegateResult> {
  if (!mayBeCut(prompt) || result.status === 'auth_error') return result;
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  const found = await findOffload(index, sessionIds, snapshot, spawnedAtMs, keptByGrok(prompt),
    Buffer.byteLength(trimmedOfWhiteSpace(prompt), 'utf8'));
  if (found === undefined) return result;
  // The subject names what grok's record shows it added to the prompt: the attached files where grok cut them, a skill's
  // block wherever it shows one (the block holds the prompt twice), and — under the boundary, where the prompt alone was
  // not long — the files it shows; with no record, or one that shows neither under the boundary, what the prompt may have
  // added (review rounds 13–14).
  const under = promptBytes < OFFLOAD_MIN_BYTES;
  const mentions = MENTION.test(prompt);
  const invokes = mayInvokeSkill(prompt);
  const files = found.cut?.files === true || (under && (found.shown ? found.shown.files : mentions));
  const skill = found.shown ? found.shown.skill : under && invokes;
  const added = under && !files && !skill ? { files: mentions, skill: invokes } : { files, skill };
  return { ...result, message: joinMessage(result.message, offloadNote(promptBytes, found.files, found.told, found.cut, added)) };
}

/**
 * Whether a plan run wrote. undefined (not false) when the cwd is not a git repo: nothing was verified,
 * and saying "nothing changed" there would be the same silent lie this field exists to end. A42: a plan
 * that COMMITTED wrote files too — its edits left the porcelain listing and `git diff HEAD` exactly as they
 * were, so the fingerprint alone called it clean.
 */
function planWrote(
  committed: boolean | undefined, filesChanged: string[], prints: Array<[string | null, string | null]>,
): boolean | undefined {
  if (committed === true || filesChanged.length > 0) return true;
  return changedIn(prints);
}

/**
 * A before/after reading taken in every folder grok may have worked in: `true` if any readable one changed, otherwise
 * `undefined` if any could not be read, and `false` only when every one was read and none changed.
 *
 * A49: HEAD (and the plan fingerprint) used to be read in the REQUESTED folder only. A `resume` runs where the session
 * lives (grok's --resume overrides --cwd — A3), so a commit made there left the requested HEAD alone and the result said
 * `committed: false`, "verified", about a folder grok never worked in. `filesChanged` already read both (A3).
 */
/** HEAD, and on a plan run the dirty-tree fingerprint, of each folder in order — one call per reading, in sequence. */
async function readFolders(
  folders: string[], plan: boolean,
  gitHead: (cwd: string) => Promise<string | null>,
  gitDirtyFingerprint: (cwd: string) => Promise<string | null>,
): Promise<Array<{ head: string | null; print: string | null }>> {
  const states: Array<{ head: string | null; print: string | null }> = [];
  for (const dir of folders) states.push({ head: await gitHead(dir), print: plan ? await gitDirtyFingerprint(dir) : null });
  return states;
}

function changedIn(pairs: Array<[string | null, string | null]>): boolean | undefined {
  let unread = false;
  for (const [before, after] of pairs) {
    if (before === null || after === null) unread = true;
    else if (before !== after) return true;
  }
  return unread ? undefined : false;
}

export async function runDelegate(
  mode: AuthMode,
  input: DelegateInput,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const gitChangedFiles = deps.gitChangedFiles ?? defaultGitChangedFiles;
  const gitDirtyFingerprint = deps.gitDirtyFingerprint ?? defaultGitDirtyFingerprint;
  const gitHead = deps.gitHead ?? defaultGitHead;
  const dirExists = deps.dirExists ?? defaultDirExists;
  const billing = billingFor(mode);

  // Validate cwd before spawning: a relative path would resolve against the MCP
  // server's own cwd (not the user's project), and a missing dir yields an opaque
  // spawn error. Fail early with an actionable, mode/billing-tagged message.
  if (!isAbsolute(input.cwd)) {
    return { status: 'grok_error', mode, billing, message: 'cwd는 절대 경로여야 합니다.' };
  }
  if (!dirExists(input.cwd)) {
    return { status: 'grok_error', mode, billing, message: 'cwd 디렉토리가 존재하지 않거나 디렉토리가 아닙니다.' };
  }

  const timeoutMs = input.timeoutMs ?? 180_000;
  const createWorktree = deps.createWorktree ?? ((c: string) => createGrokWorktree(c));

  // Validate opt-in CLI strengths before any worktree/spawn side effects.
  const options = validateDelegateOptions(input);
  if (!options.ok) {
    return { status: 'grok_error', mode, billing, message: options.message };
  }

  // Opt-in isolation: run grok in a fresh wrapper-created worktree (grok's own
  // --worktree is a headless no-op). grok edits effectiveCwd, and filesChanged is
  // derived there, so in worktree mode every change is grok's (precise attribution).
  // A creation failure fails the delegation — we never silently edit cwd instead.
  let effectiveCwd = input.cwd;
  let worktreePath: string | undefined;
  if (input.worktree) {
    try {
      worktreePath = await createWorktree(input.cwd);
      effectiveCwd = worktreePath;
    } catch (e) {
      // Carry the real cause: a bulk-timeout SIGTERM on a large checkout is not the same
      // problem as "this is not a git repo", and guessing sends the user the wrong way.
      const cause = e instanceof Error ? e.message : String(e);
      return {
        status: 'grok_error', mode, billing,
        message: `worktree 생성에 실패했습니다 (${cause}) — cwd가 커밋이 있는 git 저장소인지 확인하세요.`,
      };
    }
  }

  // Snapshot dirty paths before spawn so filesChanged can exclude pre-existing dirt
  // (after \ before). Plan runs snapshot the tree too. A plan is meant not to edit, so the point is not to
  // report edits but to CATCH them. grok 1.0.13 wrote under --permission-mode plan and 1.0.30 refused
  // (re-measured 2026-09-22), and the user's own allow rules approved writes under plan on 1.0.41/1.0.44
  // (contract §6) until A50 made every plan carry PLAN_DENY_ARGS. The check does not move with any of
  // that — the CLI updates itself, so this must not depend on which behaviour today's grok has.
  const beforeFiles = await gitChangedFiles(effectiveCwd);

  // Built only now: grok runs in effectiveCwd, and a relative GROK_HOME resolves there (A35).
  const sessionsIndex = deps.sessionsIndex ?? defaultSessionsIndex(deps.env ?? process.env, effectiveCwd);

  // A3: `--resume` overrides `--cwd`, so a resumed session writes into ITS directory, not ours.
  // Resolve that before the spawn — only then can the delta there be attributed to this run.
  // `--continue` names no session up front, so it is handled after the spawn, with a warning but
  // no file claim: an after-only listing would blame this run for whatever was already dirty.
  const resumeOwner = input.resumeSessionId
    ? resolveSessionCwd(input.resumeSessionId, sessionsIndex)
    : undefined;
  const resumedElsewhere = resumeOwner && !sameDirectory(resumeOwner, effectiveCwd) ? resumeOwner : undefined;
  const beforeResumed = resumedElsewhere ? await gitChangedFiles(resumedElsewhere) : undefined;
  // A32: HEAD on every run, not just plan — a commit hides its own edits from `filesChanged`, so the delegations that
  // most need the check are ordinary ones. A49: in every folder grok may work in — a resume's own folder is where its
  // commit or write lands. Plan runs also fingerprint the dirty tree (A42).
  const workFolders = resumedElsewhere ? [effectiveCwd, resumedElsewhere] : [effectiveCwd];
  const before = await readFolders(workFolders, input.plan === true, gitHead, gitDirtyFingerprint);

  const env = buildGrokEnv(mode, deps.env ?? process.env);
  // A32: the no-commit constraint rides on every run. VERIFY_PROMPT_SUFFIX already ends with
  // "Do not commit", so adding both would repeat the instruction — `check` runs get that one.
  const prompt = input.check
    ? `${input.prompt}${VERIFY_PROMPT_SUFFIX}`
    : `${input.prompt}${NO_COMMIT_PROMPT_SUFFIX}`;
  /*
   * B1: name the session BEFORE the run, so a run that never prints an envelope still leaves a
   * handle. MEASURED 2026-09-22 on 1.0.30: a caller-minted v4 UUID is accepted and echoed back,
   * and a run SIGKILLed at 25s still left a full session under it (chat_history.jsonl 54KB,
   * listed by `grok sessions list`). Without this, the only runs with no handle were the ones
   * that cost the most — 82 of the owner's 845 recorded delegations timed out, none resumable.
   *
   * Not minted for resume/continue: `grok --help` says `-s` is legal with those only alongside
   * `--fork-session`, which this wrapper does not pass, so minting there would exit 2 on every
   * resume.
   */
  const mintedSessionId = (input.resumeSessionId === undefined && !input.continueSession)
    ? randomUUID()
    : undefined;

  const promptArgs = promptArgv(prompt);
  if (!promptArgs.ok) {
    return { status: 'grok_error', mode, billing, message: promptArgs.message, worktreePath };
  }

  // A59: a prompt grok may cut. The prompt files its session folder already holds, wherever that folder can be named now —
  // none under a freshly minted id, the listing of a resume the index finds — so a file an earlier turn left is never
  // taken for this run's. A continue's session is named only after the run.
  const offloadsBefore = mayBeCut(prompt) ? offloadSnapshot(mintedSessionId, input.resumeSessionId, sessionsIndex) : undefined;

  const args = [
    '--no-auto-update',
    ...(input.plan ? ['--permission-mode', 'plan', ...PLAN_DENY_ARGS] : ['--always-approve']),
    '--cwd', effectiveCwd,
    ...promptArgs.args, '--output-format', 'json',
    ...(mintedSessionId ? ['--session-id', mintedSessionId] : []),
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
    ...options.extraArgs,
  ];

  const spawnedAt = Date.now();
  const r = await spawnThenRemove(spawnFn, args, effectiveCwd, env, timeoutMs, promptArgs.dir);

  if (r.spawnError) {
    return {
      status: 'grok_error', mode, billing,
      message: startFailureMessage(effectiveCwd, r.stderr),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      worktreePath,
    };
  }

  // Surfacing changed files on abort paths is required by the safety model: grok can
  // leave partial edits even when it does not finish. Delta = after \ before so
  // pre-dirty unrelated files are not attributed to Grok (pre-dirty files Grok also
  // edits may under-report — use worktree:true for full attribution on dirty trees).
  const afterFiles = await gitChangedFiles(effectiveCwd);
  const requestedDelta = diffChangedFiles(beforeFiles, afterFiles);
  // Union of both directories: the caller asked about a run, not about a path, and with a
  // relocated resume the requested cwd is precisely the one with nothing in it.
  const filesChanged = beforeResumed
    ? [...requestedDelta, ...diffChangedFiles(beforeResumed, await gitChangedFiles(resumedElsewhere!))]
    : requestedDelta;
  // A32: undefined (not false) when either read failed — outside a git repo nothing was verified,
  // and "did not commit" would be the same silent lie `planWroteFiles` exists to end. A49: in every folder grok may
  // have worked in (changedIn).
  const after = await readFolders(workFolders, input.plan === true, gitHead, gitDirtyFingerprint);
  const committed = changedIn(before.map((b, i) => [b.head, after[i].head]));
  const planWroteFiles = input.plan
    ? planWrote(committed, filesChanged, before.map((b, i) => [b.print, after[i].print]))
    : undefined;
  const moved = movedHeads(workFolders, before, after);

  const result = noteMeasurements(classifySpawnResult(r, input, {
    mode, billing, timeoutMs, filesChanged, worktreePath, planWroteFiles, committed, moved, mintedSessionId,
  }), { committed, planWroteFiles, moved, worktreePath, plan: input.plan === true });
  // A68: grok worked nowhere and sent no model request (1.0.52's record in contract §1 ③; 1.0.70's log, 2026-10-27) — so no
  // "it worked in that folder" note for a resume, and no note about what a model request left out.
  if (r.signInStarted) return result;
  const annotated = annotateResumedCwd(result, input, effectiveCwd, { resumeOwner, resumedElsewhere }, sessionsIndex);
  return noteOffload(annotated, prompt, sessionsIndex, [mintedSessionId, annotated.sessionId, input.resumeSessionId],
    offloadsBefore, spawnedAt);
}

/** The folders whose HEAD was read before and after and changed — what a commit notice names. */
function movedHeads(
  folders: string[], before: Array<{ head: string | null }>, after: Array<{ head: string | null }>,
): MovedHead[] {
  const moved: MovedHead[] = [];
  folders.forEach((dir, i) => {
    const b = before[i].head;
    const a = after[i].head;
    if (b !== null && a !== null && b !== a) moved.push({ dir, before: b });
  });
  return moved;
}

/**
 * A3: state the relocation instead of leaving the caller to infer it from an empty list.
 *
 * For `--resume` the directory is already known (resolved before the spawn). For `--continue` the
 * session id only comes back in grok's output, so it is resolved here — and reported WITHOUT a
 * file claim, because there is no before-snapshot of that directory to subtract.
 */
function annotateResumedCwd(
  result: DelegateResult,
  input: DelegateInput,
  requestedCwd: string,
  where: { resumeOwner: string | undefined; resumedElsewhere: string | undefined },
  sessionsIndex: SessionsIndex,
): DelegateResult {
  const continued = input.continueSession ? resolveSessionCwd(result.sessionId, sessionsIndex) : undefined;
  const owner = where.resumedElsewhere ?? (continued && !sameDirectory(continued, requestedCwd) ? continued : undefined);
  let out = located(input, where.resumeOwner, continued, requestedCwd) ? result : unverified(result);
  if (owner) {
    const note = `resume한 세션은 ${owner}에 속해 있어 grok이 요청한 cwd(${requestedCwd})가 아니라 그 디렉터리에서 작업했습니다 (grok의 --resume이 --cwd를 덮어씁니다).`;
    out = { ...out, resumedCwd: owner, message: joinMessage(out.message, note) };
  }
  return out;
}

/**
 * Was every folder grok worked in measured before and after? A plain run works where it was asked; a `resume` works in
 * its session's folder, known before the spawn only when the session was found (then both folders were read); a
 * `continue` names its session only after the run, so only a session found in the requested folder is covered.
 *
 * A49 round 2 (pre-merge review, found by two reviewers): the first A49 fix demoted `false` only for a `continue` that
 * resolved ELSEWHERE. A `continue` that ended with no envelope (no session id to resolve), or a `resume` whose session
 * was not in the index, kept `committed: false` read from the requested folder — and since A49 states `committed` on
 * failed endings, that became a new "verified: no commit" (measured on the bundle: the continued folder had a commit).
 */
function located(input: DelegateInput, resumeOwner: string | undefined, continued: string | undefined, requestedCwd: string): boolean {
  if (input.resumeSessionId !== undefined) return resumeOwner !== undefined;
  if (input.continueSession) return continued !== undefined && sameDirectory(continued, requestedCwd);
  return true;
}

/** "Unchanged" where grok did not demonstrably work verifies nothing: a `false` becomes "could not check", and says so. */
function unverified(result: DelegateResult): DelegateResult {
  if (result.committed !== false && result.planWroteFiles !== false) return result;
  const { committed, planWroteFiles, ...rest } = result;
  return {
    ...rest,
    ...(committed === true ? { committed } : {}),
    ...(planWroteFiles === true ? { planWroteFiles } : {}),
    message: joinMessage(result.message,
      '이 실행이 어느 폴더에서 일했는지 실행 전에 알 수 없어(세션을 찾지 못했거나 continue가 다른 폴더로 이어졌습니다) '
      + 'grok이 커밋·쓰기를 했는지 확인하지 못했습니다 — `committed`가 없다는 것은 "커밋 없음"이 아닙니다.'),
  };
}
