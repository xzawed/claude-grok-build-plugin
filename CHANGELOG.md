# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

## 2026-07-29

### Ops — 의존성 PR의 dist 재빌드는 에이전트 소유 (배포 변경 없음)

- **발견된 구멍:** `maintainer-preflight`의 재빌드 조건이 `mcp-server/src/**`뿐이라, `package-lock.json`만 바꾸는 Dependabot PR에서는 발동하지 않았다. esbuild `bundle: true`가 런타임 의존성을 번들에 인라인하므로 lockfile 변경만으로 `dist/index.js`가 바뀐다 (실측: PR #27 `fast-uri` 3.1.3→3.1.4는 소스 무변경).
- 재빌드 트리거를 `src/**` + `package-lock.json`/`package.json`으로 확대하고, 의존성 PR 처리 절차를 스킬에 명시.
- `CONTRIBUTING.md`: 재빌드 주체를 **사람 아님 / 에이전트**로 명문화. 사람은 리뷰·머지만.
- 회귀 방지: `plugin-surface.test.ts`가 스킬의 lockfile 트리거 언급을 단언.
- **기각 기록:** CI 자동 재빌드 워크플로는 **NO-GO**. 공개 저장소에 write 토큰 상시 표면이 필요하고, `GITHUB_TOKEN` 푸시는 워크플로를 재트리거하지 않아 App/PAT까지 얹어야 최종 트리가 검증된다 (GitHub 공식 문서 확인). 6개월 1건 빈도에 비해 과하다. Dependabot **버전** 업데이트도 계속 끔 (번들 diff 805KB). 근거는 `CONTRIBUTING.md` "Why this is not automated in CI".

## 2026-07-28

### Ops — maintainer surface + shipped consistency (v0.2.5)

- `.claude/skills/repo-scope`: "다음 할 일" 질문 시점에 `docs/09` A~E 분류를 강제하고 기본 답을 **없음**으로 고정 (배포 안 됨).
- `.claude/skills/maintainer-preflight`: done 선언·커밋 전 test/typecheck/build + 번들 커밋 규칙 (배포 안 됨).
- `commands/delegate.md`: status/`billingMismatch` 중단, route/`nextAction`, 위험 시 `worktree`, `/grok:review` 종료 — 에이전트·스킬이 이미 강제하던 계약과 정렬.
- `skills/grok-routing/SKILL.md`: `grok_cli` 편집 금지(훅 미적용·이력 미기록) + `billingMismatch` 중단 규칙.
- `handoff-version.test.ts`: 릴리스 노트 존재 + `CLAUDE.md`·`docs/09`의 버전 표기 일치를 강제. `docs/06`·`docs/00`은 의도적으로 미검사.
- `docs/06`·`docs/00`의 `(v0.2.3)` 고정 표기 제거 — 재드리프트 방지.
- `CONTRIBUTING.md`: 패키징 경계(배포 vs `.claude/`) 명문화.
- 협의 기록: Claude가 제안한 `git commit` PreToolUse dist 훅은 **기각**. 조건이 "dist 최신"을 보장하지 못하고 Claude 외부 커밋을 못 잡는다. dist 무결성은 CI 책임으로 유지. 상세: `docs/specs/2026-07-28-ops-surface-claude-grok-design.md`.

## 2026-07-25

### Fix — hooks.json schema (v0.2.4) — plugin failed to load

- Claude Code now requires `hooks/hooks.json` to wrap events under `{ "hooks": { "PreToolUse": … } }`.
- Old bare `{ "PreToolUse": … }` made **`claude plugin list` → Status: failed to load** — **no slash commands** after install/upgrade.
- Confirmed: after wrapping, plugin status becomes **enabled** and commands load.
- Guards: `hooks-contract` forbids top-level `PreToolUse`; CLAUDE/CONTRIBUTING/docs/03 critical notes; release notes `docs/releases/v0.2.4.md`.

### Release — v0.2.3 (GitHub Release for end users)

- User-facing notes: `docs/releases/v0.2.3.md` (English how-to + what changed since v0.1.0).
- README command tables include status / review / resume / nextAction.
- Tag: `v0.2.3` on GitHub Releases.

### Docs — close in-repo residual loop

- `docs/09-scope-and-residuals.md`: why residuals recur; A/B/C/D classification; manual GUI checklist; agent rules (no default polish PR).
- Roadmap/CLAUDE: this repo product scope **complete** at v0.2.3; open items are consumer / manual / deferred only.

### Fix/Feat — pack integrity + billingMismatch (v0.2.3)

- `StatusSnapshot.billingMismatch` when subscription mode but history has metered runs.
- `tool-surface` tests: all 9 MCP tool names present in committed `dist/index.js`.
- Agent `grok-worker`, setup/status, marketplace blurb, CONTRIBUTING tool checklist.

### Feat — status dashboard (v0.2.2)

- MCP `grok_build_status` + `/grok:status`: auth + usage + `lastSession` + `nextSteps` (read-only).
- `buildStatusSnapshot` pure helper; plugin/package version lock test; tour/docs/08 wired.

### Release — v0.2.1 consumer kit

- Plugin + mcp-server version **0.2.1**.
- `examples/orchestrator-consumer.md` — copy-paste Task Manager loop.
- Route fixtures include **`nextAction`** expectations; `grok-routing` / first-mile skills teach review + resume.

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
