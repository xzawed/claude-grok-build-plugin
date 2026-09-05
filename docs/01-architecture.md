# 01. 아키텍처

**제품 본질:** `docs/00-product-vision.md` — Claude는 오케스트레이터, Grok은 워커,
플러그인은 구독-안전한 다리. 목표는 위임 가능 여부만이 아니라 **협업 경험**.

## 개요

```
┌──────────────────┐        MCP tool call         ┌────────────────────────┐
│   Claude Code     │ ────────────────────────────▶│  grok-build MCP Server  │
│  (Orchestrator /  │                               │  (claude-grok-build-    │
│   현재 세션)       │◀──────────────────────────── │   plugin, Node.js)      │
└──────────────────┘        구조화된 결과            └───────────┬────────────┘
                                                                  │ spawn (subprocess)
                                                                  │ env: 모드별 (구독=API 키 제거 /
                                                                  │       api=API 키 통과)
                                                                  ▼
                                                       ┌────────────────────┐
                                                       │  grok CLI           │
                                                       │  --no-auto-update   │
                                                       │  --always-approve   │
                                                       │  --cwd <dir>         │
                                                       │  --single=<task>     │
                                                       │  --output-format json│
                                                       └──────────┬──────────┘
                                                                  │ 세션 토큰(구독) 또는
                                                                  │ API 키(api)로 인증
                                                                  ▼
                                                       ┌────────────────────┐
                                                       │ ~/.grok/auth.json   │
                                                       │ (SuperGrok/X Premium+│
                                                       │  OAuth 세션, 구독 모드)│
                                                       └────────────────────┘
```

## 왜 MCP 래퍼 방식인가 (ACP 대신)

Grok Build는 ACP(Agent Client Protocol)도 지원하지만, **Claude Code는 오늘 ACP
client가 아니다** (2026-07 검증 리서치 — `docs/06-roadmap.md`). 반면 MCP 래퍼 방식은:

- Claude Code 플러그인의 표준 확장 지점(MCP 서버)을 그대로 사용 — 추가 프로토콜
  구현 불필요
- Grok Build가 이미 headless 모드(`-p`)와 `--output-format json` 출력을 공식
  지원하므로 파싱 대상이 안정적(단일 JSON 객체 `{ text, stopReason, ... }`,
  실측: `docs/specs/grok-cli-contract.md`)
- 실패 시 디버깅이 "subprocess stdout을 봤다" 수준으로 단순함

ACP 직접 연동은 **보류(MCP 유지)로 결정**됐다 (2026-07, `docs/06-roadmap.md`).

## 컴포넌트 책임

| 컴포넌트 | 책임 |
|---|---|
| MCP 서버 (`mcp-server/`) | grok CLI subprocess 실행, `--output-format json` 파싱, 결과 요약, 인증 상태 확인 |
| 슬래시 커맨드 (`commands/`) | 사용자가 명시적으로 위임을 트리거하는 진입점 |
| Skill (`skills/`) | 설치 사용자 세션에 실리는 런타임 컨텍스트 — `grok-routing`(무엇을 위임할지, 상세 `docs/05-routing-policy.md`), `grok-first-mile`(온보딩, 상세 `docs/08-getting-started-with-grok.md`) |
| 서브에이전트 (`agents/`) | `grok-worker` — 볼륨·반복 작업 워커 정의. Claude/사람은 리뷰어로 남는다. 상세: `docs/03-plugin-spec.md` |
| Hook (`hooks/`) | `pre-delegate-auth-check` PreToolUse hook — delegate/plan/verify 실행 전 인증 사전 체크(harness 레벨 이중화, "확실할 때만 차단"). 위임 이력 로깅은 hook이 아니라 MCP 서버 내부(`history.ts`)에서 수행 |
| plugin.json | 위 컴포넌트를 하나의 설치 단위로 묶는 매니페스트 |

## 데이터 흐름 (위임 1건 기준)

1. Claude가 작업을 판단 (`docs/05-routing-policy.md` 기준 충족) → MCP tool
   `grok_build_delegate` 호출
2. MCP 서버가 사전에 `grok_auth_check`로 현재 `mode`(`GROK_BUILD_AUTH_MODE`,
   기본 `subscription`) 기준 인증 상태를 확인
3. `spawn("grok", ["--no-auto-update", "--always-approve", "--cwd", cwd, "--single=" + prompt, "--output-format", "json"], { cwd, env })`
   — `-p <prompt>`가 아니라 **`--single=<prompt>`** 다: bare 옵션 값으로는 clap이 `-`로 시작하는
   문자열을 거부해 "- Refactor …" 같은 프롬프트가 exit 2로 죽었다(v0.2.13에서 정정, 1.0.13 실측).
   `env`는 모드별로 처리된 사본(구독: API 키 제거 / api: API 키 통과)
4. stdout 전체를 `JSON.parse`해 단일 객체(`{ text, stopReason, ... }`)로 파싱 —
   **성공 여부는 `end_turn`/`EndTurn`으로 판정**(exit code는 취소 시에도 0이라
   신뢰할 수 없음). 변경 파일은 grok 출력이 아니라 `git status --porcelain`으로 도출
5. 요약 텍스트(`text`) + `mode`/`billing` + 실패 시 원인(인증/타임아웃/미완료)을
   구조화해 Claude에 반환
6. MCP 서버가 위임 이력(작업 요약, 소요 시간, 성공 여부, provenance)을
   `~/.grok-build/history.jsonl`에 append (`history.ts` — hook이 아닌 서버 내부, 구현 완료)

## 실패 모드와 처리 방침

| 실패 유형 | 처리 |
|---|---|
| `auth.json`(`GROK_HOME`\|\|`~/.grok`) 없음 (구독 모드) | "구독 로그인 필요" 메시지 반환, `grok login` 안내. 위임 실행 안 함 |
| env에 `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 없음 (api 모드) | `no_api_key` 반환, 키 설정 안내. 위임 실행 안 함 |
| 세션 토큰 만료 / API 키 무효 | stderr·stdout에서 auth 관련 키워드 감지 시 모드별 재인증 안내(구독: `grok login` / api: 키 확인) |
| grok CLI 미설치 | 설치 명령 안내 |
| 서브프로세스 타임아웃 | 설정 가능한 타임아웃(기본 180초) 후 SIGKILL, `status: "timeout"` 반환 |
| grok이 편집을 완료하지 못함 (`end_turn`/`EndTurn`이 아님, 예: `cancelled`) | exit code는 성공/취소 모두 0이라 신뢰하지 않음 — **`stopReason`으로 판정**해 `grok_error`로 분류하고 grok의 응답 텍스트 일부를 포함해 반환. ⚠️ 헤드리스 편집에는 `--always-approve`가 필수다 — 대신 자동 커밋은 하지 않고 Claude/사람이 diff를 검토한 뒤에만 커밋한다(`docs/05-routing-policy.md`). 계약: `docs/specs/grok-cli-contract.md`. |
