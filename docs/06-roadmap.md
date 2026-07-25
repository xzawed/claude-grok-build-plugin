# 06. 로드맵

기존 멀티에이전트 오케스트레이터 프로젝트와 동일하게 Phase 단위로 진행하며,
**Phase 1이 끝나기 전까지 다음 Phase로 넘어가지 않는다** (Verum 프로젝트에서 얻은
교훈: 범위 통제가 아키텍처 야심보다 중요, "완료"는 시작 전에 정의돼야 함).

**제품 나침반:** `docs/00-product-vision.md` — Grok을 잘 쓰게 · 실력 체감 · Claude↔Grok 협업 경험.
Phase 1~3은 **안전한 다리**, 그 이후는 **경험**을 키우는 단계다.

**진행 현황 한눈에 (2026-07):** Phase 1~5 + 신뢰 게이트 ✅ · **이 레포 제품 범위 완료 (v0.2.3)**.  
외부 오케스트레이터 **프로세스** 실배선 = 소비자 레포 · GUI 클릭 = 수동 수락 · ACP = 보류.  
잔여 분류·반복 이유: **`docs/09-scope-and-residuals.md`**.

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
- [x] `/grok:delegate`, `/grok:setup` 슬래시 커맨드 (Phase 1의 `check-auth`는 이후
      `/grok:setup`에 흡수·개명; 전체 `/grok:*` 커맨드는 `README`·`docs/03` 참고)
- [x] 유닛 테스트 38개 (config/env/grok-result/auth/delegate[parsePorcelain 포함]/smoke)
      — Phase 1 시점 수치. 이후 확장돼 현재 수치는 `CLAUDE.md` / `npm test`
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
      인증을 확인. **hook·서버가 동일 관측하는 신호로만 차단**(grok 미설치는 항상; subscription은
      `~/.grok/auth.json` 부재 시; api·unknown은 키가 서버 전용 `.mcp.json` env에 있을 수 있어
      서버에 위임 → 오차단 방지), 에러 시 fail-open. 서버 내부 `checkAuth`의 이중화.
      `hook.ts`(순수 로직)/`hook-entry.ts`(실행)
- [x] 실패 모드별 에러 분류 로직 — `grok_error`/`auth_error`/`timeout`에 더해 spawn 시작
      실패·cwd 검증·중단 시 부분편집(`filesChanged`) 노출. **auth 만료 신호 실측 앵커 완료**:
      grok은 만료/부재 시 `not authenticated`가 아니라 **device-OAuth 플로우**를 stderr로 내고
      블록 → 래퍼 timeout으로 끝남. 그래서 timed-out 런의 device-flow 마커
      (`DEVICE_AUTH_SIGNALS`)를 `auth_error`로 분류해 `grok login` 안내. 실측: `grok-cli-contract.md §7`.
      (⚠️ 개발 머신 keyring 폴백 탓에 완전 무-폴백 만료의 라이브 e2e 재현은 미검증 — 단위 테스트로 커버.)
- [x] 위임 이력 로컬 로깅 — MCP 서버 내부로 `~/.grok-build/history.jsonl`에 JSONL 기록
      (provenance; 자격증명 제외, cwd 비오염, 실패 시에도 위임 무영향). `history.ts`
- [~] `check-auth` 커맨드에 실패 모드별 진단 메시지 강화 (커맨드 자체는 Phase 1에서
      구현됨 — grok 미설치 메시지에 PATH 힌트 추가함)
- [x] grok 설치 경로 PATH prepend — install.sh 실측 결과 grok은 `$GROK_BIN_DIR`||`~/.grok/bin`에
      설치됨. `env.ts`의 `prependGrokBin`이 그 dir를 PATH 앞에 붙여(멱등) spawn env(`buildGrokEnv`)와
      grok-installed probe(`defaultAuthDeps`, hook 공유) 둘 다 Dock/GUI 최소 PATH에서도 grok을
      찾게 함. `~/.local/bin`/`/usr/local/bin`은 install.sh가 이미 PATH에 있을 때만 심링크하는
      fallback이라 제외. 설계: `docs/specs/2026-07-13-grok-path-prepend-design.md`

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
- [x] 위임 이력 기반 사용량 요약 — `grok_build_usage` tool + `/grok:usage`(읽기전용,
      history.jsonl 집계: mode/billing/status/plan/check/worktree/files/recent). `usage.ts`

## Phase 3.5 — 협업 경험

