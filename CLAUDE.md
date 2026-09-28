# CLAUDE.md — claude-grok-build-plugin

이 파일은 Claude Code가 이 프로젝트에서 세션을 시작할 때 자동으로 읽는 컨텍스트 파일입니다.
사람이 읽는 개요는 `README.md`(영문 기본) 또는 `README.ko.md`(한글), 상세 설계는 `docs/`를 참조하세요.
**여기에는 지금 알아야 할 것과 함정의 존재만 한 줄씩 둔다 — 옮긴 근거·절차·이력은 `docs/11-maintainer-playbook.md`
(그 뒤에 더한 함정은 제 소스·테스트를 가리킨다).**

> ⚠️ 이 CLAUDE.md는 **이 저장소에서 개발할 때만** 로드된다. 플러그인이 **설치된**
> 엔드유저에게는 플러그인 루트의 CLAUDE.md가 컨텍스트로 전달되지 않는다 (플러그인은
> skill/agent/hook으로 컨텍스트를 제공). 따라서 절대 원칙(예: API 키 env 정제)이
> 엔드유저 런타임에 강제돼야 한다면 반드시 코드/hook에 구현해야 하며, 이 문서에만
> 적어두면 안 된다.

## 프로젝트 한 줄 요약

Claude Code 플러그인. Claude가 코딩 작업 중 일부를 xAI의 **Grok Build CLI**에 위임할 수 있게 하는 MCP 서버 래퍼.
과금은 **API 종량제가 아니라 사용자의 xAI 구독**(SuperGrok / X Premium+)을 쓰는 것이 최우선 제약이다. 목표는 다리만이
아니라 **Claude(오케스트레이터) ↔ Grok(워커)의 멋진 협업 경험**이다 — SSOT `docs/00-product-vision.md`.

## 세션 핸드오프 (필수)

의미 있는 작업 뒤에는 다음 세션이 즉시 이어받게 맞춘다. 같은 사실을 여러 곳에 복사하지 않는다 — 원천 하나를 고치고
나머지는 가리킨다. 이 파일 `현재 상태`(지금 사실·다음 할 일만, 이력 금지) · `docs/06`(Phase) · `docs/09`(범위·잔여·
릴리스 수락) · `docs/10`(열린 결함 큐 — 고치면 지운다) · `docs/specs/`·`docs/plans/`(결정 근거) · `CHANGELOG.md`(이력).

## 현재 상태 (먼저 읽을 것)

**최신 릴리스 `v0.2.37`.** 무엇이 왜 나갔는지는 `docs/releases/`와 `CHANGELOG.md`가 원천이다 — 여기 옮겨 적지 말 것.

- **다음 할 일: 없음 — `docs/10`의 A(열린 결함)는 비었다.** 새 결함은 그 A 섹션에, 번호 재사용 없이 — **다음은 A50.**
  오너 목표가 없으면 레포 범위 완료(`.claude/skills/repo-scope`; 외부/수동/보류는 `docs/09`). B7은 오너의 컨테이너
  로그인이 있어야 잰다. 기각·반증된 항목을 다시 제기하기 전에 `docs/09`·`docs/releases/`의 근거부터 읽을 것.
- ⚠️ `docs/10`의 B(측정 불가)는 대기열이 아니라 **할 일 목록**이다 — 환경을 만들 수 있으면(Docker, 컨테이너 전용 로그인)
  지금 잰다. 절차는 `docs/specs/grok-cli-contract.md` §13.
- ⚠️ **grok CLI는 스스로 업데이트된다** — 계약 스냅샷이 낡는 것을 전제로 설계한다. 실제 CLI를 보는 것은
  `npm run probe:contract`뿐이다(쿼터 0; 유닛 테스트는 DI 목이라 어떤 grok에서도 녹색). `drifted`(이 머신)와
  `snapshotBehindLatest`(새 설치)는 다른 질문이고 뒤쪽은 `--strict`를 깨지 않는다; 조회 실패는 `null`+사유이지
  `false`가 아니다. 계약 SSOT `docs/specs/grok-cli-contract.md`는 **절마다 유효 버전이 다르다.**
- ⚠️ 새 서브커맨드를 `KNOWN_SUBCOMMANDS`에 넣는 것이 기본값이 아니다 — 헤드리스로 못 돌거나, 호출보다 오래 살거나,
  계정에 작용하면 `NON_HEADLESS` 행이다(두 집합은 반대 방향으로 실패한다 — A29).
- ⚠️ plan 모드의 쓰기 차단은 릴리스마다 뒤집힌다 — `planWroteFiles`는 지우지 않고, 사용자 문구에 "grok X.Y는 …한다"를
  단정하지 않는다.
