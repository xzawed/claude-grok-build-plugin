# Phase 1 MVP (two-track auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 MVP grok-build MCP server that lets Claude delegate a coding task to Grok Build over stdio, authenticating via either the user's subscription session (default) or an API key (opt-in), and returns a summarized diff.

**Architecture:** A single TypeScript MCP server (`@modelcontextprotocol/sdk` v1.x, stdio) exposes two tools — `grok_auth_check` and `grok_build_delegate`. A server-level env var `GROK_BUILD_AUTH_MODE` (default `subscription`) selects the auth track. In subscription mode the server strips API-key env vars before spawning `grok`; in API mode it passes them through. Pure-logic modules (config/env/streaming/auth) are unit-tested; the subprocess boundary is dependency-injected so `delegate` is tested without hitting the real CLI.

**Tech Stack:** TypeScript (ESM, `module: NodeNext`), Node ≥18, `@modelcontextprotocol/sdk` ^1.x, `zod` ^3, `vitest` for tests, `tsc` build.

## Global Constraints

- **Subscription mode:** delete `XAI_API_KEY` and `GROK_CODE_XAI_API_KEY` from the env passed to `grok`. **API mode:** pass them through unchanged. (Absolute principle #1, mode-conditional.)
- Never store, log, or read credential *contents*; for `auth.json` check existence only (`~/.grok/auth.json`).
- Always pass `--no-auto-update` to `grok`.
- Spawn with an **argument array** — never assemble a shell command string from the prompt.
- Default `authMode` = `subscription` when `GROK_BUILD_AUTH_MODE` is unset/empty; an invalid value fails the server at startup.
- Tool responses return **summarized** structured JSON as text — never raw streaming-json.
- Bundled paths in `.mcp.json` referenced via `${CLAUDE_PLUGIN_ROOT}`.
- Every `grok_build_delegate` result includes `mode` and `billing` (`subscription` | `metered_api`).
- Hooks, delegation-history logging, `/verify`, and `plan` mode are **out of scope** (Phase 2–3). The pre-delegate auth check lives inside the MCP tool, not a hook.
- Spec: [`docs/specs/2026-07-12-two-track-auth-design.md`](../specs/2026-07-12-two-track-auth-design.md).

---

## File Structure

```
mcp-server/
├── package.json          # deps, scripts (build/test/typecheck)
├── tsconfig.json         # ESM NodeNext, strict
├── vitest.config.ts
├── src/
│   ├── types.ts          # shared types (AuthMode, DelegateResult, …)
│   ├── config.ts         # resolveAuthMode()
│   ├── env.ts            # buildGrokEnv(mode)
│   ├── streaming.ts      # summarizeStreamingJson(stdout)
│   ├── auth.ts           # checkAuth(mode, deps) + defaultAuthDeps()
│   ├── delegate.ts       # runDelegate(mode, input, spawnFn) + defaultSpawn()
│   └── index.ts          # McpServer wiring: registerTool ×2
└── test/
    ├── config.test.ts
    ├── env.test.ts
    ├── streaming.test.ts
    ├── auth.test.ts
    └── delegate.test.ts

.claude-plugin/plugin.json
.mcp.json
commands/grok-build-delegate.md
commands/grok-build-check-auth.md
docs/specs/grok-cli-contract.md   # produced by Task 0
```

---

## Task 0: Verify the grok CLI contract (spike)

**Why first:** The whole design rests on unverified assumptions about xAI's CLI. Confirm them empirically before writing the parser/spawn code. Not TDD — this is a documented investigation with a concrete deliverable.

**Files:**
- Create: `docs/specs/grok-cli-contract.md`
- Create: `docs/specs/samples/grok-streaming-sample.jsonl` (a real captured run)

**Prerequisite:** `grok` installed and `grok login` done (subscriber), plus a valid `XAI_API_KEY` available for the API-mode check.

- [ ] **Step 1: Confirm flags & headless output.** In a throwaway git dir, run:
  ```bash
  grok --no-auto-update -p "Create a file hello.txt containing the word ok" --output-format streaming-json | tee /tmp/grok-cap.jsonl
  ```
  Record: does `--output-format streaming-json` exist and emit newline-delimited JSON? What is each line's shape — the exact `type` field values and which field carries (a) changed-file paths, (b) the final result text, (c) errors?

- [ ] **Step 2: Confirm the subscription-vs-API override.** With `XAI_API_KEY` set in the shell, run the same command and confirm grok bills to API (per its own output/account). Then unset it (or run with `env -u XAI_API_KEY`) and confirm it uses the subscription session. This validates that subscription mode MUST strip the key.

- [ ] **Step 3: Confirm auth-failure signals.** Temporarily rename `~/.grok/auth.json`, run once, and capture the stderr / exit code wording used for "not authenticated" (feeds the `AUTH_ERROR_SIGNALS` regexes in Task 6). Restore the file.

- [ ] **Step 4: Write the contract doc.** In `docs/specs/grok-cli-contract.md`, record: verified flags, the streaming-json event `type` strings and field names, the auth-error signals, and the API-mode key behavior. Save the captured JSONL to `docs/specs/samples/grok-streaming-sample.jsonl`.

- [ ] **Step 5: Commit.**
  ```bash
  git add docs/specs/grok-cli-contract.md docs/specs/samples/
  git commit -m "docs: capture verified grok CLI contract (flags, streaming-json, auth signals)"
  ```

> **Downstream dependency:** Tasks 4 and 6 reference the `type`/field names from this doc. Where those tasks hard-code event-type strings or stderr regexes, replace the placeholder constants with the values captured here.

---

## Task 1: Scaffold the MCP server

**Files:**
- Create: `mcp-server/package.json`, `mcp-server/tsconfig.json`, `mcp-server/vitest.config.ts`, `mcp-server/test/smoke.test.ts`

**Interfaces:**
- Produces: an installable, buildable, testable TS/ESM package with `npm run build`, `npm test`, `npm run typecheck`.

- [ ] **Step 1: Write `package.json`.**
  ```json
  {
    "name": "claude-grok-build-mcp-server",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "build": "tsc",
      "test": "vitest run",
      "test:watch": "vitest",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.12.3",
      "zod": "^3.23.8"
    },
    "devDependencies": {
      "@types/node": "^20.0.0",
      "typescript": "^5.6.0",
      "vitest": "^2.1.0"
    }
  }
  ```
  (Use the current `@modelcontextprotocol/sdk` 1.x at install time; `^1.12.3` is a verified-existing floor.)

- [ ] **Step 2: Write `tsconfig.json`.**
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true
    },
    "include": ["src"]
  }
  ```

- [ ] **Step 3: Write `vitest.config.ts`.**
  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
  ```

