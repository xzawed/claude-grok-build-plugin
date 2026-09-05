# Delegation History Logging Implementation Plan

> **SHIPPED — historical record. Do not execute.** This plan shipped in `v0.1.0`; its
> unchecked boxes are an artifact of the original plan, not open work. The source for
> current behaviour is `docs/specs/grok-cli-contract.md` (measured) and `mcp-server/src/`.
> *(Annotated 2026-09-05.)*

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every Grok Build delegation to `~/.grok-build/history.jsonl` (server-internal) so changes are auditable as Claude-vs-Grok provenance, and pin the four failure-mode messages with tests.

**Architecture:** A new pure-ish `history.ts` module (build entry → append JSONL) wired into `index.ts`'s `grok_build_delegate` handler after `runDelegate`; `delegate.ts` is untouched. Logging never throws and never contains credentials.

**Tech Stack:** TypeScript (ESM, NodeNext), Node `fs`/`os`/`path`, vitest. Bundled to `dist/index.js` via esbuild.

## Global Constraints

- Auth is server-level two-track (`GROK_BUILD_AUTH_MODE`, default `subscription`); never leak API keys — logging must never write credentials/env/`rawStderrTail`. (absolute principle #1, #4)
- Never write into the delegated `cwd` (pollutes `git status`/`filesChanged`). Log lives at `~/.grok-build/history.jsonl`.
- Subprocess/IO must not break a delegation — logging is wrapped so it never throws.
- Target OS Linux/macOS; Windows-native out of scope. SDK `@modelcontextprotocol/sdk` ^1.29.0, zod ^3.25.0. *([정정 2026-07-18] 이후 네이티브 Windows에서 auth·delegate·worktree 실측 동작 확인 — `docs/06-roadmap.md` "플랫폼 지원 (실측)" 참고. 당시 스코프 외였다는 기록으로 보존.)*
- `dist/index.js` is a **committed esbuild bundle** — run `npm run build` before committing whenever `src/` changes.
- TDD: write the failing test first, watch it fail, minimal impl, watch pass, commit. Run commands from `mcp-server/`.

---

### Task 1: `history.ts` — `buildHistoryEntry` (pure) + `HistoryEntry` type

**Files:**
- Create: `mcp-server/src/history.ts`
- Test: `mcp-server/test/history.test.ts`

**Interfaces:**
- Consumes: `DelegateInput`, `DelegateResult` from `./types.js`
- Produces: `interface HistoryEntry`, `interface HistoryMeta { ts: string; durationMs: number }`, `buildHistoryEntry(input: DelegateInput, result: DelegateResult, meta: HistoryMeta): HistoryEntry`

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/test/history.test.ts
import { describe, it, expect } from 'vitest';
import { buildHistoryEntry } from '../src/history.js';
import type { DelegateInput, DelegateResult } from '../src/types.js';

const input: DelegateInput = { prompt: 'add a hello test', cwd: '/abs/proj' };
const meta = { ts: '2026-07-13T00:00:00.000Z', durationMs: 1234 };
const completed: DelegateResult = {
  status: 'completed', mode: 'subscription', billing: 'subscription',
  summary: 'Created hi.ts', filesChanged: ['src/a.ts'],
};

describe('buildHistoryEntry', () => {
  it('carries status/mode/billing/cwd and core fields', () => {
    const e = buildHistoryEntry(input, completed, meta);
    expect(e).toMatchObject({
      ts: meta.ts, mode: 'subscription', billing: 'subscription', status: 'completed',
      cwd: '/abs/proj', filesChanged: ['src/a.ts'], filesCount: 1, filesTruncated: false, durationMs: 1234,
    });
    expect(e.promptPreview).toBe('add a hello test');
    expect(e.summaryPreview).toBe('Created hi.ts');
  });
  it('collapses whitespace and truncates prompt/summary to 200 chars + ellipsis', () => {
    const long = 'x'.repeat(250);
    const e = buildHistoryEntry({ prompt: '  a\n\nb  ', cwd: '/p' }, { ...completed, summary: long }, meta);
    expect(e.promptPreview).toBe('a b');
    expect(e.summaryPreview!.length).toBe(201);
    expect(e.summaryPreview!.endsWith('…')).toBe(true);
  });
  it('omits summaryPreview when there is no summary and defaults empty files', () => {
    const e = buildHistoryEntry(input, { status: 'timeout', mode: 'api', billing: 'metered_api' }, meta);
    expect(e.summaryPreview).toBeUndefined();
    expect(e.filesChanged).toEqual([]);
    expect(e.filesCount).toBe(0);
  });
  it('caps filesChanged at 100 while keeping the true count', () => {
    const many = Array.from({ length: 150 }, (_, i) => `f${i}.ts`);
    const e = buildHistoryEntry(input, { ...completed, filesChanged: many }, meta);
    expect(e.filesChanged.length).toBe(100);
    expect(e.filesTruncated).toBe(true);
    expect(e.filesCount).toBe(150);
  });
  it('never includes any credential/env/stderr field', () => {
    const e = buildHistoryEntry(input, { ...completed, rawStderrTail: 'XAI_API_KEY=sk-secret' }, meta);
    const json = JSON.stringify(e);
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('XAI_API_KEY');
    expect(json).not.toContain('rawStderrTail');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL — `buildHistoryEntry is not a function` / cannot import.

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/history.ts
import type { DelegateInput, DelegateResult } from './types.js';

export interface HistoryEntry {
  ts: string;
  mode: DelegateResult['mode'];
  billing: DelegateResult['billing'];
  status: DelegateResult['status'];
  cwd: string;
  promptPreview: string;
  summaryPreview?: string;
  filesChanged: string[];
  filesTruncated: boolean;
  filesCount: number;
  durationMs: number;
}

export interface HistoryMeta {
  ts: string;         // ISO timestamp, injected by the caller (index.ts)
  durationMs: number; // wall-clock around runDelegate
}

const MAX_PREVIEW = 200;
const MAX_FILES = 100;

function preview(s: string | undefined): string {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_PREVIEW ? collapsed.slice(0, MAX_PREVIEW) + '…' : collapsed;
}

export function buildHistoryEntry(
  input: DelegateInput,
  result: DelegateResult,
  meta: HistoryMeta,
): HistoryEntry {
  const files = result.filesChanged ?? [];
  const entry: HistoryEntry = {
    ts: meta.ts,
    mode: result.mode,
    billing: result.billing,
    status: result.status,
    cwd: input.cwd,
    promptPreview: preview(input.prompt),
    filesChanged: files.slice(0, MAX_FILES),
    filesTruncated: files.length > MAX_FILES,
    filesCount: files.length,
    durationMs: meta.durationMs,
  };
  if (result.summary) entry.summaryPreview = preview(result.summary);
  return entry;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/history.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/history.ts mcp-server/test/history.test.ts
git commit -m "feat(history): buildHistoryEntry — provenance entry, truncated, credential-free"
```

---

### Task 2: `history.ts` — `appendHistory` + `recordDelegation` (never-throw)

**Files:**
- Modify: `mcp-server/src/history.ts`
- Test: `mcp-server/test/history.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `buildHistoryEntry` from Task 1
- Produces: `defaultHistoryPath(): string`; `interface AppendDeps { path?: string; write?: (path: string, line: string) => void }`; `appendHistory(entry: HistoryEntry, deps?: AppendDeps): void`; `recordDelegation(input: DelegateInput, result: DelegateResult, meta: HistoryMeta, deps?: AppendDeps): void`

- [ ] **Step 1: Write the failing tests** (append to `test/history.test.ts`)

```typescript
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory, recordDelegation } from '../src/history.js';

describe('appendHistory + recordDelegation', () => {
  it('writes one JSON line + newline via the injected writer', () => {
    const writes: Array<[string, string]> = [];
    appendHistory(buildHistoryEntry(input, completed, meta), {
      path: '/x/history.jsonl', write: (p, l) => writes.push([p, l]),
    });
    expect(writes.length).toBe(1);
    expect(writes[0][0]).toBe('/x/history.jsonl');
    expect(writes[0][1].endsWith('\n')).toBe(true);
    expect(JSON.parse(writes[0][1])).toMatchObject({ status: 'completed', cwd: '/abs/proj' });
  });
  it('recordDelegation swallows writer errors (never throws)', () => {
    expect(() => recordDelegation(input, completed, meta, {
      write: () => { throw new Error('disk full'); },
    })).not.toThrow();
  });
  it('appends across calls (does not overwrite)', () => {
    const lines: string[] = [];
    const deps = { path: '/x', write: (_p: string, l: string) => { lines.push(l); } };
    recordDelegation(input, completed, meta, deps);
    recordDelegation(input, completed, meta, deps);
    expect(lines.length).toBe(2);
  });
  it('defaultWrite creates the dir and appends a real file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-hist-'));
    const path = join(dir, 'nested', 'history.jsonl');
    appendHistory(buildHistoryEntry(input, completed, meta), { path });
    appendHistory(buildHistoryEntry(input, completed, meta), { path });
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL — `appendHistory is not a function` / `recordDelegation is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `src/history.ts`)

```typescript
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function defaultHistoryPath(): string {
  return join(homedir(), '.grok-build', 'history.jsonl');
}

export interface AppendDeps {
  path?: string;
  write?: (path: string, line: string) => void;
}

const defaultWrite = (path: string, line: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line, 'utf8');
};

export function appendHistory(entry: HistoryEntry, deps: AppendDeps = {}): void {
  const path = deps.path ?? defaultHistoryPath();
  const write = deps.write ?? defaultWrite;
  write(path, JSON.stringify(entry) + '\n');
}

export function recordDelegation(
  input: DelegateInput,
  result: DelegateResult,
  meta: HistoryMeta,
  deps: AppendDeps = {},
): void {
  try {
    appendHistory(buildHistoryEntry(input, result, meta), deps);
  } catch {
    // logging must never break a delegation
  }
}
```

Add the `import type { DelegateInput, DelegateResult }` line already exists from Task 1 — keep the single import at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/history.test.ts`
Expected: PASS (9 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/history.ts mcp-server/test/history.test.ts
git commit -m "feat(history): appendHistory + recordDelegation (never-throw JSONL append)"
```

---

### Task 3: Wire `recordDelegation` into the delegate tool handler

**Files:**
- Modify: `mcp-server/src/index.ts:35-46` (the `grok_build_delegate` handler)
- Verify: isolated-bundle smoke with a temp HOME

**Interfaces:**
- Consumes: `recordDelegation` from `./history.js`

- [ ] **Step 1: Modify the handler**

In `mcp-server/src/index.ts`, add the import near the others:

```typescript
import { recordDelegation } from './history.js';
```

Replace the delegate handler body:

```typescript
    async ({ prompt, cwd, timeout_ms }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
```

- [ ] **Step 2: Typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exit 0; all tests pass (unchanged count + new history tests).

- [ ] **Step 3: Rebuild the bundle**

Run: `npm run build`
Expected: `bundled -> dist/index.js`.

- [ ] **Step 4: Verify wiring end-to-end in an isolated HOME**

Run (from `mcp-server/`, bash):
```bash
H=$(mktemp -d); cp dist/index.js "$H/index.js"; echo '{"type":"module"}' > "$H/package.json"
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"grok_build_delegate","arguments":{"prompt":"noop","cwd":"relative/dir"}}}' \
 | HOME="$H" USERPROFILE="$H" node "$H/index.js" >/dev/null 2>&1 &
sleep 2; kill %1 2>/dev/null
cat "$H/.grok-build/history.jsonl"
```
Expected: one JSON line with `"status":"grok_error"` (relative cwd rejected by `runDelegate`), `"mode":"subscription"`, `"cwd":"relative/dir"`, a `promptPreview`, and a `durationMs`. This proves index.ts → recordDelegation → file write works, without touching the real home dir.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/index.ts mcp-server/dist/index.js
git commit -m "feat(history): log every delegation from the tool handler (with duration)"
```

---

### Task 4: Pin the four failure-mode messages with tests

**Files:**
- Modify: `mcp-server/test/auth.test.ts`, `mcp-server/test/delegate.test.ts`

**Interfaces:** none new — asserts existing message text.

- [ ] **Step 1: Add message-text tests to `auth.test.ts`** (inside the `describe('checkAuth')` block)

```typescript
  it('grok_not_installed message mentions install + PATH', () => {
    const r = checkAuth('subscription', deps({ grokInstalled: () => false }));
    expect(r.message).toContain('PATH');
    expect(r.message).toContain('install.sh');
  });
  it('not_logged_in message tells the user to run grok login', () => {
    const r = checkAuth('subscription', deps({ authFileExists: () => false }));
    expect(r.message).toContain('grok login');
  });
  it('no_api_key message tells the user to set XAI_API_KEY', () => {
    const r = checkAuth('api', deps({ authFileExists: () => false, env: {} }));
    expect(r.message).toContain('XAI_API_KEY');
  });
```

- [ ] **Step 2: Add message-text tests to `delegate.test.ts`** (inside `describe('runDelegate')`)

```typescript
  it('timeout message includes the seconds and how to retry', async () => {
    const r = await runDelegate('subscription', input, deps({ timedOut: true, code: null }));
    expect(r.message).toMatch(/초 내에 끝나지 않/);
    expect(r.message).toContain('timeout_ms');
  });
  it('auth_error (subscription) message tells the user to run grok login', async () => {
    const r = await runDelegate('subscription', input, deps({ stdout: '', stderr: 'not authenticated' }));
    expect(r.status).toBe('auth_error');
    expect(r.message).toContain('grok login');
  });
```

- [ ] **Step 3: Run the suites to verify they pass**

Run: `npx vitest run test/auth.test.ts test/delegate.test.ts`
Expected: PASS (these assert current behavior — the messages already exist).

- [ ] **Step 4: Verify the guard bites (mutation check)**

Temporarily change the `not_logged_in` message in `src/auth.ts` (drop "grok login"), run `npx vitest run test/auth.test.ts`, confirm the new test FAILS, then revert and confirm PASS. (Proves the message guard is real.)

- [ ] **Step 5: Commit**

```bash
git add mcp-server/test/auth.test.ts mcp-server/test/delegate.test.ts
git commit -m "test: pin the four failure-mode messages (install/PATH, login, api-key, timeout)"
```

---

### Task 5: Docs sync + final verification

**Files:**
- Modify: `docs/05-routing-policy.md`, `docs/04-mcp-server-spec.md`, `docs/06-roadmap.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/05-routing-policy.md`** — change the logging line (currently "위임 이력은 hook을 통해 로컬 로그에 남긴다") to:

> 위임 이력은 **MCP 서버가 내부적으로** `~/.grok-build/history.jsonl`에 남긴다(위임된 cwd를 오염시키지 않도록 사용자 전역 경로). 이 변경이 Claude가 만든 건지 Grok Build가 만든 건지 추적 가능해야 한다.

- [ ] **Step 2: `docs/04-mcp-server-spec.md`** — add a section after the `grok_build_delegate` output schema:

```markdown
## 위임 이력 로깅 (`history.ts`)

모든 `grok_build_delegate` 실행을 `~/.grok-build/history.jsonl`에 JSONL 한 줄로
기록한다(서버 내부, `recordDelegation`). provenance(Claude vs Grok Build 변경 추적)
용도이며 **자격증명·env·rawStderrTail은 절대 기록하지 않는다**. 로깅은 실패해도
위임을 깨지 않는다(try/catch swallow). cwd 밖(전역)에 써서 git status를 오염시키지
않는다. 항목: `ts, mode, billing, status, cwd, promptPreview(≤200), summaryPreview?,
filesChanged(≤100), filesTruncated, filesCount, durationMs`.
```

- [ ] **Step 3: `docs/06-roadmap.md`** — under Phase 2, mark the logging item done:

Change `- [ ] 위임 이력 로컬 로깅 (커밋 추적용)` to
`- [x] 위임 이력 로컬 로깅 — 서버 내부로 ~/.grok-build/history.jsonl에 JSONL 기록 (provenance)`

- [ ] **Step 4: `CLAUDE.md`** — in the component map add under `mcp-server/src/`:

`  - \`history.ts\` — \`recordDelegation\`: 위임 이력을 ~/.grok-build/history.jsonl에 JSONL로 기록(자격증명 제외, 실패해도 위임 무영향).`

And bump the test count in the "현재 상태" and 개발 명령 sections from 38 to the new total (run `npm test` to get the exact number), and update `test/` 설명.

- [ ] **Step 5: Rebuild bundle + full verification**

Run: `npm run build && npm run typecheck && npm test`
Expected: bundle written; typecheck exit 0; all tests pass. Note the final test count for the docs.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md mcp-server/dist/index.js
git commit -m "docs: server-internal delegation history logging; roadmap + component map"
```

---

## Self-Review

**Spec coverage:** history mechanism (Tasks 1-3) ✓; user-global path/no-cwd-pollution (Task 2 `defaultHistoryPath`, Task 3 smoke uses temp HOME) ✓; privacy/no-credentials (Task 1 test) ✓; never-throw (Task 2 test) ✓; HistoryEntry fields incl. truncation/caps (Task 1) ✓; failure-mode message verification (Task 4) ✓; docs incl. docs/05 correction (Task 5) ✓; bundle rebuild (Tasks 3, 5) ✓.

**Placeholder scan:** all steps carry real code/commands. No TBD/TODO.

**Type consistency:** `HistoryEntry`, `HistoryMeta`, `AppendDeps`, `buildHistoryEntry`, `appendHistory`, `recordDelegation`, `defaultHistoryPath` are used with identical signatures across Tasks 1-3. `recordDelegation(input, result, meta, deps?)` matches the index.ts call site (Task 3) which passes `{ ts, durationMs }` as `meta`.
