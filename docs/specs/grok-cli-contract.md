# grok CLI 계약 (실측)

- grok 버전: **1.0.3 (1a29d5bc12) [stable]**, 플랫폼 Windows 11
- 재실측: **2026-08-14** (Grok 4.6 기본 모델). 설계: [`2026-08-14-grok-1.0-compat-design.md`](./2026-08-14-grok-1.0-compat-design.md)
- 최초 측정: 2026-07-12 against **0.2.93** — 아래 역사 주석은 유지, **현재 동작은 1.0.3이 이긴다**
- 방법: `grok --help`, `grok models`, scratch git + 플러그인 `runDelegate` 실경로

이 문서는 [Task 0](../plans/2026-07-12-phase1-two-track-mvp.md)에서 시작해 1.0.3에서 다시 잰다.

## 1. 헤드리스 호출 형태 (정정됨)

**확정 호출:**
```
grok --no-auto-update --always-approve --cwd <DIR> -p "<PROMPT>" --output-format json
```

- `-p, --single <PROMPT>` — 단일턴 헤드리스, stdout에 결과 출력 후 종료. ✓
- `--output-format <plain|json|streaming-json|streaming-messages-json>` [기본 plain].
  **`json` 권장** (아래 §2). 1.0 `streaming-json`은 `thought`/`text`/`end` 외에
  `available_commands`/`usage`/`tool_call`이 올 수 있다 — 이 플러그인은 쓰지 않는다.
- `--cwd <DIR>` — 작업 디렉토리. (`cd` 대신 사용해 셸 이슈 회피.)
- `--no-auto-update` — **헬프에 없지만 에러 없이 수용됨**(exit 0). 붙여도 안전. 절대 원칙 #3 유지 가능.
- **`--always-approve` — 헤드리스 편집에 필수.** 없으면 승인을 기다리다 취소될 수 있다.
- **제거됨 (1.0.3, exit 2):** `--check`, `--best-of-n`. verify는 프롬프트 접미사로 대체.
- **`--worktree`는 헤드리스 `-p`에서 worktree를 만들지 않는다** (헬프·실측). 래퍼가
  `git worktree add` 한다.
- 기본 모델: `grok models` → **`grok-4.6`** (추가로 `grok-4.5`). `grok-build`는 unknown.

## 2. 출력 스키마 (정정됨 — 플랜 가정과 다름)

### `--output-format json` (권장): 단일 JSON 객체
```json
{
  "text": "Creating `hi.txt` ... Created `hi.txt` with the content `hey`.",
  "stopReason": "end_turn",
  "sessionId": "01a00048-...",
  "requestId": "c66d6378-...",
  "thought": "The user wants me to create ...",
  "usage": { "input_tokens": 19690, "output_tokens": 37 },
  "num_turns": 1,
  "modelUsage": { "grok-4.6-build": { "inputTokens": 19690, "outputTokens": 37 } }
}
```
- `text` — 어시스턴트 최종 텍스트(요약으로 사용). `thought` — 추론(요약에서 제외).
- **성공 판정은 `stopReason`.** 1.0.3 관측값: **`"end_turn"`**(정상 완료). 0.2.x는
  `"EndTurn"`. 플러그인은 둘 다 성공으로 본다 (`isSuccessfulStopReason`).
  `"cancelled"` / `"Cancelled"` 는 실패.
- 1.0은 `usage` / `num_turns` / `modelUsage` / `total_cost_usd`를 붙일 수 있다. 파서는
  무시한다 (위임 요약·`billing`에 쓰지 않음). **실측 2026-08-15:** 세션 토큰만 있고
  `XAI_API_KEY` UNSET인 헤드리스 `-p "Say ok."`도 `stopReason: "end_turn"`과 함께
  `total_cost_usd`를 냈다. 이 숫자는 플러그인 `billing`이 아니다 — `billing`은 서버
  `GROK_BUILD_AUTH_MODE`만 따른다.
- 파서 = `JSON.parse(stdout)`. 토큰 이어붙이기 불필요.

### `--output-format streaming-json`: JSONL, 토큰 조각
```
{"type":"thought","data":"The"}
{"type":"text","data":"Creating"}
...
{"type":"end","stopReason":"EndTurn","sessionId":"...","requestId":"..."}
```
- 이벤트 타입은 **`thought` / `text` / `end` 뿐**. `data`는 토큰 조각(단어 단위)이라 이어붙여야 함.
- **`tool_use`/`file_edit` 같은 도구·파일 변경 이벤트가 전혀 없다.** (플랜의 `file_edit`/`result`
  가정은 틀림.)

→ 스트리밍이 불필요하므로 **MVP는 `--output-format json`을 쓴다** (파싱 단순, 동일 정보).

## 3. 변경 파일 탐지 (정정됨)

