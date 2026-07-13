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

## 현재 상태 (먼저 읽을 것)

- **Phase 1~3 + Phase 2 `pre-delegate-auth-check` hook 구현 완료.** `mcp-server/`
  (TypeScript, ESM)가 `grok_auth_check`·`grok_build_delegate`(worktree/sandbox 격리
  포함)·`grok_build_plan`·`grok_build_verify`·`grok_build_usage` **다섯 MCP tool**과
  **PreToolUse 인증 hook**을 구현한다. 유닛 테스트
  88개가 통과한다(`config` 5, `env` 3, `grok-result` 4, `auth` 9, `delegate` 28,
  `history` 12, `usage` 8, `worktree` 2, `hook` 16, `smoke` 1). `.claude-plugin/plugin.json`, `.mcp.json`, `commands/*.md`, `hooks/hooks.json`도 존재한다
  (아래 "컴포넌트 지도" 참고).
- **패키징:** `mcp-server/dist/index.js`(MCP 서버)와 `mcp-server/dist/hook.js`(PreToolUse
  hook)는 esbuild로 의존성을 인라인한 **자립 번들**을 커밋한다(엔드유저는 빌드/`node_modules`
  없이 기동). `src/` 변경 시 커밋 전 `npm run build`로 두 번들 재생성 필수. 상세:
  `docs/03-plugin-spec.md` "패키징".
