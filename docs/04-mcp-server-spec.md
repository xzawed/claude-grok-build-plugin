# 04. MCP 서버 스펙

## 서버 레벨 설정

`.mcp.json`의 `env`(또는 프로세스 env)로 전달하는 `GROK_BUILD_AUTH_MODE`가 서버
기동 시 `resolveAuthMode()`로 읽힌다.

- `subscription`(기본, 미설정 시) — grok subprocess env에서 `XAI_API_KEY`·
  `GROK_CODE_XAI_API_KEY` 제거
- `api`(opt-in) — env의 위 두 키를 grok subprocess에 그대로 통과
- 그 외 값 — 서버 기동 시 에러로 즉시 실패(fail fast), 잘못된 값으로 조용히
  구독/API 어느 쪽으로도 새지 않게 함
- **호출별 오버라이드는 없다** — 모드는 서버 인스턴스 하나에 고정. 근거:
  `docs/02-auth-strategy.md`, `docs/specs/2026-07-12-two-track-auth-design.md`

## Tool 목록

### 1. `grok_auth_check`

인증 상태만 확인. 위임을 실행하지 않는다.

**Input:** 없음

**Output:**
```typescript
{
  ok: boolean;
  mode: "subscription" | "api";   // 현재 활성 모드
  reason?: "grok_not_installed" | "not_logged_in" | "no_api_key";
  message: string;   // 사용자에게 그대로 보여줄 한국어 안내 문구
}
```

**구현 개요 (`checkAuth`, `mcp-server/src/auth.ts`):**
1. `where grok`(Windows) / `command -v grok`(POSIX)로 설치 여부 확인 → 없으면
   `grok_not_installed`
2. 모드 분기:
   - `subscription`: `~/.grok/auth.json` 존재 여부 확인 → 없으면 `not_logged_in`
   - `api`: env에 `XAI_API_KEY` 또는 `GROK_CODE_XAI_API_KEY` 존재 여부 확인 →
     없으면 `no_api_key`
3. 통과하면 `ok: true` 반환 (구독 모드의 스모크 테스트는 여기서 하지 않음 —
   비용/지연 문제, `docs/02-auth-strategy.md` 참고)

`grok_build_delegate`도 실행 전에 동일한 `checkAuth`를 선행 실행해, 인증 실패 시
subprocess를 아예 띄우지 않는다.

---

### 2. `grok_build_delegate`

실제 작업 위임. 아래는 실제 구현(`mcp-server/src/delegate.ts`, `index.ts`)의
입출력 스키마다 — 필드명은 camelCase 그대로 JSON으로 반환된다(스네이크케이스
아님).

**Input** (MCP tool 파라미터, `timeout_ms`만 관례상 snake_case로 노출):
```typescript
{
  prompt: string;          // grok에게 전달할 작업 지시문 (영어 권장 — 토큰 효율)
  cwd: string;              // 작업 대상 디렉토리 (절대경로)
  timeout_ms?: number;      // 기본값 180000 (3분)
}
```
`mode: "plan"`(계획만 세우고 실행하지 않는 흐름)은 아직 구현되지 않았다 —
`docs/06-roadmap.md` Phase 3 예정.

**Output (성공):**
```typescript
{
  status: "completed";
  mode: "subscription" | "api";           // 실제 실행된 인증 모드
  billing: "subscription" | "metered_api"; // 과금 방식 — 항상 mode와 함께 반환해 투명성 확보
  summary: string;          // grok --output-format json의 text 필드
  filesChanged: string[];   // git status --porcelain으로 도출 (grok 출력에는 변경 파일 목록이 없음)
}
```

**Output (실패):**
```typescript
{
  status: "auth_error" | "timeout" | "grok_error";
  mode: "subscription" | "api";
  billing: "subscription" | "metered_api";
  message: string;
  rawStderrTail?: string;   // 마지막 500자 정도만 — 전체 로그 덤프 금지 (토큰 낭비)
}
```