- [ ] **Step 4: Write a smoke test `test/smoke.test.ts`.**
  ```ts
  import { describe, it, expect } from 'vitest';

  describe('smoke', () => {
    it('runs', () => { expect(1 + 1).toBe(2); });
  });
  ```

- [ ] **Step 5: Install & verify.**
  Run: `cd mcp-server && npm install && npm test`
  Expected: vitest runs, 1 passing test.

- [ ] **Step 6: Add `.gitignore` (repo root) and commit.**
  ```gitignore
  node_modules/
  dist/
  ```
  ```bash
  git add .gitignore mcp-server/package.json mcp-server/package-lock.json mcp-server/tsconfig.json mcp-server/vitest.config.ts mcp-server/test/smoke.test.ts
  git commit -m "chore: scaffold mcp-server (ts, esm, vitest)"
  ```

---

## Task 2: Shared types + `resolveAuthMode()`

**Files:**
- Create: `mcp-server/src/types.ts`, `mcp-server/src/config.ts`, `mcp-server/test/config.test.ts`

**Interfaces:**
- Produces:
  - `type AuthMode = 'subscription' | 'api'`
  - `type Billing = 'subscription' | 'metered_api'`
  - `interface AuthCheckResult { ok: boolean; mode: AuthMode; reason?: 'grok_not_installed' | 'not_logged_in' | 'no_api_key'; message: string }`
  - `interface StreamingSummary { summary: string; filesChanged: string[]; errorText?: string }`
  - `interface DelegateInput { prompt: string; cwd: string; timeoutMs?: number }`
  - `type DelegateStatus = 'completed' | 'auth_error' | 'timeout' | 'grok_error'`
  - `interface DelegateResult { status: DelegateStatus; mode: AuthMode; billing: Billing; summary?: string; filesChanged?: string[]; message?: string; rawStderrTail?: string }`
  - `function resolveAuthMode(env?: NodeJS.ProcessEnv): AuthMode`