- ⚠️ **머지 직후 바로 태그를 끊는다** — 캐시는 버전 키라, 번들이 바뀌면 같은 번호로 재배포하지 말고 범프한다(감시
  `release-tag-check`). 릴리스 노트는 GitHub 본문 한도(125,000자, CRLF 기준)에 들어가야 하고, 밖으로 옮긴 기록은
  **절대 주소**로 링크한다 — 릴리스 페이지는 상대 링크를 저장소 루트에서 푼다(`handoff-version.test.ts`).
- 의존성 PR의 dist 재빌드는 사람이 아니라 에이전트가 한다 — 패키지마다 다르다(`grep -c "node_modules/<pkg>" dist/index.js`가
  0이면 재빌드 없이 머지). 근거 `CONTRIBUTING.md`.
- SCAManager 토큰 건은 2026-09-04에 실측으로 닫혔다 — 다시 열기 전에 `CHANGELOG.md` 그 날짜와 `docs/09` §5.
  Dependabot 경보 건수는 여기 적지 않는다(원천 `gh api …/dependabot/alerts?state=open`과 `npm audit`).
- **릴리스 수락:** 머지 내용(트리) 검증 → **즉시** 태그·릴리스 → dist blob = 태그 blob → 클론 먼저 설치본 갱신 → 캐시 =
  태그 blob → `accept-release` 레포·캐시. 마지막 칸(갱신 뒤 **새** 세션의 `serverVersion`과 그 세션 MCP 자식의 명령줄
  버전 디렉터리)은 세션이 시작 시점의 MCP를 물고 있어 새 세션 몫이다. 버전 번호·실행 기록은 `docs/09` §5에만.
- 새 클론·다른 PC: **클론이 먼저다** — 마켓플레이스 클론은 `autoUpdate: false`라 낡으면 `claude plugin update`가 새
  버전을 못 본다. 절차 원천은 `CONTRIBUTING.md`와 `docs/09` §5.
- 레포 밖/수동/보류(외부 오케스트레이터 실배선, GUI 클릭 수동 수락, ACP)는 `docs/09-scope-and-residuals.md`가 분류한다.

## 작업 수행 방법 — 결함 하나를 고치는 절차

순서를 바꾸지 말 것 — 각 단계는 앞 단계의 증거에 기댄다. 근거·실측·조리법 전문은 `docs/11-maintainer-playbook.md`.

1. **배포 번들로 재현한다** — `node .claude/tools/mcpcall.mjs call <tool> '<json args>'`(⚠️ 실제 쿼터를 쓴다; 쿼터 0으로
   배선만 볼 때는 `accept-release.mjs`). 세션의 MCP로 재현하지 말 것 — 세션 시작 때의 설치본에 고정돼 있다. 재현되지
   않으면 멈춘다. 문서에 적힌 증상은 증거가 아니다.
2. **실패하는 테스트를 먼저 쓴다** — fixture는 1번에서 실제로 보낸 페이로드 그대로.
3. **고친다** — 근거는 코드 주석에. 4. **같은 페이로드로 다시 잰다**(`npm run build` 뒤) — 숫자가 바뀐 것을 보기 전엔
   고쳤다고 말하지 않는다.
5. **Grok에게 반증을 시킨다** — `STATIC ANALYSIS ONLY`, 빈 폴더에 코드를 **그대로** 떼어 주고, 한 주장을 경로마다 분류하게
   하고, 마지막 줄은 enum, `WRITE … verdict.md and stop`, 대개 `effort: low`. 판정은 준 사실 안에서만 옳다 — 사실을 옮겨
   적지 말고 코드째 준다. 받은 지적은 실측으로 확인한 뒤에만 행동한다(Grok은 자주 옳고, 가끔 틀린 사실 위에서 옳다).
   ⚠️ 이 조리법의 옛 근거 "산문 답만 요구하는 리뷰는 끝나지 않는다"는 2026-09-12에 재현되지 않았다 — 조리법은 쓰되 그 말을
   제품 표면을 바꾸는 법칙으로 인용하지 말 것(`docs/11` "5번 조리법").
6. **preflight** — `.claude/skills/maintainer-preflight`. 7. **PR** — `CONTRIBUTING.md`, CI 2개 green, 오너
   squash-merge, **머지 직후** 태그·릴리스.
8. **결과 검증 + 과정 감사(필수)** — `origin/main`의 내용(트리)을 보고, 배포 번들로 1번 재현을 한 번 더 치고, findings는
   **두 번째 독립 방법**으로 재도출한 뒤에만 행동한다. 그럴듯한 숫자를 더 의심한다. 하네스가 틀린 사실은 CHANGELOG에 남긴다.

