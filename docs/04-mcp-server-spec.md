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
  worktree?: boolean;       // opt-in: 격리 worktree에서 실행 (아래 "격리" 참고)
  sandbox?: string;         // opt-in: grok --sandbox <profile> 그대로 전달
}
```
계획만 세우고 실행하지 않는 흐름은 `grok_build_delegate`의 `mode` 필드가 아니라 별도
tool `grok_build_plan`으로 구현돼 있다(아래 §2b 참고 — Phase 3 완료).

**Output (성공):**
```typescript
{
  status: "completed";
  mode: "subscription" | "api";           // 실제 실행된 인증 모드
  billing: "subscription" | "metered_api"; // 과금 방식 — 항상 mode와 함께 반환해 투명성 확보
  summary: string;          // grok --output-format json의 text 필드
  filesChanged: string[];   // git -C <effectiveCwd> -c core.quotepath=false status --porcelain -z 로 도출
                            // (grok 출력에는 변경 파일 목록이 없음). worktree 모드면 그 worktree에서
                            // 도출되어 전부 grok 변경(정밀 귀속). 아니면 cwd 워킹트리 전체.
  worktreePath?: string;    // worktree:true였을 때 격리 worktree 경로 (사람이 검토·병합)
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
  filesChanged?: string[];  // timeout·비-EndTurn(예: Cancelled)·파싱 실패 시에도, grok이
                            // 중단 전에 남긴 부분 편집을 검토할 수 있게 함께 반환한다.
  worktreePath?: string;    // worktree 생성 이후 실패면 함께 반환 (해당 worktree 정리용)
}
```

### 격리 (`worktree` / `sandbox`, opt-in)

- `worktree: true` — 래퍼가 `git worktree add`(HEAD 기준, 새 브랜치 `grok/<name>`)로 만든
  격리 worktree에서 grok을 실행한다(`worktree.ts`의 `createGrokWorktree`). grok의 `--worktree`
  플래그는 헤드리스에서 무시되므로 쓰지 않는다. 변경은 cwd가 아니라 worktree에 들어가며,
  `filesChanged`는 그 worktree에서 도출되어 **전부 grok 변경(정밀 귀속)**이다. 응답에
  `worktreePath`를 실어 사람/Claude가 검토·병합한다. ⚠️ worktree는 HEAD 기준이라 grok은
  cwd의 미커밋 변경을 못 본다. 생성 실패 시 `grok_error`로 실패(조용히 cwd 편집하지 않음).
  정리는 수동(`git worktree remove` / `grok worktree gc`) — 누적은 알려진 한계.
- `sandbox: "<profile>"` — grok에 `--sandbox <profile>`을 그대로 전달(fs/네트워크 제한,
  env `GROK_SANDBOX`). ⚠️ grok-native이며 유효 profile은 미검증 — 사용자가 아는 값으로 opt-in.

**구현 개요:**
```typescript
const args = [
  "--no-auto-update", "--always-approve", "--cwd", cwd,
  "-p", prompt, "--output-format", "json",
];
// detached(POSIX)로 프로세스그룹 리더 생성 → 타임아웃 시 grok의 자식까지 SIGKILL(고아 방지);
// stdout/stderr는 setEncoding('utf8')로 멀티바이트 청크 경계 손상 방지.
const r = await spawn("grok", args, { cwd, env: buildGrokEnv(mode, deps.env), detached: true });
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
- 분류 순서: **파싱 실패(JSON.parse 예외)가 전제**이고, 그때 stderr/stdout에 인증
  신호(`not authenticated`/`grok login`)가 **보이면** `auth_error`, **없으면**
  `grok_error`다. (즉 "파싱 실패 **그리고** 신호"가 auth_error, "파싱 실패 + 신호 없음"은
  grok_error.) 신호 목록은 오탐 방지를 위해 고특이도 문구 2개로 축소했다 — 기존의
  `401`/`403`/`unauthorized`/`logged in`은 일반 grok 출력(예: HTTP 403을 반환하는 코드)에
  오탐을 내 제거했다. ⚠️ 실제 인증 만료를 재현해 검증한 것이 아니라 best-effort 추정이다
  (`docs/specs/grok-cli-contract.md` §7) — 1차 방어선은 실행 전 `checkAuth`.
- 실행 전 검증: `cwd`가 절대경로가 아니거나 존재하지 않는 디렉토리면 subprocess를
  띄우지 않고 `grok_error`(mode/billing 태그 포함)로 즉시 반환한다. grok 프로세스를
  아예 시작하지 못하면(ENOENT/EACCES) 불투명한 "출력 해석 불가"가 아니라 별도의
  "프로세스를 시작할 수 없습니다" 메시지로 분류한다.
- `filesChanged`는 grok 출력이 아니라 `git -C cwd -c core.quotepath=false status
  --porcelain -z`에서 도출한다(리네임은 새 경로만, 공백/유니코드 경로 보존). git
  저장소가 아니면 빈 배열. **성공뿐 아니라 timeout·비-EndTurn·파싱 실패 시에도**
  중단 전 부분 편집을 검토할 수 있게 함께 반환한다. git 호출은 비동기(execFile,
  타임아웃/maxBuffer)라 이벤트 루프를 막지 않는다. 원본 grok stdout 전체를 Claude에게
  그대로 넘기지 않는다 — CLAUDE.md의 코딩 컨벤션 참고.

---

## 위임 이력 로깅 (`history.ts`)

