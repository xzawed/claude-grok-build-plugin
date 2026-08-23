import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveAuthMode } from './config.js';
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

async function main(): Promise<void> {
  const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup

  const server = new McpServer({ name: 'grok-build', version: getServerVersion() });

  server.registerTool(
    'grok_auth_check',
    {
      description: 'Check whether Grok Build is authenticated for the active auth mode. Does not delegate.',
      inputSchema: z.object({}),
    },
    async () => {
      const result = checkAuth(mode, defaultAuthDeps());
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
    },
  );

  const strengthFields = {
    model: z.string().optional().describe('Opt-in grok --model <id> (safe token only).'),
    effort: z.string().optional().describe('Opt-in grok --effort <level> (safe token only).'),
    best_of_n: z.number().optional().describe('Removed in Grok CLI 1.0 — if set, the tool fails without spawning. Do not pass.'),
    resume: z.string().optional().describe('Opt-in --resume <sessionId> from a prior result.sessionId. Mutually exclusive with continue.'),
    continue: z.boolean().optional().describe('Opt-in --continue last session. Mutually exclusive with resume.'),
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
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = {
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
      };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
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
    async ({ prompt, cwd, timeout_ms }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms, plan: true };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
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
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = {
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox, check: true,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
      };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
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
    async ({ cwd, limit }) => {
      const summary = summarizeHistory(readHistory(), { cwd, limit });
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], isError: false };
    },
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
      const auth = checkAuth(mode, defaultAuthDeps());
      const usage = summarizeHistory(readHistory(), { cwd, limit: 5 });
      const snapshot = buildStatusSnapshot(auth, usage);
      return {
        content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
        isError: !auth.ok,
      };
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
        const result = await listRepoWorktrees(cwd);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
      }
      if (action === 'prune') {
        const result = await pruneGrokWorktrees(cwd, { maxAgeDays: max_age_days, apply });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
      }
      if (!worktree_path) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, message: 'worktree_path가 필요합니다.' }, null, 2) }],
          isError: true,
        };
      }
      if (action === 'diff') {
        const result = await diffGrokWorktree(worktree_path);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
      }
      if (action === 'apply') {
        const result = await applyGrokWorktree(cwd, worktree_path);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
      }
      // remove
      const result = await removeGrokWorktree(cwd, worktree_path);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
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
      const decision = routeTask({ task, signals, meteredBilling: metered_billing });
      // nextAction: machine step for consumer Task Managers (docs/07). Pure; no spawn.
      const payload = { ...decision, nextAction: planNextAction(decision) };
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: false };
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
      const result = await runGrokCli(mode, args, { spawn: defaultSpawn, env: process.env }, { cwd, timeoutMs: timeout_ms });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result.status === 'error' || result.status === 'timeout' };
    },
  );

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
