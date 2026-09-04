/**
 * MCP tool registration and handlers.
 *
 * Split out of `index.ts` so the handlers are reachable from tests. `index.ts` stays a thin
 * entrypoint that resolves the auth mode and connects stdio — the same split `hook.ts` /
 * `hook-entry.ts` already uses.
 *
 * Why this exists (audit 3, 2026-09-03): the handlers used to be anonymous closures inside
 * `main()`, so nothing could call them. Measured: inverting `isError: result.status !==
 * 'completed'` to `isError: false` at all three delegate/plan/verify return sites left
 * typecheck clean and all 352 tests green. The `isError` mapping is the contract every MCP
 * client reads to decide whether a delegation failed, and it was pinned by nothing.
 *
 * Everything a handler reaches for arrives through `ServerDeps`, so a test can drive the real
 * registered tools over an in-memory transport without spawning grok or touching the home dir.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkAuth, defaultAuthDeps } from './auth.js';
import { runDelegate, defaultSpawn } from './delegate.js';
import { runGrokCli } from './grok-cli.js';
import { recordDelegation } from './history.js';
import { readHistory, summarizeHistory } from './usage.js';
import {
  listRepoWorktrees,
  diffGrokWorktree,
  applyGrokWorktree,
  removeGrokWorktree,
  pruneGrokWorktrees,
} from './worktree.js';
import { routeTask } from './routing.js';
import { planNextAction } from './orchestrator.js';
import { buildStatusSnapshot } from './status.js';
import { getServerVersion } from './version.js';
import type { AuthMode } from './types.js';

/**
 * Every side-effecting call a handler makes. Defaults are the real implementations; tests pass
 * fakes. Signatures are derived from the real functions so a change there breaks typecheck here
 * instead of drifting silently.
 */
export interface ServerDeps {
  checkAuth: (mode: AuthMode) => ReturnType<typeof checkAuth>;
  runDelegate: (
    mode: AuthMode,
    input: Parameters<typeof runDelegate>[1],
  ) => ReturnType<typeof runDelegate>;
  recordDelegation: typeof recordDelegation;
  readHistory: () => ReturnType<typeof readHistory>;
  summarizeHistory: typeof summarizeHistory;
  buildStatusSnapshot: typeof buildStatusSnapshot;
  listRepoWorktrees: typeof listRepoWorktrees;
  diffGrokWorktree: typeof diffGrokWorktree;
  applyGrokWorktree: typeof applyGrokWorktree;
  removeGrokWorktree: typeof removeGrokWorktree;
  pruneGrokWorktrees: typeof pruneGrokWorktrees;
  routeTask: typeof routeTask;
  planNextAction: typeof planNextAction;
  runGrokCli: (
    mode: AuthMode,
    args: string[],
    opts?: Parameters<typeof runGrokCli>[3],
  ) => ReturnType<typeof runGrokCli>;
  /** Injected so history timing is deterministic under test. */
  now: () => number;
  nowIso: () => string;
}

export const defaultServerDeps: ServerDeps = {
  checkAuth: (mode) => checkAuth(mode, defaultAuthDeps()),
  runDelegate: (mode, input) => runDelegate(mode, input),
  recordDelegation,
  readHistory: () => readHistory(),
  summarizeHistory,
  buildStatusSnapshot,
  listRepoWorktrees,
  diffGrokWorktree,
  applyGrokWorktree,
  removeGrokWorktree,
  pruneGrokWorktrees,
  routeTask,
  planNextAction,
  runGrokCli: (mode, args, opts) =>
    runGrokCli(mode, args, { spawn: defaultSpawn, env: process.env }, opts),
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

const json = (value: unknown, isError: boolean) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  isError,
});