`grok_build_delegate`가 `runDelegate`를 실행한 뒤(즉 pre-check를 통과한 실제 위임만),
`index.ts`가 `recordDelegation(input, result, { ts, durationMs })`을 호출해
`~/.grok-build/history.jsonl`에 JSONL 한 줄을 append한다. 용도는 provenance —
"이 변경이 Claude 것인지 Grok Build 것인지" 추적(`docs/05-routing-policy.md`).

- **서버 내부 기록**(PostToolUse hook 아님): 구조화된 `DelegateResult`를 그대로 쓰므로
  응답 엔벨로프 파싱이 필요 없고, hook 비활성화와 무관하게 항상 남는다.
- **cwd 밖(사용자 전역)** 에 기록해 위임된 리포의 `git status`/`filesChanged`를
  오염시키지 않는다.
- **자격증명·env·`rawStderrTail`은 절대 기록하지 않는다**(절대 원칙 #4). prompt·summary는
  200자로 truncate, `filesChanged`는 100개로 cap(`filesTruncated`/`filesCount`로 표기).
- **로깅은 실패해도 위임을 깨지 않는다**(`recordDelegation` 전체 try/catch swallow).
- pre-check 인증 실패(grok 미실행)는 위임이 아니므로 기록하지 않는다.

**`HistoryEntry` (1행):**
```typescript
{
  ts: string;              // ISO 8601 UTC
  mode: "subscription" | "api";
  billing: "subscription" | "metered_api";
  status: "completed" | "timeout" | "auth_error" | "grok_error";
  cwd: string;             // 위임 대상 (프로젝트별 추적)
  promptPreview: string;   // ≤200자, 공백 정규화
  summaryPreview?: string; // ≤200자 (summary 있을 때만)
  filesChanged: string[];  // ≤100
  filesTruncated: boolean;
  filesCount: number;      // 실제 개수
  durationMs: number;      // runDelegate 벽시계
}
```

### 2b. `grok_build_plan`

작업을 **실제 편집 없이** grok에게 계획만 받아보는 읽기전용 미리보기.
`grok_build_delegate` 전에 접근 방식을 확인하는 용도. 내부적으로
`runDelegate(plan: true)`를 재사용한다.

- **Input:** `{ prompt, cwd, timeout_ms? }` (worktree/sandbox 없음 — 편집 안 함)
- **동작:** `--always-approve` 대신 `--permission-mode plan`을 넘긴다. 실측상 grok은
  계획만 세우고 `stopReason: "Cancelled"`로 끝나며 **파일을 바꾸지 않는다**. 따라서 plan
  모드는 파싱 성공 + text가 있으면 **성공(`completed`)**으로 판정하고 `summary`에 계획을,
  `filesChanged`에 `[]`를 반환한다(git status 스킵). text가 없으면 `grok_error`.
- 인증/과금/이력 로깅 경로는 delegate와 동일(이력엔 `plan: true` 마커).

### 3. `grok_build_verify`

작업을 위임하되 grok이 **스스로 검증**하게 한다 — `--always-approve`에 `--check`
(자기검증 루프, 헤드리스 전용)를 덧붙인다. 실측상 grok은 편집 후 검증 서브에이전트를
띄워 체크리스트/Action-Trace를 `text`에 담아 반환하고 `stopReason: "EndTurn"`으로 끝난다.

- **Input:** `{ prompt, cwd, timeout_ms?, worktree?, sandbox? }` (delegate와 동일)
- **동작:** 성공 판정·`filesChanged`는 delegate와 동일(편집함). `summary`에 grok의
  자기검증 리포트가 포함된다. 내부적으로 `runDelegate({ check: true })` 재사용. 이력엔
  `check: true` 마커.
- ⚠️ 로드맵 초안의 "독립 `/verify`(샌드박스 빌드/테스트/스크린샷·영상)"는 grok CLI에
  **실재하지 않는다**(서브커맨드·플래그 부재, 실측). 헤드리스로 가능한 건 `--check`(작업 +
  자기검증)뿐이라 그 범위로 구현했다.

### 4. `grok_build_usage`

`~/.grok-build/history.jsonl`(Phase 2 이력)을 집계하는 **읽기전용** 요약. grok 호출·인증
없음(로컬 로그만 읽음). 과금 투명성(절대 원칙 #1)과 직결.

- **Input:** `{ cwd?, limit? }` (cwd로 프로젝트별 필터, limit=recent 개수 기본 10)
- **Output:** `UsageSummary` — `total`, `byMode`, `byBilling`(구독 vs 종량제 강조),
  `byStatus`, `counts`(plan/check/worktree 사용 횟수), `totalFilesChanged`,
  `firstTs`/`lastTs`, `recent`(최근순). 파일 없으면 `total: 0`.
- 구현: `usage.ts`의 `readHistory`(malformed 줄 관용, 파일 없으면 `[]`) +
  `summarizeHistory`(순수 집계). 슬래시 커맨드 `/grok-build:usage`.

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
- CLI 미설치/PATH 누락: "Grok Build CLI를 PATH에서 찾을 수 없습니다. 미설치면 `curl
  -fsSL https://x.ai/cli/install.sh | bash`로 설치하고, 이미 설치했다면 grok이 PATH에
  포함된 터미널에서 Claude Code를 실행하세요."
- cwd 오류: "cwd는 절대 경로여야 합니다." / "cwd 디렉토리가 존재하지 않거나
  디렉토리가 아닙니다."
- grok 프로세스 시작 실패: "Grok Build 프로세스를 시작할 수 없습니다: {stderr}"
