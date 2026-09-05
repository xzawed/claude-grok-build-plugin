# `grok_build_usage` (usage summary) Implementation Plan

> **SHIPPED — historical record. Do not execute.** This plan shipped in `v0.1.0`; its
> unchecked boxes are an artifact of the original plan, not open work. The source for
> current behaviour is `docs/specs/grok-cli-contract.md` (measured) and `mcp-server/src/`.
> *(Annotated 2026-09-05.)*

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `grok_build_usage` MCP tool (+ `/grok-build:usage` command) that summarizes `~/.grok-build/history.jsonl`.

**Architecture:** A new pure `summarizeHistory` + tolerant `readHistory` in `usage.ts`; a tool that reads the log and returns the summary (no auth, no grok call).

**Tech Stack:** TypeScript (ESM, NodeNext), Node `fs`, `@modelcontextprotocol/sdk` ^1.29.0, zod ^3.25.0, vitest, esbuild.

## Global Constraints

- Read-only: no grok call, no `checkAuth`. No credentials are ever in the log (Phase 2 invariant), so none are in the summary.
- Reuse the log path from `history.ts` (`defaultHistoryPath`) and the `HistoryEntry` shape.
- Tolerate a missing file (`[]`) and malformed JSONL lines (skip). Aggregation must never throw.
- `dist/index.js` is a committed esbuild bundle — `npm run build` before committing after `src/` changes. TDD; run from `mcp-server/`.

---

### Task 1: `usage.ts` — `summarizeHistory` (pure) + types

**Files:**
- Create: `mcp-server/src/usage.ts`
- Test: `mcp-server/test/usage.test.ts`

**Interfaces:**
- Produces: `interface RecentEntry`; `interface UsageSummary`; `summarizeHistory(entries: HistoryEntry[], opts?: { cwd?: string; limit?: number }): UsageSummary`

- [ ] **Step 1: Write the failing tests**

```typescript
// mcp-server/test/usage.test.ts
import { describe, it, expect } from 'vitest';
import { summarizeHistory } from '../src/usage.js';
import type { HistoryEntry } from '../src/history.js';

const mk = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  ts: '2026-07-13T00:00:00.000Z', mode: 'subscription', billing: 'subscription',
  status: 'completed', cwd: '/p', promptPreview: 'do x',
  filesChanged: [], filesTruncated: false, filesCount: 0, durationMs: 1, ...over,
});

describe('summarizeHistory', () => {
  it('aggregates counts by mode/billing/status and special modes + files', () => {
    const s = summarizeHistory([
      mk({ ts: '2026-07-13T00:00:01.000Z', filesCount: 2 }),
      mk({ ts: '2026-07-13T00:00:02.000Z', mode: 'api', billing: 'metered_api', status: 'grok_error' }),
      mk({ ts: '2026-07-13T00:00:03.000Z', plan: true }),
      mk({ ts: '2026-07-13T00:00:04.000Z', check: true, filesCount: 1 }),
      mk({ ts: '2026-07-13T00:00:05.000Z', worktreePath: '/wt', filesCount: 3 }),
    ]);
    expect(s.total).toBe(5);
    expect(s.byMode).toEqual({ subscription: 4, api: 1 });
    expect(s.byBilling).toEqual({ subscription: 4, metered_api: 1 });
    expect(s.byStatus).toEqual({ completed: 4, auth_error: 0, timeout: 0, grok_error: 1 });
    expect(s.counts).toEqual({ plan: 1, check: 1, worktree: 1 });
    expect(s.totalFilesChanged).toBe(6);
    expect(s.firstTs).toBe('2026-07-13T00:00:01.000Z');
    expect(s.lastTs).toBe('2026-07-13T00:00:05.000Z');
  });
  it('recent respects limit and is most-recent-first', () => {
    const entries = Array.from({ length: 5 }, (_, i) => mk({ ts: `2026-07-13T00:00:0${i}.000Z`, promptPreview: `p${i}` }));
    const s = summarizeHistory(entries, { limit: 2 });
    expect(s.recent.map((r) => r.promptPreview)).toEqual(['p4', 'p3']);
  });
  it('filters by cwd', () => {
    const s = summarizeHistory([mk({ cwd: '/a' }), mk({ cwd: '/b' }), mk({ cwd: '/a' })], { cwd: '/a' });
    expect(s.total).toBe(2);
  });
  it('empty input yields zeros and no timestamps', () => {
    const s = summarizeHistory([]);
    expect(s.total).toBe(0);
    expect(s.byStatus).toEqual({ completed: 0, auth_error: 0, timeout: 0, grok_error: 0 });
    expect(s.firstTs).toBeUndefined();
    expect(s.recent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/usage.test.ts`
Expected: FAIL — cannot import `summarizeHistory`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// mcp-server/src/usage.ts
import { readFileSync } from 'node:fs';
import type { HistoryEntry } from './history.js';
import { defaultHistoryPath } from './history.js';

