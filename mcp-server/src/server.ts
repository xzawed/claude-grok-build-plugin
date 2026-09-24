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
import { runGrokCli, extractPromptRun } from './grok-cli.js';
import { recordDelegation } from './history.js';
import { readHistory, summarizeHistory } from './usage.js';
import {
  listRepoWorktrees,
  diffGrokWorktree,
  applyGrokWorktree,
  removeGrokWorktree,
  pruneGrokWorktrees,
  newWorktreeStandIn,
} from './worktree.js';
import { routeTask } from './routing.js';
import { planNextAction } from './orchestrator.js';
import { buildStatusSnapshot } from './status.js';
import { configBillingCaveat } from './config-keys.js';
import { grokHomeNote } from './env.js';
import { isAbsolute } from 'node:path';
import { getServerVersion } from './version.js';
import type { AuthMode, DelegateStatus } from './types.js';

/**
 * Every side-effecting call a handler makes. Defaults are the real implementations; tests pass
 * fakes. Signatures are derived from the real functions so a change there breaks typecheck here
 * instead of drifting silently.
 */
export interface ServerDeps {
  /** `baseDir`: the folder grok will run in, when known — a relative GROK_HOME resolves there (A35). */
  checkAuth: (mode: AuthMode, baseDir?: string) => ReturnType<typeof checkAuth>;
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
  /** Per-model keys in grok's config.toml that would bill a "subscription" run elsewhere (v0.2.33). */
  billingCaveat: (mode: AuthMode, baseDir?: string) => ReturnType<typeof configBillingCaveat>;
  /** A35: set when GROK_HOME depends on the folder (grokHomeDependsOnFolder), so an answer given for one folder says which one. */
  grokHomeNote: (baseDir?: string) => string | undefined;
  /** Injected so history timing is deterministic under test. */
  now: () => number;
  nowIso: () => string;
}

export const defaultServerDeps: ServerDeps = {
  checkAuth: (mode, baseDir) => checkAuth(mode, defaultAuthDeps(), baseDir),
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
  billingCaveat: (mode, baseDir) => configBillingCaveat(mode, process.env, undefined, baseDir),
  grokHomeNote: (baseDir) => grokHomeNote(process.env, baseDir ?? process.cwd()),
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

const json = (value: unknown, isError: boolean) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  isError,
});

// A2: grok_cli reports its own status vocabulary; the history file speaks DelegateStatus. `blocked`
// is deliberately absent — it never spawns, so it never becomes a row.
const CLI_STATUS_TO_DELEGATE: Record<string, DelegateStatus> = {
  ok: 'completed', timeout: 'timeout', error: 'grok_error',
};

export interface BuildServerOptions {
  /** A34: this process runs inside a grok worker that grok-build started (see env.ts). */
  insideWorker?: boolean;
}

// The refusal names the situation, not the switch: the reader is the worker model, and a message
// that spells out the variable reads as instructions for getting past it (review finding). People
// find the variable in docs/04 and the README troubleshooting table. `status: 'blocked'` is the
// vocabulary grok_cli already uses for "refused before anything ran"; `reason` is what a program
// (accept-release.mjs, the tests) keys on instead of the wording.
const INSIDE_WORKER_REFUSAL = {
  status: 'blocked',
  reason: 'inside_grok_worker',
  message:
    '이 grok-build 서버는 이 플러그인이 띄운 Grok 워커 안에서 실행 중이라 어떤 도구도 실행하지 않습니다. '
    + '여기서 또 다른 Grok을 띄우면 그 편집은 위임한 쪽이 검토하는 범위 밖에 남을 수 있고, 쿼터도 두 번 씁니다. '
    + '받은 작업은 이 도구 없이 직접 수행하세요.',
} as const;

