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
    └── pre-delegate-auth-check.json
```

> `.claude-plugin/`에는 `plugin.json`만 위치한다. 다른 컴포넌트를 이 폴더 안에 넣으면
> 로드되지 않는다 (Claude Code 플러그인 로더의 알려진 제약).

## `.claude-plugin/plugin.json` (초안)

```json
{
  "name": "claude-grok-build-plugin",
  "version": "0.1.0",
  "description": "Grok Build CLI를 구독 기반으로 위임하는 MCP 브리지",
  "author": "xzawed",
  "components": {
    "mcpServers": ["grok-build"],
    "commands": ["grok-build-delegate", "grok-build-check-auth"],
    "hooks": ["pre-delegate-auth-check"]
  }
}
```

실제 필드명/스키마는 설치해 사용 중인 Claude Code 버전의 공식 plugin.json 레퍼런스로
구현 직전에 재검증할 것 (버전마다 필드가 바뀔 수 있음 — 이 문서의 예시는 설계
의도를 보여주기 위한 초안이며 최종 스키마 소스가 아니다).

## `.mcp.json` (초안)

```json
{
  "mcpServers": {
    "grok-build": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"]
    }
  }
}
```

플러그인이 활성화되면 이 MCP 서버가 자동으로 기동하고, per-server 승인 절차를 거친다
(프로젝트 `.mcp.json`과 동일한 신뢰 모델).

## 슬래시 커맨드

### `/grok-build:delegate "<작업 설명>"`
- `grok_auth_check` → 실패 시 중단하고 안내
- 성공 시 `grok_build_delegate` 호출, 결과를 대화에 표시

### `/grok-build:check-auth`
- 로그인 상태만 확인하는 유틸리티 커맨드. 위임 없이 진단용으로 사용.

## Hook

### `pre-delegate-auth-check`
- 이벤트: PreToolUse (matcher: `mcp__plugin_claude-grok-build-plugin_grok-build__delegate`)
- 역할: delegate tool 호출 직전에 인증 캐시 상태를 확인하고, 문제가 있으면
  tool 호출 자체를 막고 사용자에게 안내 메시지를 반환 (harness 레벨 방어 —
  MCP 서버 내부 체크와 이중화)

> 이중 체크가 과하다고 느껴지면 v0.1에서는 MCP 서버 내부 체크만으로 시작하고,
> hook은 v0.2에서 추가해도 무방하다. (`docs/06-roadmap.md` Phase 2 참고)
