export type AuthMode = 'subscription' | 'api';
export type Billing = 'subscription' | 'metered_api';

export interface AuthCheckResult {
  ok: boolean;
  mode: AuthMode;
  /** Expected billing path for this mode (no spawn). */
  billing: Billing;
  /** MCP server version from package.json (SSOT). */
  serverVersion: string;
  reason?: 'grok_not_installed' | 'not_logged_in' | 'no_api_key';
  message: string;
}

/**
 * B3: token counts under grok's own names, each present only when grok stated it.
 *
 * `input` and `cacheRead` are disjoint parts of one input total — adding them to `total` would
 * double-count, and `reasoning` is a subset of `output`, so it is never an addend either
 * (measured on a real 1.0.30 envelope, 2026-09-22). `total` is grok's own figure, not ours.
 */
export interface GrokTokenUsage {
  input?: number;
  cacheRead?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

export interface GrokResult {
  text: string;
  stopReason: string;
  sessionId?: string;
  /** True when stdout was a grok JSON error object (`type: "error"`). */
  isError?: boolean;
  /** B3, 1.0.30+. Absent on older envelopes. */
  tokens?: GrokTokenUsage;
  /** B3, 1.0.30+: grok's `num_turns` for this run. */
  turns?: number;
  /** B3, 1.0.30+: the model the run RECORDED (`modelUsage` key), not the catalog default. */
  model?: string;
}

export interface DelegateInput {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  worktree?: boolean;   // opt-in: run grok in a fresh wrapper-created git worktree
  sandbox?: string;     // opt-in: pass --sandbox <profile> to grok
  plan?: boolean;       // opt-in: read-only plan preview (no edits)
  check?: boolean;      // opt-in: verify loop (prompt suffix; CLI 1.0 has no --check)
  /** Opt-in grok --model <id> (safe token only). */
  model?: string;
  /** Opt-in grok --effort <level> (safe token only). */
  effort?: string;
  /**
   * B2 (1.0.30): `--max-turns` — a bound on WORK, not wall clock. `timeoutMs` kills the process;
   * this stops the agent cleanly after N turns with its partial edits intact. Grok 4.7 is sold on
   * multi-hour runs, so a turn budget is the bound that scales with the model.
   */
  maxTurns?: number;
  /** Rejected: CLI 1.0 removed --best-of-n. Kept so callers get a grok_error, not a schema miss. */
  bestOfN?: number;
  /** Opt-in --resume <sessionId> (safe token only). Mutually exclusive with continueSession. */
  resumeSessionId?: string;
  /** Opt-in --continue (last session). Mutually exclusive with resumeSessionId. */
  continueSession?: boolean;
}

export type DelegateStatus = 'completed' | 'auth_error' | 'timeout' | 'grok_error';

export interface DelegateResult {
  status: DelegateStatus;
  mode: AuthMode;
  billing: Billing;
  summary?: string;
  filesChanged?: string[];
  message?: string;
  rawStderrTail?: string;
  worktreePath?: string; // set when the delegation ran in an isolated worktree
  sessionId?: string;    // from grok JSON when present (resume later)
  /**
   * Resume/continue runs only, and only when it DIFFERS from the requested cwd: the directory
   * the resumed session actually belongs to, which is where grok wrote (A3, measured 2026-09-05 —
   * grok's --resume overrides --cwd). Absent means the run stayed where it was asked to.
   */
  resumedCwd?: string;
  /**
   * Plan runs only. `true` when the working tree changed during a run that is supposed to be
   * read-only — grok CLI 1.0.13 ignores `--permission-mode plan` and edits anyway (measured
   * 2026-09-05; `--sandbox read-only`/`strict` do not stop it either on win32). `false` means the
   * tree was verified unchanged; `undefined` means it could not be checked (cwd is not a git repo).
   */
  planWroteFiles?: boolean;
  /**
   * A32. `true` when git HEAD moved across the run — this wrapper never commits, so a moved HEAD
   * means grok did, and the diff-review gate every routing decision assumes was bypassed. It also
   * makes `filesChanged` under-report, because committing removes the edit from the porcelain
   * listing the set difference is taken over (measured 2026-09-22 on grok 1.0.30). `false` means
   * HEAD was verified unchanged; `undefined` means it could not be read (cwd is not a git repo,
   * or has no commit yet).
   */
  committed?: boolean;
  /**
   * B3 (1.0.30+): what the run actually spent and which model spent it, straight off grok's own
   * envelope. Absent on older CLIs and on branches that never parsed one (spawn failure, timeout
   * kill). Reported for failed runs too — a capped or cancelled run still spent those turns.
   *
   * No USD figure is carried on purpose. On a subscription login grok's cost number is not money
   * the user was charged, and `billing` (derived from the configured mode) is what answers that
   * question. `grok usage <SESSION_ID>` prints the figure for anyone who wants it.
   */
  tokens?: GrokTokenUsage;
  turns?: number;
  /** The model the run RECORDED, e.g. `grok-4.7-build` — not the catalog name `grok models` shows. */
  model?: string;
}
