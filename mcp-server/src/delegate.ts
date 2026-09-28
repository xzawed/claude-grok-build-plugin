import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { constants, statSync, existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { lstat, open, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { buildGrokEnv, grokHome, grokHomeFor } from './env.js';
import { normalizeCwd } from './usage.js';
import { isSuccessfulStopReason, parseGrokResult } from './grok-result.js';
import { createGrokWorktree } from './worktree.js';
import { parsePorcelain, untrackedPaths } from './git-porcelain.js';
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
// in". It exits 1 after ~25-30s with a 401 envelope whose only auth wording is "Invalid or
// expired credentials", followed by xAI's boilerplate "Your session is still signed in ... no
// need to run /login". Without the last signal below, that classified as grok_error and handed
// the user advice that is the exact opposite of what they must do.
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
  };
}

/** The directory a session belongs to, or undefined when it cannot be established. */
export function resolveSessionCwd(sessionId: string | undefined, index: SessionsIndex): string | undefined {
  if (!sessionId) return undefined;
  for (const dir of index.listSessionDirs()) {
    if (!index.sessionDirHasId(dir, sessionId)) continue;
    try { return decodeURIComponent(dir); } catch { return undefined; }
  }
  return undefined;
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

/** The bounded subprocess runner behind `defaultSpawn`; the command is a parameter so tests can run it. */
export function spawnBounded(
  command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
  graceMs: number = EXIT_GRACE_MS,
): Promise<SpawnResult> {
  return new Promise((resolve) => {
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
      resolve(result);
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

export const defaultSpawn: SpawnFn = (args, cwd, env, timeoutMs) => spawnBounded('grok', args, cwd, env, timeoutMs);

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
    return null; // not a git repo, no HEAD yet, git unavailable, timeout, or huge output
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
 * Deliberately NOT `--rules` (1.0.30, measured working): that flag is absent from the 1.0.13
 * snapshot this wrapper still supports, and an unconditional unknown flag exits 2 on every
 * delegation. A suffix cannot break a CLI version.
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
    // still reads (`committed: false` beside "not a repo") — so the causes are possibilities, never an assertion.
    return {
      message:
        'plan 실행 중 파일이 변경됐는지 확인할 수 없었습니다 (grok이 일했을 수 있는 폴더의 작업 트리를 읽지 못했습니다 — '
        + 'git 저장소가 아니거나, 커밋이 없거나, git이 제시간에 답하지 못했거나 출력이 너무 컸을 수 있습니다). '
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
 */
export function shellDir(dir: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const path = platform === 'win32' ? dir.split('\\').join('/') : dir;
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
    // That was measured and true then, and is false on 1.0.30 — re-measured 2026-09-22, plan mode
    // now refuses the write (no file created, stopReason `cancelled`). The check stays exactly as
    // it is; only the blame was removed. A user-facing string must not pin a version claim about a
    // CLI that updates itself, because `planWroteFiles === true` is a fact about THIS run whatever
    // the current grok does with the flag.
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
  // `--prompt-file` takes the text as-is, a leading `-` included (contract §1, measured 2026-09-22).
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
  // (after \ before). Plan runs snapshot the tree too. They are supposed to be read-only, so the point is not to
  // report edits but to CATCH them. grok 1.0.13 ignored --permission-mode plan and wrote anyway;
  // 1.0.30 refuses (re-measured 2026-09-22). The snapshot moved, the check does not — the CLI
  // updates itself, so this must not depend on which behaviour today's grok has.
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

  const args = [
    '--no-auto-update',
    ...(input.plan ? ['--permission-mode', 'plan'] : ['--always-approve']),
    '--cwd', effectiveCwd,
    ...promptArgs.args, '--output-format', 'json',
    ...(mintedSessionId ? ['--session-id', mintedSessionId] : []),
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
    ...options.extraArgs,
  ];

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
  return annotateResumedCwd(result, input, effectiveCwd, { resumeOwner, resumedElsewhere }, sessionsIndex);
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
