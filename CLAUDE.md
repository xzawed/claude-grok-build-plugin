# CLAUDE.md — claude-grok-build-plugin

이 파일은 Claude Code가 이 프로젝트에서 세션을 시작할 때 자동으로 읽는 컨텍스트 파일입니다.
사람이 읽는 개요는 `README.md`(영문 기본) 또는 `README.ko.md`(한글), 상세 설계는
`docs/`를 참조하세요.

> ⚠️ 이 CLAUDE.md는 **이 저장소에서 개발할 때만** 로드된다. 플러그인이 **설치된**
> 엔드유저에게는 플러그인 루트의 CLAUDE.md가 컨텍스트로 전달되지 않는다 (플러그인은
> skill/agent/hook으로 컨텍스트를 제공). 따라서 절대 원칙(예: API 키 env 정제)이
> 엔드유저 런타임에 강제돼야 한다면 반드시 코드/hook에 구현해야 하며, 이 문서에만
> 적어두면 안 된다.

## 프로젝트 한 줄 요약

Claude Code 플러그인. Claude가 코딩 작업 중 일부를 xAI의 **Grok Build CLI**에 위임할 수 있게
하는 MCP 서버 래퍼. 과금은 **API 종량제가 아니라 사용자의 xAI 구독**(SuperGrok / X Premium+)을
사용하는 것을 최우선 제약 조건으로 한다.

**제품 본질 (SSOT: `docs/00-product-vision.md`):** 개발자가 Grok을 잘 쓰게 하고, 플러그인으로
Grok의 코딩 실력을 체감하게 하며, Claude(오케스트레이터) ↔ Grok(워커) 협업 경험을 만든다.
다리를 만드는 것만이 아니라 **멋진 협업 경험**이 목표다.

## 세션 핸드오프 (Claude·Grok·사람 — 필수)

의미 있는 작업 후에는 다음 세션이 **즉시** 진행 상황을 알 수 있게 문서를 맞춘다.

| 읽을 곳 | 담는 것 |
|---|---|
| 이 파일 `현재 상태` | 지금 사실·다음 할 일만 (이력 나열 금지, 짧게) |
| `docs/00-product-vision.md` | 왜 / 제품 목표 |
| `docs/06-roadmap.md` | Phase 완료 체크리스트 |
| `docs/09-scope-and-residuals.md` | 이 레포 범위 완료·잔여 분류·polish 금지 |
| `docs/10-service-audit-queue.md` | **열린 코드 결함 큐** (기능 감사 실측) — 고치면 지운다 |
| `docs/specs/`, `docs/plans/` | 결정 근거·구현 서사 |

같은 사실을 여러 문서에 복사하지 않는다 — 원천 하나를 고치고 나머지는 포인터. 전역 규칙과 동일.

## 현재 상태 (먼저 읽을 것)

- **최신 릴리스 `v0.2.20`** (2026-09-05). 무엇이 왜 나갔는지는 `docs/releases/`와
  `CHANGELOG.md`가 원천이다 — **여기 옮겨 적지 말 것**(이 줄이 이력으로 자라면 다음 세션이
  같은 서사를 매번 다시 읽는다). MCP **9 tools** 동일. 계약 SSOT:
  `docs/specs/grok-cli-contract.md` — **절마다 유효 버전이 다르다**(헤더 버전 하나로 전체를
  대표시키지 말 것). 유닛 수치는 `npm test`로 직접 낼 것 — 문서의 숫자는 낡는다.
  ⚠️ **선언만 하고 태그를 안 끊는 사고는 한 번이 아니다** — `0.2.0`·`0.2.1`·`0.2.2`는 지금도
  태그가 없고 `v0.2.12`는 소급 태그뿐이다(`git tag --sort=v:refname`). 마켓플레이스 소스가
  `./`라 그 사이 설치자가 옛 번들을 그 번호로 캐시한다 — 규칙은 아래 캐시 항목, 경위는
  `docs/releases/`·`CHANGELOG.md`. `release-tag-check`(schedule/dispatch)가 감시한다.
