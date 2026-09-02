import { isAbsolute } from 'node:path';
import { buildGrokEnv } from './env.js';
import { billingFor, type SpawnFn, type SpawnResult } from './delegate.js';
import type { AuthMode, Billing } from './types.js';

// Commands that can't run headless (TUI/server/shell). Spawning them would hang or be meaningless.
const NON_HEADLESS = new Set(['dashboard', 'agent', 'leader', 'completions', 'wrap']);

// Not a real 1.0 subcommand — first positional is treated as a TUI prompt and hangs.
const MISSING_SUBCOMMANDS = new Set(['import']);

// grok global flags that consume the NEXT token as their value (measured from `grok --help`
// on 1.0.5), so a bare token following one is that value — not the subcommand. This snapshot
// tracks a CLI this repo does not ship, so assume it is ALWAYS one release from being stale:
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

export function isBlockedGrokCommand(args: string[]): boolean {
  return blockedGrokWord(args) !== undefined;
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
  const blocked = blockedGrokWord(args);
  if (blocked !== undefined) {
    // Name the word that actually tripped the denylist — with any-positional scanning it is
    // not necessarily the first positional, and a message pointing at the wrong token is
    // unactionable.
    const sub = blocked;
    const message = sub === 'import'
      ? '`grok import`는 CLI 1.0에 서브커맨드가 없습니다 (위치 인자면 TUI가 떠서 행합니다). 세션은 `grok sessions list` 또는 `/grok:sessions` / `/grok:resume`을 쓰세요.'
      : `\`grok ${sub}\`는 대화형/서버 모드라 헤드리스로 실행할 수 없습니다. 터미널에서 직접 실행하세요.`;
    return { status: 'blocked', exitCode: null, mode, billing, message };
  }
  // A relative cwd resolves against the MCP server's own directory, not the caller's
  // project — the same guard runDelegate already applies. Fail before spawning so the
  // caller gets an actionable message instead of a generic "grok 실행에 실패했습니다".
  if (opts.cwd !== undefined && !isAbsolute(opts.cwd)) {
    return {
      status: 'error', exitCode: null, mode, billing,
      message: 'cwd는 절대 경로여야 합니다.',
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
