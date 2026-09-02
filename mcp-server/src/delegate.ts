import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildGrokEnv } from './env.js';
import { isSuccessfulStopReason, parseGrokResult } from './grok-result.js';
import { createGrokWorktree } from './worktree.js';
import type { AuthMode, Billing, DelegateInput, DelegateResult } from './types.js';

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
// Non-timeout auth text (parse fail, type:error JSON, non-EndTurn). Broad 401/403 excluded.
export const AUTH_ERROR_SIGNALS = [
  /not signed in/i,
  /not authenticated/i,
  /grok login --device-code/i,
  /grok login/i,
  /set the xai_api_key/i,
];

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
}

export type SpawnFn = (
  args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
) => Promise<SpawnResult>;

export type GitChangedFilesFn = (cwd: string) => string[] | Promise<string[]>;
export type DirExistsFn = (cwd: string) => boolean;

export interface DelegateDeps {
  spawn?: SpawnFn;
  gitChangedFiles?: GitChangedFilesFn;
  dirExists?: DirExistsFn;
  env?: NodeJS.ProcessEnv;
  createWorktree?: (cwd: string) => Promise<string>;
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
export const defaultSpawn: SpawnFn = (args, cwd, env, timeoutMs) =>
  new Promise((resolve) => {
    // detached (POSIX) makes grok a process-group leader so a timeout can kill its
    // whole subtree (git/LSP/sub-agents), not just the grok PID leaving orphans.
    // stdin is /dev/null on purpose: this wrapper is headless-only (prompts arrive as
    // -p/--prompt-file argv), and a live stdin pipe turns any grok confirmation prompt into
    // a wait for input that nothing will ever write — measured on 1.0.5, `memory clear`
    // without -y sat on "Are you sure? [y/N]" until the timeout killed it, having cleared
    // nothing. On EOF grok declines and exits instead, so an unguarded prompt fails fast.
    const child = spawn('grok', args, {
      cwd, env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // setEncoding routes chunks through a StringDecoder that buffers partial multi-byte
    // UTF-8 across 'data' events, so CJK/emoji spanning a chunk boundary is not garbled.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const killTree = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout = appendBounded(stdout, String(d), STDOUT_CAP_BYTES, 'head'); });
    child.stderr.on('data', (d) => { stderr = appendBounded(stderr, String(d), STDERR_CAP_BYTES, 'tail'); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || err.message, timedOut, spawnError: true });
    });
  });

// Parses `git status --porcelain -z` (with core.quotepath=false) into changed paths.
// -z is NUL-separated and does NOT C-quote, so spaces/unicode survive. Rename/copy
// entries emit the NEW path then a following NUL field with the original path, which
// is skipped. Kept pure and exported so it can be unit-tested without invoking git.
export function parsePorcelain(zOutput: string): string[] {
  const fields = zOutput.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const path = field.slice(3); // 2-char XY status + 1 separator space, then the path
    if (path) paths.push(path);
    if (field[0] === 'R' || field[0] === 'C') i += 1; // skip the original-path field
  }
  return paths;
}

export const defaultGitChangedFiles: GitChangedFilesFn = async (cwd) => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', 'status', '--porcelain', '-z'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return parsePorcelain(stdout as string);
  } catch {
    return []; // not a git repo, git unavailable, timeout, or huge output
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
}

// Safe tokens for opt-in CLI flags (model / effort / session id / sandbox profile).
// Hyphen allowed (built-in sandbox profile `read-only`). Reject shell-ish chars.
// Length cap avoids pathological argv. Exported for unit tests.
export const SAFE_CLI_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._@+/-]{0,127}$/;
export const BEST_OF_N_MIN = 2;
export const BEST_OF_N_MAX = 4;

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

