# 03. 플러그인 스펙

## 디렉토리 구조 (구현 목표)

```
claude-grok-build-plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # MCP 서버 엔트리포인트
│       ├── env.ts             # buildGrokEnv() — API 키 제거 로직
│       ├── auth.ts            # 인증 상태 확인
│       ├── delegate.ts        # grok subprocess 실행 + streaming-json 파싱
│       └── types.ts
├── commands/
│   ├── grok-build-delegate.md
│   └── grok-build-check-auth.md
└── hooks/
    └── hooks.json          # 기본 로드 파일명 (고정)
```

> `.claude-plugin/`에는 `plugin.json`만 위치한다. 다른 모든 컴포넌트(`commands/`,
> `hooks/`, `.mcp.json` 등)는 플러그인 **루트**에 둔다.
>
> 기본 경로의 컴포넌트는 **자동 발견**된다 — `commands/*.md`, `hooks/hooks.json`,
> `.mcp.json`은 manifest에 선언하지 않아도 로드된다. 기본 파일명은 고정이므로 훅은
> 반드시 `hooks/hooks.json`이어야 한다. 기본 경로를 벗어날 때만 manifest의 top-level
> `commands`/`hooks`/`mcpServers` 필드로 `./`-상대경로를 지정한다.

## `.claude-plugin/plugin.json` (초안)

```json
{
  "name": "claude-grok-build-plugin",
  "version": "0.1.0",
  "description": "Grok Build CLI에 코딩 작업을 위임하는 MCP 브리지",
  "author": { "name": "xzawed" }
}
```

공식 스키마(`code.claude.com/docs/en/plugins-reference`)에 맞춘 형태다. `components`
같은 래퍼 필드는 스키마에 없으므로 넣지 않는다 — 기본 경로 컴포넌트는 자동 발견된다.
`author`는 문자열이 아니라 객체(`{ "name", "email", "url" }`)다. 버전마다 필드가 바뀔 수
있으니 구현 직전 설치 버전 레퍼런스로 재확인할 것.

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

## 슬래시 커맨드

> ⚠️ 호출 문자열 형식(`/name` vs `/<플러그인명>:name`)은 공식 레퍼런스에 명확히
> 규정돼 있지 않다. 커맨드 파일은 `commands/grok-build-delegate.md`·
> `commands/grok-build-check-auth.md`(kebab-case)이며, 최종 호출 문자열은 설치한
> Claude Code 버전에서 실측해 확정한다. 아래 `/grok-build:...` 표기는 잠정값이다.
> (새 플러그인은 `commands/` 대신 `skills/<name>/SKILL.md`도 권장된다.)

### `/grok-build:delegate "<작업 설명>"`
- `grok_auth_check` → 실패 시 중단하고 안내
- 성공 시 `grok_build_delegate` 호출, 결과를 대화에 표시

### `/grok-build:check-auth`
- 로그인 상태만 확인하는 유틸리티 커맨드. 위임 없이 진단용으로 사용.

## Hook

### `pre-delegate-auth-check` (`hooks/hooks.json`에 정의)
- 이벤트: PreToolUse (matcher: `mcp__plugin_claude-grok-build-plugin_grok-build__grok_build_delegate`)
  — 스코프 툴명 형식: `mcp__plugin_<플러그인명>_<서버명>__<툴명>`
- 역할: delegate tool 호출 직전에 인증 캐시 상태를 확인하고, 문제가 있으면
  tool 호출 자체를 막고 사용자에게 안내 메시지를 반환 (harness 레벨 방어 —
  MCP 서버 내부 체크와 이중화)

> 이중 체크가 과하다고 느껴지면 v0.1에서는 MCP 서버 내부 체크만으로 시작하고,
> hook은 v0.2에서 추가해도 무방하다. (`docs/06-roadmap.md` Phase 2 참고)
