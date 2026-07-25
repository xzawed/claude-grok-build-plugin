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
하는 MCP 서버 래퍼. 과금은 **API 종량제가 아니라 사용자의 xAI 구독(SuperGrok / X Premium+)**을
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
| `docs/specs/`, `docs/plans/` | 결정 근거·구현 서사 |

같은 사실을 여러 문서에 복사하지 않는다 — 원천 하나를 고치고 나머지는 포인터. 전역 규칙과 동일.

## 현재 상태 (먼저 읽을 것)

- **이 레포 제품 범위 완료 (v0.2.4).** Phase 1~5 + 신뢰 게이트. 유닛 **197** (`npm test`).
  MCP 9 tools: auth, status, delegate, plan, verify, usage, worktree, route, cli.
- **표면:** route/`nextAction`, status(+`billingMismatch`), review/resume, first-mile,
  consumer kit (`examples/orchestrator-consumer.md`), hook e2e + tool-surface CI.
- **다음 코딩 (이 레포):** **없음** — 사용자가 목표를 주기 전 polish PR 금지.
- **레포 밖/수동/보류:** 외부 오케스트레이터 실배선(소비자) · GUI 클릭 수동 수락 · ACP 보류.
  분류·이유·수동 체크리스트: **`docs/09-scope-and-residuals.md`**.
- 비전: `docs/00-product-vision.md` · Phase 표: `docs/06-roadmap.md`.

## 절대 원칙 (변경 금지)

1. **인증은 서버 레벨 env `GROK_BUILD_AUTH_MODE`(기본 `subscription`, opt-in `api`)로
   결정되는 투트랙이며, 모드에 따라 API 키 env 처리가 갈린다 — 호출별 오버라이드는
   없다.**
   - `subscription`(기본, 미설정 시): grok 프로세스에 넘기는 env에서
     `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY`를 항상 제거한다(`env.ts`의
     `buildGrokEnv`). grok CLI는 API 키가 세션 토큰보다 우선순위가 높으므로,
     env에 키가 하나라도 섞여 있으면 구독이 아니라 API 종량제로 과금이 샌다.
   - `api`(opt-in, `GROK_BUILD_AUTH_MODE=api`일 때만): env의 API 키를 그대로
     통과시킨다 — 종량제(`billing: "metered_api"`)로 명시적으로 청구된다.
   - 모든 `grok_build_delegate` 응답은 실제 실행된 `mode`·`billing`을 명시해
     투명성을 보장한다. 상세: `docs/02-auth-strategy.md`.
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
4. MCP 서버는 credential을 로깅하거나 파일에 쓰지 않는다. API 모드에서도 키를
   저장하지 않고 env에서 읽어 통과만 시킨다.

## 컴포넌트 지도