// Turns a completed (non-spawn-error) grok spawn result into a DelegateResult:
// timeout → parse (auth_error/grok_error) → plan-success → EndTurn success/failure.
function classifySpawnResult(r: SpawnResult, input: DelegateInput, ctx: ClassifyCtx): DelegateResult {
  const { mode, billing, timeoutMs, filesChanged, worktreePath } = ctx;

  if (r.timedOut) {
    // Device-OAuth block → timeout (2026-07-13). stderr-only device markers — never stdout.
    if (isTimedOutDeviceAuth(r.stderr)) {
      return {
        status: 'auth_error', mode, billing,
        message: authNeededMessage(mode, { timedOutDeviceFlow: true }),
        rawStderrTail: (r.stderr || '').slice(-500), filesChanged, worktreePath,
      };
    }
    return {
      status: 'timeout', mode, billing,
      message: `Grok Build 작업이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다. 범위를 줄이거나 timeout_ms를 늘려 다시 시도하세요.`,
      filesChanged, worktreePath,
    };
  }

  let parsed;
  try {
    parsed = parseGrokResult(r.stdout);
  } catch {
    const tail = (r.stderr || r.stdout).slice(-500);
    if (looksLikeAuthFailure(r.stderr, r.stdout)) {
      return {
        status: 'auth_error', mode, billing, message: authNeededMessage(mode),
        rawStderrTail: tail, filesChanged, worktreePath,
      };
    }
    return { status: 'grok_error', mode, billing, message: 'Grok Build 출력을 해석할 수 없습니다.', rawStderrTail: tail, filesChanged, worktreePath };
  }

  const sid = parsed.sessionId;

  // Auth on the measured error envelope only — never scan successful assistant text.
  // A completed/plan summary can mention `grok login` (docs, comments) without being unauth.
  if (parsed.isError && looksLikeAuthFailure(r.stderr, r.stdout, parsed.text)) {
    return withSession({
      status: 'auth_error', mode, billing,
      message: authNeededMessage(mode),
      rawStderrTail: (r.stderr || '').slice(-500) || undefined,
      filesChanged, worktreePath,
    }, sid);
  }

  // Other CLI error envelopes (not auth) — never treat as a successful plan/delegate.
  if (parsed.isError) {
    return withSession({
      status: 'grok_error', mode, billing,
      message: (parsed.text || 'Grok Build가 오류로 종료했습니다.').trim(),
      rawStderrTail: (r.stderr || '').slice(-500) || undefined,
      filesChanged, worktreePath,
    }, sid);
  }

  // Plan mode: 1.0.3 ends `end_turn` + text and does not edit; 0.2.x used `Cancelled` + text.
  // Any parsed result WITH text is a successful plan (not an error); filesChanged stays [].
  if (input.plan) {
    const planText = (parsed.text ?? '').trim();
    if (!planText) {
      return withSession(
        { status: 'grok_error', mode, billing, message: 'Grok Build가 계획을 반환하지 않았습니다.', filesChanged, worktreePath },
        sid,
      );
    }
    return withSession(
      { status: 'completed', mode, billing, summary: parsed.text, filesChanged, worktreePath },
      sid,
    );
  }

  // Exit code is 0 even on cancel — success is decided by stopReason
  // (1.0 `end_turn` or legacy `EndTurn`; see isSuccessfulStopReason).
  // Non-success: only stderr auth markers (same rule as timeout — do not scan text).
  if (!isSuccessfulStopReason(parsed.stopReason)) {
    if (looksLikeAuthFailure(r.stderr)) {
      return withSession({
        status: 'auth_error', mode, billing,
        message: authNeededMessage(mode),
        rawStderrTail: r.stderr.slice(-500) || undefined,
        filesChanged, worktreePath,
      }, sid);
    }
    return withSession({
      status: 'grok_error', mode, billing,
      message: `Grok Build가 완료되지 않았습니다 (stopReason: ${parsed.stopReason || 'unknown'}). ${parsed.text}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      filesChanged, worktreePath,
    }, sid);
  }

  return withSession({
    status: 'completed', mode, billing,
    summary: parsed.text || '(no summary)',
    filesChanged, worktreePath,
  }, sid);
}

export async function runDelegate(
  mode: AuthMode,
  input: DelegateInput,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const gitChangedFiles = deps.gitChangedFiles ?? defaultGitChangedFiles;
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
  // (after \ before). Plan mode skips git entirely.
  const beforeFiles = input.plan ? [] : await gitChangedFiles(effectiveCwd);

  const env = buildGrokEnv(mode, deps.env ?? process.env);
  const prompt = input.check ? `${input.prompt}${VERIFY_PROMPT_SUFFIX}` : input.prompt;
  const args = [
    '--no-auto-update',
    ...(input.plan ? ['--permission-mode', 'plan'] : ['--always-approve']),
    '--cwd', effectiveCwd,
    '-p', prompt, '--output-format', 'json',
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
    ...options.extraArgs,
  ];

  const r = await spawnFn(args, effectiveCwd, env, timeoutMs);

  if (r.spawnError) {
    return {
      status: 'grok_error', mode, billing,
      message: `Grok Build 프로세스를 시작할 수 없습니다: ${r.stderr}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      worktreePath,
    };
  }

  // Surfacing changed files on abort paths is required by the safety model: grok can
  // leave partial edits even when it does not finish. Delta = after \ before so
  // pre-dirty unrelated files are not attributed to Grok (pre-dirty files Grok also
  // edits may under-report — use worktree:true for full attribution on dirty trees).
  const afterFiles = input.plan ? [] : await gitChangedFiles(effectiveCwd);
  const filesChanged = input.plan ? [] : diffChangedFiles(beforeFiles, afterFiles);

  return classifySpawnResult(r, input, { mode, billing, timeoutMs, filesChanged, worktreePath });
}
