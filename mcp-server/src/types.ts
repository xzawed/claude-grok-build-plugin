export type AuthMode = 'subscription' | 'api';
export type Billing = 'subscription' | 'metered_api';

export interface AuthCheckResult {
  ok: boolean;
  mode: AuthMode;
  reason?: 'grok_not_installed' | 'not_logged_in' | 'no_api_key';
  message: string;
}

export interface GrokResult {
  text: string;
  stopReason: string;
}

export interface DelegateInput {
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  worktree?: boolean;   // opt-in: run grok in a fresh wrapper-created git worktree
  sandbox?: string;     // opt-in: pass --sandbox <profile> to grok
  plan?: boolean;       // opt-in: read-only plan preview (no edits)
  check?: boolean;      // opt-in: append grok's --check self-verification loop
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
}