Phase 1 구현 완료. 상세 배치는 `docs/03-plugin-spec.md` 참조.

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
    grok subprocess 실행 → `stopReason === "EndTurn"`으로 성공 판정. 실패도 세분
    (spawn 시작 실패/timeout/auth_error/grok_error)하고 중단 시에도 부분편집을
    `filesChanged`로 노출. **auth 만료 실측 신호**: grok은 만료 시 device-OAuth 플로우를
    stderr로 내고 블록 → timeout이 되므로, timed-out 런의 device-flow 마커(`DEVICE_AUTH_SIGNALS`)를
    `auth_error`로 분류(`grok login` 안내). 상세: `docs/specs/grok-cli-contract.md §7`. 변경 파일은 `parsePorcelain`(`git status --porcelain -z`,
    비동기)으로 도출, 결과에 `mode`·`billing` 부착. DI(`spawn`/`gitChangedFiles`/
    `dirExists`/`env`)로 테스트 가능.
  - `history.ts` — `recordDelegation`: 위임 이력을 `~/.grok-build/history.jsonl`에
    JSONL로 기록(provenance, 자격증명 제외, cwd 비오염, 실패해도 위임 무영향).
    `index.ts`가 `runDelegate` 후 호출.
  - `worktree.ts` — `createGrokWorktree` + list/diff/apply/remove 라이프사이클
    (`grok_build_worktree`). apply는 uncommitted patch·무커밋; remove는 baseDir 하위만.
  - `usage.ts` — `readHistory`+`summarizeHistory`(+`insights`): 집계 및 성공률/구독 비중
    헤드라인. `grok_build_usage` tool.
  - `hook.ts` — `pre-delegate-auth-check` PreToolUse hook 순수 로직: `resolveHookMode`
    (미설정/모호→`unknown`, throw 안 함), `decideHook`(**hook·서버가 동일 관측하는 신호로만
    deny** — grok 미설치는 항상, subscription은 `~/.grok/auth.json` 부재 시; api·unknown은
    키가 서버 전용 `.mcp.json` env에 있을 수 있어 서버에 위임 → 오차단 방지. `checkAuth` 재사용),
    `runHook`(IO DI, 에러 fail-open). 서버 내부 `checkAuth`의 하네스 레벨 이중화.
  - `hook-entry.ts` — hook 실행 진입점(실제 stdin/stdout/env/`defaultAuthDeps` → `runHook`).
    esbuild가 `dist/hook.js`로 번들, `hooks/hooks.json`이 실행.
  - `grok-cli.ts` — `runGrokCli`: 빌링 안전 env(`buildGrokEnv(mode)` — subscription은
    `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 제거 + PATH prepend)로 임의 grok 서브커맨드를
    실행. 비-헤드리스 denylist(`dashboard`/`agent`/`leader`/`completions`/`wrap` + 대화형
    login)는 spawn 없이 "터미널에서 실행" 메시지를 반환(행 방지), timeout(기본 60초), 실행
    `mode`/`billing` 보고. `/grok:*` 유틸 커맨드 + `/grok:cli` passthrough의 구동부.
  - `routing.ts` — `routeTask` / `inferSignalsFromTask` (LOW·MEDIUM·HIGH, 순수 함수).
  - `index.ts` — auth·delegate·plan·verify·usage·worktree·**route**·cli 등록/기동.
  - `types.ts` — 공유 타입(`AuthMode`, `Billing`, `DelegateResult` 등).
  - `build.mjs` — esbuild 번들러(`src/index.ts`→`dist/index.js`, `src/hook-entry.ts`→
    `dist/hook.js` 자립 번들 2개).
  - `test/` — 유닛 테스트 (vitest; 현재 수치는 `npm test`).
- `commands/` — `/grok:*`: setup/**tour**/delegate/plan/verify/usage/worktree/route/tests/migrate/boilerplate
  + 유틸 + `cli`. worktree→`grok_build_worktree`, route→`grok_build_route`.
- `skills/` — `grok-routing`, `grok-first-mile` (엔드유저 세션).
- `agents/grok-worker.md` — 볼륨 작업 서브에이전트.
- `hooks/hooks.json` — `pre-delegate-auth-check` PreToolUse hook 정의 (matcher:
  `mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)` → `node dist/hook.js`).
  위임 이력 로깅은 hook이 아니라 서버 내부(`history.ts`)에서 수행. 상세:
  `docs/03-plugin-spec.md` "Hook".
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
  subscription)·`--worktree` 격리까지 통과. **1차 테스트/지원 플랫폼은 여전히 Linux/macOS**이고
  `--sandbox`·PreToolUse hook은 Windows 미검증이다(`docs/06-roadmap.md` "플랫폼 지원 (실측)" 참고).
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
- **`best_of_n` 상한 4**, 잘못된 model/effort/resume 토큰은 spawn 없이 `grok_error` —
  안정성·주입 방어. best-of-n 시 호출자가 `timeout_ms`를 충분히 줘야 한다.
- **worktree apply**는 untracked 포함(`add -A` → `diff --cached` → cwd `apply`, worktree
  `reset`). timeout→auth는 **stderr device-flow만** (stdout `grok login` 오탐 금지).