- grok CLI 헤드리스 계약은 실측으로 확정됐다 — `docs/specs/grok-cli-contract.md` 참고.
  이전 가정(`streaming-json`, `--always-approve` 기본 미사용)은 틀렸던 것으로 정정됨:
  실제로는 `--output-format json` + `--always-approve` **필수** + `stopReason` 기반
  성공 판정을 쓴다 (아래 절대 원칙 #1, `docs/01-architecture.md` 참고).
- **완료 현황:** Phase 2(이력 로깅 `history.ts`, `pre-delegate-auth-check` hook
  `hook.ts`/`hook-entry.ts`) + Phase 3(worktree/sandbox 격리, plan 미리보기, verify
  자기검증, usage 요약) 모두 구현·병합됨. **다음 할 일:** `docs/06-roadmap.md`의 미완 항목 —
  실제 auth 만료 문구 확보 후 신호 정밀화, PATH prepend, Phase 4(오케스트레이터 통합·ACP).
  그 외 dev 툴체인 유지보수(vitest 2→4 수동 업그레이드 — dev 전용·breaking, 프로덕션
  audit는 클린; 저장소에 dependabot 미설정이라 자동 PR 아님)는 별도 항목.

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
  - `env.ts` — `buildGrokEnv(mode, env)`: subscription이면 API 키 제거, api면 그대로 통과.
  - `grok-result.ts` — `parseGrokResult(stdout)`: `--output-format json` 단일 객체
    파싱 (`text`, `stopReason`).
  - `auth.ts` — `checkAuth(mode, deps)`: 모드별 분기(`grok_not_installed` /
    `not_logged_in` / `no_api_key`).
  - `delegate.ts` — `runDelegate(mode, input, deps)`: cwd(절대경로·존재) 검증 →
    grok subprocess 실행 → `stopReason === "EndTurn"`으로 성공 판정. 실패도 세분
    (spawn 시작 실패/timeout/auth_error/grok_error)하고 중단 시에도 부분편집을
    `filesChanged`로 노출. 변경 파일은 `parsePorcelain`(`git status --porcelain -z`,
    비동기)으로 도출, 결과에 `mode`·`billing` 부착. DI(`spawn`/`gitChangedFiles`/
    `dirExists`/`env`)로 테스트 가능.
  - `history.ts` — `recordDelegation`: 위임 이력을 `~/.grok-build/history.jsonl`에
    JSONL로 기록(provenance, 자격증명 제외, cwd 비오염, 실패해도 위임 무영향).
    `index.ts`가 `runDelegate` 후 호출.
  - `worktree.ts` — `createGrokWorktree`: cwd의 HEAD 기준 격리 git worktree 생성
    (위험 작업 격리 + filesChanged 정밀 귀속). grok `--worktree`는 헤드리스 미동작이라
    래퍼가 직접 관리하고 grok `--cwd`를 worktree로 가리킨다.
  - `usage.ts` — `readHistory`+`summarizeHistory`: `~/.grok-build/history.jsonl` 집계
    (읽기전용 사용량 요약: mode/billing/status/plan/check/worktree/files/recent).
    `grok_build_usage` tool이 사용.
  - `hook.ts` — `pre-delegate-auth-check` PreToolUse hook 순수 로직: `resolveHookMode`
    (미설정/모호→`unknown`, throw 안 함), `decideHook`(**hook·서버가 동일 관측하는 신호로만
    deny** — grok 미설치는 항상, subscription은 `~/.grok/auth.json` 부재 시; api·unknown은
    키가 서버 전용 `.mcp.json` env에 있을 수 있어 서버에 위임 → 오차단 방지. `checkAuth` 재사용),
    `runHook`(IO DI, 에러 fail-open). 서버 내부 `checkAuth`의 하네스 레벨 이중화.
  - `hook-entry.ts` — hook 실행 진입점(실제 stdin/stdout/env/`defaultAuthDeps` → `runHook`).
    esbuild가 `dist/hook.js`로 번들, `hooks/hooks.json`이 실행.
  - `index.ts` — `grok_auth_check`·`grok_build_delegate`·`grok_build_plan`·
    `grok_build_verify`·`grok_build_usage` MCP tool 등록/서버 기동.
  - `types.ts` — 공유 타입(`AuthMode`, `Billing`, `DelegateResult` 등).
  - `build.mjs` — esbuild 번들러(`src/index.ts`→`dist/index.js`, `src/hook-entry.ts`→
    `dist/hook.js` 자립 번들 2개).
  - `test/` — 유닛 테스트 88개 (vitest).
- `commands/` — 슬래시 커맨드 (`grok-build-delegate.md`, `grok-build-check-auth.md`,
  `grok-build-usage.md`).
- `hooks/hooks.json` — `pre-delegate-auth-check` PreToolUse hook 정의 (matcher:
  delegate|plan|verify → `node dist/hook.js`). 위임 이력 로깅은 hook이 아니라 서버
  내부(`history.ts`)에서 수행. 상세: `docs/03-plugin-spec.md` "Hook".
- `.claude-plugin/plugin.json` — 플러그인 매니페스트 (이 폴더에는 `plugin.json`만 둔다).
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
npm test             # vitest run (유닛 테스트 88개)
npm run typecheck    # tsc --noEmit (타입 검사만, 산출물 없음)
```

> ⚠️ `dist/index.js`·`dist/hook.js`는 커밋되는 빌드 산출물이다 — `src/` 변경 후에는 커밋 전
> 반드시 `npm run build`로 두 번들을 재생성해야 소스와 어긋나지 않는다. SDK는 실측 `1.29.0`
> (`package.json` floor `^1.29.0`, zod `^3.25.0`).

## 설계 문서 인덱스

| 문서 | 내용 |
|---|---|
| `docs/01-architecture.md` | 전체 아키텍처, Claude ↔ MCP 서버 ↔ grok CLI 흐름 |
| `docs/02-auth-strategy.md` | 투트랙 인증 전략(구독 기본 + API opt-in), env 정제, 만료 처리 |
| `docs/03-plugin-spec.md` | 플러그인 디렉토리 구조, manifest 필드 |
| `docs/04-mcp-server-spec.md` | MCP tool 정의 (요청/응답 스키마) |
| `docs/05-routing-policy.md` | 어떤 작업을 Grok Build에 위임할지 판단 기준 |
| `docs/06-roadmap.md` | 구현 단계 (Phase 1~4) |

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

- **타깃 OS는 Linux/macOS인데 현재 개발 환경은 Windows다.** `docs/06-roadmap.md`는
  Windows 네이티브 지원을 스코프에서 제외한다. 따라서 이 저장소에서 코드를 작성할 때는
  플랫폼 차이를 주의: 인증 파일 경로가 `~/.grok/auth.json`(POSIX)이지 Windows의
  `%USERPROFILE%\.grok\auth.json`이 아님, `which grok` 대신 `command -v` 사용,
  경로/셸 가정 등. 실제 검증은 Linux/macOS 기준.
- **설계 문서는 `docs/` 안에 있다.** (초기에 저장소 루트에 흩어져 있었으나 `docs/`로
  이동함. CLAUDE.md·README의 모든 `docs/...` 링크는 이제 정상 동작.)
- `.claude-plugin/plugin.json`·`.mcp.json`은 `docs/03-plugin-spec.md`의 초안대로
  실제 구현됐다. 두 파일을 고칠 때는 문서 예시도 함께 갱신해 어긋나지 않게 할 것
  (버전마다 공식 스키마 필드가 바뀔 수 있으니 변경 전 공식 레퍼런스로 재검증).
- **플러그인은 MCP 서버 서브디렉토리에 `npm install`/빌드를 자동 실행하지 않는다.**
  따라서 `dist/index.js`(esbuild 자립 번들)를 커밋해야 엔드유저 환경에서 서버가 뜬다
  (`node_modules`·`dist/`는 gitignore, `!mcp-server/dist/index.js`만 예외). `src/`를
  고치면 커밋 전 `npm run build` 필수 — 안 하면 번들이 소스보다 뒤처져 배포된다.
- **`git status --porcelain`은 `-z` + `core.quotepath=false`로 파싱한다**(`parsePorcelain`).
  기본 포맷은 리네임을 `old -> new`로, 비ASCII를 octal 이스케이프로 내보내 파싱이 깨진다.
- **`filesChanged`는 cwd 워킹트리 전체의 미커밋 변경을 보고**하므로 위임 전 dirty였던
  파일까지 포함될 수 있다(안전 방향의 과다보고 — grok 편집 누락보다 안전). 정밀 귀속은
  Phase 3의 래퍼 관리 `--worktree` 격리(`worktree.ts`)로 해결됨 — 격리 실행 시 그 worktree
  전체가 grok 변경이므로 `filesChanged`가 정밀하게 귀속된다(기본은 cwd 직접 편집이라 여전히
  과다보고 가능).