- **⚠️ grok CLI는 스스로 업데이트된다.** 2026-09-02 세션 도중 `1.0.5 → 1.0.13` 자동 갱신이
  실측됐다. 계약 스냅샷(값-플래그 목록 등)이 낡는 것을 **전제로** 설계한다 —
  `grok-cli.ts` 차단 판정이 목록에 의존하지 않는 이유. 재실측 전 계약 문서의 버전을
  "사용자 머신의 버전"으로 읽지 말 것.
- **표면:** route/`nextAction`, status(+`billingMismatch`), review/resume, first-mile,
  consumer kit (`examples/orchestrator-consumer.md`), hook e2e + tool-surface CI.
- **유지보수자 표면 (`.claude/`, 배포 안 됨):** `repo-scope`(다음 할 일 = 기본 없음),
  `maintainer-preflight`(done 선언 전 test/typecheck/build + 번들 재빌드). 경계: `CONTRIBUTING.md`.
- **의존성 PR:** dist 재빌드는 **사람이 아니라 에이전트**가 한다. esbuild가 런타임 의존성을
  번들에 인라인하므로 lockfile만 바뀌어도 `dist/index.js`가 바뀔 수 있다 (실측 PR #27·#49
  `fast-uri`). 단 **패키지마다 다르다** — `grep -c "node_modules/<pkg>" dist/index.js`로
  확인하고, 0이면 재빌드 없이 머지한다 (실측 PR #48 `ip-address`는 번들 밖이라 CI 통과).
  CI 자동 재빌드는 기각 — 근거는 `CONTRIBUTING.md` "Why this is not automated in CI".
- **이 머신 설치본은 `0.2.17`이고, 레포는 `0.2.20`을 선언한다 (세 버전 뒤)** — 최신을 쓰려면 오너가
  `claude plugin marketplace update` → `claude plugin update grok@grok-marketplace`를 다시
  돌려야 한다 (아래 순서 그대로). (2026-09-04 갱신 실측: `claude plugin marketplace update`로
  클론을 올린 뒤 `claude plugin update grok@grok-marketplace` → **0.2.11 → 0.2.17**,
  `claude plugin list` = Version 0.2.17 · Status **enabled**, gitCommitSha `29f2236`. 새 캐시의
  번들을 직접 기동해 `serverInfo.version` **0.2.17**도 확인했다).
  ⚠️ **갱신 후에도 실행 중이던 세션은 옛 프로세스를 물고 있다** — 지금 `/grok:status`에서 봐야 할 수는
  `0.2.20`이다 (`0.2.17`을 기다리던 이전 인스턴스는 2026-09-05에 닫혔다 — `docs/09` §5). 그러려면 Claude
  Code 재시작이 필요하다. 마켓플레이스 클론은 `autoUpdate: false`라 **클론 갱신이 항상 먼저**다
  (클론이 낡으면 `plugin update`가 새 버전을 보지 못한다 — 2026-09-04 실측).
  캐시는 **버전 키**다(`~/.claude/plugins/cache/<mk>/<plugin>/<version>/`) — 번들이 바뀌면
  같은 버전으로 재배포하지 말고 반드시 범프한다. 그 규칙의 실사례가 위 `v0.2.12`다 —
  **머지 직후 바로 태그를 끊는다.**
- **다음 할 일 (이 레포): 있음 — `docs/10-service-audit-queue.md`에 15건.** 2026-09-05
  기능 감사(배포 번들 53개 항목 실행 + 독립 재실행)가 찾았고 FAIL 4건은 v0.2.19로,
  **A1~A5는 v0.2.20으로** 나갔다. 남은 15건은 전부 DEGRADED이며 **큐 순서대로** 집으면 된다.
  1순위 A6: `history.ts`의 `redactSecrets`가 `scheme://user:pass@`·`DATABASE_URL`·`Basic`·
  종결 마커 없는 PEM을 놓치고, 그 원문이 대시보드 호출마다 Claude 컨텍스트로 되돌아온다.
  그 문서가 열린 결함의 SSOT다 — 고치면 거기서 지운다 (**번호는 재사용하지 않는다**).
  범위 밖(외부/수동/보류)은 여전히 `docs/09`이고, 기각·반증된 항목을 다시 제기하기 전에는
  `docs/09`·`docs/releases/`의 근거부터 읽을 것.
- **사람이 해야 할 미해결: 1건 — 이 머신 설치본 갱신.** 위 설치본 항목의 순서(marketplace update →
  plugin update → Claude Code 재시작)를 오너가 돌리고 `/grok:status`의 `serverVersion`이
  `0.2.20`인지 확인하면 닫힌다. 2026-09-05 실측: `claude plugin list` = Version 0.2.17, 캐시에
  `0.2.7`·`0.2.11`·`0.2.17`만 있고, 마켓플레이스 클론 = 0.2.17, 레포 선언 = `0.2.20`
  (`gh release list` Latest = `v0.2.19`). **설치본이 세 버전 뒤처져 있다** — v0.2.18의 만료 세션
  분류도, v0.2.19의 라우터 위험 게이트도, v0.2.20의 감사 큐 수정(A1~A5)도 이 머신에서는 아직 돌지 않는다.
  그 뒤 `docs/09` §5의 수용 런이 남는다.
  오래 이월되던 다른 두 건은 2026-09-04에 **실측으로** 닫혔다 —
  SCAManager 토큰은 발급처에서 무력함이 확인됐고(무작위 토큰과 동일하게 거부, 경로 전체가
  `STATUS=200` 게이트 뒤에 있음), Dependabot 경보는 open 0건이다. 근거 전문은 `CHANGELOG.md`
  2026-09-04 항목과 `docs/09` §5 실행 기록에 있다 — **다시 열기 전에 그것부터 읽을 것.**
- **다음 세션 시작점: `docs/10` A6부터.** 감사 하네스는 `.claude/tools/mcpcall.mjs` —
  세션의 MCP(설치 시점 버전 고정)가 아니라 **배포 번들을 stdio로** 띄워 채점한다. 엉뚱한
  산출물을 채점하는 사고를 막는 유일한 방법이다.
  ⚠️ 지우면 안 되는 불변식 둘: 만료 세션은 **폐기**이므로 `AUTH_ERROR_SIGNALS`의
  `invalid or expired credentials`(계약 §7 C), 그리고 **plan은 read-only가 아니다** — grok
  1.0.13이 `--permission-mode plan`을 무시하므로 `planWroteFiles`가 유일한 방어다(계약 §6).
- **레포 밖/수동/보류:** 외부 오케스트레이터 실배선(소비자) · GUI 클릭 수동 수락 · ACP 보류.
  분류: **`docs/09-scope-and-residuals.md`**.
- 치명 회귀 주의(`hooks/hooks.json` 스키마 등)는 아래 **Gotchas**. 이력은 `CHANGELOG.md`.
- 비전: `docs/00` · Phase: `docs/06` · 릴리스 노트: `docs/releases/`.

## 절대 원칙 (변경 금지)

1. **인증은 서버 레벨 env `GROK_BUILD_AUTH_MODE`(기본 `subscription`, opt-in `api`)로
   결정되는 투트랙이며, 모드에 따라 API 키 env 처리가 갈린다 — 호출별 오버라이드는
   없다.**
   - `subscription`(기본, 미설정 시): grok 프로세스에 넘기는 env에서
     `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY`를 항상 제거한다(`env.ts`의
     `buildGrokEnv`). **이유(2026-09-02 실측으로 정정):** "키가 세션보다 우선이라서"가
     아니다 — 1.0.13에서 유효 세션이 있으면 grok은 `auth_type=SessionToken`으로 가며
     env 키를 시도조차 하지 않는다(헤드리스 `-p` 5형태 실측; 그 밖은 미측정).
     진짜 이유는 세션이 없거나 만료된 순간 env 키가
     **폴백 자격증명**이 되어 구독 모드 실행이 조용히 종량제로 넘어갈 수 있기 때문이다.
     키를 지우면 그 실행은 조용히 과금되는 대신 `auth_error`로 명시적으로 실패한다.
     즉 구독 모드는 종량제 자격증명을 아예 쥐지 않는다는 **정책 보장**이다.
     ⚠️ `grok models`의 "You are using XAI_API_KEY." 문구는 env 변수 존재만 보고하며
     요청 인증과 다르다 — 이를 근거로 삼지 말 것. 실측 전문: `docs/specs/grok-cli-contract.md` §10.
   - `api`(opt-in, `GROK_BUILD_AUTH_MODE=api`일 때만): env의 API 키를 그대로
     통과시킨다 — 종량제(`billing: "metered_api"`)로 명시적으로 청구된다.
   - 모든 `grok_build_delegate` 응답은 설정된 `mode`와 그로부터 파생된 `billing`을
     명시한다 — `billingFor(mode)`이며 관측값이 아니다. 상세:
     `docs/02-auth-strategy.md`, `docs/specs/grok-cli-contract.md` §2.
   - ⚠️ **안전 모델 (헤드리스 편집을 위해 필수):** grok에 실제 편집을 시키려면
     `--always-approve`가 필수다 (없으면 grok이 `stopReason: Cancelled`로
     끝나고 아무 파일도 바꾸지 않는다 — 실측, `docs/specs/grok-cli-contract.md`
     §1·§5). 즉 이 플러그인은 승인을 대화식으로 보류하지 않는다 — grok은 대상
     `cwd`(또는 `--worktree` 격리)에서 **직접 편집**하되, **자동 커밋은 하지
     않는다**. Claude/사람이 diff를 검토한 뒤에만 커밋한다
     (`docs/05-routing-policy.md` "위임 시에도 지켜야 할 것" 참고).
2. 인증은 `grok login`(브라우저 OAuth, 사용자가 터미널에서 최초 1회 수동 실행)으로
   생성되는 `~/.grok/auth.json` 세션 토큰(구독 모드) 또는 env의 API 키(API 모드)에
   전적으로 의존한다. 이 플러그인은 자격증명을 저장하거나 대신 로그인하지 않는다.
3. 자동화 실행에는 항상 `--no-auto-update` 플래그를 붙인다 (헤드리스 환경에서
   업데이트 체크로 인한 행 방지). 실측 결과 헬프에는 없지만 에러 없이 수용된다
   (exit 0) — 붙여도 안전.
4. MCP 서버는 **자신이 쥔 credential**(env의 API 키, 세션 토큰, `rawStderrTail`)을 로깅하거나
   파일에 쓰지 않는다. API 모드에서도 키를 저장하지 않고 env에서 읽어 통과만 시킨다.
   ⚠️ **이 원칙이 덮지 않는 것 — 위임 이력의 프롬프트 미리보기.** `~/.grok-build/history.jsonl`은
   프롬프트 앞 200자를 기록하고, `grok_build_usage`·`grok_build_status`가 그것을 Claude에게
   되돌려준다. 즉 **사용자가 프롬프트에 붙여넣은** 시크릿은 서버가 쥔 자격증명이 아니지만
   기록될 수 있다. `history.ts`의 `redactSecrets`가 알려진 형태(xAI·AWS·GitHub·Slack·JWT·
   Bearer·`password:` 류 대입·PEM 블록)를 가리지만 **모든 형태를 가릴 수는 없다** — 마스킹은
   완화이지 보장이 아니다. 2026-09-03 실측 전에는 xAI 키만 가렸고 나머지는 그대로 기록됐다.

## 컴포넌트 지도

구현 완료. 상세 배치는 `docs/03-plugin-spec.md`, Phase 상태의 원천은 `docs/06-roadmap.md`.

- `mcp-server/` — Grok Build CLI를 헤드리스(`-p`, `--output-format json`,
  `--always-approve`)로 감싸는 MCP 서버 (TypeScript, ESM). 상세 tool 스펙은
  `docs/04-mcp-server-spec.md`. `src/`:
  - `config.ts` — `resolveAuthMode()`: `GROK_BUILD_AUTH_MODE` 읽어 `subscription`
    (기본) / `api` 결정, 잘못된 값이면 서버 기동 시 에러.
  - `env.ts` — `buildGrokEnv(mode, env)`: subscription이면 API 키 제거, api면 그대로 통과;
    항상 `prependGrokBin`으로 grok 설치 dir(`GROK_BIN_DIR`||`~/.grok/bin`)를 PATH 앞에 붙여
    GUI/Dock 최소 PATH에서도 grok 발견(멱등). `grokBinDir`/`prependGrokBin`은 `auth.ts` probe도 공유.
  - `grok-result.ts` — `parseGrokResult(stdout)`: `--output-format json` 단일 객체
    파싱 (`text`, `stopReason`).
  - `auth.ts` — `checkAuth(mode, deps)`: 모드별 분기(`grok_not_installed` /
    `not_logged_in` / `no_api_key`). `defaultAuthDeps.grokInstalled` probe는 `prependGrokBin`으로
    PATH를 보정해 GUI/Dock에서도 grok 발견(서버·hook 공유). 미설치 메시지는 `GROK_NOT_INSTALLED_MESSAGE`.
  - `delegate.ts` — `runDelegate(mode, input, deps)`: cwd(절대경로·존재) 검증 →
    grok subprocess 실행 → `isSuccessfulStopReason`(`end_turn`/`EndTurn`)으로 성공 판정. 실패도 세분
    (spawn 시작 실패/timeout/auth_error/grok_error)하고 중단 시에도 부분편집을
    `filesChanged`로 노출. **auth 만료 신호:** grok은 만료를
    **기다리지 않고 폐기**한다 — exit 1 + `Not signed in.`(갱신 실패) 또는 401
    `Invalid or expired credentials`(서버 거부). 후자는 `AUTH_ERROR_SIGNALS`의
    `invalid or expired credentials`만이 잡는다 — xAI 상용구가 "no need to run /login"이라
    말하므로 **이 신호를 지우면 정반대 안내가 나간다.** device-flow 블록
    경로(`DEVICE_AUTH_SIGNALS` → timed-out 런 재분류)는 1.0.13에서 재현되지 않았지만 보험으로
    남긴다. 재현 `npm run probe:expired`. 상세: `docs/specs/grok-cli-contract.md §7`. 변경 파일은 `parsePorcelain`(`git status --porcelain -z`,
    비동기)으로 도출, 결과에 `mode`·`billing` 부착. DI(`spawn`/`gitChangedFiles`/
    `dirExists`/`env`)로 테스트 가능.
  - `history.ts` — `recordDelegation`: 위임 이력을 `~/.grok-build/history.jsonl`에
    JSONL로 기록(provenance, 자격증명·`rawStderrTail` 제외, 프롬프트의 API 키 대입 마스킹,
    cwd 비오염, 실패해도 위임 무영향). `server.ts`가 `runDelegate` 후 호출.
  - `status.ts` / `routing.ts` / `orchestrator.ts` / `version.ts` — 대시보드, route/`nextAction`,
    서버가 광고하는 버전(SSOT는 `mcp-server/package.json`이고 `version.ts`는 그것을 읽는다 —
    하드코딩 폴백 리터럴만 함께 범프한다).
  - `worktree.ts` — `createGrokWorktree` + list/diff/apply/remove/prune 라이프사이클
    (`grok_build_worktree`). apply는 uncommitted patch·무커밋(패치는 `mkdtemp` 0600);
    remove는 baseDir 하위만이며 동반 브랜치를 `git branch -d`로 정리; prune은 기본 dry run.
    모든 git 호출은 `runGitBounded`(타임아웃·maxBuffer)를 지난다.
  - `usage.ts` — `readHistory`+`summarizeHistory`(+`insights`): 집계 및 성공률/구독 비중
    헤드라인. `grok_build_usage` tool.
  - `hook.ts` — `pre-delegate-auth-check` PreToolUse hook 순수 로직: `resolveHookMode`
    (미설정/모호→`unknown`, throw 안 함), `decideHook`(**hook·서버가 동일 관측하는 신호로만
    deny** — grok 미설치는 항상, subscription은 `auth.json`(`GROK_HOME`||`~/.grok`) 부재 시; api·unknown은
    키가 서버 전용 `.mcp.json` env에 있을 수 있어 서버에 위임 → 오차단 방지. `checkAuth` 재사용),
    `runHook`(IO DI, 에러 fail-open). 서버 내부 `checkAuth`의 하네스 레벨 이중화.
  - `hook-entry.ts` — hook 실행 진입점(실제 stdin/stdout/env/`defaultAuthDeps` → `runHook`).
    esbuild가 `dist/hook.js`로 번들, `hooks/hooks.json`이 실행.
  - `grok-cli.ts` — `runGrokCli`: 빌링 안전 env(`buildGrokEnv(mode)` — subscription은
    `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 제거 + PATH prepend)로 임의 grok 서브커맨드를
    실행. 비-헤드리스 denylist(`dashboard`/`agent`/`leader`/`completions`/`wrap` + 대화형
    login)와 CLI 1.0에 없는 `import`는 spawn 없이 안내/`blocked`를 반환(행 방지), timeout(기본 60초), 실행
    `mode`/`billing` 보고. `/grok:*` 유틸 커맨드 + `/grok:cli` passthrough의 구동부.
  - `routing.ts` — `routeTask` / `inferSignalsFromTask` (LOW·MEDIUM·HIGH, 순수 함수).
  - `server.ts` — 9개 tool 등록 + 핸들러. 부작용은 전부 `ServerDeps`(기본값은 실제 구현)를
    지나므로 테스트가 인메모리 전송으로 진짜 등록된 tool을 호출할 수 있다
    (`test/server-tools.test.ts`). ⚠️ 핸들러를 `main()` 안 익명 클로저로 되돌리지 말 것 —
    호출이 불가능해지면 `isError` 계약을 뒤집어도 전 스위트가 녹색이다(실측).
  - `index.ts` — stdio 진입점만. `resolveAuthMode()` → `buildServer(mode).connect(stdio)`.
    `hook-entry.ts`/`hook.ts`와 같은 진입/로직 분리.
  - `types.ts` — 공유 타입(`AuthMode`, `Billing`, `DelegateResult` 등).
  - `scripts/check-release-tag.mjs` — 선언 버전에 태그·GitHub 릴리스가 있는지 검사
    (`.github/workflows/release-tag-check.yml`이 schedule/dispatch로 실행 — push/PR이 아니다:
    버전 선언 커밋은 태그보다 **먼저** 머지되므로 PR 시점 검사는 모든 릴리스 PR을 오탐한다).
  - `build.mjs` — esbuild 번들러(`src/index.ts`→`dist/index.js`, `src/hook-entry.ts`→
    `dist/hook.js` 자립 번들 2개).
  - `test/` — 유닛 테스트 (vitest; 현재 수치는 `npm test`).
- `commands/` — `/grok:*`: setup/**tour**/delegate/plan/verify/usage/worktree/route/tests/migrate/boilerplate
  + 유틸 + `cli`. worktree→`grok_build_worktree`, route→`grok_build_route`.
- `skills/` — `grok-routing`, `grok-first-mile` (엔드유저 세션).
- `agents/grok-worker.md` — 볼륨 작업 서브에이전트.
- `hooks/hooks.json` — `pre-delegate-auth-check` PreToolUse hook 정의 (matcher:
  `mcp__plugin_grok_grok-build__(grok_build_(delegate|plan|verify)|grok_cli)` → `node dist/hook.js`).
  `grok_cli`는 **프롬프트를 실은 passthrough일 때만** 인증 게이트를 받는다 — hook이 페이로드의
  `tool_input.args`를 읽는다(`needsAuthGate`). 읽기 전용 서브커맨드는 게이트 없음.
  위임 이력 로깅은 hook이 아니라 서버 내부(`history.ts`)에서 수행하며, 프롬프트 passthrough도
  `via: "grok_cli"`로 남는다. 상세: `docs/03-plugin-spec.md` "Hook".
- `.claude-plugin/plugin.json` — 플러그인 매니페스트 (`name: "grok"`).
- `.claude-plugin/marketplace.json` — 마켓플레이스 정의 (`grok-marketplace`; 4단계 설치:
  `/plugin marketplace add … → /plugin install grok@grok-marketplace → /reload-plugins → /grok:setup`).
- `.mcp.json` — MCP 서버 등록 (플러그인 **루트**에 위치).

## 개발 명령

**사용자가 사전에 수동으로 해야 하는 것** (플러그인이 대신 하지 않음):

```bash
curl -fsSL https://x.ai/cli/install.sh | bash   # 1. Grok Build CLI 설치
grok login                                        # 2. 구독 계정 OAuth 로그인
grok --no-auto-update -p "Say ok."                # 3. 로그인/구독 인증 스모크 테스트
```

**MCP 서버 빌드/테스트 명령** (`mcp-server/` 안에서 실행):

```bash
npm run build       # esbuild(build.mjs) → dist/index.js + dist/hook.js 자립 번들 (커밋 대상)
npm test             # vitest run
npm run typecheck    # tsc --noEmit (타입 검사만, 산출물 없음)
```

> ⚠️ `dist/index.js`·`dist/hook.js`는 커밋되는 빌드 산출물이다 — `src/` 변경 후에는 커밋 전
> 반드시 `npm run build`로 두 번들을 재생성해야 소스와 어긋나지 않는다. SDK는 실측 `1.29.0`
> (`package.json` floor `^1.29.0`, zod `^3.25.0`, vitest `^4.1.0`).

## 설계 문서 인덱스

| 문서 | 내용 |
|---|---|
| `docs/00-product-vision.md` | 제품 본질·협업 경험 목표·성공 감각 (왜) |
| `docs/01-architecture.md` | 전체 아키텍처, Claude ↔ MCP 서버 ↔ grok CLI 흐름 |
| `docs/02-auth-strategy.md` | 투트랙 인증 전략(구독 기본 + API opt-in), env 정제, 만료 처리 |
| `docs/03-plugin-spec.md` | 플러그인 디렉토리 구조, manifest 필드 |
| `docs/04-mcp-server-spec.md` | MCP tool 정의 (요청/응답 스키마) |
| `docs/05-routing-policy.md` | 어떤 작업을 Grok Build에 위임할지 판단 기준 |
| `docs/06-roadmap.md` | 구현 단계 (Phase 1~5) |
| `docs/07-orchestrator-integration.md` | 오케스트레이터 JSON/MCP 연동 계약 |
| `docs/08-getting-started-with-grok.md` | 사람용 Grok 시작 지도 (15분 경로) |
| `docs/09-scope-and-residuals.md` | 범위 종료·잔여 반복 이유·수동 수락 |
| `docs/10-service-audit-queue.md` | 2026-09-05 기능 감사 — 열린 결함 20건·측정 불가 5건·재현 방법 |

## 이 프로젝트가 속한 더 큰 그림

이 플러그인은 별도로 설계 중인 **멀티에이전트 오케스트레이터**(Orchestrator ↔ PM/Dev/
Designer/Tester/Security/Wiki/QA agents) 프로젝트의 한 축으로 편입될 예정이다.
Grok Build는 오케스트레이터 관점에서 "병렬 탐색/저비용 반복 작업"을 처리하는
서브에이전트 워커로 취급하며, QA Agent의 위험도 기반 모델 라우팅(LOW/MEDIUM/HIGH)과
유사한 방식으로 Claude와 Grok Build 사이의 작업 분배 기준을 둔다.
(자세한 기준은 `docs/05-routing-policy.md` 참조.)

## 코딩 컨벤션

- MCP 서버: TypeScript, Node.js. `@modelcontextprotocol/sdk` 사용.
- 서브프로세스 실행은 `spawn` 사용, `exec`/`execSync`로 셸 인젝션 위험 있는 문자열
  조립 금지 — 프롬프트는 반드시 인자 배열로 전달.
- 모든 tool 응답은 구조화된 JSON을 텍스트로 요약해서 반환 (grok의 raw stdout을
  그대로 Claude에게 넘기지 않는다 — 토큰 낭비 및 파싱 부담).

## Gotchas

- **코드는 크로스플랫폼이고 네이티브 Windows에서 핵심 경로가 실측 동작한다.** `env.ts`·`auth.ts`·
  `history.ts`·`worktree.ts`가 `homedir()`+`path.join`+`path.delimiter`(win32는 `;`)를 쓰고
  `process.platform === 'win32'` 분기가 있다(예: `auth.ts`는 `where grok`, POSIX는
  `sh -c 'command -v grok'`; `delegate.ts`는 win32에서 `detached:false`+`child.kill`). 2026-07-18
  네이티브 Win32NT 세션 실측: `grok_auth_check`(ok, subscription)·`grok_build_delegate`(completed,
  subscription)·`--worktree` 격리까지 통과. **1차 테스트/지원 플랫폼은 여전히 Linux/macOS**다.
  Windows PreToolUse는 `hook-e2e`가 `windows-latest`에서 돌고, `--sandbox workspace` 수용은
  2026-07-25 실측됐다. 커널 강제는 Linux/macOS만 가정 (`docs/06-roadmap.md` "플랫폼 지원 (실측)").
  코드 작성 시 POSIX 경로/셸을 하드코딩하지 말 것 — `~/.grok/…`은 홈 축약 표기일 뿐 win32에선
  `C:\Users\…\.grok\…`이며, `homedir()`/`join`/`delimiter`와 `process.platform` 분기를 쓴다.
- **설계 문서는 `docs/` 안에 있다.** (초기에 저장소 루트에 흩어져 있었으나 `docs/`로
  이동함. CLAUDE.md·README의 모든 `docs/...` 링크는 이제 정상 동작.)
- `.claude-plugin/plugin.json`·`.mcp.json`은 `docs/03-plugin-spec.md`의 초안대로
  실제 구현됐다. 두 파일을 고칠 때는 문서 예시도 함께 갱신해 어긋나지 않게 할 것
  (버전마다 공식 스키마 필드가 바뀔 수 있으니 변경 전 공식 레퍼런스로 재검증).
- **⚠️ CRITICAL — `hooks/hooks.json` 스키마 (2026-07-25):** Claude Code 플러그인 로드는
  반드시 `{ "hooks": { "PreToolUse": [...] } }` 형태. **최상위에 `PreToolUse`를 두면**
  `Hook load failed: expected record at path ["hooks"]` → **Status: failed to load** →
  **슬래시 커맨드 전부 미등록**. 공식 플러그인(railway 등)과 동일 래핑. 회귀 방지:
  `mcp-server/test/hooks-contract.test.ts`. 배포 전 `claude plugin list`로
  `grok@… Status: enabled` 확인.
- **⚠️ `npm i --no-save`는 "부작용 없음"이 아니다 (2026-08-23 실측).** `mcp-server/`에서 커버리지·린트
  도구를 `--no-save`로 설치했더니 npm이 트리를 다시 풀면서 **런타임 의존성**
  `@modelcontextprotocol/sdk`를 lockfile의 `1.29.0` 대신 `1.30.0`으로 올렸다. esbuild가 런타임
  의존성을 번들에 인라인하므로, 그 상태로 `npm run build` 하면 소스와 어긋난 `dist/index.js`가
  커밋된다 (CI의 Linux dist 검사가 잡았다 — PR #63). **`--no-save` 설치를 했으면 반드시 `npm ci`
  후에 빌드**한다. 확인:
  `node -e "console.log(require('./node_modules/@modelcontextprotocol/sdk/package.json').version)"`
  를 lockfile 값과 대조.
- **플러그인은 MCP 서버 서브디렉토리에 `npm install`/빌드를 자동 실행하지 않는다.**
  따라서 `dist/index.js`(MCP 서버)와 `dist/hook.js`(PreToolUse hook) **두 esbuild 자립
  번들**을 커밋해야 엔드유저 환경에서 서버·hook이 뜬다 (`node_modules`·`dist/`는 gitignore,
  `!mcp-server/dist/index.js`·`!mcp-server/dist/hook.js` 두 번들만 예외). `src/`를
  고치면 커밋 전 `npm run build` 필수 — 안 하면 번들이 소스보다 뒤처져 배포된다.
- **`git status --porcelain`은 `-z` + `core.quotepath=false`로 파싱한다**(`parsePorcelain`).
  기본 포맷은 리네임을 `old -> new`로, 비ASCII를 octal 이스케이프로 내보내 파싱이 깨진다.
- **`filesChanged`는 spawn 전후 git porcelain 차집합(after \\ before)** 이다 — 위임 전
  dirty 파일은 기본적으로 제외된다. 이미 dirty인 경로를 grok이 더 수정하면 under-report될
  수 있다; 그때는 `worktree: true`로 정밀 귀속. (Slice B)
- **`best_of_n`은 CLI 1.0에서 삭제** — 값이 있으면 spawn 없이 `grok_error`. 잘못된
  model/effort/resume 토큰도 spawn 없이 `grok_error`. `grok-build` 모델 id는 `--model` 생략.
- **worktree apply**는 untracked 포함(`add -A` → `diff --cached` → cwd `apply`, worktree
  `reset`). timeout→auth는 **stderr device-flow만** (stdout `grok login` 오탐 금지).
