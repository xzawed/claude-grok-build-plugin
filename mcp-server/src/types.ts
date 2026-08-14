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

export interface GrokResult {
  text: string;
  stopReason: string;
  sessionId?: string;
  /** True when stdout was a grok JSON error object (`type: "error"`). */
  isError?: boolean;
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
}
