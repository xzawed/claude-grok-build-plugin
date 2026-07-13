# `grok_build_verify` (self-verification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `grok_build_verify` MCP tool that delegates a task with grok's `--check` self-verification loop (grok does the work AND verifies it, returning a checklist/action-trace).

**Architecture:** A new tool reuses `runDelegate` via `input.check`, which appends `--check` to the grok args. Success semantics and `filesChanged` are unchanged from a normal delegation (grok edits + self-verifies, ends EndTurn).

**Tech Stack:** TypeScript (ESM, NodeNext), `@modelcontextprotocol/sdk` ^1.29.0, zod ^3.25.0, vitest, esbuild.

## Global Constraints

- `--check` is headless-only and appends a self-verification loop; it runs WITH `--always-approve` (execute mode) — measured EndTurn + edits + verifier report. Do NOT combine with plan mode.
- Verify shares the delegate flow: EndTurn success test, `filesChanged` from git, optional `worktree`/`sandbox`.
- Non-check delegate behavior must be unchanged. Auth/billing/history shared with delegate.
- `dist/index.js` is a committed esbuild bundle — `npm run build` before committing after `src/` changes. TDD; run from `mcp-server/`.

---

### Task 1: `runDelegate` `--check` + `DelegateInput.check`

**Files:**
- Modify: `mcp-server/src/types.ts` (DelegateInput)
- Modify: `mcp-server/src/delegate.ts` (args construction)
- Test: `mcp-server/test/delegate.test.ts`

**Interfaces:**
- Produces: `DelegateInput.check?: boolean`

- [ ] **Step 1: Write the failing tests** (append inside `describe('runDelegate')`)

```typescript
  // Phase 3 — self-verification (--check)
  it('check mode appends --check (keeping --always-approve) and stays EndTurn=completed with git files', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson({ text: 'done + verified' }), stderr: '', timedOut: false }; };
    const r = await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj', check: true }, {
      spawn: cap, dirExists: () => true, gitChangedFiles: () => ['math.js'],
    });
    expect(args).toContain('--check');
    expect(args).toContain('--always-approve');
    expect(r.status).toBe('completed');
    expect(r.summary).toBe('done + verified');
    expect(r.filesChanged).toEqual(['math.js']);
  });
  it('omits --check when check is not set', async () => {
    let args: string[] = [];
    const cap: SpawnFn = async (a) => { args = a; return { code: 0, stdout: okJson(), stderr: '', timedOut: false }; };
    await runDelegate('subscription', { prompt: 'x', cwd: '/tmp/proj' }, { spawn: cap, dirExists: () => true, gitChangedFiles: () => [] });
    expect(args).not.toContain('--check');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/delegate.test.ts`
Expected: FAIL — `--check` not in argv.

- [ ] **Step 3a: `types.ts`** — add to `DelegateInput`:
```typescript
  check?: boolean;      // opt-in: append grok's --check self-verification loop
```

- [ ] **Step 3b: `delegate.ts`** — replace the `const args = [...]` construction:
```typescript
  const args = [
    '--no-auto-update',
    ...(input.plan ? ['--permission-mode', 'plan'] : ['--always-approve']),
    ...(input.check ? ['--check'] : []),
    '--cwd', effectiveCwd,
    '-p', input.prompt, '--output-format', 'json',
    ...(input.sandbox ? ['--sandbox', input.sandbox] : []),
  ];
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run test/delegate.test.ts`
Expected: typecheck exit 0; all delegate tests pass (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/types.ts mcp-server/src/delegate.ts mcp-server/test/delegate.test.ts
git commit -m "feat(delegate): --check self-verification flag (input.check)"
```

---

### Task 2: `grok_build_verify` MCP tool

**Files:**
- Modify: `mcp-server/src/index.ts`
- Verify: isolated-bundle `tools/list` smoke

- [ ] **Step 1: Register the tool** — in `index.ts`, after the `grok_build_plan` `registerTool(...)` call, add:

```typescript
  server.registerTool(
    'grok_build_verify',
    {
      description: 'Delegate a task to Grok Build AND have it self-verify its own work (appends a verification loop; returns the changes plus a checklist / action-trace report). Use for changes you want grok to validate.',
      inputSchema: z.object({
        prompt: z.string().describe('Task instruction for grok (English recommended).'),
        cwd: z.string().describe('Absolute path of the working directory.'),
        timeout_ms: z.number().int().positive().optional().describe('Default 180000 (3 min).'),
        worktree: z.boolean().optional().describe('Run grok in a fresh isolated git worktree from HEAD; changes land there (not in cwd) for review. Returns worktreePath.'),
        sandbox: z.string().optional().describe('grok --sandbox <profile> for filesystem/network limits (grok-native; profile names unverified).'),
      }),
    },
    async ({ prompt, cwd, timeout_ms, worktree, sandbox }) => {
      const pre = checkAuth(mode, defaultAuthDeps());
      if (!pre.ok) {
        return { content: [{ type: 'text', text: pre.message }], isError: true };
      }
      const input = { prompt, cwd, timeoutMs: timeout_ms, worktree, sandbox, check: true };
      const t0 = Date.now();
      const result = await runDelegate(mode, input);
      recordDelegation(input, result, { ts: new Date().toISOString(), durationMs: Date.now() - t0 });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result.status !== 'completed',
      };
    },
  );
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: typecheck exit 0; `bundled -> dist/index.js`.

- [ ] **Step 3: Verify tool registration in an isolated bundle**