export function buildServer(mode: AuthMode, deps: ServerDeps = defaultServerDeps): McpServer {
  const server = new McpServer({ name: 'grok-build', version: getServerVersion() });

  server.registerTool(
    'grok_auth_check',
    {
      description: 'Check whether Grok Build is authenticated for the active auth mode. Does not delegate.',
      inputSchema: z.object({}),
    },
    async () => {
      const result = deps.checkAuth(mode);
      return json(result, !result.ok);
    },
  );

  const strengthFields = {
    model: z.string().optional().describe('Opt-in grok --model <id> (safe token only).'),
    effort: z.string().optional().describe('Opt-in grok --effort <level> (safe token only).'),
    best_of_n: z.number().optional().describe('Removed in Grok CLI 1.0 — if set, the tool fails without spawning. Do not pass.'),
    resume: z.string().optional().describe('Opt-in --resume <sessionId> from a prior result.sessionId. Mutually exclusive with continue.'),
    continue: z.boolean().optional().describe('Opt-in --continue last session. Mutually exclusive with resume.'),
  };

  /** delegate/plan/verify share one shape: auth pre-check → run → record → isError by status. */
  const runAndRecord = async (input: Parameters<typeof runDelegate>[1]) => {
    const pre = deps.checkAuth(mode);
    if (!pre.ok) {
      return { content: [{ type: 'text' as const, text: pre.message }], isError: true };
    }
    const t0 = deps.now();
    const result = await deps.runDelegate(mode, input);
    deps.recordDelegation(input, result, { ts: deps.nowIso(), durationMs: deps.now() - t0 });
    return json(result, result.status !== 'completed');
  };

  server.registerTool(
    'grok_build_delegate',
    {
      description: 'Delegate a coding task to Grok Build; returns a summary, changed files (new during run), billing mode, and sessionId when present.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox profile: off|workspace|devbox|read-only|strict (or custom from sandbox.toml). Linux/macOS kernel enforce; Windows may accept without full enforcement.'),
        ...strengthFields,
      }),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont }) =>
      runAndRecord({
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
      }),
  );

  server.registerTool(
    'grok_build_plan',
    {
      description: 'Ask Grok Build for a plan/approach for a task WITHOUT editing any files (read-only preview). Use before grok_build_delegate to preview grok\'s approach; returns a plan summary.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
      }),
    },
    async ({ prompt, cwd, timeout_ms }) =>
      runAndRecord({ prompt, cwd, timeoutMs: timeout_ms, plan: true }),
  );

  server.registerTool(
    'grok_build_verify',
    {
      description: 'Delegate a task to Grok Build AND have it self-verify (appends a verification checklist instruction; returns the changes plus a verification report). Use for changes you want grok to validate. CLI 1.0 has no --check flag.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox profile: off|workspace|devbox|read-only|strict (or custom from sandbox.toml). Linux/macOS kernel enforce; Windows may accept without full enforcement.'),
        ...strengthFields,
      }),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont }) =>
      runAndRecord({
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox, check: true,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
      }),
  );

  server.registerTool(
    'grok_build_usage',
    {
      description: 'Summarize Grok Build delegation history (~/.grok-build/history.jsonl): counts by mode/billing/status, plan/verify usage, files changed, recent runs, plus insights (success rate, subscription share, headline/tips). Read-only.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Filter to delegations whose cwd matches (absolute path).'),
        limit: z.number().int().positive().optional().describe('Number of recent entries to include (default 10).'),
      }),
    },
    async ({ cwd, limit }) => json(deps.summarizeHistory(deps.readHistory(), { cwd, limit }), false),
  );

  server.registerTool(
    'grok_build_status',
    {
      description:
        'One-shot readiness dashboard: auth (mode/billing/serverVersion) + usage insights + lastSession + nextSteps. Read-only — no grok spawn, no file edits.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Optional absolute cwd to filter usage history.'),
      }),
    },
    async ({ cwd }) => {
      const auth = deps.checkAuth(mode);
      const usage = deps.summarizeHistory(deps.readHistory(), { cwd, limit: 5 });
      return json(deps.buildStatusSnapshot(auth, usage), !auth.ok);
    },
  );

  server.registerTool(
    'grok_build_worktree',
    {
      description:
        'Manage wrapper-created git worktrees: list (repo worktrees), diff (uncommitted changes in a worktree), apply (patch onto cwd without commit), remove (only under ~/.grok-build/worktrees, deletes the companion grok/<name> branch when it holds no unmerged commits), prune (report — or with apply, remove — worktrees older than max_age_days; dry run by default). Never auto-commits.',
      inputSchema: z.object({
        action: z.enum(['list', 'diff', 'apply', 'remove', 'prune']).describe('Lifecycle action.'),
        cwd: z.string().describe('Absolute path of the main repository.'),
        worktree_path: z.string().optional().describe('Absolute worktree path (required for diff/apply/remove).'),
        max_age_days: z.number().positive().optional().describe('prune only: age threshold in days (default 7).'),
        apply: z.boolean().optional().describe('prune only: actually remove. Omitted or false = dry run that only reports candidates.'),
      }),
    },
    async ({ action, cwd, worktree_path, max_age_days, apply }) => {
      if (action === 'list') {
        const result = await deps.listRepoWorktrees(cwd);
        return json(result, !result.ok);
      }
      if (action === 'prune') {
        const result = await deps.pruneGrokWorktrees(cwd, { maxAgeDays: max_age_days, apply });
        return json(result, !result.ok);
      }
      if (!worktree_path) {
        return json({ ok: false, message: 'worktree_path가 필요합니다.' }, true);
      }
      if (action === 'diff') {
        const result = await deps.diffGrokWorktree(worktree_path);
        return json(result, !result.ok);
      }
      if (action === 'apply') {
        const result = await deps.applyGrokWorktree(cwd, worktree_path);
        return json(result, !result.ok);
      }
      // remove
      const result = await deps.removeGrokWorktree(cwd, worktree_path);
      return json(result, !result.ok);
    },
  );

  server.registerTool(
    'grok_build_route',
    {
      description:
        'Recommend whether Claude or Grok should handle a task (LOW/MEDIUM/HIGH) and return nextAction (machine step). Pure decision — does NOT run grok, does NOT edit files, does NOT affect billing. For orchestrators and Claude before calling delegate.',
      inputSchema: z.object({
        task: z.string().optional().describe('Free-text task description (keyword hints).'),
        signals: z.object({
          bulk: z.boolean().optional(),
          lowRiskDomain: z.boolean().optional(),
          narrowScope: z.boolean().optional(),
          exploratory: z.boolean().optional(),
          architecture: z.boolean().optional(),
          security: z.boolean().optional(),
          regulated: z.boolean().optional(),
          monorepoWide: z.boolean().optional(),
          finalReview: z.boolean().optional(),
        }).optional().describe('Structured signals from a Task Manager (preferred over keywords alone).'),
        metered_billing: z.boolean().optional().describe('True if this session is API/metered — stricter LOW bar.'),
      }),
    },
    async ({ task, signals, metered_billing }) => {
      const decision = deps.routeTask({ task, signals, meteredBilling: metered_billing });
      // nextAction: machine step for consumer Task Managers (docs/07). Pure; no spawn.
      return json({ ...decision, nextAction: deps.planNextAction(decision) }, false);
    },
  );

  server.registerTool(
    'grok_cli',
    {
      description: "Run an arbitrary Grok CLI subcommand (sessions, models, inspect, mcp, export, worktree, logout, memory, update, version, trace, or a raw passthrough) under the billing-safe env. Non-headless commands (dashboard/agent/leader/completions/wrap) and login (including --device-auth) are refused with guidance — run login in your terminal. Passthrough runs are NOT recorded to delegation history and NOT gated by the pre-delegate auth hook; use grok_build_delegate for auditable coding tasks.",
      inputSchema: z.object({
        args: z.array(z.string()).min(1).describe('grok subcommand + args, e.g. ["sessions","list"] or ["inspect","--json"].'),
        cwd: z.string().optional().describe('Working directory (absolute).'),
        timeout_ms: z.number().int().positive().optional().describe('Default 60000.'),
      }),
    },
    async ({ args, cwd, timeout_ms }) => {
      const result = await deps.runGrokCli(mode, args, { cwd, timeoutMs: timeout_ms });
      return json(result, result.status === 'error' || result.status === 'timeout');
    },
  );

  return server;
}
