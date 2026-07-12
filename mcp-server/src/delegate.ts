import { spawn, execFileSync } from 'node:child_process';
import { buildGrokEnv } from './env.js';
import { parseGrokResult } from './grok-result.js';
import type { AuthMode, Billing, DelegateInput, DelegateResult } from './types.js';

// Best-effort auth-failure signals (stderr/stdout). Auth wording was not reproduced
// in the Task 0 spike — verify in Task 9. Primary auth gate is the pre-check in index.ts.
const AUTH_ERROR_SIGNALS = [/not authenticated/i, /unauthorized/i, /\b401\b/, /\b403\b/, /grok login/i, /logged in/i];

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type SpawnFn = (
  args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
) => Promise<SpawnResult>;

export type GitChangedFilesFn = (cwd: string) => string[];

export interface DelegateDeps {
  spawn?: SpawnFn;
  gitChangedFiles?: GitChangedFilesFn;
}

export function billingFor(mode: AuthMode): Billing {
  return mode === 'api' ? 'metered_api' : 'subscription';
}

export const defaultSpawn: SpawnFn = (args, cwd, env, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn('grok', args, { cwd, env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr || 'spawn error', timedOut }); });
  });

export const defaultGitChangedFiles: GitChangedFilesFn = (cwd) => {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' });
    return out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
  } catch {
    return []; // not a git repo, or git unavailable
  }
};

export async function runDelegate(
  mode: AuthMode,
  input: DelegateInput,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const gitChangedFiles = deps.gitChangedFiles ?? defaultGitChangedFiles;
  const billing = billingFor(mode);
  const timeoutMs = input.timeoutMs ?? 180_000;
  const env = buildGrokEnv(mode, process.env);
  const args = ['--no-auto-update', '--always-approve', '--cwd', input.cwd, '-p', input.prompt, '--output-format', 'json'];

  const r = await spawnFn(args, input.cwd, env, timeoutMs);

  if (r.timedOut) {
    return {
      status: 'timeout', mode, billing,
      message: `Grok Build 작업이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다. 범위를 줄이거나 timeout_ms를 늘려 다시 시도하세요.`,
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
      return { status: 'auth_error', mode, billing, message, rawStderrTail: tail };
    }
    return { status: 'grok_error', mode, billing, message: 'Grok Build 출력을 해석할 수 없습니다.', rawStderrTail: tail };
  }

  // Exit code is 0 even on cancel — success is decided by stopReason.
  if (parsed.stopReason !== 'EndTurn') {
    return {
      status: 'grok_error', mode, billing,
      message: `Grok Build가 완료되지 않았습니다 (stopReason: ${parsed.stopReason || 'unknown'}). ${parsed.text}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
    };
  }

  return {
    status: 'completed', mode, billing,
    summary: parsed.text || '(no summary)',
    filesChanged: gitChangedFiles(input.cwd),
  };
}
