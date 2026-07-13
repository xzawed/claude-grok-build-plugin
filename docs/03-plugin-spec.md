# 03. 플러그인 스펙

## 디렉토리 구조 (구현 목표)

```
claude-grok-build-plugin/
├── .claude-plugin/
│   ├── plugin.json          # name: "grok"
│   └── marketplace.json     # grok-marketplace (4단계 설치)
├── .mcp.json
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── build.mjs             # esbuild 번들러 (src → dist/index.js + dist/hook.js 자립 번들)
│   ├── src/
│   │   ├── index.ts           # MCP 서버 엔트리포인트
│   │   ├── env.ts             # buildGrokEnv() — API 키 제거 + grok bin PATH prepend
│   │   ├── auth.ts            # 인증 상태 확인 (checkAuth, GROK_NOT_INSTALLED_MESSAGE)
│   │   ├── config.ts          # resolveAuthMode() — GROK_BUILD_AUTH_MODE 해석
│   │   ├── grok-result.ts      # parseGrokResult() — --output-format json 파싱
│   │   ├── delegate.ts        # grok subprocess 실행 + 결과/변경파일(parsePorcelain) 도출
│   │   ├── worktree.ts        # createGrokWorktree() — 래퍼 관리 격리 worktree
│   │   ├── history.ts         # recordDelegation() — ~/.grok-build/history.jsonl 이력 로깅
│   │   ├── usage.ts           # readHistory()+summarizeHistory() — 사용량 요약
│   │   ├── hook.ts            # PreToolUse hook 순수 로직 (resolveHookMode/decideHook/runHook)
│   │   ├── hook-entry.ts      # hook 실행 진입점 (실제 stdin/stdout/deps) → dist/hook.js
│   │   ├── grok-cli.ts        # runGrokCli() — 빌링 안전 임의 grok 서브커맨드 (비-헤드리스 denylist, timeout)
│   │   └── types.ts
│   ├── test/                  # vitest 유닛 테스트 (109개)
│   └── dist/
│       ├── index.js           # ⚠️ 커밋되는 자립 번들 (MCP 서버) — 아래 "패키징" 참고
│       └── hook.js            # ⚠️ 커밋되는 자립 번들 (PreToolUse hook)
├── commands/                # /grok:* 슬래시 커맨드 (짧은 동사형)
│   ├── setup.md  delegate.md  plan.md  verify.md  usage.md  cli.md
│   └── …                    # 유틸 동사: sessions/export/import/memory/inspect/models/
│                            #   mcp/worktree/login/logout/update/version/trace (grok_cli)
└── hooks/
    └── hooks.json          # 기본 로드 파일명 (고정) — pre-delegate-auth-check
```

> `.claude-plugin/`에는 `plugin.json`과 `marketplace.json`이 위치한다. 다른 모든
> 컴포넌트(`commands/`, `hooks/`, `.mcp.json` 등)는 플러그인 **루트**에 둔다.
>
> 기본 경로의 컴포넌트는 **자동 발견**된다 — `commands/*.md`, `hooks/hooks.json`,
> `.mcp.json`은 manifest에 선언하지 않아도 로드된다. 기본 파일명은 고정이므로 훅은
> 반드시 `hooks/hooks.json`이어야 한다. 기본 경로를 벗어날 때만 manifest의 top-level
> `commands`/`hooks`/`mcpServers` 필드로 `./`-상대경로를 지정한다.

## `.claude-plugin/plugin.json` (초안)

```json
{
  "name": "grok",
  "version": "0.1.0",
  "description": "Grok Build CLI에 코딩 작업을 위임하는 MCP 브리지",
  "author": { "name": "xzawed" }
}
```

