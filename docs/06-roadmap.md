# 06. 로드맵

기존 멀티에이전트 오케스트레이터 프로젝트와 동일하게 Phase 단위로 진행하며,
**Phase 1이 끝나기 전까지 다음 Phase로 넘어가지 않는다** (Verum 프로젝트에서 얻은
교훈: 범위 통제가 아키텍처 야심보다 중요, "완료"는 시작 전에 정의돼야 함).

## Phase 1 — 최소 동작 (MVP) ✅ 구현 완료

**"done" 정의:** 터미널에서 `grok login`(또는 API 모드는 `XAI_API_KEY` export)
완료 후, Claude Code 세션에서 슬래시 커맨드로 실제 코드 한 건을 Grok Build에
위임해 성공적으로 diff를 받아온다.

- [x] `.claude-plugin/plugin.json` 최소 스펙 작성
- [x] `.mcp.json`으로 MCP 서버 등록
- [x] MCP 서버: `grok_auth_check`, `grok_build_delegate` 두 tool 구현
- [x] `resolveAuthMode()` — `GROK_BUILD_AUTH_MODE` 읽어 `subscription`(기본)/`api`
      결정 (`config.ts`)
- [x] `buildGrokEnv(mode)` — 모드별 API 키 제거/통과 로직
      (`docs/02-auth-strategy.md` 체크리스트 통과)
- [x] 모드 분기된 `grok_auth_check`(`no_api_key` 포함)·`grok_build_delegate`
      (출력에 `mode`/`billing`)
- [x] `parseGrokResult()` — `--output-format json` 파싱, `stopReason` 기반 성공 판정
- [x] `/grok-build:delegate`, `/grok-build:check-auth` 슬래시 커맨드
- [x] 유닛 테스트 38개 (config/env/grok-result/auth/delegate[parsePorcelain 포함]/smoke)
      — Phase 1 시점 수치. Phase 2~3에서 확장돼 현재 72개(전체 현황은 `CLAUDE.md`)
- [x] 패키징: esbuild 단일 자립 번들(`mcp-server/dist/index.js`) 커밋 — 설치 사용자가
      빌드/`node_modules` 없이 바로 기동 (이전엔 dist·node_modules 미배포로 서버 미기동)
- [x] 로컬 토이 프로젝트 end-to-end 테스트 — **구독 모드**: 실제 grok 실행으로
      파일 생성 확인, `status: "completed"`, `billing: "subscription"`
- [x] 로컬 토이 프로젝트 end-to-end 테스트 — **API 모드**: 실제 grok 실행으로
      파일 생성 확인(사용자 `XAI_API_KEY` 사용), `status: "completed"`,
      `billing: "metered_api"`

Hook, 이력 로깅, `/verify` 연동은 이 단계에 포함하지 않는다 (Phase 2~3).

## Phase 2 — 안전장치

**"done" 정의:** 인증 실패/만료/CLI 미설치/타임아웃 4가지 실패 모드를 인위적으로
재현했을 때 모두 명확한 한국어 안내 메시지를 받는다.

- [x] `pre-delegate-auth-check` hook 추가 (harness 레벨 방어) — PreToolUse hook
      (`hooks/hooks.json` → `mcp-server/dist/hook.js`)이 delegate/plan/verify 실행 전
      인증을 확인. **"확실할 때만 차단"**(grok 미설치는 항상; auth 상태는 `GROK_BUILD_AUTH_MODE`가
      hook env에 명시적일 때만 — `.mcp.json` env는 hook에 안 보여 오차단 방지), 에러 시
      fail-open. 서버 내부 `checkAuth`의 이중화. `hook.ts`(순수 로직)/`hook-entry.ts`(실행)
- [~] 실패 모드별 에러 분류 로직 — `grok_error`/`auth_error`/`timeout`에 더해
      spawn 시작 실패·cwd 검증·중단 시 부분편집(`filesChanged`) 노출·auth 신호
      오탐 축소까지 강화 완료. 남은 것: 실제 auth 만료 문구 확보 후 신호 정밀 앵커.
- [x] 위임 이력 로컬 로깅 — MCP 서버 내부로 `~/.grok-build/history.jsonl`에 JSONL 기록
      (provenance; 자격증명 제외, cwd 비오염, 실패 시에도 위임 무영향). `history.ts`
- [~] `check-auth` 커맨드에 실패 모드별 진단 메시지 강화 (커맨드 자체는 Phase 1에서
      구현됨 — grok 미설치 메시지에 PATH 힌트 추가함)
- [ ] grok 설치 경로 PATH prepend (install.sh 실제 설치 위치 확인 후) — Dock/GUI 실행
      시 `~/.local/bin` 등이 MCP 서버 PATH에 없어 `grok_not_installed` 오탐 방지

## Phase 3 — 확장

- [x] `grok_build_verify` — delegate + `--check`(grok 자기검증 루프: 편집 후 검증
      서브에이전트가 체크리스트/Action-Trace 반환). 독립 `/verify`·스크린샷은 grok CLI
      미지원(실측)이라 스코프 외.
- [x] plan 미리보기 — 별도 tool `grok_build_plan`(`--permission-mode plan`, Cancelled+text
      =성공, 편집 없음, `filesChanged` []). `runDelegate(plan:true)` 재사용, 이력 `plan:true` 마커.
- [x] `--worktree`/`--sandbox` opt-in 격리 필드 (`DelegateInput` 확장) — **래퍼 관리
      worktree**(grok --worktree는 헤드리스 no-op이라 래퍼가 `git worktree add`)에서 실행 +
      `filesChanged` 정밀 귀속(그 worktree = 전부 grok 변경). sandbox는 pass-through.
      default-off. `worktree.ts`
- [x] 위임 이력 기반 사용량 요약 — `grok_build_usage` tool + `/grok-build:usage`(읽기전용,
      history.jsonl 집계: mode/billing/status/plan/check/worktree/files/recent). `usage.ts`

## Phase 4 — 오케스트레이터 통합

- [ ] 멀티에이전트 오케스트레이터의 Task Manager가 Grok Build를 "저비용 병렬 워커"
      옵션으로 인식하도록 라우팅 로직 연결 (`docs/05-routing-policy.md` 기준 코드화)
- [ ] ACP 직접 연동 검토 (MCP 래퍼 대비 이점이 실제로 있는지 재평가 후 착수 여부 결정)

## 명시적으로 하지 않는 것 (스코프 제외)

- Grok Build 결과의 자동 커밋/자동 PR 생성 — 항상 사람/Claude 검토 후 수동
- `grok_build_delegate` 호출별 `authMode` 오버라이드 — 모드는 서버 레벨
  `GROK_BUILD_AUTH_MODE` 1곳에서만 결정 (`docs/02-auth-strategy.md` §안전 보장 참고,
  과금 경로가 호출마다 새는 것을 원천 차단하기 위한 의도적 설계)
- Windows 네이티브 지원 — 개발 환경(Linux 홈서버, macOS/Linux 워크플로) 기준으로
  우선 검증