grok 출력(json/streaming-json 어느 쪽도)에 **변경 파일 목록이 없다.** 따라서:

- 변경 파일은 **git으로 도출**한다. 플러그인은 spawn **전후** `git -C <cwd> -c core.quotepath=false status --porcelain -z` 차집합(`diffChangedFiles`, after \\ before)이다.
- ⚠️ MCP 서버는 grok stdout을 **메모리로만** 캡처해야 한다. stdout을 cwd 안 파일로 리다이렉트하면
  그 파일이 `git status`에 잡혀 오탐이 된다. (현 delegate 설계는 메모리 캡처라 OK.)
- cwd가 git 저장소가 아니면 `filesChanged`는 빈 배열.
- ⚠️ **알려진 한계:** 위임 전부터 dirty였던 경로를 grok이 더 고치면 under-report된다. 정밀 귀속이 필요하면 `worktree: true`.

## 4. 종료 코드 (정정됨 — 중요)

**exit code는 성공/취소 모두 0이었다.** `--permission-mode acceptEdits`로 아무것도 못 하고
`Cancelled`된 경우에도 exit 0. → **`r.code !== 0`만으로 실패를 판정하면 안 된다.**
성공 여부는 `isSuccessfulStopReason` — 1.0.3 `"end_turn"` 또는 레거시 `"EndTurn"`.

## 5. 안전 모델에 미치는 영향 (사용자 결정 필요)

기존 설계는 "`--always-approve`를 기본으로 쓰지 않는다(안전)"였으나, 실측 결과
**헤드리스로 실제 편집을 하려면 `--always-approve`(혹은 그에 준하는 권한 모드)가 필수**다.
따라서 안전 모델을 다음으로 이동한다(사용자 승인 대상):
- grok은 대상 `cwd`(또는 `--worktree` 격리)에서 편집, **자동 커밋 없음**
- Claude/사람이 diff를 검토한 뒤에만 커밋
- 선택: `--sandbox <PROFILE>`(파일시스템/네트워크 제한), `--worktree`로 작업 격리

## 6. 부수 확인 (기존 미검증 주장 검증됨)

- **`--worktree`(git worktree 격리) 플래그 실재** — 다만 헤드리스 `-p`에서는 no-op이라 래퍼가 `git worktree add` 한다.
- **0.2.93:** `--best-of-n` + `--agent/--agents`가 병렬 탐색 근거였다.
- **1.0.3 (현재):** `--check` / `--best-of-n` **삭제** (exit 2). 플러그인은 `best_of_n`을 spawn 없이 거절한다. `--agent`/`--no-subagents`는 남아 있을 수 있으나 이 래퍼는 넘기지 않는다.
- `--sandbox`(env `GROK_SANDBOX`), `--permission-mode`(default|acceptEdits|auto|dontAsk|
  bypassPermissions|plan), `grok agent stdio|headless|serve`(ACP류) 존재.
- `--permission-mode plan` 헤드리스는 1.0.3에서 **`end_turn` + text**로 끝나며 파일을
  쓰지 않았다 (0.2.x는 `Cancelled` + text). 플러그인 plan은 text 유무로 성공 판정.

## 7. 플랜에 반영할 정정 요약

- Task 6 delegate 인자: `['--no-auto-update','--always-approve','--cwd',cwd,'-p',prompt,'--output-format','json']`
- Task 4: `summarizeStreamingJson` → `parseGrokResult(stdout): { text, stopReason }` (JSON.parse 기반)
- Task 6: 성공=`isSuccessfulStopReason` (`end_turn`/`EndTurn`); 실패 분류는 stopReason + stderr 신호; `filesChanged`는
  spawn 전후 porcelain 차집합
- Global constraint: `streaming-json` → `json`; `--always-approve` 필수(안전 모델 §5)
- 인증 만료/부재 신호 — **두 경로가 관측됨**:

  **A. 2026-07-13 (auth.json 치움, keyring 폴백 있을 수 있음):** 일부 환경에서 device-OAuth
  stderr + 블록 대기 → 래퍼 **timeout**. 신호: `accounts.x.ai/oauth2/device`,
  `Waiting for authorization` → timeout 분기에서 `auth_error`.

  **B. 2026-07-25 (격리 `USERPROFILE`/`HOME`, API 키 없음, Windows 실측):** 즉시 종료.
  ```
  stdout: {"type":"error","message":"Not signed in. ... grok login --device-code ... XAI_API_KEY ..."}
  stderr: Error: Not signed in. ...
  exit: 1
  ```
  → `parseGrokResult`가 `isError`/`stopReason: Error`로 파싱, `looksLikeAuthFailure` /
  `AUTH_ERROR_SIGNALS`(`not signed in`, `grok login --device-code`, …)로 **`auth_error`**.

  재현(실 홈 손상 없음): `cd mcp-server && npm run probe:unauth`.