공식 스키마(`code.claude.com/docs/en/plugins-reference`)에 맞춘 형태다. `components`
같은 래퍼 필드는 스키마에 없으므로 넣지 않는다 — 기본 경로 컴포넌트는 자동 발견된다.
`author`는 문자열이 아니라 객체(`{ "name", "email", "url" }`)다. **`name`이 `grok`이므로
커맨드 네임스페이스는 `/grok:*`이고 스코프 툴명은 `mcp__plugin_grok_grok-build__…`이 된다**
(hook matcher·마켓플레이스 install 문자열과 함께 바뀜). 버전마다 필드가 바뀔 수 있으니
구현 직전 설치 버전 레퍼런스로 재확인할 것.

## `.claude-plugin/marketplace.json` (마켓플레이스 + 4단계 설치)

이 저장소는 자기 자신을 마켓플레이스로도 노출한다(`name: "grok-marketplace"`,
`owner`, `plugins[].source: "./"`). 엔드유저 설치는 4단계다(OpenAI codex-plugin 스타일):

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
/grok:setup
```

`grok`(플러그인)·`grok-marketplace`(마켓플레이스) 이름이 install 문자열
(`grok@grok-marketplace`)과 커맨드 네임스페이스(`/grok:*`)를 함께 결정하므로 세 이름은
같이 바뀌어야 한다. grok CLI 자체 설치(`curl … x.ai/cli/install.sh`)와 `grok login`은
여전히 사용자가 직접 하며, `/grok:setup`이 설치·로그인 여부를 확인·안내만 한다.

## `.mcp.json` (초안)

```json
{
  "mcpServers": {
    "grok-build": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"]
    }
  }
}
```

번들 경로는 반드시 `${CLAUDE_PLUGIN_ROOT}`로 참조한다 — bare 상대경로는 설치 디렉토리가
아니라 런타임 cwd 기준으로 풀려 마켓플레이스 설치 후 깨진다. 플러그인이 활성화되면 이
MCP 서버가 자동 기동하고 per-server 승인 절차를 거친다 (프로젝트 `.mcp.json`과 동일한
신뢰 모델).

## 패키징 (자립 번들 — 필수)

Claude Code 플러그인 설치 시 MCP 서버 서브디렉토리에 대해 `npm install`/빌드가 **자동
실행되지 않는다.** `.mcp.json`이 `dist/index.js`를 실행하므로, 그 파일과 의존성
(`@modelcontextprotocol/sdk`, `zod`)이 배포에 실제로 존재해야 한다.

- `node_modules/`와 `dist/`는 원칙적으로 gitignore 대상이라, 소스만 커밋하면 설치
  사용자 환경엔 `dist/index.js`도 `node_modules`도 없어 `node dist/index.js`가
  `ERR_MODULE_NOT_FOUND`으로 **서버가 아예 기동하지 못한다.**
- 해결: `build.mjs`가 **esbuild로 두 진입점(`src/index.ts` → `dist/index.js` MCP 서버,
  `src/hook-entry.ts` → `dist/hook.js` PreToolUse hook)과 모든 의존성을 각각 단일 ESM
  파일로 번들**한다(`npm run build`). `.gitignore`는 그 두 파일만 예외로 두어 커밋한다
  (`mcp-server/dist/*` 무시 + `!mcp-server/dist/index.js` + `!mcp-server/dist/hook.js`).
  따라서 설치 사용자는 빌드/설치 없이 번들만으로 기동한다.
- ⚠️ **`dist/index.js`·`dist/hook.js`는 커밋되는 빌드 산출물이다.** `src/`를 변경하면
  커밋 전 반드시 `npm run build`로 두 번들을 재생성해야 소스와 어긋나지 않는다.
  `npm run typecheck`(`tsc --noEmit`)는 타입 검사만 하고 산출물을 내지 않는다.
- 검증: 번들을 `node_modules`가 없는 디렉토리에 복사해 실행하면 MCP `initialize` +
  `tools/list`가 정상 응답해야 한다(자립성 확인).

## 슬래시 커맨드

플러그인명이 `grok`이라 커맨드는 `/grok:<command>`로 네임스페이싱된다(Claude Code가
플러그인명에서 접두어를 도출). 커맨드 파일은 `commands/<verb>.md`(짧은 동사형)다.
사용자용 전체 표는 README 참고.

### 위임/온보딩 (delegate·plan·verify·usage tool)
- `/grok:setup` — grok 설치·로그인 확인 및 설정 안내(온보딩; 구 check-auth 흡수).
- `/grok:delegate "<작업 설명>"` — `grok_auth_check` 선행 → 성공 시 `grok_build_delegate`
  호출, 결과를 대화에 표시.
- `/grok:plan "<작업>"` — 읽기전용 계획 미리보기(`grok_build_plan`, 편집 없음).
- `/grok:verify "<작업>"` — 위임 + grok 자기검증(`grok_build_verify`, `--check`).
- `/grok:usage` — 위임 이력(`~/.grok-build/history.jsonl`) 기반 읽기전용 사용량 요약
  (`grok_build_usage`; mode/billing/status/plan/check/worktree/files/recent 집계).

### 유틸/passthrough (`grok_cli` tool 경유)
- `/grok:sessions`·`export`·`import`·`memory`·`inspect`·`models`·`mcp`·`worktree`·
  `login`(헤드리스 device-auth)·`logout`·`update`·`version`·`trace` — 각 grok
  서브커맨드를 빌링 안전 env로 실행.
- `/grok:cli "<raw grok args>"` — 임의 grok 서브커맨드 passthrough.
- ⚠️ 비-헤드리스 모드(`dashboard`·`agent`·`leader`·`completions`·`wrap`, 대화형 login)는
  커맨드로 노출하지 않는다 — `grok_cli`가 spawn 없이 "터미널에서 직접 실행" 메시지를 반환.

## Hook

### `pre-delegate-auth-check` (`hooks/hooks.json`에 정의) — 구현 완료 (Phase 2)

- **이벤트:** PreToolUse. **matcher(정규식 alternation):**
  `mcp__plugin_grok_grok-build__grok_build_(delegate|plan|verify)`
  — grok을 실제로 spawn하고 인증이 필요한 세 tool만 게이트. `grok_build_usage`(읽기전용)·
  `grok_auth_check`(그 자체가 체크)는 제외. 스코프 툴명 형식은 `mcp__plugin_<플러그인명>_<서버명>__<툴명>`.
- **명령:** `node "${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/hook.js"` (자립 번들).
- **동작 — hook·서버가 동일 관측하는 신호로만 차단(오차단 0):** hook은 MCP 서버와 **별도
  프로세스**라 `.mcp.json` env 블록(`GROK_BUILD_AUTH_MODE`·`XAI_API_KEY` 등)을 **보지 못한다**.
  그래서 hook과 서버가 **동일하게 관측하는 신호**로만 deny한다:
  - `grok` 미설치 → **deny**(모드 무관·양쪽 동일 PATH probe·항상 옳음).
  - `GROK_BUILD_AUTH_MODE=subscription`(명시적) → `~/.grok/auth.json`은 **파일**이라 양쪽이 동일
    관측 → 부재 시 **deny**(서버와 동일한 한글 메시지).
  - `api`·미설정(unknown) → **allow**, auth 상태는 서버 내부 `checkAuth`에 위임. (api 키는 서버
    전용 `.mcp.json` env에 있을 수 있어 hook이 확인 불가 → 여기서 deny하면 정상 위임을 오차단.)
- **차단 방식:** exit 0 + stdout에 `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"deny","permissionDecisionReason":"<메시지>"}}`. 에러 시 **fail-open**(allow).
- **역할:** 서버 내부 `checkAuth`(`index.ts`)의 harness 레벨 **이중화**. 구현: `src/hook.ts`
  (순수 로직, DI 테스트)/`src/hook-entry.ts`(실행). 설계: `docs/specs/2026-07-13-pre-delegate-auth-check-hook-design.md`.

> ⚠️ hooks.json 스키마·매처 발화·스코프 툴명·`permissionDecision`는 버전 민감 — 설치한
> Claude Code 버전에서 실측 검증할 것(`CLAUDE.md` 플러그인-스키마 gotcha 참고).
