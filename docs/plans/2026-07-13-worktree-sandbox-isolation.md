# Worktree Isolation + Sandbox Pass-through Implementation Plan

> **SHIPPED — historical record. Do not execute.** This plan shipped in `v0.1.0`; its
> unchecked boxes are an artifact of the original plan, not open work. The source for
> current behaviour is `docs/specs/grok-cli-contract.md` (measured) and `mcp-server/src/`.
> *(Annotated 2026-09-05.)*

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in `worktree` (wrapper-created git worktree, precise `filesChanged`) and `sandbox` (grok `--sandbox <profile>` pass-through) to `grok_build_delegate`.

**Architecture:** New `worktree.ts` creates a fresh worktree from HEAD; `runDelegate` runs grok with `--cwd` = the worktree and derives `filesChanged` there (all changes are grok's). `sandbox` is appended to the grok args. Both default off; a worktree-creation failure fails the delegation (no silent fallback).

**Tech Stack:** TypeScript (ESM, NodeNext), Node `child_process`/`fs`/`os`/`path`, vitest, esbuild bundle.

## Global Constraints

- Both fields opt-in, default OFF. `worktree` bases on HEAD (grok will not see uncommitted cwd changes — isolation implies a clean base).
- Worktree-creation failure → `grok_error` with a clear message; do NOT silently edit `cwd`.
- Never leak credentials; keep `delegate.ts`'s hardened behavior intact for the non-worktree path.
- grok's own `--worktree` flag is a headless no-op — do NOT use it; the wrapper manages the worktree and points grok `--cwd` at it. grok honors `--cwd` (measured).
- `dist/index.js` is a committed esbuild bundle — run `npm run build` before committing after `src/` changes.
- TDD; run commands from `mcp-server/`. SDK `@modelcontextprotocol/sdk` ^1.29.0, zod ^3.25.0.

---

### Task 1: `worktree.ts` — `createGrokWorktree`

**Files:**
- Create: `mcp-server/src/worktree.ts`
- Test: `mcp-server/test/worktree.test.ts`

**Interfaces:**
- Produces: `type GitRunner = (args: string[]) => Promise<void>`; `interface WorktreeDeps { runGit?: GitRunner; baseDir?: string; name?: string }`; `worktreeName(): string`; `createGrokWorktree(cwd: string, deps?: WorktreeDeps): Promise<string>`

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/test/worktree.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrokWorktree } from '../src/worktree.js';

