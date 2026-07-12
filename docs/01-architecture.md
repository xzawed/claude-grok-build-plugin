# 01. 아키텍처

## 개요

```
┌──────────────────┐        MCP tool call         ┌────────────────────────┐
│   Claude Code     │ ────────────────────────────▶│  grok-build MCP Server  │
│  (Orchestrator /  │                               │  (claude-grok-build-    │
│   현재 세션)       │◀──────────────────────────── │   plugin, Node.js)      │
└──────────────────┘        구조화된 결과            └───────────┬────────────┘
                                                                  │ spawn (subprocess)
                                                                  │ env: API 키 제거됨
                                                                  ▼
                                                       ┌────────────────────┐
                                                       │  grok CLI           │
                                                       │  --no-auto-update   │
                                                       │  -p "<task>"         │
                                                       │  --output-format     │
                                                       │    streaming-json    │
                                                       └──────────┬──────────┘
                                                                  │ 세션 토큰 사용
                                                                  ▼
                                                       ┌────────────────────┐
                                                       │ ~/.grok/auth.json   │
                                                       │ (SuperGrok/X Premium+│
                                                       │  OAuth 세션)         │
                                                       └────────────────────┘
```

## 왜 MCP 래퍼 방식인가 (ACP 대신)

Grok Build는 ACP(Agent Client Protocol)도 지원하지만, ACP client 역할을
Claude Code가 공식적으로 지원하는지는 검증되지 않았다. 반면 MCP 래퍼 방식은:

- Claude Code 플러그인의 표준 확장 지점(MCP 서버)을 그대로 사용 — 추가 프로토콜
  구현 불필요
- Grok Build가 이미 headless 모드(`-p`)와 `streaming-json` 출력을 공식 지원하므로
  파싱 대상이 안정적
- 실패 시 디버깅이 "subprocess stdout을 봤다" 수준으로 단순함

ACP 직접 연동은 v2 이후 옵션으로 남겨둔다 (`docs/06-roadmap.md` 참고).

## 컴포넌트 책임

| 컴포넌트 | 책임 |
|---|---|
| MCP 서버 (`mcp-server/`) | grok CLI subprocess 실행, streaming-json 파싱, 결과 요약, 인증 상태 확인 |
| 슬래시 커맨드 (`commands/`) | 사용자가 명시적으로 위임을 트리거하는 진입점 |
| Hook (`hooks/`) | 위임 실행 전 인증 사전 체크 강제, 위임 이력 로깅 (감사 목적) |
| plugin.json | 위 컴포넌트를 하나의 설치 단위로 묶는 매니페스트 |

## 데이터 흐름 (위임 1건 기준)

1. Claude가 작업을 판단 (`docs/05-routing-policy.md` 기준 충족) → MCP tool
   `grok_build_delegate` 호출
2. MCP 서버가 사전에 `grok_auth_check` 결과를 캐시에서 확인 (없으면 즉시 체크)
3. `spawn("grok", ["--no-auto-update", "-p", prompt, "--output-format", "streaming-json"], { cwd, env })`
   — `env`는 API 키가 제거된 사본
4. stdout을 라인 단위 JSON 이벤트로 파싱 → plan/edit/test/diff 이벤트를 요약
5. 요약 텍스트 + 실패 시 원인(인증/타임아웃/거부)을 구조화해 Claude에 반환
6. hook이 위임 이력(작업 요약, 소요 시간, 성공 여부)을 로컬 로그에 append

## 실패 모드와 처리 방침

| 실패 유형 | 처리 |
|---|---|
| `~/.grok/auth.json` 없음 | "구독 로그인 필요" 메시지 반환, `grok login` 안내. 위임 실행 안 함 |
| 세션 토큰 만료 (7일) | stderr에서 auth 관련 키워드 감지 시 재인증 안내 |
| grok CLI 미설치 | 설치 명령 안내 |
| 서브프로세스 타임아웃 | 설정 가능한 타임아웃(기본 180초) 후 강제 종료, 부분 결과라도 반환 |
| grok CLI가 승인 대기 상태로 멈춤 | `--always-approve`는 기본적으로 쓰지 않음 (안전) — 대신 타임아웃으로 감지해 Claude에게 "수동 승인 필요"로 보고 |