export function buildServer(
  mode: AuthMode,
  deps: ServerDeps = defaultServerDeps,
  opts: BuildServerOptions = {},
): McpServer {
  const server = new McpServer({ name: 'grok-build', version: getServerVersion() });

  // A34 (docs/10, MEASURED 2026-09-24): inside a grok worker, EVERY tool refuses. The registration
  // method of THIS instance is swapped before anything registers, so each tool below keeps its
  // name, description and schema but gets the refusal as its handler — one door, and a tool added
  // later is covered without anyone remembering to. Three choices, each measured or argued:
  //   - all tools, not just the ones that start grok: worktree apply/remove act on the caller's
  //     tree from inside a run the caller is still waiting on, and nothing a worker legitimately
  //     needs lives here.
  //   - listed-and-refused, not hidden: with this server missing from its tools a worker searched
  //     for it for 10 turns and ~380k tokens (twice); a refusal that says why ends it in one call.
  //   - no history row: nothing ran, the same rule `blocked` follows.
  if (opts.insideWorker) {
    const refuseInsideWorker = async () => json(INSIDE_WORKER_REFUSAL, true);
    const registerOriginal = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: Parameters<McpServer['registerTool']>[1]) =>
      registerOriginal(name, config, refuseInsideWorker)) as McpServer['registerTool'];
  }

  // A21 (docs/10, MEASURED 2026-09-06 against the shipped bundle): every tool here PUBLISHES
  // `additionalProperties: false`, and before this change exactly one enforced it — grok_build_route,
  // which A1 had made `.strict()`. The other eight accepted an unknown key and silently dropped it,
  // so a misspelled field name produced a successful call with that field simply absent.
  //
  // Two of those fields cost a PROTECTION rather than a preference. Measured end to end:
  // delegate called with `worktreee` returned status completed with no worktreePath, and grok
  // edited the caller's working directory — the isolation was requested and silently not applied.
  // `sandbox` is the same shape (no filesystem/network profile; kernel-enforced on Linux/macOS);
  // Grok found that second one after I claimed worktree was the only one.
  //
  // Refusing is safe for a spec-compliant client: `_meta` belongs at the params level, where it
  // never reaches this object. Only `_meta` misplaced INSIDE arguments is refused (measured).
  //
  // Every z.object below therefore ends in `.strict()`. Keep it that way when adding a tool —
  // the schema we publish and the schema we enforce have to be the same schema.
  // A35: a folder to answer for. Only an absolute path names one — a relative cwd is refused before
  // anything runs, so there is no grok to agree with.
  const folderOf = (cwd: string | undefined) => (cwd !== undefined && isAbsolute(cwd) ? cwd : undefined);
  const noteFor = (base: string | undefined) => {
    try {
      return deps.grokHomeNote(base);
    } catch {
      return undefined;
    }
  };

  server.registerTool(
    'grok_auth_check',
    {
      description: 'Check whether Grok Build is authenticated for the active auth mode. Does not delegate. Pass the task\'s absolute cwd when GROK_HOME may be relative: grok resolves it against the folder it runs in.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Absolute folder grok would run in. A relative GROK_HOME resolves against it, as grok resolves it.'),
      }).strict(),
    },
    async ({ cwd }) => {
      const base = folderOf(cwd);
      const result = deps.checkAuth(mode, base);
      const note = noteFor(base);
      return json(note ? { ...result, grokHomeNote: note } : result, !result.ok);
    },
  );

  const strengthFields = {
    // B2: a WORK budget, next to timeout_ms's wall clock. Shared by delegate/plan/verify because
    // a runaway is a runaway whichever tool started it.
    max_turns: z.number().int().positive().optional().describe('Opt-in grok --max-turns <n>: stop cleanly after n agent turns, keeping partial edits. A bound on work, unlike timeout_ms which kills the process.'),
    model: z.string().optional().describe('Opt-in grok --model <id> (safe token only). Omit to follow the CLI default (grok-4.7 as of 2026-09-22).'),
    effort: z.string().optional().describe('Opt-in grok --effort <level> (safe token only).'),
    best_of_n: z.number().optional().describe('Removed in Grok CLI 1.0 — if set, the tool fails without spawning. Do not pass.'),
    resume: z.string().optional().describe('Opt-in --resume <sessionId> from a prior result.sessionId. Mutually exclusive with continue.'),
    continue: z.boolean().optional().describe('Opt-in --continue last session. Mutually exclusive with resume.'),
  };

  /** delegate/plan/verify share one shape: auth pre-check → run → record → isError by status. */
  /*
   * AUDITED BY GROK 2026-09-23, no finding. Claim put to it: "a run that did not succeed can come back
   * from here without isError set." Verdict False — the only post-run return passes
   * `result.status !== 'completed'`, and the sole other return is the auth pre-check, which sets
   * the flag true. This is the contract CLAUDE.md warns can be inverted without the suite noticing
   * if these handlers are ever moved back into anonymous closures, so it is worth having judged.
   */
  // v0.2.33 (docs/specs/2026-09-24-config-model-keys-billing-caveat.md): advice about `billing`,
  // so it must never cost the run or the dashboard it annotates. The real detector already turns a
  // bad file into `config_unreadable` instead of throwing; this catch is the backstop for anything
  // else, and the one place where "could not ask" does end up as silence.
  const caveatFor = (m: AuthMode, base?: string) => {
    try {
      return deps.billingCaveat(m, base);
    } catch {
      return undefined;
    }
  };

  const runAndRecord = async (input: Parameters<typeof runDelegate>[1]) => {
    // A35: ask about the folder grok will run in, since a relative GROK_HOME resolves there. That is
    // the task folder — except for a worktree run, whose grok works in a new folder under
    // ~/.grok-build/worktrees (runDelegate passes it as --cwd). Asking about the task folder there
    // said "ready", and grok then started in the worktree with no session.
    const base = input.worktree ? newWorktreeStandIn() : folderOf(input.cwd);
    const pre = deps.checkAuth(mode, base);
    if (!pre.ok) {
      // "Run grok login" alone does not help when the home depends on the folder — the login lands
      // wherever the user's terminal is. Say which home was checked — only when the refusal IS about
      // the session there (not "grok is not installed", not api mode's "no key").
      const note = pre.reason === 'not_logged_in' ? noteFor(base) : undefined;
      return { content: [{ type: 'text' as const, text: note ? `${pre.message} ${note}` : pre.message }], isError: true };
    }
    // Read before the spawn: the config that matters is the one grok starts with.
    const caveat = caveatFor(mode, base);
    const t0 = deps.now();
    const result = await deps.runDelegate(mode, input);
    // History gets the run as it was; the caveat describes configuration, not the run.
    deps.recordDelegation(input, result, { ts: deps.nowIso(), durationMs: deps.now() - t0 });
    return json(caveat ? { ...result, billingCaveat: caveat } : result, result.status !== 'completed');
  };

  server.registerTool(
    'grok_build_delegate',
    {
      description: 'Delegate a coding task to Grok Build; returns a summary, changed files (new during run), billing mode, and sessionId when present. In subscription mode the result may also carry billingCaveat: grok\'s config.toml gives some model its own key, which grok uses before the subscription — or the file could not be checked (advice only — nothing is blocked). Records the run to ~/.grok-build/history.jsonl (timestamp, cwd, first ~200 chars of the prompt with known secret shapes redacted, files changed, sessionId) — grok_build_usage and grok_build_status read that back.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox profile: off|workspace|devbox|read-only|strict (or custom from sandbox.toml). Linux/macOS kernel enforce; Windows may accept without full enforcement.'),
        ...strengthFields,
      }).strict(),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont, max_turns }) =>
      runAndRecord({
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
        maxTurns: max_turns,
      }),
  );

  server.registerTool(
    'grok_build_plan',
    {
      description: 'Ask Grok Build for a plan/approach for a task (passes --permission-mode plan). Use before grok_build_delegate to preview grok\'s approach; returns a plan summary. ⚠️ NOT guaranteed read-only. grok 1.0.13 ignored --permission-mode plan and edited anyway (measured 2026-09-05; --sandbox did not stop it either); grok 1.0.30 does refuse the write (re-measured 2026-09-22). The CLI self-updates, so treat neither as the version in front of you: the response reports planWroteFiles and filesChanged, and those are facts about THIS run — check them before treating the tree as untouched. May carry billingCaveat, as delegate does. Records the run to ~/.grok-build/history.jsonl (timestamp, cwd, first ~200 chars of the prompt with known secret shapes redacted, files changed, sessionId) — grok_build_usage and grok_build_status read that back.',
      // A14 (docs/10, MEASURED 2026-09-06): plan advertised three fields with
      // additionalProperties:false while delegate advertised ten, and zod STRIPPED the rest
      // rather than rejecting them — a call passing worktree:true and model:"grok-code" came
      // back isError false, status completed, no worktreePath. Accepted and silently dropped,
      // which breaks the contract in both directions: the schema promises a rejection and the
      // runtime gives neither that nor the behaviour.
      //
      // Spreading the fields is the direction that helps, and `worktree` most of all:
      // --permission-mode plan is NOT read-only (grok 1.0.13 ignores it — see the description
      // above and delegate.ts planWroteFiles), so worktree isolation is the real containment
      // for a plan, not a nicety.
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath. Especially worth setting here: plan mode is not guaranteed read-only.'),
        sandbox: z.string().optional().describe('grok --sandbox profile: off|workspace|devbox|read-only|strict (or custom from sandbox.toml). Linux/macOS kernel enforce; Windows may accept without full enforcement.'),
        ...strengthFields,
      }).strict(),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont, max_turns }) =>
      runAndRecord({
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox, plan: true,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
        maxTurns: max_turns,
      }),
  );

  server.registerTool(
    'grok_build_verify',
    {
      description: 'Delegate a task to Grok Build AND have it self-verify (appends a verification checklist instruction; returns the changes plus a verification report). Use for changes you want grok to validate. CLI 1.0 has no --check flag. May carry billingCaveat, as delegate does. Records the run to ~/.grok-build/history.jsonl (timestamp, cwd, first ~200 chars of the prompt with known secret shapes redacted, files changed, sessionId) — grok_build_usage and grok_build_status read that back.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox profile: off|workspace|devbox|read-only|strict (or custom from sandbox.toml). Linux/macOS kernel enforce; Windows may accept without full enforcement.'),
        ...strengthFields,
      }).strict(),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox, model, effort, best_of_n, resume, continue: cont, max_turns }) =>
      runAndRecord({
        prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox, check: true,
        model, effort, bestOfN: best_of_n, resumeSessionId: resume, continueSession: cont,
        maxTurns: max_turns,
      }),
  );

  server.registerTool(
    'grok_build_usage',
    {
      description: 'Summarize Grok Build delegation history (~/.grok-build/history.jsonl): counts by mode/billing/status, plan/verify usage, files changed, recent runs, plus insights (success rate, subscription share, headline/tips). Read-only.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Filter to delegations whose cwd matches (absolute path).'),
        limit: z.number().int().positive().optional().describe('Number of recent entries to include (default 10).'),
      }).strict(),
    },
    async ({ cwd, limit }) => json(deps.summarizeHistory(deps.readHistory(), { cwd, limit }), false),
  );

  server.registerTool(
    'grok_build_status',
    {
      description:
        'One-shot readiness dashboard: auth (mode/billing/serverVersion) + usage insights + lastSession + nextSteps, plus billingCaveat in subscription mode when grok\'s config.toml gives some model its own key or could not be checked. Read-only — no grok spawn, no file edits.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Optional absolute cwd: filters usage history, and is the folder a relative GROK_HOME resolves against (as grok resolves it).'),
      }).strict(),
    },
    async ({ cwd }) => {
      const base = folderOf(cwd);
      const auth = deps.checkAuth(mode, base);
      const usage = deps.summarizeHistory(deps.readHistory(), { cwd, limit: 5 });
      // A10: this used to be `!auth.ok`, which reported a COMPLETE dashboard as a failed call —
      // measured in api mode with no key: isError true beside all thirteen fields populated,
      // nextSteps included. A consumer that discards on isError threw away the very answer that
      // tells it how to fix the auth it is complaining about. The call succeeded; "not ready" is
      // one FIELD of the answer (`ready`, `authMessage`, `reason`), not a failure to answer.
      // grok_auth_check deliberately keeps `!result.ok`: its whole output is the verdict, so
      // there is nothing else to lose and isError is the shortest true answer.
      return json(deps.buildStatusSnapshot(auth, usage, caveatFor(mode, base), noteFor(base)), false);
    },
  );

  server.registerTool(
    'grok_build_worktree',
    {
      description:
        'Manage wrapper-created git worktrees: list (repo worktrees), diff (uncommitted changes in a worktree), apply (patch onto cwd without commit), remove (only under ~/.grok-build/worktrees; REFUSES a worktree with uncommitted or unreadable state unless force:true, and deletes the companion grok/<name> branch when it holds no unmerged commits), prune (report — or with apply, remove — worktrees older than max_age_days; dry run by default). Never auto-commits.',
      inputSchema: z.object({
        action: z.enum(['list', 'diff', 'apply', 'remove', 'prune']).describe('Lifecycle action.'),
        cwd: z.string().describe('Absolute path of the main repository.'),
        worktree_path: z.string().optional().describe('Absolute worktree path (required for diff/apply/remove).'),
        max_age_days: z.number().positive().optional().describe('prune only: age threshold in days (default 7).'),
        apply: z.boolean().optional().describe('prune only: actually remove. Omitted or false = dry run that only reports candidates.'),
        force: z.boolean().optional().describe('remove only: delete even though the worktree still holds uncommitted work. This plugin never commits, so that work cannot be recovered — run diff or apply first.'),
      }).strict(),
    },
    async ({ action, cwd, worktree_path, max_age_days, apply, force }) => {
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
      // remove — A4: force is the caller saying, out loud, that unapplied work may be destroyed.
      const result = await deps.removeGrokWorktree(cwd, worktree_path, undefined, { force });
      return json(result, !result.ok);
    },
  );

  server.registerTool(
    'grok_build_route',
    {
      description:
        'Recommend whether Claude or Grok should handle a task (LOW/MEDIUM/HIGH) and return nextAction (machine step). Pure decision — does NOT run grok, does NOT edit files, does NOT affect billing. For orchestrators and Claude before calling delegate.',
      // A1 (docs/10, MEASURED 2026-09-05): this schema already published
      // `additionalProperties: false`, but zod stripped unknown keys silently — `meteredBilling`
      // (camelCase) was accepted, ignored, and the metered strictness never applied. `.strict()`
      // makes the runtime match the contract we advertise. `destructive`/`production` are listed
      // so a Task Manager that KNOWS a task is destructive can still say so; switching them (or
      // any other danger key) OFF is refused by routing.ts, not here.
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
          destructive: z.boolean().optional(),
          production: z.boolean().optional(),
        }).strict().optional().describe('Structured signals from a Task Manager (preferred over keywords alone). An explicit false CANNOT switch off a danger the task text states — if you know better than the text, send signals WITHOUT task.'),
        metered_billing: z.boolean().optional().describe('True if this session is API/metered — stricter LOW bar.'),
      }).strict(),
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
      description: "Run an arbitrary Grok CLI subcommand (sessions, models, inspect, mcp, export, worktree, logout, memory, update, version, trace, or a raw passthrough) under the billing-safe env. Non-headless commands (dashboard/agent/leader/completions/wrap) and login (including --device-auth) are refused with guidance — run login in your terminal. A passthrough that carries a prompt (-p / --single / --prompt-file / --prompt-json) is a real grok turn: it is gated by the pre-delegate auth hook and recorded to delegation history with via='grok_cli'. Read-only subcommands are neither. A subcommand whose confirmation prompt went unanswered (no stdin means the default N) exits 0 and changes nothing: that is reported as cancelled=true, not as plain success. Prefer grok_build_delegate for coding tasks — it adds worktree isolation, plan mode and structured results.",
      inputSchema: z.object({
        args: z.array(z.string()).min(1).describe('grok subcommand + args, e.g. ["sessions","list"] or ["inspect","--json"].'),
        cwd: z.string().optional().describe('Working directory (absolute).'),
        timeout_ms: z.number().int().positive().optional().describe('Default 60000.'),
        max_chars: z.number().int().positive().optional().describe('Raise the stdout budget for this call (default 4000, ceiling 100000). Only worth it when you need a whole document — `grok inspect --json` measured ~81 KB — and you accept the token cost.'),
      }).strict(),
    },
    async ({ args, cwd, timeout_ms, max_chars }) => {
      const t0 = deps.now();
      const result = await deps.runGrokCli(mode, args, { cwd, timeoutMs: timeout_ms, maxChars: max_chars });
      // A2 (docs/10): a passthrough carrying a prompt spends a subscription turn and edits files,
      // exactly like a delegation — MEASURED 2026-09-05, one such run wrote a2.txt while
      // history.jsonl stayed at 1790 lines, so /grok:usage and /grok:status underreported real use.
      // `blocked` never spawned and read-only queries spend nothing, so only prompt runs are rows.
      if (result.promptRun) {
        const prompt = extractPromptRun(args)?.prompt ?? '';
        // A25 (docs/10, MEASURED 2026-09-06): this used to write `cwd ?? ''`, but runGrokCli
        // defaults an omitted cwd to process.cwd() — so a run that really happened in a directory
        // was filed under no directory at all, and `/grok:usage --cwd` and `/grok:status` could
        // never count it. Measured: two runs in ONE directory, unfiltered 2, filtered 1. The run
        // now reports the directory it used, so the default has a single definition (A7).
        deps.recordDelegation(
          { prompt, cwd: result.cwd },
          {
            status: CLI_STATUS_TO_DELEGATE[result.status] ?? 'grok_error',
            mode: result.mode, billing: result.billing,
            filesChanged: result.filesChanged ?? [],
            ...(result.stdoutTail ? { summary: result.stdoutTail } : {}),
          },
          { ts: deps.nowIso(), durationMs: deps.now() - t0, via: 'grok_cli' },
        );
      }
      // A10 (docs/10, MEASURED 2026-09-06): `blocked` used to go out with isError false, so a
      // consumer branching on isError alone read a REFUSED command as "success with no output"
      // — and a cancelled confirmation (A9) had exactly the same shape. isError answers "did
      // the thing you asked for happen?", and for both of those the answer is no.
      const didNotRun = result.status !== 'ok' || result.cancelled === true;
      return json(result, didNotRun);
    },
  );

  return server;
}