- ⚠️ **파일 내용을 셸 명령 문자열 안에서 만들지 말 것** — heredoc, `node -e "…"`, `python - <<PY`, PowerShell
  `Get-Content`→`Set-Content` 왕복 모두. 셸이 역슬래시·백틱·`$`를 먹고, 대개 조용히 0건 치환으로 끝나 성공처럼 보이며,
  나쁠 때는 파일을 깨뜨리거나 명령을 실행한다. 편집은 Edit/Write로, 커밋 메시지는 파일로(`git commit -F`). Edit/Write도
  역슬래시-u 유니코드 이스케이프를 푼다 — 코드는 `String.fromCharCode`, 문서는 이름(U+2028). **증상이 아니라 메커니즘을 금지한다.**
- ⚠️ Git Bash에서 `git show origin/main:.claude/…`는 경로 변환에 먹힌다 — `MSYS_NO_PATHCONV=1`을 붙인다.

## 절대 원칙 (변경 금지)

1. **인증은 서버 레벨 env `GROK_BUILD_AUTH_MODE`(기본 `subscription`, opt-in `api`)로 결정되는 투트랙이다 — 호출별
   오버라이드는 없다.**
   - `subscription`: grok에 넘기는 env에서 `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY`를 항상 제거한다(`env.ts`의
     `buildGrokEnv`). 이유는 세션이 없거나 만료된 순간 env 키가 **폴백 자격증명**이 되어 조용히 종량제로 넘어갈 수 있기
     때문이다 — 키를 지우면 조용히 과금되는 대신 `auth_error`로 명시적으로 실패한다(정책 보장). ⚠️ `grok models`의
     "You are using XAI_API_KEY." 문구는 env 존재만 보고하며 요청 인증과 다르다. 실측 전문 `docs/specs/grok-cli-contract.md` §10.
   - `api`(opt-in): env의 API 키를 그대로 통과시킨다 — `billing: "metered_api"`.
   - 모든 `grok_build_delegate` 응답은 설정된 `mode`와 파생된 `billing`(`billingFor(mode)`, 관측값이 아니다)을 명시한다.
     상세 `docs/02-auth-strategy.md`.
   - ⚠️ 헤드리스 편집에는 `--always-approve`가 필수다(없으면 `stopReason: Cancelled`로 아무 파일도 바꾸지 않는다 — 계약
     §1·§5). grok은 대상 `cwd`(또는 `--worktree` 격리)에서 직접 편집하되 **자동 커밋은 하지 않는다** — Claude/사람이
     diff를 검토한 뒤에만 커밋한다.
2. 인증은 `grok login`(브라우저 OAuth, 사용자가 터미널에서 최초 1회 수동 실행)으로 생기는 `~/.grok/auth.json` 세션 토큰
   또는 env의 API 키에 전적으로 의존한다. 이 플러그인은 자격증명을 저장하거나 대신 로그인하지 않는다.
3. 자동화 실행에는 항상 `--no-auto-update`를 붙인다(헤드리스 업데이트 체크로 인한 행 방지; 헬프에는 없지만 수용된다).
4. MCP 서버는 **자신이 쥔 credential**(env의 API 키, 세션 토큰, `rawStderrTail`)을 로깅하거나 파일에 쓰지 않는다.
   ⚠️ 이 원칙이 덮지 않는 것 — 위임 이력의 프롬프트 미리보기(`~/.grok-build/history.jsonl`의 앞 200자; `history.ts`의
   `redactSecrets`는 완화이지 보장이 아니다)와, 플랫폼별 한도(`promptFitsArgv`)를 넘는 프롬프트의 임시 파일(실행 동안 전문이
   남고, 서버가 도중에 죽으면 남을 수 있다 — A39). 원천 `SECURITY.md`.

## 컴포넌트 지도 — 손대기 전에 알아야 할 것

배치는 `docs/03-plugin-spec.md`, tool 스펙은 `docs/04-mcp-server-spec.md`, 나머지는 소스 주석이 원천이다.
`mcp-server/src/`의 9 tools: `grok_build_delegate` · `grok_build_plan` · `grok_build_verify` · `grok_build_route` ·
`grok_build_worktree` · `grok_build_usage` · `grok_build_status` · `grok_auth_check` · `grok_cli`. `hooks/hooks.json` +
`src/hook-entry.ts` → `dist/hook.js`(PreToolUse 인증 게이트). `.claude/tools/`는 **엔드유저 디스크에 그대로 내려간다**
(마켓플레이스 소스가 `./`).