Run (bash, from `mcp-server/`):
```bash
H=$(mktemp -d); cp dist/index.js "$H/index.js"; echo '{"type":"module"}' > "$H/package.json"
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
 | node "$H/index.js" 2>/dev/null | node -e "let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{for(const l of b.split('\n').filter(Boolean)){const o=JSON.parse(l);if(o.id===2)console.log(o.result.tools.map(t=>t.name).join(', '))}})"
```
Expected: lists `grok_auth_check, grok_build_delegate, grok_build_plan, grok_build_verify`.

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/index.ts mcp-server/dist/index.js
git commit -m "feat(verify): grok_build_verify MCP tool (delegate + --check via runDelegate)"
```

---

### Task 3: history marks verify runs

**Files:**
- Modify: `mcp-server/src/history.ts`
- Test: `mcp-server/test/history.test.ts`

- [ ] **Step 1: Write the failing test** (append inside `describe('buildHistoryEntry')`)

```typescript
  it('marks check runs with check:true, omits otherwise', () => {
    const c = buildHistoryEntry({ prompt: 'x', cwd: '/p', check: true }, completed, meta);
    expect(c.check).toBe(true);
    expect(buildHistoryEntry(input, completed, meta).check).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/history.test.ts`
Expected: FAIL — `check` undefined on the entry.

- [ ] **Step 3: Modify `history.ts`** — add to `HistoryEntry`:
```typescript
  check?: boolean;
```
In `buildHistoryEntry`, before `return entry;`:
```typescript
  if (input.check) entry.check = true;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/history.ts mcp-server/test/history.test.ts
git commit -m "feat(history): mark --check (verify) runs with check:true"
```

---

### Task 4: docs sync + bundle + real-grok e2e + final verification

**Files:**
- Modify: `docs/04-mcp-server-spec.md`, `docs/06-roadmap.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/04-mcp-server-spec.md`** — after the `grok_build_plan` section (before `### 3. grok_build_verify (v2 옵션, Phase 3)`), REPLACE the old `### 3. grok_build_verify (v2 옵션, Phase 3)` stub with an implemented section:

```markdown
### 3. `grok_build_verify`

작업을 위임하되 grok이 **스스로 검증**하게 한다 — `--always-approve`에 `--check`
(자기검증 루프, 헤드리스 전용)를 덧붙인다. 실측상 grok은 편집 후 검증 서브에이전트를
띄워 체크리스트/Action-Trace를 `text`에 담아 반환하고 `stopReason: "EndTurn"`으로 끝난다.

- **Input:** `{ prompt, cwd, timeout_ms?, worktree?, sandbox? }` (delegate와 동일)
- **동작:** 성공 판정·`filesChanged`는 delegate와 동일(편집함). `summary`에 grok의
  자기검증 리포트가 포함된다. 내부적으로 `runDelegate({ check: true })` 재사용.
- ⚠️ 로드맵의 "독립 /verify(샌드박스 빌드/테스트/스크린샷/영상)"는 grok에 실재하지
  않는다 — 실측상 `--check`(작업 + 자기검증)만 헤드리스로 가능. 이력엔 `check: true` 마커.
```

- [ ] **Step 2: `docs/06-roadmap.md`** — under Phase 3 change the `grok_build_verify` line to:
`- [x] \`grok_build_verify\` — delegate + \`--check\`(grok 자기검증 루프: 편집 후 검증 서브에이전트가 체크리스트/Action-Trace 반환). 독립 /verify·스크린샷은 grok 미지원이라 스코프 외.`

- [ ] **Step 3: `CLAUDE.md`** — update the `index.ts` component-map line to list four tools:
`  - \`index.ts\` — \`grok_auth_check\`·\`grok_build_delegate\`·\`grok_build_plan\`·\`grok_build_verify\` MCP tool 등록/서버 기동.`
And bump the test count (run `npm test`) in the 현재 상태 + 개발 명령 + `test/` sections.

- [ ] **Step 4: Rebuild bundle + full verification**

Run: `npm run build && npm run typecheck && npm test`
Expected: bundle written; typecheck exit 0; all tests pass. Note the final count for docs.

- [ ] **Step 5 (optional but recommended): real-grok e2e** — in a scratch git repo, call `grok_build_verify` via the built server for a small change; confirm `status: "completed"`, the edit lands, and `summary` contains a verification checklist / action trace.

- [ ] **Step 6: Commit**

```bash
git add docs/ CLAUDE.md mcp-server/dist/index.js
git commit -m "docs: grok_build_verify tool; roadmap + component map"
```

---

## Self-Review

**Spec coverage:** separate tool (Task 2) ✓; `runDelegate` `check` flag appends `--check` keeping `--always-approve` (Task 1) ✓; EndTurn semantics + `filesChanged` unchanged (Task 1 test) ✓; worktree/sandbox reused (Task 2 schema + handler) ✓; history `check` marker (Task 3) ✓; auth/billing/logging reuse (Task 2 handler) ✓; docs correct the unfounded /verify premise (Task 4) ✓; bundle (Tasks 2, 4) ✓.

**Placeholder scan:** all steps carry real code/commands. No TBD.

**Type consistency:** `DelegateInput.check?: boolean` (Task 1) is read in the args build (Task 1), passed by the `grok_build_verify` handler as `check: true` (Task 2), and read by `buildHistoryEntry` as `input.check` (Task 3). `HistoryEntry.check?: boolean` (Task 3) matches. Result stays `DelegateResult` (unchanged shape).