export interface RecentEntry {
  ts: string;
  status: string;
  mode: string;
  billing: string;
  cwd: string;
  promptPreview: string;
}

export interface UsageSummary {
  total: number;
  byMode: { subscription: number; api: number };
  byBilling: { subscription: number; metered_api: number };
  byStatus: { completed: number; auth_error: number; timeout: number; grok_error: number };
  counts: { plan: number; check: number; worktree: number };
  totalFilesChanged: number;
  firstTs?: string;
  lastTs?: string;
  recent: RecentEntry[];
}

export function summarizeHistory(
  entries: HistoryEntry[],
  opts: { cwd?: string; limit?: number } = {},
): UsageSummary {
  const filtered = opts.cwd ? entries.filter((e) => e.cwd === opts.cwd) : entries;
  const limit = opts.limit ?? 10;

  const summary: UsageSummary = {
    total: filtered.length,
    byMode: { subscription: 0, api: 0 },
    byBilling: { subscription: 0, metered_api: 0 },
    byStatus: { completed: 0, auth_error: 0, timeout: 0, grok_error: 0 },
    counts: { plan: 0, check: 0, worktree: 0 },
    totalFilesChanged: 0,
    recent: [],
  };

  for (const e of filtered) {
    if (e.mode === 'subscription' || e.mode === 'api') summary.byMode[e.mode] += 1;
    if (e.billing === 'subscription' || e.billing === 'metered_api') summary.byBilling[e.billing] += 1;
    if (e.status === 'completed' || e.status === 'auth_error' || e.status === 'timeout' || e.status === 'grok_error') {
      summary.byStatus[e.status] += 1;
    }
    if (e.plan) summary.counts.plan += 1;
    if (e.check) summary.counts.check += 1;
    if (e.worktreePath) summary.counts.worktree += 1;
    summary.totalFilesChanged += e.filesCount ?? 0;
  }

  if (filtered.length > 0) {
    const times = filtered.map((e) => e.ts).filter(Boolean).sort();
    summary.firstTs = times[0];
    summary.lastTs = times[times.length - 1];
  }

  summary.recent = filtered.slice(-limit).reverse().map((e) => ({
    ts: e.ts, status: e.status, mode: e.mode, billing: e.billing, cwd: e.cwd, promptPreview: e.promptPreview,
  }));

  return summary;
}
```
(`readFileSync`/`defaultHistoryPath` are imported now for Task 2; if the linter flags them as unused between tasks, that resolves when Task 2 lands — or add `readHistory` in the same task.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/usage.test.ts && npm run typecheck`
Expected: PASS (4 tests); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/usage.ts mcp-server/test/usage.test.ts
git commit -m "feat(usage): summarizeHistory — pure aggregation of delegation history"
```

---

### Task 2: `usage.ts` — `readHistory` (tolerant JSONL reader)

**Files:**
- Modify: `mcp-server/src/usage.ts`
- Test: `mcp-server/test/usage.test.ts`

**Interfaces:**
- Produces: `readHistory(path?: string): HistoryEntry[]`

- [ ] **Step 1: Write the failing tests** (append to `test/usage.test.ts`)

```typescript
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHistory } from '../src/usage.js';