- `server.ts` — 핸들러를 `main()` 안 익명 클로저로 되돌리지 말 것(호출이 불가능해지면 `isError` 계약을 뒤집어도 전
  스위트가 녹색이다).
- `env.ts`·`server.ts` — grok은 이 플러그인을 워커 안에 다시 로드한다(계약 §14). grok을 `buildGrokEnv` 밖에서 띄우지 말 것
  (`GROK_BUILD_WORKER`와 `insideWorker`가 그 사본을 거절시킨다; 전제는 `probe:contract`의 `workerMarker`가 감시). 홈은
  `grokHomeFor(env, 실행 폴더)`로 묻는다(A35·A36; 점·공백 정규화는 `npm run probe:home`으로 잰다).
- `config-keys.ts` — grok의 `config.toml`을 새 의존성 없이 직접 읽어 `billingCaveat`를 만든다. 모든 위임 spawn 전에 동기로
  돈다 — 정규 파일 확인·크기 상한을 빼지 말 것. 판독기를 고치면 독립 파서 차등 비교를 다시 돌린다.
- `prompt-flags.ts` — 리프 모듈이어야 한다(hook이 import해도 위임 엔진이 `dist/hook.js`로 딸려 들어가지 않게).
- `delegate.ts` — `AUTH_ERROR_SIGNALS`의 `invalid or expired credentials`를 지우지 말 것(지우면 정반대 안내가 나간다);
  `bestOfN` 거부는 `accept-release.mjs`의 쿼터 0 보증을 떠받친다; `--prompt-file`의 `finally` 삭제와 `readExactly`의
  비차단 열기를 되돌리지 말 것. `committed`는 grok이 실행된 모든 결말에 싣고, 실행 전에 알 수 있는 폴더(요청 폴더,
  찾은 resume 세션 폴더)에서 잰다 — 폴더를 실행 전에 모르면(세션을 못 찾은 resume, 요청 폴더로 밝혀지지 않은 continue)
  `false`를 쓰지 않을 뿐 그곳의 커밋을 찾지는 않는다. 커밋 안내는 움직인 폴더와 이전 커밋을 이름으로, 폴더는 `shellDir`로
  (작은따옴표) 말한다 — 폴더 없는 `git reset`은 사용자 커밋을 되돌렸고, 큰따옴표 안의 `$`·백틱은 다른 폴더를 가리켰다(A49).
- `history.ts` — `redactSecrets`는 모든 위임의 프롬프트 전문에 돈다: 선형이어야 하고, 바닥은 v0.2.35의 파이프라인이다 —
  `redact-floor.test.ts`의 얼린 사본을 고쳐 통과시키지 말 것. 새 규칙은 더 가리기만 한다.
- `worktree.ts` — 삭제는 baseDir 하위만, 브랜치는 래퍼가 만든 이름만. `version.ts` — 하드코딩 폴백 리터럴도 같이 범프.
  `build.mjs` — 번들 2개(`dist/index.js`·`dist/hook.js`) 모두 커밋 대상. `scripts/check-release-tag.mjs` — schedule/dispatch 전용.
- `agents/grok-worker.md` — 도구 제한은 grok 도구를 **이름으로** 적은 허용 목록이다: 서버 단위 패턴(`mcp__plugin_grok_grok-build`)은
  아무것도 풀지 못해 워커가 grok 도구를 잃었고, 거부 목록은 셸·다른 MCP 도구를 남겼다(둘 다 실측 — `plugin-surface.test.ts`가
  등록된 도구와 대조한다). 서버에 도구를 더하면 이 목록도 정한다.

## 개발 명령

사용자가 사전에 수동으로 할 것(grok 설치 → `grok login` → 스모크)은 `docs/08-getting-started-with-grok.md`와 README가 원천.
`mcp-server/` 안에서: `npm test` · `npm run typecheck` · `npm run build` · `npm run probe:contract`(쿼터 0).
⚠️ 의존성 버전은 이 문서에 적지 않는다 — floor는 `package.json`, 해석값은 `package-lock.json`. `test/claude-md-claims.test.ts`가
floor 재등장 금지와, 이 문서와 `docs/11`이 이름 대는 경로·식별자·npm 스크립트·tool의 실재를 확인한다 — **이름만** 본다.
설명이 맞는지는 사람이 소스와 대조해야 한다.

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
| `docs/10-service-audit-queue.md` | 열린 결함 큐 · 측정 불가 항목 · 재현 방법 (**건수는 그 문서가 원천** — 여기 적으면 낡는다) |
| `docs/11-maintainer-playbook.md` | 이 파일에서 옮긴 상세 — 결함 고치는 절차의 근거, 8번 검증·감사, Grok 리뷰 조리법, 함정의 근거와 이력 |

