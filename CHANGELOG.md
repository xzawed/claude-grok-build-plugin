# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

## 2026-07-25

### Feat — orchestrator nextAction + post-delegate review

- `orchestrator.ts`: `planNextAction`, `afterPlanGate`, `observeBilling` (pure consumer helpers).
- `grok_build_route` response includes **`nextAction`** for Task Managers.
- `/grok:review` quality-gate command; docs/07 wiring checklist updated.
- CI Node **22** (GitHub Node 20 deprecation); plugin-surface command frontmatter tests.

### Test — PreToolUse hook harness e2e

- Spawn committed `dist/hook.js` with isolated HOME/`GROK_BIN_DIR`/PATH (deny/allow/exit 0).
- `hooks/hooks.json` matcher contract test (plugin `grok` + server `grok-build`).

### Feat — session resume provenance + auth surface + dep hygiene

- History records `sessionId` when grok returns it; `grok_build_usage` recent rows expose it for `resume`.
- `grok_auth_check` always includes `billing` (mode expectation) + `serverVersion`.
- `npm overrides` pin `@hono/node-server@2.0.11` (transitive of MCP SDK) — audit 0 vulnerabilities.
- `usage.lastSession` + pure `latestResumableSession`; slash command **`/grok:resume`**.

### Fix — MCP server version SSOT

- `McpServer` advertised version no longer hardcodes `0.1.0`; reads `mcp-server/package.json` via `getServerVersion()` (matches plugin **0.2.0**).

### Fix — P1 reliability (apply untracked + timeout auth)

- `applyGrokWorktree`: include untracked files via temp `git add -A` + `diff --cached`, always reset.
- Timeout → `auth_error` only on **stderr device-flow** markers (no stdout `grok login` false positive).

### Feat — first-mile Grok starting point

- `docs/08-getting-started-with-grok.md` — 15-minute human path and recipes.
- `/grok:tour` guided tour; skills `grok-first-mile` + agent `grok-worker`.
- README/vision positioned as the on-ramp for using Grok well in Claude Code.

### Fix — unauth / expired-session signals (modern grok)

- Live probe with isolated home: immediate `{"type":"error","message":"Not signed in..."}`.
- `parseGrokResult` handles `type:error`; `looksLikeAuthFailure` + expanded signals.
- `npm run probe:unauth` script; contract §7 + `docs/specs/2026-07-25-auth-unauth-signals.md`.

### Docs/fix — sandbox profiles measured + tests

- Document built-in profiles (`workspace`, `read-only`, `strict`, …) from grok guide.
- Tests cover hyphenated `read-only`; `KNOWN_SANDBOX_PROFILES` for tool messaging.
- Win32 headless `--sandbox workspace` accepted (EndTurn); kernel enforce not assumed on Windows.
- Spec: `docs/specs/2026-07-25-sandbox-profiles.md`.

### Fix — Windows platform hardening

- Robust grok discovery: `where.exe` + `~/.grok/bin/grok.exe` fallback.
- Platform-aware install message (`install.ps1` on Windows).
- CI matrix includes `windows-latest` unit tests/typecheck.
- Native hook smoke recorded (exit 0). Design:
  `docs/specs/2026-07-25-windows-platform-hardening-design.md`.

### Chore — Phase 4 Slice B (CI + contract hardening)

- GitHub Actions CI: test, typecheck, dist freshness on PR/push to main.
- `docs/04` worktree/route/usage insights; orchestrator pseudocode + fixtures.
- Fixture-backed routing test; plugin version **0.2.0**.

### Feat — Phase 4 Slice A (routing engine)

- `routeTask` pure policy (`routing.ts`) + MCP `grok_build_route` (recommend only).
- `/grok:route`; integration contract `docs/07-orchestrator-integration.md`.
- 144 unit tests; dist rebuild. No spawn/billing side effects from route.

### Feat — Phase 3.5 Slice C (worktree lifecycle + usage insights)

- MCP tool `grok_build_worktree`: list / diff / apply (patch, no commit) / remove
  (only under `~/.grok-build/worktrees`).
- `summarizeHistory` → `insights` (success rate, subscription share, headline, tips).
- `/grok:worktree` command updated; 133 tests; dist rebuild.
- Design: `docs/specs/2026-07-25-phase35-slice-c-worktree-usage-design.md`.

### Feat — Phase 3.5 Slice B (stable delegate quality)

- `filesChanged`: before/after porcelain delta (exclude pre-dirty noise).
- Result `sessionId` from grok JSON; opt-in `model` / `effort` / `best_of_n`(2–4) /
  `resume` / `continue` with fail-closed validation (no spawn on bad input).
- Tests 122; rebuild `dist/index.js` + `dist/hook.js`.
- Design: `docs/specs/2026-07-25-phase35-slice-b-stable-delegate-design.md`.

### Feat — Phase 3.5 Slice A (routing skill · presets · setup)

- `skills/grok-routing/SKILL.md`: 엔드유저 세션에서 위임 판단 기준 자동 로드.
- `/grok:tests`, `/grok:migrate`, `/grok:boilerplate` 프리셋 커맨드.
- `/grok:setup` 첫 성공 경로(샘플 위임 · `billing` · 다음 시나리오).
- 설계: `docs/specs/2026-07-25-phase35-routing-skill-design.md`.

### Docs — 제품 본질 · 세션 핸드오프

- `docs/00-product-vision.md` 추가: Grok을 잘 쓰게 / 실력 체감 / Claude↔Grok 협업 경험.
- `CLAUDE.md`: 제품 포인터, 세션 핸드오프 표, “현재 상태”를 Phase 3.5 경험 방향으로 정리.
- `docs/06-roadmap.md`: Phase 3.5(협업 경험) 체크리스트 (Slice A 완료 표시).
- README / README.ko, `docs/01`, `docs/05`에 비전 포인터 정렬.
