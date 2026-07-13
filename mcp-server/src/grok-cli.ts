import { buildGrokEnv } from './env.js';
import { billingFor, type SpawnFn, type SpawnResult } from './delegate.js';
import type { AuthMode, Billing } from './types.js';

// Commands that can't run headless (TUI/server/shell). Spawning them would hang or be meaningless.
const NON_HEADLESS = new Set(['dashboard', 'agent', 'leader', 'completions', 'wrap']);

export function isBlockedGrokCommand(args: string[]): boolean {
  const sub = args[0];
  if (!sub) return false;
  if (NON_HEADLESS.has(sub)) return true;
  // login is interactive: browser OAuth blocks, and --device-auth prints a device URL then blocks
  // polling. Our buffered spawn only returns on process close, so the URL can't be surfaced in time
  // — route login to the user's terminal instead of running it here.
  if (sub === 'login') return true;
  return false;
}

export interface GrokCliDeps {
  spawn: SpawnFn;
  env: NodeJS.ProcessEnv;
}

export interface GrokCliResult {
  status: 'ok' | 'error' | 'blocked' | 'timeout';
  exitCode: number | null;
  stdoutTail?: string;
  stderrTail?: string;
  mode: AuthMode;
  billing: Billing;
  message?: string;
}

// Runs an arbitrary grok subcommand under the billing-safe env (subscription strips API keys +
// prepends the grok bin dir). Non-headless commands are refused (no spawn) instead of hanging.
export async function runGrokCli(
  mode: AuthMode,
  args: string[],
  deps: GrokCliDeps,
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<GrokCliResult> {
  const billing = billingFor(mode);
  if (isBlockedGrokCommand(args)) {
    return {
      status: 'blocked', exitCode: null, mode, billing,
      message: `\`grok ${args[0]}\`는 대화형/서버 모드라 헤드리스로 실행할 수 없습니다. 터미널에서 직접 실행하세요.`,
    };
  }
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? 60000;
  const env = buildGrokEnv(mode, deps.env);
  const r: SpawnResult = await deps.spawn(['--no-auto-update', ...args], cwd, env, timeoutMs);
  if (r.spawnError) {
    return { status: 'error', exitCode: r.code, mode, billing, stderrTail: (r.stderr || '').slice(-500), message: 'grok 실행에 실패했습니다 (설치/PATH 확인).' };
  }
  if (r.timedOut) {
    return {
      status: 'timeout', exitCode: null, mode, billing,
      stdoutTail: (r.stdout || '').slice(-4000), stderrTail: (r.stderr || '').slice(-1000),
      message: `grok 명령이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다.`,
    };
  }
  return {
    status: r.code === 0 ? 'ok' : 'error',
    exitCode: r.code,
    stdoutTail: (r.stdout || '').slice(-4000),
    stderrTail: (r.stderr || '').slice(-1000),
    mode, billing,
  };
}