## 이 프로젝트가 속한 더 큰 그림

별도로 설계 중인 **멀티에이전트 오케스트레이터**의 한 축으로 편입될 예정이다 — Grok Build는 "병렬 탐색/저비용 반복
작업" 워커로, Claude와의 작업 분배 기준은 `docs/05-routing-policy.md`, 연동 계약은 `docs/07-orchestrator-integration.md`.

## 코딩 컨벤션

- MCP 서버: TypeScript, Node.js. `@modelcontextprotocol/sdk` 사용.
- 서브프로세스 실행은 `spawn` 사용, `exec`/`execSync`로 셸 인젝션 위험 있는 문자열
  조립 금지 — 프롬프트는 반드시 인자 배열로 전달.
- 모든 tool 응답은 구조화된 JSON을 텍스트로 요약해서 반환 (grok의 raw stdout을
  그대로 Claude에게 넘기지 않는다 — 토큰 낭비 및 파싱 부담).

## Gotchas

각 항목은 함정의 존재만 말한다. 근거와 재현은 `docs/11`과 가리키는 문서·소스 주석에 있다.

- 플랫폼: 1차 지원은 Linux/macOS지만 **네이티브 Windows에서 핵심 경로가 실측 동작한다.** POSIX 경로·셸을 하드코딩하지
  말 것(`homedir()`/`join`/`delimiter` + `process.platform` 분기; `~/.grok/…`은 홈 축약 표기일 뿐). ⚠️ `--sandbox`의 커널
  강제는 Linux/macOS만 가정하고, win32의 timeout 캡은 손자 프로세스를 보장 정리하지 않는다(`killTree`는 grok만 죽인다) —
  `docs/06-roadmap.md` "플랫폼 지원 (실측)". ⚠️ CI의 Windows 러너 TEMP는 8.3 짧은 이름이다 — 경로를 비교하는 테스트는
  `realpathSync.native`로.
- `git status --porcelain`은 `-z` + `core.quotepath=false`로 파싱한다(`parsePorcelain`). `filesChanged`는 spawn 전후
  차집합이라 이미 dirty인 경로는 under-report될 수 있다 — 정밀 귀속은 `worktree: true`.
- `best_of_n`은 CLI 1.0에서 삭제됐고 값이 있으면 **spawn 없이** 거절된다 — 죽은 코드가 아니다(쿼터 0 보증). worktree
  apply는 untracked를 포함하고, timeout→auth 재분류는 stderr device-flow만 본다(stdout의 `grok login`은 오탐).
- `.claude-plugin/plugin.json`·`.mcp.json`·`agents/*.md` 프런트매터는 **Claude Code가 소유한 스키마**라 버전마다 바뀔 수
  있다 — 손대기 전에 공식 레퍼런스로 재검증하고, 고치면 `docs/03-plugin-spec.md`의 예시도 맞춘다.
- ⚠️ 이 레포에서 세션을 열면 `grok-build` MCP가 `CONNECTION_CLOSED`로 뜬다 — 정상이다(`${CLAUDE_PLUGIN_ROOT}` 치환은 플러그인
  로더만 한다). `${VAR:-기본값}`으로 "고치지" 말 것 — 실측했고, 엔드유저가 세션 cwd에서 서버를 띄우게 된다. 세션에서는
  `plugin:grok:grok-build`를 쓰고, 배포 번들 채점은 `.claude/tools/mcpcall.mjs`로 한다.
- ⚠️ **CRITICAL — `hooks/hooks.json`은 `{ "hooks": { "PreToolUse": [...] } }` 형태여야 한다.** 최상위에 `PreToolUse`를 두면
  플러그인이 **로드 실패**하고 **슬래시 커맨드가 전부 사라진다**(회귀 방지 `test/hooks-contract.test.ts`).
- ⚠️ `npm i --no-save`는 런타임 의존성을 올릴 수 있고 esbuild가 그것을 번들에 인라인한다 — 했으면 **반드시 `npm ci` 후에
  빌드**한다. `npm install`·`npm update`는 npm 10.9.3에서 죽는다 — `npx npm@11 install …`로 우회하되 런타임 의존성 전후
  대조가 필수다.
- **번들 2개(`dist/index.js`·`dist/hook.js`)는 커밋 대상이다** — 플러그인은 설치 시점에 빌드하지 않으므로 `src/` 변경 뒤
  빌드를 빠뜨리면 소스보다 뒤처진 번들이 배포된다.