- [ ] **Step 1: Write `test/config.test.ts` (failing).**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { resolveAuthMode } from '../src/config.js';

  describe('resolveAuthMode', () => {
    it('defaults to subscription when unset', () => {
      expect(resolveAuthMode({})).toBe('subscription');
    });
    it('defaults to subscription when empty/whitespace', () => {
      expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: '  ' })).toBe('subscription');
    });
    it('accepts api (case-insensitive)', () => {
      expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'API' })).toBe('api');
    });
    it('accepts subscription', () => {
      expect(resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'subscription' })).toBe('subscription');
    });
    it('throws on an invalid value', () => {
      expect(() => resolveAuthMode({ GROK_BUILD_AUTH_MODE: 'metered' })).toThrow(/GROK_BUILD_AUTH_MODE/);
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../src/config.js'`).
  Run: `npm test -- config`

- [ ] **Step 3: Write `src/types.ts`.**
  ```ts
  export type AuthMode = 'subscription' | 'api';
  export type Billing = 'subscription' | 'metered_api';

  export interface AuthCheckResult {
    ok: boolean;
    mode: AuthMode;
    reason?: 'grok_not_installed' | 'not_logged_in' | 'no_api_key';
    message: string;
  }

  export interface StreamingSummary {
    summary: string;
    filesChanged: string[];
    errorText?: string;
  }

  export interface DelegateInput {
    prompt: string;
    cwd: string;
    timeoutMs?: number;
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
  }
  ```

- [ ] **Step 4: Write `src/config.ts`.**
  ```ts
  import type { AuthMode } from './types.js';

  export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
    const raw = env.GROK_BUILD_AUTH_MODE?.trim().toLowerCase();
    if (raw === undefined || raw === '') return 'subscription';
    if (raw === 'subscription' || raw === 'api') return raw;
    throw new Error(
      `Invalid GROK_BUILD_AUTH_MODE: "${env.GROK_BUILD_AUTH_MODE}". Expected "subscription" or "api".`,
    );
  }
  ```

- [ ] **Step 5: Run — expect PASS.** Run: `npm test -- config`

- [ ] **Step 6: Commit.**
  ```bash
  git add mcp-server/src/types.ts mcp-server/src/config.ts mcp-server/test/config.test.ts
  git commit -m "feat: auth mode resolution (default subscription)"
  ```

---

## Task 3: `buildGrokEnv(mode)` — the safety-critical env filter

**Files:**
- Create: `mcp-server/src/env.ts`, `mcp-server/test/env.test.ts`

**Interfaces:**
- Consumes: `AuthMode` from `./types.js`.
- Produces: `function buildGrokEnv(mode: AuthMode, env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`

- [ ] **Step 1: Write `test/env.test.ts` (failing).**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildGrokEnv } from '../src/env.js';

  const withKeys = { PATH: '/usr/bin', XAI_API_KEY: 'sk-x', GROK_CODE_XAI_API_KEY: 'sk-y' };

  describe('buildGrokEnv', () => {
    it('subscription mode strips both API-key vars even when present', () => {
      const out = buildGrokEnv('subscription', withKeys);
      expect(out.XAI_API_KEY).toBeUndefined();
      expect(out.GROK_CODE_XAI_API_KEY).toBeUndefined();
      expect(out.PATH).toBe('/usr/bin');
    });
    it('api mode passes the API-key vars through', () => {
      const out = buildGrokEnv('api', withKeys);
      expect(out.XAI_API_KEY).toBe('sk-x');
      expect(out.GROK_CODE_XAI_API_KEY).toBe('sk-y');
    });
    it('does not mutate the input env', () => {
      buildGrokEnv('subscription', withKeys);
      expect(withKeys.XAI_API_KEY).toBe('sk-x');
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm test -- env`

- [ ] **Step 3: Write `src/env.ts`.**
  ```ts
  import type { AuthMode } from './types.js';

  const API_KEY_VARS = ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'] as const;

  export function buildGrokEnv(
    mode: AuthMode,
    env: NodeJS.ProcessEnv = process.env,
  ): NodeJS.ProcessEnv {
    const copy: NodeJS.ProcessEnv = { ...env };
    if (mode === 'subscription') {
      for (const key of API_KEY_VARS) delete copy[key];
    }
    return copy;
  }
  ```

- [ ] **Step 4: Run — expect PASS.** Run: `npm test -- env`

- [ ] **Step 5: Commit.**
  ```bash
  git add mcp-server/src/env.ts mcp-server/test/env.test.ts
  git commit -m "feat: buildGrokEnv strips API keys in subscription mode, passes through in api mode"
  ```

---

## Task 4: `summarizeStreamingJson(stdout)`

**Files:**
- Create: `mcp-server/src/streaming.ts`, `mcp-server/test/streaming.test.ts`

**Interfaces:**
- Consumes: `StreamingSummary` from `./types.js`.
- Produces: `function summarizeStreamingJson(stdout: string): StreamingSummary`

> **Task 0 dependency:** the `EVENT` constant strings below are the *expected* event-type names. Replace them with the exact values from `docs/specs/grok-cli-contract.md`. The parser logic and its tests are schema-stable; only these three strings and the field names (`path`, `text`) may need adjusting.

- [ ] **Step 1: Write `test/streaming.test.ts` (failing).**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { summarizeStreamingJson } from '../src/streaming.js';

  const jsonl = [
    JSON.stringify({ type: 'file_edit', path: 'src/a.ts' }),
    'not json — should be ignored',
    JSON.stringify({ type: 'file_edit', path: 'src/b.ts' }),
    JSON.stringify({ type: 'file_edit', path: 'src/a.ts' }), // dup
    JSON.stringify({ type: 'result', text: 'Done.' }),
  ].join('\n');

  describe('summarizeStreamingJson', () => {
    it('collects unique changed files and the result text', () => {
      const s = summarizeStreamingJson(jsonl);
      expect(s.filesChanged).toEqual(['src/a.ts', 'src/b.ts']);
      expect(s.summary).toContain('Done.');
      expect(s.summary).toContain('2 file(s)');
      expect(s.errorText).toBeUndefined();
    });
    it('captures error events', () => {
      const s = summarizeStreamingJson(JSON.stringify({ type: 'error', text: 'boom' }));
      expect(s.errorText).toBe('boom');
    });
    it('returns a placeholder summary when nothing usable is present', () => {
      const s = summarizeStreamingJson('');
      expect(s.filesChanged).toEqual([]);
      expect(s.summary).toBe('(no summary produced)');
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm test -- streaming`

- [ ] **Step 3: Write `src/streaming.ts`.**
  ```ts
  import type { StreamingSummary } from './types.js';

  // Grok streaming-json event type strings — CONFIRM against docs/specs/grok-cli-contract.md (Task 0).
  const EVENT = { fileEdit: 'file_edit', result: 'result', error: 'error' } as const;

  export function summarizeStreamingJson(stdout: string): StreamingSummary {
    const files = new Set<string>();
    let resultText = '';
    let errorText: string | undefined;

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: unknown;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // ignore non-JSON lines
      }
      const e = event as { type?: string; path?: unknown; text?: unknown };
      switch (e.type) {
        case EVENT.fileEdit:
          if (typeof e.path === 'string') files.add(e.path);
          break;
        case EVENT.result:
          if (typeof e.text === 'string') resultText = e.text;
          break;
        case EVENT.error:
          if (typeof e.text === 'string') errorText = e.text;
          break;
      }
    }

    const filesChanged = [...files];
    const parts: string[] = [];
    if (resultText) parts.push(resultText);
    if (filesChanged.length) parts.push(`Changed ${filesChanged.length} file(s): ${filesChanged.join(', ')}`);
    return { summary: parts.join('\n') || '(no summary produced)', filesChanged, errorText };
  }
  ```

- [ ] **Step 4: Run — expect PASS.** Run: `npm test -- streaming`

- [ ] **Step 5: Commit.**
  ```bash
  git add mcp-server/src/streaming.ts mcp-server/test/streaming.test.ts
  git commit -m "feat: summarize grok streaming-json into text + changed files"
  ```

---

## Task 5: `checkAuth(mode, deps)`

**Files:**
- Create: `mcp-server/src/auth.ts`, `mcp-server/test/auth.test.ts`

**Interfaces:**
- Consumes: `AuthMode`, `AuthCheckResult` from `./types.js`.
- Produces:
  - `interface AuthDeps { grokInstalled: () => boolean; authFileExists: () => boolean; env: NodeJS.ProcessEnv }`
  - `function checkAuth(mode: AuthMode, deps: AuthDeps): AuthCheckResult`
  - `function defaultAuthDeps(env?: NodeJS.ProcessEnv): AuthDeps`

- [ ] **Step 1: Write `test/auth.test.ts` (failing).**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { checkAuth, type AuthDeps } from '../src/auth.js';

  const deps = (over: Partial<AuthDeps>): AuthDeps => ({
    grokInstalled: () => true,
    authFileExists: () => true,
    env: {},
    ...over,
  });

  describe('checkAuth', () => {
    it('fails when grok is not installed (either mode)', () => {
      const r = checkAuth('subscription', deps({ grokInstalled: () => false }));
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('grok_not_installed');
    });
    it('subscription: fails when auth.json is missing', () => {
      const r = checkAuth('subscription', deps({ authFileExists: () => false }));
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('not_logged_in');
    });
    it('subscription: ok when auth.json exists', () => {
      expect(checkAuth('subscription', deps({})).ok).toBe(true);
    });
    it('api: fails when no key is present', () => {
      const r = checkAuth('api', deps({ authFileExists: () => false, env: {} }));
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('no_api_key');
    });
    it('api: ok when XAI_API_KEY is present (even without auth.json)', () => {
      const r = checkAuth('api', deps({ authFileExists: () => false, env: { XAI_API_KEY: 'sk-x' } }));
      expect(r.ok).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm test -- auth`

- [ ] **Step 3: Write `src/auth.ts`.**
  ```ts
  import { existsSync } from 'node:fs';
  import { homedir } from 'node:os';
  import { join } from 'node:path';
  import { spawnSync } from 'node:child_process';
  import type { AuthMode, AuthCheckResult } from './types.js';

  export interface AuthDeps {
    grokInstalled: () => boolean;
    authFileExists: () => boolean;
    env: NodeJS.ProcessEnv;
  }

  export function checkAuth(mode: AuthMode, deps: AuthDeps): AuthCheckResult {
    if (!deps.grokInstalled()) {
      return {
        ok: false, mode, reason: 'grok_not_installed',
        message: 'Grok Build CLI가 설치돼 있지 않습니다. `curl -fsSL https://x.ai/cli/install.sh | bash`로 설치하세요.',
      };
    }
    if (mode === 'subscription') {
      if (!deps.authFileExists()) {
        return {
          ok: false, mode, reason: 'not_logged_in',
          message: '구독 로그인이 필요합니다. 터미널에서 `grok login`을 실행한 뒤 다시 시도하세요.',
        };
      }
      return { ok: true, mode, message: '구독 세션 인증 준비됨.' };
    }
    const hasKey = Boolean(deps.env.XAI_API_KEY || deps.env.GROK_CODE_XAI_API_KEY);
    if (!hasKey) {
      return {
        ok: false, mode, reason: 'no_api_key',
        message: 'API 모드입니다. `XAI_API_KEY` 환경변수를 설정한 뒤 다시 시도하세요.',
      };
    }
    return { ok: true, mode, message: 'API 키 인증 준비됨.' };
  }

  export function defaultAuthDeps(env: NodeJS.ProcessEnv = process.env): AuthDeps {
    return {
      grokInstalled: () => {
        const probe = process.platform === 'win32'
          ? spawnSync('where', ['grok'])
          : spawnSync('sh', ['-c', 'command -v grok']);
        return probe.status === 0;
      },
      authFileExists: () => existsSync(join(homedir(), '.grok', 'auth.json')),
      env,
    };
  }
  ```

- [ ] **Step 4: Run — expect PASS.** Run: `npm test -- auth`

- [ ] **Step 5: Commit.**
  ```bash
  git add mcp-server/src/auth.ts mcp-server/test/auth.test.ts
  git commit -m "feat: mode-branched auth check (subscription/api)"
  ```

---

## Task 6: `runDelegate(mode, input, spawnFn)`

**Files:**
- Create: `mcp-server/src/delegate.ts`, `mcp-server/test/delegate.test.ts`

**Interfaces:**
- Consumes: `buildGrokEnv` (Task 3), `summarizeStreamingJson` (Task 4), types from `./types.js`.
- Produces:
  - `interface SpawnResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }`
  - `type SpawnFn = (args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<SpawnResult>`
  - `function billingFor(mode: AuthMode): Billing`
  - `function runDelegate(mode: AuthMode, input: DelegateInput, spawnFn?: SpawnFn): Promise<DelegateResult>`
  - `const defaultSpawn: SpawnFn`

> **Task 0 dependency:** the `AUTH_ERROR_SIGNALS` regexes must match the real stderr wording captured in Task 0. Update them if the capture differs.

- [ ] **Step 1: Write `test/delegate.test.ts` (failing).**
  ```ts
  import { describe, it, expect } from 'vitest';
  import { runDelegate, type SpawnFn, type SpawnResult } from '../src/delegate.js';

  const fakeSpawn = (r: Partial<SpawnResult>): SpawnFn =>
    async (_args, _cwd, _env, _t) => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...r });

  const input = { prompt: 'do x', cwd: '/tmp/proj' };

  describe('runDelegate', () => {
    it('completed: summarizes stdout and reports billing by mode', async () => {
      const stdout = JSON.stringify({ type: 'result', text: 'ok' });
      const r = await runDelegate('api', input, fakeSpawn({ code: 0, stdout }));
      expect(r.status).toBe('completed');
      expect(r.mode).toBe('api');
      expect(r.billing).toBe('metered_api');
      expect(r.summary).toContain('ok');
    });
    it('subscription mode reports subscription billing', async () => {
      const r = await runDelegate('subscription', input, fakeSpawn({ code: 0 }));
      expect(r.billing).toBe('subscription');
    });
    it('timeout maps to status timeout', async () => {
      const r = await runDelegate('subscription', input, fakeSpawn({ timedOut: true, code: null }));
      expect(r.status).toBe('timeout');
    });
    it('auth-signal stderr on nonzero exit maps to auth_error', async () => {
      const r = await runDelegate('subscription', input, fakeSpawn({ code: 1, stderr: 'Error: not authenticated' }));
      expect(r.status).toBe('auth_error');
      expect(r.rawStderrTail).toContain('not authenticated');
    });
    it('other nonzero exit maps to grok_error', async () => {
      const r = await runDelegate('subscription', input, fakeSpawn({ code: 2, stderr: 'compile failed' }));
      expect(r.status).toBe('grok_error');
    });
  });
  ```

- [ ] **Step 2: Run — expect FAIL.** Run: `npm test -- delegate`

- [ ] **Step 3: Write `src/delegate.ts`.**
  ```ts
  import { spawn } from 'node:child_process';
  import { buildGrokEnv } from './env.js';
  import { summarizeStreamingJson } from './streaming.js';
  import type { AuthMode, Billing, DelegateInput, DelegateResult } from './types.js';

  // CONFIRM against docs/specs/grok-cli-contract.md (Task 0).
  const AUTH_ERROR_SIGNALS = [/not authenticated/i, /unauthorized/i, /\b401\b/, /\b403\b/, /grok login/i];

  export interface SpawnResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }

  export type SpawnFn = (
    args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number,
  ) => Promise<SpawnResult>;

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

  export async function runDelegate(
    mode: AuthMode,
    input: DelegateInput,
    spawnFn: SpawnFn = defaultSpawn,
  ): Promise<DelegateResult> {
    const billing = billingFor(mode);
    const timeoutMs = input.timeoutMs ?? 180_000;
    const env = buildGrokEnv(mode, process.env);
    const args = ['--no-auto-update', '-p', input.prompt, '--output-format', 'streaming-json'];

    const r = await spawnFn(args, input.cwd, env, timeoutMs);

    if (r.timedOut) {
      return {
        status: 'timeout', mode, billing,
        message: `Grok Build 작업이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다. 범위를 줄이거나 timeout_ms를 늘려 다시 시도하세요.`,
      };
    }
    if (r.code !== 0) {
      const tail = r.stderr.slice(-500);
      if (AUTH_ERROR_SIGNALS.some((re) => re.test(r.stderr))) {
        const message = mode === 'subscription'
          ? '구독 인증이 만료됐습니다. `grok login`을 다시 실행하세요.'
          : 'API 인증에 실패했습니다. `XAI_API_KEY`가 유효한지 확인하세요.';
        return { status: 'auth_error', mode, billing, message, rawStderrTail: tail };
      }
      return { status: 'grok_error', mode, billing, message: 'Grok Build 실행이 실패했습니다.', rawStderrTail: tail };
    }
    const s = summarizeStreamingJson(r.stdout);
    return { status: 'completed', mode, billing, summary: s.summary, filesChanged: s.filesChanged };
  }
  ```

- [ ] **Step 4: Run — expect PASS.** Run: `npm test -- delegate`

- [ ] **Step 5: Commit.**
  ```bash
  git add mcp-server/src/delegate.ts mcp-server/test/delegate.test.ts
  git commit -m "feat: runDelegate spawns grok, classifies errors, tags mode/billing"
  ```

---

## Task 7: MCP server wiring (`index.ts`) + build

**Files:**
- Create: `mcp-server/src/index.ts`

**Interfaces:**
- Consumes: `resolveAuthMode` (Task 2), `checkAuth`/`defaultAuthDeps` (Task 5), `runDelegate` (Task 6).
- Produces: a runnable stdio MCP server exposing `grok_auth_check` and `grok_build_delegate`.

- [ ] **Step 1: Write `src/index.ts`.**
  ```ts
  import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
  import { z } from 'zod';
  import { resolveAuthMode } from './config.js';
  import { checkAuth, defaultAuthDeps } from './auth.js';
  import { runDelegate } from './delegate.js';

  async function main(): Promise<void> {
    const mode = resolveAuthMode(); // throws on invalid value → server fails fast at startup

    const server = new McpServer({ name: 'grok-build', version: '0.1.0' });

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

    server.registerTool(
      'grok_build_delegate',
      {
        description: 'Delegate a coding task to Grok Build; returns a summary, changed files, and billing mode.',
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
        const result = await runDelegate(mode, { prompt, cwd, timeoutMs: timeout_ms });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: result.status !== 'completed',
        };
      },
    );

    await server.connect(new StdioServerTransport());
  }

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  ```

- [ ] **Step 2: Typecheck + build.**
  Run: `npm run typecheck && npm run build`
  Expected: no errors; `dist/index.js` produced.

- [ ] **Step 3: Smoke-run the server handshake.** Confirm it starts and responds to an MCP `initialize` over stdio. Quick check that it doesn't crash:
  Run: `node dist/index.js` then send Ctrl-D (it should wait on stdio without throwing). For a real handshake, use Task 9's Claude Code registration.

- [ ] **Step 4: Commit.**
  ```bash
  git add mcp-server/src/index.ts
  git commit -m "feat: wire grok_auth_check + grok_build_delegate MCP tools over stdio"
  ```

---

## Task 8: Plugin packaging

**Files:**
- Create: `.claude-plugin/plugin.json`, `.mcp.json`, `commands/grok-build-delegate.md`, `commands/grok-build-check-auth.md`

**Interfaces:**
- Produces: an installable plugin that auto-registers the MCP server and exposes two slash commands.

- [ ] **Step 1: Write `.claude-plugin/plugin.json`.**
  ```json
  {
    "name": "claude-grok-build-plugin",
    "version": "0.1.0",
    "description": "Grok Build CLI에 코딩 작업을 위임하는 MCP 브리지",
    "author": { "name": "xzawed" }
  }
  ```

- [ ] **Step 2: Write `.mcp.json`.**
  ```json
  {
    "mcpServers": {
      "grok-build": {
        "command": "node",
        "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"]
      }
    }
  }
  ```
  (To run in API mode, add `"env": { "GROK_BUILD_AUTH_MODE": "api" }` here. Omitted ⇒ subscription.)

- [ ] **Step 3: Write `commands/grok-build-delegate.md`.**
  ```markdown
  ---
  description: Delegate a coding task to Grok Build (subscription or API mode)
  ---

  Call `grok_auth_check` first. If it returns `ok: false`, stop and show its `message`.
  Otherwise call `grok_build_delegate` with the user's task as `prompt` and the current
  working directory as `cwd`. Show the returned `summary`, `filesChanged`, and — importantly —
  the `billing` field so the user knows whether this ran on their subscription or metered API.
  Do not commit; let the user review the diff.
  ```

- [ ] **Step 4: Write `commands/grok-build-check-auth.md`.**
  ```markdown
  ---
  description: Check Grok Build auth status without delegating
  ---

  Call `grok_auth_check` and show the result verbatim (ok, mode, reason, message).
  Use this to diagnose login / API-key problems before delegating.
  ```

- [ ] **Step 5: Commit.**
  ```bash
  git add .claude-plugin/plugin.json .mcp.json commands/
  git commit -m "feat: package plugin (manifest, mcp registration, slash commands)"
  ```

> **Verify before finalizing:** the exact slash-command invocation string (`/grok-build-delegate` vs a namespaced form) against the installed Claude Code version — see the caution note in `docs/03-plugin-spec.md`.

---

## Task 9: End-to-end verification (both modes)

**Files:** none (manual verification). Prerequisite: `npm run build` done; plugin installed/registered locally in Claude Code; `grok login` complete; `XAI_API_KEY` available for the API run.

- [ ] **Step 1: Subscription E2E.** With `GROK_BUILD_AUTH_MODE` unset, in a throwaway git project, invoke the delegate command with a tiny task ("add a `hello()` that returns 'ok' to `util.js`"). Confirm: result `status: completed`, `billing: subscription`, `filesChanged` lists the file, and `git diff` shows the change.

- [ ] **Step 2: Key-leak cross-check.** Set `XAI_API_KEY=sk-bogus` in the shell, keep subscription mode, and delegate again. Confirm it still authenticates via the session (not the bogus key) — i.e. no auth failure attributable to the key — proving `buildGrokEnv` stripped it. (Optional: add a temporary `console.error(Object.keys(env))` in `defaultSpawn` to confirm the key is absent, then revert.)

- [ ] **Step 3: API E2E.** Set `GROK_BUILD_AUTH_MODE=api` (in `.mcp.json` env or the server env) and a valid `XAI_API_KEY`, restart, delegate the same tiny task. Confirm `status: completed`, `billing: metered_api`, and the diff appears.

- [ ] **Step 4: Failure modes.** (a) API mode with no key ⇒ `grok_auth_check` returns `no_api_key`. (b) Subscription mode with `auth.json` renamed away ⇒ `not_logged_in`. (c) grok uninstalled/off PATH ⇒ `grok_not_installed`.

- [ ] **Step 5: Record results** in a short note on the PR / commit message. No code commit unless a fix was needed.

---

## Task 10: Documentation updates

**Files (modify):** `CLAUDE.md`, `docs/02-auth-strategy.md`, `docs/04-mcp-server-spec.md`, `docs/05-routing-policy.md`, `docs/06-roadmap.md`, `README.md`, `README.ko.md`

Apply the "문서 영향" list from the spec (§6). Each is a targeted edit, not a rewrite:

- [ ] **Step 1: `CLAUDE.md`** — replace absolute principle #1 with the mode-conditional wording from spec §4; component map already lists `mcp-server/`, add `src/config.ts`; note default mode = subscription.
- [ ] **Step 2: `docs/02-auth-strategy.md`** — reframe "구독 전용" → two-track (subscription default, API opt-in); keep the billing-leak rationale as justification for opt-in + no per-call override; add API-mode items to the verification checklist.
- [ ] **Step 3: `docs/04-mcp-server-spec.md`** — add `mode`/`billing` to `grok_build_delegate` output; add `no_api_key` reason to `grok_auth_check`; document `GROK_BUILD_AUTH_MODE`.
- [ ] **Step 4: `docs/05-routing-policy.md`** — make the "구독 정액이라 위임 횟수 아낄 이유 없음" note mode-conditional (API mode is metered → cost matters again).
- [ ] **Step 5: `docs/06-roadmap.md`** — check Phase 1 boxes that are now done; confirm the "API 키 경로 미지원" exclusion is already removed.
- [ ] **Step 6: `README.md` / `README.ko.md`** — add a short "Auth modes" / "인증 모드" section (subscription default, `GROK_BUILD_AUTH_MODE=api` for metered); keep EN/KO in parity.
- [ ] **Step 7: Commit.**
  ```bash
  git add CLAUDE.md docs/ README.md README.ko.md
  git commit -m "docs: reflect two-track auth across specs and READMEs"
  ```

---

## Self-Review

- **Spec coverage:** config (§5 config.ts → Task 2) ✓; env strip/pass-through (§3.1, §5 → Task 3) ✓; auth_check branch incl. `no_api_key` (§5.1 → Task 5) ✓; delegate mode/billing + error branch (§5.2 → Task 6) ✓; server wiring (→ Task 7) ✓; packaging + `GROK_BUILD_AUTH_MODE` env (§2 → Task 8) ✓; unit + both-mode E2E incl. key-leak cross-check (§7 → Tasks 2–6, 9) ✓; doc impact (§6 → Task 10) ✓; premise verification (§9 → Task 0) ✓. No per-call override / no hooks (§8) — correctly absent.
- **Placeholders:** none — the only deferred values are the grok event-type strings / stderr regexes, which are explicitly bound to the Task 0 capture (named constants, not TODOs).
- **Type consistency:** `AuthMode`, `Billing`, `AuthCheckResult`, `DelegateResult`, `DelegateInput`, `StreamingSummary`, `AuthDeps`, `SpawnFn`/`SpawnResult` are defined once (Tasks 2/5/6) and consumed with matching names/shapes downstream; `resolveAuthMode`, `buildGrokEnv`, `summarizeStreamingJson`, `checkAuth`, `defaultAuthDeps`, `runDelegate`, `billingFor`, `defaultSpawn` are referenced consistently.
