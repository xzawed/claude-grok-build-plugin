import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { buildGrokEnv } from './env.js';
import { parseGrokResult } from './grok-result.js';
import { createGrokWorktree } from './worktree.js';
import type { AuthMode, Billing, DelegateInput, DelegateResult } from './types.js';

const execFileAsync = promisify(execFile);

// High-specificity auth-failure signals only. Broad tokens (401/403/unauthorized/
// "logged in") were removed: they false-positive on ordinary grok output (e.g. code
// that returns HTTP 403) and would wrongly tell the user to re-authenticate. Real grok
// auth wording is still uncaptured (see docs/specs/grok-cli-contract.md §7) — anchor
// precisely once reproduced; until then, ambiguous cases fall through to grok_error.
const AUTH_ERROR_SIGNALS = [/not authenticated/i, /grok login/i];

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

export const defaultSpawn: SpawnFn = (args, cwd, env, timeoutMs) =>
  new Promise((resolve) => {
    // detached (POSIX) makes grok a process-group leader so a timeout can kill its
    // whole subtree (git/LSP/sub-agents), not just the grok PID leaving orphans.
    const child = spawn('grok', args, { cwd, env, detached: process.platform !== 'win32' });
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
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
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
    } catch {
      return { status: 'grok_error', mode, billing, message: 'worktree 생성에 실패했습니다 — cwd가 커밋이 있는 git 저장소인지 확인하세요.' };
    }
  }

  const env = buildGrokEnv(mode, deps.env ?? process.env);
  const args = [
    '--no-auto-update', '--always-approve', '--cwd', effectiveCwd,
    '-p', input.prompt, '--output-format', 'json',
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
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

  // Compute once, reuse across terminal branches. Surfacing changed files on abort
  // paths (timeout/non-EndTurn) is required by the safety model: grok can leave
  // partial edits even when it does not finish, and those must be reviewable.
  const filesChanged = await gitChangedFiles(effectiveCwd);

  if (r.timedOut) {
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
    if (AUTH_ERROR_SIGNALS.some((re) => re.test(r.stderr) || re.test(r.stdout))) {
      const message = mode === 'subscription'
        ? '구독 인증이 필요/만료됐습니다. `grok login`을 실행하세요.'
        : 'API 인증에 실패했습니다. `XAI_API_KEY`가 유효한지 확인하세요.';
      return { status: 'auth_error', mode, billing, message, rawStderrTail: tail, worktreePath };
    }
    return { status: 'grok_error', mode, billing, message: 'Grok Build 출력을 해석할 수 없습니다.', rawStderrTail: tail, filesChanged, worktreePath };
  }

  // Exit code is 0 even on cancel — success is decided by stopReason.
  if (parsed.stopReason !== 'EndTurn') {
    return {
      status: 'grok_error', mode, billing,
      message: `Grok Build가 완료되지 않았습니다 (stopReason: ${parsed.stopReason || 'unknown'}). ${parsed.text}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      filesChanged, worktreePath,
    };
  }

  return {
    status: 'completed', mode, billing,
    summary: parsed.text || '(no summary)',
    filesChanged, worktreePath,
  };
}