describe('createGrokWorktree', () => {
  it('runs `git -C <cwd> worktree add <baseDir>/<name> -b grok/<name> HEAD` and returns the path', async () => {
    const calls: string[][] = [];
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-wt-'));
    const path = await createGrokWorktree('/abs/repo', {
      name: 'fixed', baseDir, runGit: async (a) => { calls.push(a); },
    });
    const expected = join(baseDir, 'fixed');
    expect(path).toBe(expected);
    expect(calls).toEqual([['-C', '/abs/repo', 'worktree', 'add', expected, '-b', 'grok/fixed', 'HEAD']]);
  });
  it('propagates a git failure (throws)', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'grok-wt-'));
    await expect(createGrokWorktree('/abs/repo', {
      name: 'fixed', baseDir, runGit: async () => { throw new Error('not a git repo'); },
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/worktree.test.ts`
Expected: FAIL — cannot import `createGrokWorktree`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/worktree.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export type GitRunner = (args: string[]) => Promise<void>;

export interface WorktreeDeps {
  runGit?: GitRunner;
  baseDir?: string;
  name?: string;
}

const defaultRunGit: GitRunner = async (args) => {
  await execFileAsync('git', args); // rejects on non-zero exit
};

export function worktreeName(): string {
  return `grok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Creates a fresh git worktree at <baseDir>/<name> on a new branch grok/<name>
// based on the current HEAD of the repo at cwd. Returns the worktree path.
// Throws if cwd is not a git repo / has no commits / git otherwise fails.
export async function createGrokWorktree(cwd: string, deps: WorktreeDeps = {}): Promise<string> {
  const name = deps.name ?? worktreeName();
  const baseDir = deps.baseDir ?? join(homedir(), '.grok-build', 'worktrees');
  const runGit = deps.runGit ?? defaultRunGit;
  const path = join(baseDir, name);
  mkdirSync(baseDir, { recursive: true });
  await runGit(['-C', cwd, 'worktree', 'add', path, '-b', `grok/${name}`, 'HEAD']);
  return path;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/worktree.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/worktree.ts mcp-server/test/worktree.test.ts
git commit -m "feat(worktree): createGrokWorktree — fresh worktree from HEAD"
```

---

### Task 2: delegate + types + index wiring (worktree isolation + sandbox)

**Files:**
- Modify: `mcp-server/src/types.ts` (DelegateInput, DelegateResult)
- Modify: `mcp-server/src/delegate.ts` (runDelegate)
- Modify: `mcp-server/src/index.ts` (zod schema + handler)
- Test: `mcp-server/test/delegate.test.ts`

**Interfaces:**
- Consumes: `createGrokWorktree` from `./worktree.js`
- Produces: `DelegateDeps.createWorktree?: (cwd: string) => Promise<string>`; `DelegateInput.worktree?: boolean`, `DelegateInput.sandbox?: string`; `DelegateResult.worktreePath?: string`

- [ ] **Step 1: Write the failing tests** (append inside `describe('runDelegate')` in `test/delegate.test.ts`)

```typescript
  // Phase 3 — worktree isolation
  it('worktree mode runs grok in the created worktree and derives filesChanged there', async () => {
    let capturedArgs: string[] = [];
    let capturedCwd = '';
    const capSpawn: SpawnFn = async (args, cwd) => { capturedArgs = args; capturedCwd = cwd; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'do x', cwd: '/abs/repo', worktree: true }, {
      spawn: capSpawn, dirExists: () => true,
      createWorktree: async () => '/wt/path',
      gitChangedFiles: (cwd) => (cwd === '/wt/path' ? ['a.ts'] : []),
    });
    expect(r.status).toBe('completed');
    expect(r.worktreePath).toBe('/wt/path');
    expect(r.filesChanged).toEqual(['a.ts']);
    expect(capturedCwd).toBe('/wt/path');
    expect(capturedArgs[capturedArgs.indexOf('--cwd') + 1]).toBe('/wt/path');
  });
  it('worktree creation failure returns grok_error without spawning grok', async () => {
    let spawned = false;
    const spy: SpawnFn = async () => { spawned = true; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/abs/repo', worktree: true }, {
      spawn: spy, dirExists: () => true, gitChangedFiles: () => [],
      createWorktree: async () => { throw new Error('not a git repo'); },
    });
    expect(r.status).toBe('grok_error');
    expect(r.message).toMatch(/worktree/);
    expect(spawned).toBe(false);
  });
  // Phase 3 — sandbox pass-through
  it('passes --sandbox <profile> when sandbox is set, and omits it otherwise', async () => {
    let withArgs: string[] = [];
    const cap: SpawnFn = async (args) => { withArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', sandbox: 'readonly' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(withArgs[withArgs.indexOf('--sandbox') + 1]).toBe('readonly');
    let noArgs: string[] = [];
    const cap2: SpawnFn = async (args) => { noArgs = args; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap2, dirExists: () => true, gitChangedFiles: () => [] });
    expect(noArgs).not.toContain('--sandbox');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/delegate.test.ts`
Expected: FAIL — `worktreePath` undefined / `--sandbox` absent / worktree not honored.

- [ ] **Step 3a: Extend `types.ts`**

In `DelegateInput` add:
```typescript
  worktree?: boolean;   // opt-in: run grok in a fresh wrapper-created git worktree
  sandbox?: string;     // opt-in: pass --sandbox <profile> to grok
```
In `DelegateResult` add:
```typescript
  worktreePath?: string; // set when the delegation ran in an isolated worktree
```

- [ ] **Step 3b: Modify `delegate.ts`**

Add the import:
```typescript
import { createGrokWorktree } from './worktree.js';
```
Add to `DelegateDeps`:
```typescript
  createWorktree?: (cwd: string) => Promise<string>;
```
Replace the body of `runDelegate` from the `const timeoutMs = ...` line through the final `return` with:
```typescript
  const timeoutMs = input.timeoutMs ?? 180_000;
  const createWorktree = deps.createWorktree ?? ((c: string) => createGrokWorktree(c));

  let effectiveCwd = input.cwd;
  let worktreePath: string | undefined;
  if (input.worktree) {
    try {
      worktreePath = await createWorktree(input.cwd);
      effectiveCwd = worktreePath;
    } catch {
      return { status: 'grok_error', mode, billing, message: 'worktree 생성에 실패했습니다 — cwd가 커밋이 있는 git 저장소인지 확인하세요.' };
    }
  }

  const env = buildGrokEnv(mode, deps.env ?? process.env);
  const args = [
    '--no-auto-update', '--always-approve', '--cwd', effectiveCwd,
    '-p', input.prompt, '--output-format', 'json',
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
  ];

  const r = await spawnFn(args, effectiveCwd, env, timeoutMs);

  if (r.spawnError) {
    return {
      status: 'grok_error', mode, billing,
      message: `Grok Build 프로세스를 시작할 수 없습니다: ${r.stderr}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      worktreePath,
    };
  }

  const filesChanged = await gitChangedFiles(effectiveCwd);

  if (r.timedOut) {
    return {
      status: 'timeout', mode, billing,
      message: `Grok Build 작업이 ${Math.round(timeoutMs / 1000)}초 내에 끝나지 않았습니다. 범위를 줄이거나 timeout_ms를 늘려 다시 시도하세요.`,
      filesChanged, worktreePath,
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
      return { status: 'auth_error', mode, billing, message, rawStderrTail: tail, worktreePath };
    }
    return { status: 'grok_error', mode, billing, message: 'Grok Build 출력을 해석할 수 없습니다.', rawStderrTail: tail, filesChanged, worktreePath };
  }

  if (parsed.stopReason !== 'EndTurn') {
    return {
      status: 'grok_error', mode, billing,
      message: `Grok Build가 완료되지 않았습니다 (stopReason: ${parsed.stopReason || 'unknown'}). ${parsed.text}`.trim(),
      rawStderrTail: r.stderr.slice(-500) || undefined,
      filesChanged, worktreePath,
    };
  }

  return {
    status: 'completed', mode, billing,
    summary: parsed.text || '(no summary)',
    filesChanged, worktreePath,
  };
```
(Note: `worktreePath` is `undefined` for non-worktree calls; `JSON.stringify` omits undefined fields, so non-worktree responses are unchanged. The `env`/`args`/`spawnFn` lines now use `effectiveCwd`.)

- [ ] **Step 3c: Modify `index.ts`**

Extend the `grok_build_delegate` `inputSchema` with:
```typescript
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox <profile> for filesystem/network limits (grok-native; profile names unverified).'),
```
Change the handler signature and `input`:
```typescript
    async ({ prompt, cwd, timeout_ms, worktree, sandbox }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run test/delegate.test.ts`
Expected: typecheck exit 0; all delegate tests pass (existing 21 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/types.ts mcp-server/src/delegate.ts mcp-server/src/index.ts mcp-server/test/delegate.test.ts
git commit -m "feat(delegate): wrapper-managed worktree isolation + --sandbox pass-through"
```

---

### Task 3: history entry carries worktreePath + sandbox

**Files:**
- Modify: `mcp-server/src/history.ts`
- Test: `mcp-server/test/history.test.ts`

**Interfaces:**
- Produces: `HistoryEntry.worktreePath?: string`, `HistoryEntry.sandbox?: string`

- [ ] **Step 1: Write the failing test** (append inside `describe('buildHistoryEntry')`)

```typescript
  it('carries worktreePath (from result) and sandbox (from input) when present, omits when absent', () => {
    const withIso = buildHistoryEntry(
      { prompt: 'x', cwd: '/p', sandbox: 'readonly' },
      { ...completed, worktreePath: '/wt/path' },
      meta,
    );
    expect(withIso.worktreePath).toBe('/wt/path');
    expect(withIso.sandbox).toBe('readonly');
    const plain = buildHistoryEntry(input, completed, meta);
    expect(plain.worktreePath).toBeUndefined();
    expect(plain.sandbox).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL — `worktreePath`/`sandbox` undefined on the entry.

- [ ] **Step 3: Modify `history.ts`**

Add to the `HistoryEntry` interface:
```typescript
  worktreePath?: string;
  sandbox?: string;
```
In `buildHistoryEntry`, before `return entry;`, add:
```typescript
  if (result.worktreePath) entry.worktreePath = result.worktreePath;
  if (input.sandbox) entry.sandbox = input.sandbox;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/history.ts mcp-server/test/history.test.ts
git commit -m "feat(history): record worktreePath + sandbox for provenance"
```

---

### Task 4: docs sync + bundle + final verification

**Files:**
- Modify: `docs/04-mcp-server-spec.md`, `docs/05-routing-policy.md`, `docs/06-roadmap.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/04-mcp-server-spec.md`** — in the `grok_build_delegate` Input block add `worktree?: boolean` and `sandbox?: string`; add `worktreePath?: string` to the success/failure Output blocks; and add a subsection:

```markdown
### 격리 (`worktree` / `sandbox`, opt-in)

- `worktree: true` — 래퍼가 `git worktree add`(HEAD 기준, 새 브랜치 `grok/<name>`)로 만든
  격리 worktree에서 grok을 실행한다(`worktree.ts`의 `createGrokWorktree`). grok의 `--worktree`
  플래그는 헤드리스에서 무시되므로 쓰지 않는다. 변경은 cwd가 아니라 worktree에 들어가며,
  `filesChanged`는 그 worktree에서 도출되어 **전부 grok 변경(정밀 귀속)**이다. 응답에
  `worktreePath`를 실어 사람/Claude가 검토·병합한다. ⚠️ worktree는 HEAD 기준이라 grok은
  cwd의 미커밋 변경을 못 본다. 생성 실패 시 `grok_error`로 실패(조용히 cwd 편집하지 않음).
  정리는 수동(`git worktree remove` / `grok worktree gc`) — 누적은 알려진 한계.
- `sandbox: "<profile>"` — grok에 `--sandbox <profile>`을 그대로 전달(fs/네트워크 제한,
  env `GROK_SANDBOX`). ⚠️ grok-native이며 유효 profile은 미검증 — 사용자가 아는 값으로 opt-in.
```

- [ ] **Step 2: `docs/05-routing-policy.md`** — in "위임 시에도 지켜야 할 것" note that risky/large delegations can opt into `worktree: true` for isolation + precise change attribution.

- [ ] **Step 3: `docs/06-roadmap.md`** — under Phase 3 change the isolation line to done:
`- [x] --worktree/--sandbox opt-in 격리 필드 — 래퍼 관리 worktree(정밀 filesChanged 귀속) + sandbox pass-through. grok --worktree는 헤드리스 no-op이라 래퍼가 관리.`

- [ ] **Step 4: `CLAUDE.md`** — add to the component map under `mcp-server/src/`:
`  - \`worktree.ts\` — \`createGrokWorktree\`: cwd의 HEAD 기준 격리 git worktree 생성(위험 작업 격리 + filesChanged 정밀 귀속). grok --worktree는 헤드리스 미동작이라 래퍼가 관리.`
And bump the test count (run `npm test` for the exact number) in the 현재 상태 + 개발 명령 sections and the `test/` line.

- [ ] **Step 5: Rebuild bundle + full verification**

Run: `npm run build && npm run typecheck && npm test`
Expected: bundle written; typecheck exit 0; all tests pass. Note the final count for docs.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md mcp-server/dist/index.js
git commit -m "docs: worktree isolation + sandbox pass-through; roadmap + component map"
```

---

## Self-Review

**Spec coverage:** wrapper-managed worktree (Task 1 `createGrokWorktree`; Task 2 `effectiveCwd`) ✓; precise `filesChanged` from worktree (Task 2, `gitChangedFiles(effectiveCwd)`) ✓; sandbox pass-through (Task 2) ✓; fail-on-worktree-error, no silent fallback (Task 2 test) ✓; `worktreePath` on result + history (Tasks 2, 3) ✓; opt-in default-off (optional fields) ✓; base-on-HEAD semantics + cleanup limitation documented (Task 4) ✓; bundle rebuild (Task 4) ✓.

**Placeholder scan:** every step has real code/commands. No TBD.

**Type consistency:** `createGrokWorktree(cwd, deps?) => Promise<string>` (Task 1) matches `DelegateDeps.createWorktree?: (cwd) => Promise<string>` default `(c) => createGrokWorktree(c)` (Task 2). `DelegateInput.worktree/sandbox` (Task 2 types) match the index.ts schema + handler (Task 2) and `buildHistoryEntry` reads `input.sandbox` + `result.worktreePath` (Task 3), consistent with `DelegateResult.worktreePath` (Task 2).