describe('readHistory', () => {
  it('parses valid lines and skips malformed ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grok-usage-'));
    const path = join(dir, 'history.jsonl');
    writeFileSync(path, [
      JSON.stringify(mk({ promptPreview: 'a' })),
      'this is not json',
      '',
      JSON.stringify(mk({ promptPreview: 'b' })),
    ].join('\n'), 'utf8');
    const entries = readHistory(path);
    expect(entries.map((e) => e.promptPreview)).toEqual(['a', 'b']);
  });
  it('returns [] for a missing file', () => {
    expect(readHistory(join(tmpdir(), 'definitely-missing-xyz', 'h.jsonl'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/usage.test.ts`
Expected: FAIL — cannot import `readHistory`.

- [ ] **Step 3: Add the implementation** (append to `src/usage.ts`)

```typescript
export function readHistory(path: string = defaultHistoryPath()): HistoryEntry[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return []; // missing / unreadable file
  }
  const entries: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      /* skip malformed line */
    }
  }
  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/usage.test.ts && npm run typecheck`
Expected: PASS (6 tests total); typecheck exit 0.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/usage.ts mcp-server/test/usage.test.ts
git commit -m "feat(usage): readHistory — tolerant JSONL reader (skips malformed, [] if missing)"
```

---

### Task 3: `grok_build_usage` tool + `/grok-build:usage` command

**Files:**
- Modify: `mcp-server/src/index.ts`
- Create: `commands/grok-build-usage.md`
- Verify: isolated-bundle `tools/list` smoke

- [ ] **Step 1: Register the tool** — in `index.ts`, add the import near the others:
```typescript
import { readHistory, summarizeHistory } from './usage.js';
```
After the `grok_build_verify` `registerTool(...)` call, add:
```typescript
  server.registerTool(
    'grok_build_usage',
    {
      description: 'Summarize Grok Build delegation history (~/.grok-build/history.jsonl): counts by mode/billing/status, plan/verify usage, files changed, and recent runs. Read-only; highlights subscription vs metered-API billing.',
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
```

- [ ] **Step 2: Create the slash command**

```markdown
<!-- commands/grok-build-usage.md -->
---
description: Show Grok Build delegation usage summary (counts, billing, recent)
---

Call `grok_build_usage` and present the summary as a short table. Emphasize the
**billing split** (`byBilling`: subscription vs metered_api) and plan/verify usage
(`counts.plan` / `counts.check`), plus `total` delegations and `totalFilesChanged`. If
`total` is 0, say there are no recorded delegations yet.
```

- [ ] **Step 3: Typecheck + build + tools/list smoke**

Run (bash, from `mcp-server/`):
```bash
npm run typecheck && npm run build
H=$(mktemp -d); cp dist/index.js "$H/index.js"; echo '{"type":"module"}' > "$H/package.json"
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"grok_build_usage","arguments":{}}}' \
 | node "$H/index.js" 2>/dev/null | node -e "let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{for(const l of b.split('\n').filter(Boolean)){const o=JSON.parse(l);if(o.id===2){const r=JSON.parse(o.result.content[0].text);console.log('usage total:',r.total,'byBilling:',JSON.stringify(r.byBilling))}}})"
rm -rf "$H"
```
Expected: typecheck exit 0; bundle written; the call returns a summary (reads the real `~/.grok-build/history.jsonl`, so `total` reflects prior runs; `byBilling` present).

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/index.ts commands/grok-build-usage.md mcp-server/dist/index.js
git commit -m "feat(usage): grok_build_usage MCP tool + /grok-build:usage command"
```

---

### Task 4: docs sync + bundle + final verification

**Files:**
- Modify: `docs/04-mcp-server-spec.md`, `docs/06-roadmap.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/04-mcp-server-spec.md`** — after the `grok_build_verify` section (before `## 프롬프트 작성 원칙`), add:

```markdown
### 4. `grok_build_usage`

`~/.grok-build/history.jsonl`(Phase 2 이력)을 집계하는 **읽기전용** 요약. grok 호출·인증
없음(로컬 로그만 읽음). 과금 투명성(절대 원칙 #1)과 직결.

- **Input:** `{ cwd?, limit? }` (cwd로 프로젝트별 필터, limit=recent 개수 기본 10)
- **Output:** `UsageSummary` — `total`, `byMode`, `byBilling`(구독 vs 종량제 강조),
  `byStatus`, `counts`(plan/check/worktree 사용 횟수), `totalFilesChanged`,
  `firstTs`/`lastTs`, `recent`(최근순). 파일 없으면 `total: 0`.
- 구현: `usage.ts`의 `readHistory`(malformed 줄 관용) + `summarizeHistory`(순수 집계).
  슬래시 커맨드 `/grok-build:usage`.
```

- [ ] **Step 2: `docs/06-roadmap.md`** — under Phase 3 change the dashboard line to:
`- [x] 위임 이력 기반 사용량 요약 — \`grok_build_usage\` tool + \`/grok-build:usage\`(읽기전용, history.jsonl 집계: mode/billing/status/plan/check/files/recent).`

- [ ] **Step 3: `CLAUDE.md`** — add to the component map under `mcp-server/src/`:
`  - \`usage.ts\` — \`readHistory\`+\`summarizeHistory\`: ~/.grok-build/history.jsonl 집계(읽기전용 사용량 요약). \`grok_build_usage\` tool이 사용.`
Update the `index.ts` line to list five tools; add `grok-build-usage.md` to the `commands/` line; and bump the test count (run `npm test`) in the 현재 상태 + 개발 명령 + `test/` sections.

- [ ] **Step 4: Rebuild bundle + full verification**

Run: `npm run build && npm run typecheck && npm test`
Expected: bundle written; typecheck exit 0; all tests pass. Note the final count for docs.

- [ ] **Step 5: Commit**

```bash
git add docs/ CLAUDE.md mcp-server/dist/index.js
git commit -m "docs: grok_build_usage tool + command; roadmap + component map"
```

---

## Self-Review

**Spec coverage:** `readHistory` tolerant reader (Task 2) ✓; `summarizeHistory` pure aggregation incl. cwd filter, limit, empty case (Task 1) ✓; `UsageSummary` shape (Task 1) ✓; tool with no auth (Task 3) ✓; slash command (Task 3) ✓; docs + bundle (Tasks 3, 4) ✓.

**Placeholder scan:** all steps carry real code/commands. No TBD.

**Type consistency:** `summarizeHistory(entries, opts?)` and `readHistory(path?)` (Tasks 1-2) are the exact signatures the tool handler calls (Task 3). `UsageSummary`/`RecentEntry` fields used in tests (Task 1) match the implementation. `HistoryEntry` is imported from `./history.js`; `defaultHistoryPath` reused from `history.ts`.