Phase 1~3으로 “위임 가능한 다리”는 완성됐다. 제품 본질(`docs/00-product-vision.md`)상
다음은 **Grok 사용·체감·협업 루프**를 키우는 일이다. 항목마다 짧은 design으로 "done"을
정의한 뒤 구현한다 (범위 통제 원칙 유지).

### Slice A — 라우팅·프리셋·첫 성공 ✅ (2026-07-25)

설계: `docs/specs/2026-07-25-phase35-routing-skill-design.md`

- [x] **라우팅 skill** — `skills/grok-routing/SKILL.md` (`docs/05`를 엔드유저 런타임 컨텍스트로)
- [x] **프리셋 커맨드** — `/grok:tests`, `/grok:migrate`, `/grok:boilerplate`
- [x] **온보딩 첫 성공** — `/grok:setup`에 샘플 위임·`billing` 강조·다음 시나리오 표

### Slice B — 안정 위임 품질 ✅ (2026-07-25)

설계: `docs/specs/2026-07-25-phase35-slice-b-stable-delegate-design.md`

- [x] **filesChanged 정밀화** — spawn 전후 porcelain 차집합 (`diffChangedFiles`)
- [x] **sessionId** — grok JSON → 결과 필드
- [x] **CLI 강점 노출** — `model` / `effort` / `best_of_n`(2–4 상한) / `resume`·`continue`
      (safe token 검증, 실패 시 spawn 없음). 과금/env strip/`--always-approve` 불변

### Slice C — worktree 수명 · usage insights ✅ (2026-07-25)

설계: `docs/specs/2026-07-25-phase35-slice-c-worktree-usage-design.md`

- [x] **worktree 라이프사이클** — `grok_build_worktree` list/diff/apply/remove
      (apply는 patch·무커밋; remove는 `~/.grok-build/worktrees` 하위만)
- [x] **usage 설득 피드백** — `insights` (successRatePct, subscriptionBillingPct, headline, tips)

## Phase 4 — 오케스트레이터 통합

### Slice A — 라우팅 엔진 ✅ (2026-07-25)

설계: `docs/specs/2026-07-25-phase4-routing-engine-design.md`  
계약: `docs/07-orchestrator-integration.md`

- [x] `routeTask` 순수 함수 — LOW/MEDIUM/HIGH → `claude` | `grok` | `plan_then_grok`
      (`mcp-server/src/routing.ts`, `docs/05` 코드화)
- [x] MCP `grok_build_route` — **추천만** (spawn/과금/편집 없음)
- [x] `/grok:route` 커맨드
- [x] 플러그인 측 소비자 헬퍼: `planNextAction` / `afterPlanGate` / `observeBilling` +
      route 응답 `nextAction` + `/grok:review` (2026-07-25)
- [x] 소비자 키트: `examples/orchestrator-consumer.md` + fixtures with `nextAction` (v0.2.1)
- [x] **이 레포 측 계약 제공 완료** (구현·픽스처·nextAction·예제·docs/07).  
      외부 Task Manager **프로세스 실배선**은 소비자 저장소 작업 — 이 레포 체크리스트에서
      열지 않음 (`docs/09-scope-and-residuals.md` §4A).

### Slice B — 계약 하드닝 · CI ✅ (2026-07-25)

- [x] GitHub Actions CI (`npm test` · typecheck · dist 동기 검증) — `.github/workflows/ci.yml`
- [x] `docs/04`에 worktree/route/usage insights 스펙 반영
- [x] 오케스트레이터 의사코드 + 픽스처 JSON + 픽스처 단위 테스트
- [x] 플러그인 버전 `0.2.0` → `0.2.1` (consumer kit) → `0.2.2` (status) → **`0.2.3`**
      (billingMismatch + dist tool-surface integrity)

- [~] ACP 직접 연동 — **보류(MCP 유지)로 결정** (2026-07, 검증 리서치 기반). ACP(Agent
      Client Protocol)는 "표준화·상호운용" 전송 계층일 뿐 grok의 코딩 범위를 넓히지 않는다
      (같은 에이전트를 감쌈 — 편집/bash/plan/병렬 서브에이전트/모델/worktree·sandbox/과금 모두
      전송과 무관). **결정적 근거: Claude Code는 오늘 ACP 클라이언트가 아니다** — 어댑터
      (`@zed-industries/claude-code-acp`)를 통해 ACP *에이전트*로만 등장하므로, grok-over-ACP를
      만들어도 Claude Code 사용자가 소비할 수 없다(도달 대상 0). 스트리밍/멀티턴·재개/권한 모드·
      샌드박스는 이미 grok 헤드리스 플래그로 도달 가능(`--output-format streaming-json`,
      `--continue`/`--resume`, `--permission-mode`(default|acceptEdits|auto|dontAsk|bypassPermissions|plan)·`--sandbox`)하고, ACP 전용 이득은
      "실행 중 액션별 실시간 승인" 하나뿐이다. **재검토 트리거:** ① Claude Code가 ACP 클라이언트
      지원 ② 오케스트레이터가 ACP-네이티브인데 MCP 불가 ③ grok 진행상황 실시간 스트리밍이 필수
      요건. (근거: agentclientprotocol.com, docs.x.ai/build/cli, zed.dev/acp — 2026-07 실측.)

