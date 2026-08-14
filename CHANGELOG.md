# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

## 2026-08-14

### Fix — Grok Build CLI 1.0.3 / Grok 4.6 헤드리스 계약 (v0.2.7)

- **원인:** 플러그인은 0.2.93 실측(`EndTurn`, `--check`, `--best-of-n`)에 고정돼 있었다.
  1.0.3은 `stopReason: "end_turn"`, `--check`/`--best-of-n` 삭제, 기본 모델 `grok-4.6`.
- **효과:** 기본 위임이 파일을 쓰고도 `grok_error`로 집계됐고, verify는 스폰 전에 죽었다.
- 수리: `isSuccessfulStopReason`, verify 프롬프트 접미사, `best_of_n` 거절, `grok-build`
  alias, `import` 차단, Windows `HOME` 폴백. 계약 SSOT를 1.0.3으로 재실측.
- 설계: `docs/specs/2026-08-14-grok-1.0-compat-design.md`.

## 2026-08-09

### Ops — GitHub 표면 정리 + 머지 게이트 강화 (제품 변경 없음)

- **정리:** 원격에서 이미 삭제된 로컬 브랜치 25개 제거, 빈 `Microsoft/` 디렉토리 제거,
  Actions 캐시 14개 삭제. Open PR·Issue는 원래 0이었다.
- **머지 게이트:** `PRIMARY` ruleset에 `required_status_checks`(`mcp-server (ubuntu-latest)`·
  `(windows-latest)`)를 추가했다. 기존 ruleset을 **확장**했고 별도 branch protection을 겹쳐
  만들지 않았다 — 규칙이 두 곳으로 갈라지면 어느 쪽이 이기는지 아무도 모르게 된다.
  `bypass_actors`는 비어 있어 소유자도 red CI를 통과 못 한다 (CI 40초, 감당 가능한 대가).
- **병합 방식:** merge commit·rebase를 저장소·ruleset 양쪽에서 끄고 squash만 남겼다.
  이력이 이미 전부 squash였으므로 실질은 "관행을 강제로 승격"이다.
- 반영: `CONTRIBUTING.md` "Branch & PR", `.claude/skills/maintainer-preflight` "Never".

### Ops — `npm ci` 조건 정정 (실측 사고)

- **낡은 `node_modules`는 없는 것보다 나쁘다.** 이 레포에서 `npm ci` 없이 `npm run build`를
  돌린 결과, `node_modules`의 `fast-uri` 3.1.4(lockfile은 3.1.5)가 인라인되면서 **v0.2.6이
  담은 보안 패치(GHSA-7p8r-x3mc-p8w7)가 번들에서 제거됐다.** 빌드는 성공하고 경고도 없다.
  `maintainer-preflight`의 "`npm ci`는 node_modules가 없을 때만"을 "없거나 낡았을 때"로 고치고
  버전 확인 한 줄을 추가.
- **Windows에서 `git status`는 `dist/`에 대해 거짓말한다.** `core.autocrlf=true`가 체크아웃을
  CRLF로 바꾸는데 esbuild는 LF로 쓰므로, 아무것도 안 바뀐 재빌드도 `M dist/index.js`로 뜬다.
  판단 근거는 `git diff`다 (빈 출력 = 커밋된 번들이 그대로 재현됨). CI의 dist 검사가 Linux
  전용인 이유와 같은 현상.

### Security — 추적되던 서드파티 자격증명 제거 (PR #53)

- 코드리뷰 도구(SCAManager)가 심어둔 `.scamanager/config.json`이 **평문 토큰을 담은 채 공개
  저장소에 커밋**돼 있었다. 추적 해제 + `.gitignore` 등록. 훅은 파일이 없으면 `exit 0`이라
  (`.scamanager/install-hook.sh`) 기능 손실 없이 노출만 멈춘다.
- **추적 해제는 무효화가 아니다.** 토큰은 히스토리·`refs/pull/*`·릴리스 tarball에 그대로
  남고, 공개 기간의 클론은 회수할 수 없다. 실제 조치는 **발급처에서의 revoke**였고 그것으로
  모든 사본이 무력해졌다. 히스토리 재작성은 기각 — 이미 공개된 값을 되돌리지 못하면서 커밋
  SHA·태그·릴리스·PR 링크만 전부 깨뜨린다.
- **근본 원인은 이 레포 밖이다.** 해당 도구가 토큰을 git에 커밋하는 구조 자체가 원인이며,
  수정은 그 도구의 저장소가 소유한다. 이 레포에서는 재발 방지선(`.gitignore` 한 줄)만 둔다.

## 2026-08-08

### Security — 번들에 인라인된 `fast-uri` 패치 (v0.2.6)

- **문제:** 이용자가 실행하는 `dist/index.js`에 `fast-uri` 3.1.4가 인라인돼 있었다 (GHSA-7p8r-x3mc-p8w7, high — 백슬래시 authority introducer를 통한 host confusion). `ajv`(MCP SDK 경유) → `fast-uri` 체인. 3.1.5로 올리고 번들 재빌드.
- **실제 위험은 낮음:** `fast-uri`는 `ajv`의 `$ref`/`$id` 해석(`normalizeId`/`resolveUrl`)에서만 쓰이고, 이 서버가 검증하는 건 저장소에 정의된 자기 자신의 정적 스키마다. 공격자 제어 URI가 신뢰 판단에 쓰이는 경로가 없다. 배포물 위생 차원의 패치.
- 함께 정리된 lockfile: `hono` 4.13.1, `ip-address` 10.4.0, `nanoid`·`postcss`(dev). **번들 delta 0** — SDK HTTP/express 트랜스포트와 vitest 트리 소속으로 이 stdio 서버는 로드하지 않는다. `npm audit` = 0 vulnerabilities.
- **배운 것 (재빌드 판단 기준 정정):** "의존성 PR = 항상 재빌드"는 과일반화였다. **패키지마다 다르다** — PR #48(`ip-address`)은 lockfile만 바뀌고 CI dist 체크를 그대로 통과했고, PR #49(`fast-uri`)는 실패했다. 판단은 `grep -c "node_modules/<pkg>" dist/index.js`로 한다. `CLAUDE.md`·`maintainer-preflight` 반영.
- **버전을 올린 이유:** 플러그인 캐시가 **버전 키**다 (`~/.claude/plugins/cache/<mk>/<plugin>/<version>/`, 실측: 버전 디렉토리가 업데이트마다 새로 생김). 같은 `0.2.5`로 다른 번들을 재배포하면 한 버전 문자열에 두 산출물이 붙고 `/grok:status`의 `serverVersion`이 식별력을 잃는다.

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
