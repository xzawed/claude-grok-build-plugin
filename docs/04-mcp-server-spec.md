# 04. MCP 서버 스펙

## Tool 목록

### 1. `grok_auth_check`

인증 상태만 확인. 위임을 실행하지 않는다.

**Input:** 없음

**Output:**
```typescript
{
  ok: boolean;
  reason?: "not_logged_in" | "session_expired" | "grok_not_installed";
  message: string;   // 사용자에게 그대로 보여줄 한국어 안내 문구
}
```

**구현 개요:**
1. `which grok` (또는 `command -v grok`)로 설치 여부 확인 → 없으면 `grok_not_installed`
2. `~/.grok/auth.json` 존재 여부 확인 → 없으면 `not_logged_in`
3. 둘 다 통과하면 `ok: true` 반환 (스모크 테스트는 여기서 하지 않음 — 비용/지연 문제,
   `docs/02-auth-strategy.md` 참고)

---

### 2. `grok_build_delegate`

실제 작업 위임.

**Input:**
```typescript
{
  prompt: string;          // grok에게 전달할 작업 지시문 (영어 권장 — 토큰 효율)
  cwd: string;              // 작업 대상 디렉토리 (절대경로)
  mode?: "exec" | "plan";   // 기본값 "exec". "plan"은 계획만 세우고 실행하지 않음
  timeout_ms?: number;      // 기본값 180000 (3분)
}
```

**Output (성공):**
```typescript
{
  status: "completed";
  summary: string;          // streaming-json 이벤트를 요약한 텍스트
  files_changed: string[];  // grok이 수정한 파일 경로 목록
  diff_available: boolean;  // true면 Claude가 후속으로 git diff를 직접 확인 가능
}
```

**Output (실패):**
```typescript
{
  status: "auth_error" | "timeout" | "grok_error";
  message: string;
  raw_stderr_tail?: string;  // 마지막 500자 정도만 — 전체 로그 덤프 금지 (토큰 낭비)
}
```

**구현 개요:**
```typescript
const proc = spawn(
  "grok",
  ["--no-auto-update", "-p", prompt, "--output-format", "streaming-json"],
  { cwd, env: buildGrokEnv(), timeout: timeout_ms ?? 180_000 }
);
```
- `mode === "plan"`인 경우 인자를 `["plan", prompt]`로 교체 (실행 없이 계획만)
- stdout을 줄 단위로 읽어 JSON.parse, 이벤트 타입별로 누적
- 종료 후 이벤트 목록에서 파일 변경/에러/최종 상태만 추출해 summary 생성
  (원본 streaming-json 전체를 Claude에게 그대로 넘기지 않는다 — CLAUDE.md의
  코딩 컨벤션 참고)
- exit code ≠ 0 이고 stderr에 인증 관련 키워드가 있으면 `status: "auth_error"`로
  분류하고 `grok_auth_check`와 동일한 안내 메시지 사용

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

- 인증 실패: "구독 로그인이 필요합니다. 터미널에서 `grok login`을 실행한 뒤 다시
  시도하세요."
- 타임아웃: "Grok Build 작업이 {N}초 내에 끝나지 않았습니다. 작업 범위를 줄이거나
  timeout_ms를 늘려 다시 시도하세요."
- CLI 미설치: "Grok Build CLI가 설치돼 있지 않습니다. `curl -fsSL
  https://x.ai/cli/install.sh | bash`로 설치하세요."