## Phase 5 — First-mile / Grok starting point ✅ (2026-07-25)

엔지니어링 다리를 **사람의 시작 경험**으로 연결한다. 목표: 설치 후 “다음에 뭘 하지?”를 없애고,
Grok이 빛나는 작업으로 첫 성공을 만든다.

- [x] `docs/08-getting-started-with-grok.md` — 15분 경로 · 레시피 · 트러블슈팅
- [x] `/grok:tour` — 인증 → route 데모 → 작은 위임 → 다음 프리셋
- [x] skill `grok-first-mile` — 온보딩/첫 세션 트리거
- [x] agent `grok-worker` — 볼륨 작업 실행 전용 서브에이전트 정의
- [x] README/비전 포지션: **Grok starting point**

## 명시적으로 하지 않는 것 (스코프 제외)

- Grok Build 결과의 자동 커밋/자동 PR 생성 — 항상 사람/Claude 검토 후 수동
- `grok_build_delegate` 호출별 `authMode` 오버라이드 — 모드는 서버 레벨
  `GROK_BUILD_AUTH_MODE` 1곳에서만 결정 (`docs/02-auth-strategy.md` §안전 보장 참고,
  과금 경로가 호출마다 새는 것을 원천 차단하기 위한 의도적 설계)

## 플랫폼 지원 (실측)

- **1차 검증 플랫폼:** Linux / macOS (개발 환경: Linux 홈서버, macOS/Linux 워크플로).
- **Windows 네이티브 — WSL 없이 동작 확인.** 코드가 크로스플랫폼이다(`homedir()`+`path.join`+
  `path.delimiter`(win32 `;`), `win32` 분기 — `auth.ts` `where grok`, `delegate.ts` win32
  `detached:false`+`child.kill`). 2026-07-18 네이티브 Win32NT 실측: `grok_auth_check`(ok,
  subscription) → `grok_build_delegate`(completed, billing subscription, filesChanged) →
  `--worktree` 격리(`worktreePath` 정상)까지 통과. 따라서 "Windows 미지원/ WSL 필수"는 틀린 서술.
- **Windows PreToolUse hook 스모크 (2026-07-25):** 네이티브 Win32에서
  `echo '{}' | node mcp-server/dist/hook.js` → exit 0 (fail-open/allow 경로). grok 탐지는
  `where.exe` + `~/.grok/bin/grok.exe` 폴백(`auth.ts` resolveGrokInstalled). CI에
  `windows-latest` 유닛 테스트 추가.
- **sandbox 프로필 실측 (2026-07-25):** 내장 `off|workspace|devbox|read-only|strict` 문서화
  (`docs/specs/2026-07-25-sandbox-profiles.md`). Win32 headless `--sandbox workspace` → EndTurn.
  커널 강제는 Linux/macOS; Windows는 강제 미가정.
- **unauth 신호 (2026-07-25):** 격리 홈 프로브로 즉시 `Not signed in` JSON 실측;
  device-flow timeout 경로 유지. `npm run probe:unauth`. 상세:
  `docs/specs/2026-07-25-auth-unauth-signals.md`.
- **PreToolUse 하네스 e2e (CI):** `mcp-server/test/hook-e2e.test.ts`가 커밋된
  `dist/hook.js`를 서브프로세스로 띄워 deny/allow/exit-0·HOME 격리·plan/verify stdin을
  검증. **이 레포 자동화 상한** — GUI 클릭은 대체하지 않음.
- **Claude Code GUI 클릭 경로:** 미자동 · **수동 수락 체크리스트**로 전환  
  (`docs/09-scope-and-residuals.md` §5). 열린 “개발 잔여”가 아님.

## 이 레포 “다음 코딩” 기본값

**없음.** 새 기능은 사용자가 목표·done을 명시한 뒤에만. 잔여 분류는 `docs/09`.