**구현 개요:**
```typescript
const args = [
  "--no-auto-update", "--always-approve", "--cwd", cwd,
  "-p", prompt, "--output-format", "json",
];
const r = await spawn("grok", args, { cwd, env: buildGrokEnv(mode) }); // timeout via SIGKILL
```
- **`--always-approve`는 항상 붙인다** — 헤드리스로 실제 편집이 이뤄지려면 필수다.
  없으면(또는 승인 대기 모드면) grok이 `stopReason: "Cancelled"`로 끝나고 파일을
  하나도 바꾸지 않는다(실측, `docs/specs/grok-cli-contract.md`). 대신 **자동 커밋은
  하지 않는다** — Claude/사람이 diff를 검토한 뒤에만 커밋(`docs/05-routing-policy.md`).
- 실행 전 `checkAuth(mode, ...)`로 인증을 선행 확인 — 실패 시 subprocess를 아예
  띄우지 않고 `isError: true`로 안내 메시지만 반환.
- `r.timedOut`이면 `status: "timeout"` 반환(설정 가능한 타임아웃, 기본 180초, 초과 시
  SIGKILL).
- stdout을 `JSON.parse`해 단일 객체(`{ text, stopReason, ... }`)로 파싱(`grok-result.ts`).
  **exit code는 성공/취소 모두 0**이라 신뢰하지 않는다 — **`stopReason ===
  "EndTurn"`일 때만 성공**으로 판정하고, 그 외(`"Cancelled"` 등)는 `status:
  "grok_error"`로 분류.
- 파싱 자체가 실패하거나(JSON.parse 예외) stderr/stdout에 인증 관련 신호
  (`not authenticated`/`unauthorized`/`401`/`403`/`grok login`/`logged in`)가
  보이면 `status: "auth_error"`로 분류하고 모드별 안내 메시지(구독:
  `grok login` / api: `XAI_API_KEY` 확인) 사용. ⚠️ 이 신호 목록은 실제 인증 만료를
  재현해 검증된 것이 아니라 best-effort 추정이다(`docs/specs/grok-cli-contract.md`
  §7 참고) — 1차 방어선은 실행 전 `checkAuth`.
- 성공 시 `filesChanged`는 grok 출력이 아니라 `git -C cwd status --porcelain`에서
  도출한다(grok json/streaming-json 어느 출력에도 변경 파일 목록이 없음). git
  저장소가 아니면 빈 배열을 반환한다. 원본 grok stdout 전체를 Claude에게 그대로
  넘기지 않는다 — CLAUDE.md의 코딩 컨벤션 참고.

---

### 3. `grok_build_verify` (v2 옵션, Phase 3)

Grok Build의 `/verify` 기능(샌드박스에서 빌드/테스트/브라우저 스모크 테스트 실행,
스크린샷·영상 증거 생성)을 wrapping. Phase 1~2에서는 구현하지 않는다.

## 프롬프트 작성 원칙 (MCP 서버 → grok CLI)

- Claude가 넘기는 `prompt`는 위임 목적에 맞게 구체적이어야 한다. 애매한 "고쳐줘"
  류의 지시는 Grok Build도 Claude Code와 동일하게 요약만 반환하고 실제 변경을
  안 하는 경우가 있다 — "전체 파일을 다시 출력하라"는 식의 명시적 지시가 필요할 때가 있음.
- 프롬프트에 이미 CLAUDE.md/AGENTS.md 컨벤션이 있다는 걸 전제하고 중복 설명을
  넣지 않는다 (Grok Build가 자동으로 읽으므로 토큰 낭비).

## 에러 메시지 문구 가이드 (한국어, 과장 없이)

- 인증 실패 (구독 모드): "구독 로그인이 필요합니다. 터미널에서 `grok login`을
  실행한 뒤 다시 시도하세요."
- 인증 실패 (API 모드, 키 없음): "API 모드입니다. `XAI_API_KEY` 환경변수를 설정한
  뒤 다시 시도하세요."
- 인증 실패 (API 모드, 위임 중 감지): "API 인증에 실패했습니다. `XAI_API_KEY`가
  유효한지 확인하세요."
- 타임아웃: "Grok Build 작업이 {N}초 내에 끝나지 않았습니다. 범위를 줄이거나
  timeout_ms를 늘려 다시 시도하세요."
- CLI 미설치: "Grok Build CLI가 설치돼 있지 않습니다. `curl -fsSL
  https://x.ai/cli/install.sh | bash`로 설치하세요."
