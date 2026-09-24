# grok CLI 계약 (실측)

- 플랫폼 Windows 11. 방법: `grok --help`, `grok models`, scratch git + 플러그인 `runDelegate` 실경로
- 측정 이력: 2026-07-12 against **0.2.93** → 2026-08-14 against **1.0.3** → 2026-09-02 against
  **1.0.13 (5e9a58528b76) [stable]** → 2026-09-22 against **1.0.30 (04b7ffed98c6) [stable]**.
  아래 본문의 "1.0.3에서 제거됨" 류 서술은 **유래**를 적은 것이라 그대로 유효하다 — 바꾸지 말 것.

> **유효 버전은 절마다 다르다.** 헤더의 버전 하나로 문서 전체를 대표시키면, 일부만 재실측했을 때
> 나머지까지 검증된 것처럼 읽힌다 (실제로 1.0.3 헤더가 1.0.5·1.0.13까지 유효한 것처럼 읽혔다).
> 재측정한 절만 날짜를 올린다.

| 절 | 마지막 실측 | 버전 |
|---|---|---|
| §1 헤드리스 호출 형태 | 2026-09-22 | 1.0.30 |
| §2 출력 스키마 | 2026-09-22 | 1.0.30 |
| §3 변경 파일 탐지 | 2026-09-02 | 1.0.13 |
| §4 종료 코드 | 2026-09-02 | 1.0.13 |
| §5 안전 모델 | 2026-09-02 | 1.0.13 |
| §6 부수 확인 | 2026-09-22 | 1.0.30 (**plan이 이제 쓰기를 막는다 — 1.0.13과 정반대**) |
| §7 auth 만료 신호 | 2026-09-05 | 1.0.13 (부재 + 거부 봉투; A는 재현 안 됨) |
| §8 grok home 위치 | 2026-09-02 | 1.0.13 |
| §9 확인 프롬프트 · stdin | 2026-09-02 | 1.0.13 |
| §10 인증 우선순위 | 2026-09-02 | 1.0.13 |
| §11 resume × sandbox | 2026-09-03 | 1.0.13 |
| §12 resume × cwd | 2026-09-05 | 1.0.13 |
| §13 sandbox on **Linux** | 2026-09-24 | 1.0.41 (**Linux에서 잰 절** — §14 일부도 Linux; 인증된 턴 포함) |
| §14 워커가 **이 플러그인을** 로드 | 2026-09-24 | 1.0.13·1.0.30 (win32, 세션 기록) · 1.0.30 (win32 실측) · 1.0.41 (Linux 실측) |

> **1.0.41 표면 (2026-09-24, Docker, 쿼터 0):** `probe:contract`를 컨테이너에서 돌린 결과 플래그·
> 서브커맨드는 1.0.30 스냅샷과 **동일**하고 `--no-auto-update`도 수용된다 — `NON_HEADLESS`/
> `KNOWN_SUBCOMMANDS` 재분류는 필요 없다. 모델 목록은 두 개(`grok-4.7`, `grok-4.7-build-fast`)가
> 빠져 보였지만 **미인증 상태에서 잰 값**이었다 — 합성 인증 세션은 1.0.30·1.0.41 모두
> `Available: grok-4.6, grok-4.5`만 말했고, **인증된 1.0.41**의 `grok models`는 `grok-4.7`(기본)·
> `grok-4.7-build-fast`·`grok-4.6`·`grok-4.5`로 probe의 모델 diff가 **0**이었다(2026-09-24). 목록은 인증 상태를 따른다. 스냅샷(`--update`)은
> 이 머신이 1.0.41이 된 뒤에 올린다 — 그 전에 올리면 이 머신이 갱신될 때까지 `drifted`가 참이 된다.

이 문서는 [Task 0](../plans/2026-07-12-phase1-two-track-mvp.md)에서 시작했다.

> ⚠️ **CLI는 스스로 업데이트된다.** 2026-09-02 세션 도중 `1.0.5 → 1.0.13`으로 자동 갱신된 것이
> 실측됐다(바이너리 mtime). 즉 이 문서의 버전은 "사용자 머신에 있는 버전"이 아니라 "마지막으로
> 재실측한 버전"이다. 계약에 의존하는 코드는 스냅샷이 낡는 것을 전제로 설계한다 —
> `grok-cli.ts`의 차단 판정이 값-플래그 목록에 의존하지 않는 이유가 이것이다.
>
> ⚠️ **그리고 이 문서는 *최신*보다도 뒤처질 수 있다 — 그건 `drifted`와 다른 질문이다.**
> 2026-09-23 실측: 설치 스크립트가 *"Fetching latest stable version… Installing Grok **1.0.41**"*
> 이라 말하는 동안 개발 머신도 스냅샷도 **1.0.30**이었고 probe는 `drifted: false`였다. 그 답은
> 옳다 — probe의 질문은 "이 머신의 CLI가 스냅샷에서 벗어났는가"이기 때문이다(Grok 판정:
> 헤더는 딱 그만큼만 주장한다). **"새 사용자가 받는 것과 계약이 맞는가"는 별개이고, 이제
> `snapshotBehindLatest`가 그것을 답한다** — 설치 스크립트가 읽는 것과 **같은 채널 포인터**
> (`https://x.ai/cli/<channel>`)를 읽으므로 두 번째 출처가 생기지 않는다.
> **셋을 구분한다:** `true`(뒤처짐) · `false`(일치) · `null`(**못 물어봤다** — 사유 동반).
> 일부러 `--strict`를 깨뜨리지 않는다: grok은 자주 릴리스하므로 그걸로 게이트를 붉히면 늑대를
> 외치는 게이트가 된다. 이 절의 1.0.30이 왜 1.0.41이 아닌지(플랫폼인지 미갱신인지)는 그 자체로는
> **미규명**이었고, 같은 날 win32에서 채널 포인터가 동일하게 `1.0.41`을 돌려주어 **플랫폼 차이가
> 아님**이 확인됐다 — 이 머신이 갱신되지 않았을 뿐이다.

## 1. 헤드리스 호출 형태 (정정됨)

**확정 호출:**
```
grok --no-auto-update --always-approve --cwd <DIR> "--single=<PROMPT>" --output-format json
```

- `-p, --single <PROMPT>` — 단일턴 헤드리스, stdout에 결과 출력 후 종료. ✓ 값은 `--single=<PROMPT>` 등호 형태로 붙인다 — bare 옵션 값에는 clap이 `-`로 시작하는 문자열을 거부해 `-p "- Refactor"`가 exit 2(빈 stdout, 모델 호출 없음)로 죽었다 (v0.2.13에서 정정, 1.0.13 실측).
- `--output-format <plain|json|streaming-json|streaming-messages-json>` [기본 plain].
  **`json` 권장** (아래 §2). 1.0 `streaming-json`은 `thought`/`text`/`end` 외에
  `available_commands`/`usage`/`tool_call`이 올 수 있다 — 이 플러그인은 쓰지 않는다.
- `--cwd <DIR>` — 작업 디렉토리. (`cd` 대신 사용해 셸 이슈 회피.)
- `--no-auto-update` — **헬프에 없지만 에러 없이 수용됨**(exit 0). 붙여도 안전. 절대 원칙 #3 유지 가능.
- **`--always-approve` — 헤드리스 편집에 필수.** 없으면 승인을 기다리다 취소될 수 있다.
- **제거됨 (1.0.3, exit 2):** `--check`, `--best-of-n`. verify는 프롬프트 접미사로 대체.
- **`--worktree`는 헤드리스 `-p`에서 worktree를 만들지 않는다** (헬프·실측). 래퍼가
  `git worktree add` 한다.
- 기본 모델은 **여기 박아두지 않는다.** 원천은 `grok models`뿐이고, 카탈로그는 스스로 움직인다
  (2026-08-14 `grok-4.6` → 2026-09-22 `grok-4.7` 기본 + `grok-4.7-build-fast` 티어 신설).
  `grok-build`는 여전히 unknown이라 `--model`을 생략한다.
  ⚠️ **카탈로그 id ≠ 실행 id** (2026-09-22 실측): `-m grok-4.7`로 돌려도 응답의 `modelUsage` 키는
  **`grok-4.7-build`**이고, 그 이름은 `grok models` 목록에 아예 없다. "어느 모델이 돌았나"의
  원천은 카탈로그가 아니라 **응답 봉투**다.
- **`--session-id <UUID>`** (2026-09-22 실측): 호출자가 실행 **전에** 세션 이름을 정할 수 있다.
  v4 UUID 수용(grok 자신의 id는 v7 모양이지만 헬프는 "valid UUID"만 요구), 봉투에 그대로 되돌아오고,
  **25초에 SIGKILL된 런도 그 id로 온전한 세션을 남긴다**(`chat_history.jsonl` 54KB, `sessions list`에
  요약까지 표시). `--resume`/`--continue`와는 `--fork-session` 없이는 **불법**이다(헬프).
- **`--max-turns <N>`** (2026-09-22 실측): `--max-turns 1`이 3파일 과제를 첫 파일에서 끊고
  **exit 1 + `cancelled` + stderr `Error: max turns reached`**, 부분 편집은 남는다. 시간이 아니라
  작업량 상한.
- **`--prompt-file <PATH>`** (2026-09-22 실측): 첫 글자가 `-`인 프롬프트도 그대로 통과한다.
  즉 §1의 equals-form 회피가 필요 없는 경로가 생겼다. 단 채택하려면 임시 파일이 `--sandbox`
  프로필 안에 있어야 하고, 프롬프트 전문이 담긴 **잔존 파일이 시크릿 노출면**이 된다(Grok 리뷰 지적).
- **`--rules <RULES>`** (2026-09-22 실측): 시스템 프롬프트에 규칙을 덧붙인다. 커밋 금지 규칙을
  주면 grok이 편집만 하고 커밋을 거부한다. **1.0.13 스냅샷에는 없으므로 무조건 붙이면 안 된다.**
- ⚠️ **`--tools` / `--disallowed-tools`는 이름을 검증하지 않는다** (2026-09-22 실측): 존재하지
  않는 툴 이름을 줘도 exit 0, 에러 없음. 안전장치로 쓰면 **오타 하나가 조용히 무력화**된다.

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
- 1.0은 `usage` / `num_turns` / `modelUsage` / `total_cost_usd`를 붙인다. **1.0.30에서는 항상
  붙었고(2026-09-22 실측), 플러그인은 v0.2.26부터 이것을 읽는다** — `tokens`·`turns`·`model`로
  결과와 이력에 싣는다(B3). 1.0.30 봉투 전문:

```json
"usage": { "input_tokens": 25641, "cache_read_input_tokens": 27648,
           "cache_creation_input_tokens": 0, "output_tokens": 270,
           "reasoning_tokens": 158, "total_tokens": 53559 },
"num_turns": 2,
"total_cost_usd": 0.02268684, "total_cost_usd_ticks": 226868400,
"modelUsage": { "grok-4.7-build": { "inputTokens": 25641, "outputTokens": 270,
                                    "cacheReadInputTokens": 27648, "modelCalls": 2,
                                    "costUSD": 0.02268684 } }
```

  ⚠️ **합산 함정 3개 (2026-09-22 직접 검증):**
  ① `input_tokens`와 `cache_read_input_tokens`는 **분리된 값**이다 — 합(53289)이 바로
  `grok usage <id>`가 말하는 `inputTokens`다. 그 위에 캐시를 또 더하면 이중계상.
  ② `total_tokens` = in + cacheRead + cacheCreation + out (53559). 우리가 다시 계산하지 않는다.
  ③ `reasoning_tokens`(158)는 `output_tokens`(270)의 **부분집합**이라 더하면 안 된다.
  그리고 `total_cost_usd_ticks` = `total_cost_usd` × 10¹⁰ (같은 수의 고정소수점 표현).
- ⚠️ **`total_cost_usd`는 플러그인이 노출하지 않는다.** **실측 2026-08-15 / 재확인 2026-09-22:**
  세션 토큰만 있고 `XAI_API_KEY` UNSET인 **구독** 실행도 `total_cost_usd`를 낸다. 봉투에는 어느
  과금인지 말하는 필드가 **없다** — `billing`은 서버 `GROK_BUILD_AUTH_MODE`만 따른다. 구독 사용자에게
  이 숫자를 "비용"으로 보여주면 일어나지 않은 청구를 말하는 것이다. 숫자가 필요하면
  `grok usage <SESSION_ID>`.
- 파서 = `JSON.parse(stdout)`. 토큰 이어붙이기 불필요.

### `--output-format streaming-json`: JSONL, 토큰 조각

전체 캡처: [`samples/grok-streaming-json-sample.jsonl`](samples/grok-streaming-json-sample.jsonl)
(131줄). 아래는 그것을 줄인 것이다 — **2026-09-22 감사에서 이 파일을 가리키는 것이 레포 전체에
하나도 없다는 것이 실측됐다.** 플러그인이 이 포맷을 쓰지 않으므로 코드가 참조할 일은 없지만,
지우는 대신 인용한다: 아래 요약이 실제 출력과 일치하는지 확인할 수 있는 유일한 근거다.

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

- 변경 파일은 **git으로 도출**한다. 플러그인은 spawn **전후** `git -C <cwd> -c core.quotepath=false status --porcelain -z -uall` 차집합(`diffChangedFiles`, after \\ before)이다.
- ⚠️ MCP 서버는 grok stdout을 **메모리로만** 캡처해야 한다. stdout을 cwd 안 파일로 리다이렉트하면
  그 파일이 `git status`에 잡혀 오탐이 된다. (현 delegate 설계는 메모리 캡처라 OK.)
- cwd가 git 저장소가 아니면 `filesChanged`는 빈 배열.
- ⚠️ **알려진 한계:** 위임 전부터 dirty였던 경로를 grok이 더 고치면 under-report된다. 정밀 귀속이 필요하면 `worktree: true`.

## 4. 종료 코드 (정정됨 — 중요)

**exit code는 성공/취소 모두 0이었다.** `--permission-mode acceptEdits`로 아무것도 못 하고
`Cancelled`된 경우에도 exit 0. → **`r.code !== 0`만으로 실패를 판정하면 안 된다.**
성공 여부는 `isSuccessfulStopReason` — 1.0.3 `"end_turn"` 또는 레거시 `"EndTurn"`.

## 5. 안전 모델에 미치는 영향 (결정 완료 — Phase 1 MVP(0.1.0)에 배포됨)

기존 설계는 "`--always-approve`를 기본으로 쓰지 않는다(안전)"였으나, 실측 결과
**헤드리스로 실제 편집을 하려면 `--always-approve`(혹은 그에 준하는 권한 모드)가 필수**다.
따라서 안전 모델을 다음으로 이동했다 — **승인·배포 완료**(절대 원칙 #1, `delegate.ts`):
- grok은 대상 `cwd`(또는 `--worktree` 격리)에서 편집, **자동 커밋 없음**
- Claude/사람이 diff를 검토한 뒤에만 커밋
- 선택: `--sandbox <PROFILE>`(파일시스템/네트워크 제한), `--worktree`로 작업 격리

## 6. 부수 확인 (기존 미검증 주장 검증됨)

- **`--worktree`(git worktree 격리) 플래그 실재** — 다만 헤드리스 `-p`에서는 no-op이라 래퍼가 `git worktree add` 한다.
- **0.2.93:** `--best-of-n` + `--agent/--agents`가 병렬 탐색 근거였다.
- **1.0.3에서 삭제, 1.0.13에서도 그대로:** `--check` / `--best-of-n` (exit 2). 플러그인은 `best_of_n`을 spawn 없이 거절한다.
- `--agent <NAME>`·`--no-subagents`는 **1.0.13 `--help`에 실재한다**(2026-09-03 실측) — 다만 이 래퍼는 넘기지 않는다.
- `--sandbox`(env `GROK_SANDBOX`), `--permission-mode`(default|acceptEdits|auto|dontAsk|
  bypassPermissions|plan), `grok agent stdio|headless|serve`(ACP류) 존재.
- ✅ **1.0.30에서 `--permission-mode plan`은 다시 쓰기를 막는다 (2026-09-22 실측).** 같은 스크래치
  저장소에 "파일을 만들어라"를 헤드리스로 줬더니 **파일이 생기지 않았고 `stopReason: cancelled`**
  로 끝났다. 아래 1.0.13 문단과 **정반대**다.
  ⚠️ 그렇다고 `planWroteFiles`를 지우면 안 된다. 이 절의 역사가 보여주는 것은 "plan이 안전하다"가
  아니라 **이 동작이 릴리스마다 뒤집힌다**는 것이다(1.0.3 막음 → 1.0.13 안 막음 → 1.0.30 막음).
  CLI는 스스로 업데이트하므로, 사용자 머신의 grok이 어느 쪽인지 이 문서는 알 수 없다. 탐지는
  **이번 실행의 사실**이라 버전과 무관하게 유효하다.
  ⚠️ 또한 이 머신에서는 `--always-approve` 없이도 편집이 되는데, 그것은 사용자
  `~/.grok/config.toml`에 `[ui] permission_mode = "always-approve"`가 있기 때문이다 —
  **이 머신에서 §5 안전 모델은 재측정할 수 없다.** 아래 1.0.13 기록은 그대로 둔다:
- ⚠️ **`--permission-mode plan`은 1.0.13에서 쓰기를 막지 않았다 (2026-09-05 실측).**
  1.0.3에서는 `end_turn` + text로 끝나며 파일을 쓰지 않았는데(0.2.x는 `Cancelled` + text),
  1.0.13 헤드리스 `--single=`에서는 **파일을 생성한다** — 플러그인 경유·플러그인 없이 직접
  실행 양쪽에서 재현. `--sandbox read-only`·`--sandbox strict`도 win32에서 막지 못했고,
  `--always-approve`를 빼도 썼다. 즉 **1.0.13에는 쓰기를 막는 플래그가 없다**; 봉쇄 수단은
  격리(`--worktree`/버릴 cwd)뿐이다. 플러그인은 막을 수 없으므로 **탐지해서 보고**한다 —
  `grok_build_plan`이 before/after porcelain + `git diff HEAD` 해시를 비교해
  `planWroteFiles`로 알린다(v0.2.19). 성공 판정은 여전히 text 유무.

## 7. 인증 만료/부재 신호 (+ 2026-07 플랜 정정 요약)

- Task 6 delegate 인자: `['--no-auto-update','--always-approve','--cwd',cwd,'--single='+prompt,'--output-format','json']`
- Task 4: `summarizeStreamingJson` → `parseGrokResult(stdout): { text, stopReason }` (JSON.parse 기반)
- Task 6: 성공=`isSuccessfulStopReason` (`end_turn`/`EndTurn`); 실패 분류는 stopReason + stderr 신호; `filesChanged`는
  spawn 전후 porcelain 차집합
- Global constraint: `streaming-json` → `json`; `--always-approve` 필수(안전 모델 §5)
- 인증 만료/부재 신호 — **세 경로가 관측됨** (A는 1.0.13에서 재현되지 않음):

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

  재현(실 홈 손상 없음): `cd mcp-server && npm run probe:unauth`. **2026-09-02 재실측(1.0.13):**
  B 봉투 그대로 — exit 1, `notSignedIn` 신호 매칭. 단 격리는 `HOME`/`USERPROFILE`이 아니라
  **`GROK_HOME`으로 고정해야** 한다(§8). 프로브는 `process.env`를 펼치므로 개발자 머신에
  `GROK_HOME`이 있으면 격리가 뚫려 **실제 세션으로 과금**됐다 — 실측으로 확인하고 고쳤다.

  **C. 2026-09-05 (1.0.13, win32) — 세션 "만료"는 대기가 아니라 폐기다.** A·B는 세션의
  **부재**만 측정한다. 만료는 auth.json이 **있는데 거부되는** 경우이고 CLI 안에서 다른
  경로다. 재현: `cd mcp-server && npm run probe:expired` (합성 auth.json을 격리
  `GROK_HOME`에 쓴다 — 실 `~/.grok`은 읽지도 쓰지도 않는다). 3회 연속 동일:

  | 변형 | auth.json | 결과 (exit 1, 첫 출력 10~20초) |
  |---|---|---|
  | C1 | `expires_at` 과거 + 갱신 실패 | `Not signed in.` — **B와 같은 봉투** |
  | C2 | `expires_at` 미래 + 서버가 거부 | `Unauthorized (401) … Invalid or expired credentials` |
  | B  | 파일 없음 (대조군) | `Not signed in.` |

  - **어떤 변형도 device-OAuth를 띄우거나 기다리지 않는다** — A 경로(블록 → wrapper timeout)는
    1.0.13에서 재현되지 않았다. 만료 세션의 답은 **폐기**다. 만료 순간을 사람이 캡처해 줄
    필요가 사라졌다.
  - ⚠️ **C2 봉투에는 옛 auth 신호가 하나도 없다.** `not signed in`도 `grok login`도 없고,
    오히려 xAI의 상용구가 *"Your session is still signed in … no need to run /login"* 이라고
    **정반대**를 말한다. `AUTH_ERROR_SIGNALS`에 `invalid or expired credentials`를 넣기 전에는
    이 경로가 `grok_error`로 분류돼 **그 문장이 그대로 사용자 안내가 됐다**(v0.2.18에서 수정).
    401/403 상태코드 자체는 여전히 신호가 아니다 — 매칭하는 것은 자격증명 문구다.
  - 프로브 주의: auth.json 항목 키는 `<oidc_issuer>::<oidc_client_id>`이고, 그 UUID는
    항목의 `oidc_client_id`와 같다(사용자 id가 **아니다**). 다른 UUID로 쓰면 CLI가 항목을
    찾지 못해 세 변형이 전부 B로 무너지고, 프로브는 조용히 `probe:unauth`의 사본이 된다.

## 8. grok home 위치 — `GROK_HOME`이 유일한 스위치 (2026-09-02, 1.0.13)

grok README: `GROK_HOME — Override config directory (default: ~/.grok)`.

```
grok --no-auto-update du --json                    → grok_home: C:\Users\dirtc\.grok
GROK_HOME=<tmp> grok --no-auto-update du --json    → grok_home: <tmp>
grok --no-auto-update models                       → "You are logged in with grok.com."
GROK_HOME=<tmp> grok --no-auto-update models       → "You are not authenticated."
```

- **폴백이 없다.** `GROK_HOME` 아래 `auth.json`이 없으면, `~/.grok/auth.json`이 멀쩡해도
  미인증이다. 따라서 auth 탐지는 반드시 `GROK_HOME`을 따라가야 한다 (`env.ts` `grokHome`,
  `auth.ts` `authFilePath`).
- **`HOME`/`USERPROFILE`은 grok home을 움직이지 못한다** (win32 실측):
  `env -u HOME -u GROK_HOME grok du --json` → 정상 동작, `grok_home` 불변.
  `env -u GROK_HOME HOME=<tmp> grok du --json` → `grok_home` 불변.
- **바이너리는 따라 움직이지 않는다.** install.sh는 `BIN_DIR="${GROK_BIN_DIR:-$HOME/.grok/bin}"`이고
  `GROK_HOME`을 읽지 않는다. `GROK_HOME=<tmp>`로 옮겨도 `where grok`은 `~/.grok/bin/grok.exe` 그대로.
  → `grokBinDir`가 `grokHome`과 **독립인 것이 옳다**.
- 기본값이 겹쳐 보이는 이유는 둘 다 `~/.grok`을 기본으로 쓰기 때문일 뿐, 종속 관계가 아니다.
- 플러그인 소유 디렉토리 `~/.grok-build`(worktrees·history)는 grok 설정이 아니므로
  `GROK_HOME`을 따르지 **않는다**.

## 9. 확인 프롬프트 — 헤드리스에서 stdin은 열려 있으면 안 된다 (2026-09-02, 1.0.13)

`memory clear`는 `Are you sure? [y/N]`를 띄운다. 동일 argv, stdio만 다르게 실측:

```
stdin=pipe    → 25098ms, 타임아웃 강제 종료, exit null, 아무것도 안 지워짐
stdin=ignore  →   428ms, exit 0, "Are you sure? [y/N] Cancelled."
```

이 래퍼는 헤드리스 전용(프롬프트는 `-p`/`--prompt-file` argv로 전달)이라 stdin을 `ignore`로
둔다 → `defaultSpawn`. 같은 형태의 프롬프트가 `plugin install`(`--trust`),
`plugin uninstall`(`--confirm`), `doctor fix`(`--yes`)에도 있고 셋 다 denylist에 없다.
열거보다 구조적 차단이 낫다. 실제로 지우려면 `-y`가 필요하다 (`commands/memory.md`).

## 10. 인증 우선순위 — 세션이 있으면 env 키는 **쓰이지 않는다** (2026-09-02, 1.0.13)

절대 원칙 #1(구독 모드에서 API 키 env 제거)의 근거를 실측했다. **원칙은 유지되지만, 오래
적혀 있던 근거는 1.0.13에서 사실이 아니다.**

### 잘못된 측정법 — `grok models`는 요청 인증을 말해주지 않는다

```
grok --no-auto-update models                          → "You are logged in with grok.com."
XAI_API_KEY=xai-BOGUS… grok --no-auto-update models   → "You are using XAI_API_KEY."
GROK_CODE_XAI_API_KEY=xai-BOGUS… grok … models        → "You are using XAI_API_KEY."
```

이 상태 문구는 **env에 변수가 있느냐**만 보고한다. 이걸 근거로 "키가 우선"이라고 결론내면
틀린다. 실제 요청이 어느 자격증명으로 나가는지는 별개다.

### 결정적 실측 — 실제 요청을 걸어본다

같은 env(가짜 키 존재 + 유효 세션)로 진짜 한 턴을 돌린다:

```
XAI_API_KEY=xai-BOGUS… grok --no-auto-update -p "Say ok." --output-format json --debug-file dbg.log
→ exit 0, stopReason "end_turn", text "ok"     (401이 아니다)
```

디버그 로그가 순서를 그대로 보여준다:
```
phase=eager_auth
auth: authenticate request method=cached_token
auth: cached_token handler set api_key (SessionToken)
authenticate response: auth_mode "Oidc", <계정>
```
→ **`auth_type=SessionToken`. API 키는 시도조차 되지 않는다.** `xai-` + 80자로 형식을 맞춘
무효 키로 반복해도 동일하게 세션으로 나갔다 — 즉 "형식이 틀려서 무시된 것"이 아니다.

**측정 범위(이 밖으로 일반화 금지):** 헤드리스 `-p … --output-format json` 5가지 형태에서
전부 `auth_type=SessionToken` / `method=cached_token`, exit 0 — ① 기본 ② `-m grok-4.5`
③ `--permission-mode plan` ④ 연속 2회차(캐시 상태) ⑤ `XAI_API_KEY` 대신
`GROK_CODE_XAI_API_KEY`. 어떤 로그에도 `auth_type=ApiKey` / `has_api_key`가 없었다.
**미측정:** `-p` 밖의 서브커맨드, 만료된 세션, `--resume`.

### 문서 두 곳이 서로 반대다 — 실측은 user-guide 쪽이다

| 출처 | 문장 | 실측과 |
|---|---|---|
| `~/.grok/README.md` L111 (퀵스타트) | *"The API key takes precedence over browser credentials."* | **불일치** |
| `~/.grok/docs/user-guide/02-authentication.md` L53 | *"Grok uses the API key as a fallback when no session token is active. If you have already signed in interactively, the stored session token takes precedence."* | **일치** |
| 같은 문서 L289–291 (전역 순서) | ① per-model `api_key`/`env_key` → ② **세션 토큰** → ③ `XAI_API_KEY` 폴백 | **일치** |

README 한 줄은 "아직 로그인 안 한 CI 환경" 맥락의 퀵스타트 문장이다. 전역 우선순위의
정본은 user-guide다.

### per-model `api_key`는 실제로 세션을 이긴다 (실측)

격리 `GROK_HOME` + 세션 복사 + `config.toml`에 per-model 키를 넣고 측정:
```
[model."grok-4.6"]        ← 따옴표 필수 (아래 함정)
api_key = "<bogus>"
→ debug: has_api_key=true, auth_type=ApiKey, model_byok="byok", 401
```
→ **env 정제로는 막을 수 없다.** 이 플러그인의 범위 밖이며 감지도 하지 않는다.

⚠️ **TOML 함정:** `[model.grok-4.6]`은 dotted key로 파싱돼 `model.grok-4` + 필드 `6`이 되고
설정이 **조용히 무시**된다(`grok inspect`가 `key=grok-4 field=6` 경고). 반드시
`[model."grok-4.6"]`처럼 따옴표로 감싼다. README의 예시 자체가 같은 함정을 안고 있다.

### 그래서 원칙 #1은 왜 유지되나 — 근거를 바꾼다

env 정제의 정당성은 "키가 세션을 이긴다"가 **아니다**(1.0.13에서 반증됨). 정당성은:

1. **구독 모드는 종량제 자격증명을 아예 쥐지 않는다는 정책 보장**이다. 세션이 없거나 만료된
   순간 env 키는 폴백 경로가 되고(user-guide ③), 그때 구독 모드 실행이 조용히 종량제로
   넘어갈 수 있다. 키를 지우면 그런 실행은 조용히 과금되는 대신 `auth_error`로 **명시적으로
   실패**한다(§7-B). 이건 우선순위 문제가 아니라 실패 모드 선택 문제다.
2. 문서가 서로 반대이고 CLI는 스스로 업데이트된다. 관측되지 않은 조합(유효한 실키)에
   플러그인의 과금 정확성을 걸지 않는다.

**미측정으로 남는 것:** *유효한* 실제 API 키. 안전상 주입하지 않았다. 세션이 있을 때 grok이
키를 시도조차 하지 않는 것은 확인했지만, 유효 키에서 코드 경로가 갈릴 가능성은 배제하지
못한다. 위 1번 정당성은 그 결과와 무관하게 성립한다.

### 자격증명의 출처는 API 키 둘보다 넓다 (2026-09-24, 1.0.30)

- **`GROK_AUTH_PROVIDER_COMMAND`** — grok README가 문서화한 외부 토큰 발급기. 실측(가짜 발급기, 쿼터 0):
  합성 `auth.json`이 있는데도 grok은 **세션을 열 때 발급기를 불렀고**, 그 토큰으로 추론을 네 번 재시도한 뒤
  401로 끝냈다("Auth recovery succeeded but 4 authenticated inference requests were still rejected"). README는
  401 뒤 `GROK_AUTH_EXPIRED=1`을 붙여 다시 부르는 헤드리스 갱신 계약도 적는다. 즉 **발급기가 진짜면 거부될
  세션이 인증된다.**
- 바이너리 문자열에는 자격 성격의 변수가 더 있다: `GROK_AUTH_PATH`, `GROK_AUTH_PROVIDER_ACCESS_TOKEN` /
  `_REFRESH_TOKEN` / `_EXPIRES_AT`, `GROK_DEPLOYMENT_KEY`, `GROK_ALPHA_TEST_KEY`, `GROK_OAUTH2_*`, `GROK_OIDC_*`.
  **의미와 과금 성격은 미측정이다.**
- 그래서 **실계정에 닿으면 안 되는 프로브**(`probe-expired-session`, `worker-marker-probe`)는 부모 env의
  `GROK_*`·`XAI_*`를 **전부** 지운다(`scripts/synthetic-auth.mjs`의 `isolatedGrokEnv`). 반면 플러그인 본체의
  구독 모드(`buildGrokEnv`)는 원칙 #1대로 종량제 키 둘만 지운다 — 다른 변수가 종량제 폴백이 되는지는
  `docs/10` B6이다.

## 11. resume × sandbox — 세션의 프로필은 고정이다 (2026-09-03, 1.0.13)

`grok_build_delegate`/`verify`는 `resume`과 `sandbox`를 각각 옵셔널 입력으로 받고 같은 argv에
싣는다. 그 조합이 grok에서 어떻게 끝나는지 실측했다 — 스크래치 git repo, 헤드리스 `-p`.

```
grok --sandbox workspace -p "Say ok." --output-format json
  → end_turn, sessionId 01a064fd-…            (세션 생성, 프로필 workspace로 고정)

grok --resume <id> --sandbox read-only -p "…"  → exit 1, stdout 0바이트, stderr:
  error: cannot resume this session under sandbox profile 'read-only' — it was created
  with 'workspace'. Omit --sandbox to resume with 'workspace', or start a new session
  to use 'read-only'.

grok --resume <id> --sandbox workspace -p "…"  → end_turn  (같은 프로필은 허용)
grok --resume <id> -p "…"                      → end_turn  (생략 시 저장된 프로필로 재개)
```

즉 **프로필은 세션 수명 동안 고정**이며 다른 값으로 재개하면 거부된다(설치본 user-guide
`18-sandbox.md` "Resuming Sessions"와 일치).

**래퍼에서의 귀결 (코드 변경 불필요):** exit 1 + 빈 stdout이므로 `parseGrokResult`가 던지고,
stderr에 device-flow 마커가 없어 auth로 오분류되지 않는다 → `grok_error`,
message "Grok Build 출력을 해석할 수 없습니다.", 그리고 **`rawStderrTail`에 grok의 안내 문구가
그대로 실린다**(191자로 500자 컷 안). 즉 호출자는 무엇을 고쳐야 하는지 받는다 — 별도 가드를
넣지 않는 이유다.

## 12. resume × cwd — `--resume`이 `--cwd`를 덮어쓴다 (2026-09-05, 1.0.13)

세션은 **자기가 태어난 디렉터리에 묶인다.** 버릴 git repo 두 개로 실측:

```
delegate {prompt:"Create b.txt …", cwd:<dirB>}                  → completed, b.txt in dirB, sessionId S
delegate {prompt:"Create a.txt …", cwd:<dirA>, resume:S}        → completed
  실제 결과: a.txt는 **dirB**에 생성됨. dirA는 비어 있음.
  0.2.19 응답: filesChanged: []  ← 요청한 cwd만 봤으므로 아무 신호도 없었다
```

즉 `--cwd dirA`는 무시된다. grok이 세션을 어디에 두는지는 파일시스템에 드러난다 —
`<grokHome>/sessions/<url-encoded cwd>/<sessionId>/` (win32 실측: 디렉터리 이름은
`C%3A%5CUsers%5C…`, 즉 `encodeURIComponent`된 **백슬래시** 경로. 요청은 슬래시로 나가므로
비교 전에 정규화해야 한다).

**래퍼에서의 귀결 (v0.2.20, `docs/10` A3):** `resume`이 주어지면 spawn **전에** 그 세션의
소유 디렉터리를 찾아, 다르면 그쪽 디렉터리의 porcelain 델타도 함께 잰다. 결과에는
`resumedCwd`와 한국어 경고가 붙는다. `--continue`는 사전에 세션을 특정할 수 없어 실행 후
`resumedCwd`와 경고만 붙고 파일 주장은 하지 않는다(그 디렉터리의 before 스냅샷이 없으므로
기존 dirty를 이 실행의 결과로 돌릴 수 없다).

⚠️ 이 조회는 **이 레포가 소유하지 않은 레이아웃**을 읽는다. 못 찾으면 아무 주장도 하지 않고
0.2.19 이전과 동일하게 조용히 지나간다 — 틀린 주장보다 무주장이 낫다.

## 13. sandbox는 Linux에서 **fail-closed**다 (2026-09-23, 1.0.41, Docker/Debian bookworm)

> **win32가 아닌 곳에서 잰 절이다(§14 일부도 그렇다).** 다른 절의 win32 관찰을 여기에,
> 여기 관찰을 다른 절에 옮기지 말 것 — 강제 주체가 아예 다르다(win32는 커널 강제가 없다, §6).

- **`--sandbox <PROFILE>`은 고정 enum이 아니다.** `--help`에 `[possible values:]`가 없고
  (`--permission-mode`에는 있다), 이름은 `~/.grok/sandbox.toml`·`.grok/sandbox.toml`에서
  해석된다. 모르는 이름은 `error: sandbox profile resolve failed: Custom sandbox profile 'X'
  not found`로 죽는다. `off`·`none`은 프로파일 해석 없이 통과한다.
- **deny 목록이 있는 프로파일은 bubblewrap을 요구하고, 없으면 실행을 거부한다.**
  `workspace`로 실측: `error: this sandbox could not enforce its deny list on Linux: bwrap exec
  failed: No such file or directory (os error 2). Install bubblewrap with 'apt install -y
  bubblewrap'. **Refusing to start with denied paths unprotected.**` — exit 1, stdout 0바이트.
  bwrap이 있어도 user namespace가 막히면 `bwrap: Creating new namespace failed: Operation not
  permitted`로 같은 자리에서 죽는다. 바이너리 문자열에 Landlock 폴백 경로가 있지만
  (`Falling back to Landlock sandbox`), deny 목록은 Landlock만으로 못 하므로 여기서는
  폴백하지 않는다.
- **이 검사는 인증보다 먼저다.** 같은 호출이 sandbox 없이는 401까지 갔고, `GROK_SANDBOX=workspace`
  에서는 모델에 닿지도 못했다. 즉 샌드박스 거부는 **과금되지 않는다** — 그래서 자격증명 없이
  잴 수 있었다(합성 `auth.json`으로 서버 게이트만 통과시킴).
- ⚠️ **env 별칭이 곧 함정이다.** `--sandbox`는 `[env: GROK_SANDBOX=]`를 갖는다. 호출자가
  아무것도 넘기지 않아도 오퍼레이터 셸의 `GROK_SANDBOX` 하나가 위임 결과를 바꾼다.
  4-arm 실측(통제=미설정 → auth_error, 처리=`workspace` → 시작 거부, 파라미터=동일,
  통제2=`off` → auth_error로 복귀)으로 **원인이 그 변수임이 확정**됐다. 래퍼 대응은 A33.
- **bwrap이 정상 동작할 때 응답은 샌드박스를 전혀 보고하지 않는다.** 4-arm을 `--privileged`로
  다시 돌리면 네 응답이 `sessionId`만 빼고 바이트 동일하다. 즉 **위임이 샌드박스 안에서 돌았는지
  아닌지를 호출자는 응답으로 알 수 없다.** 이것을 응답에 싣지 않는 이유는 `docs/10` B4 주석이
  원천이다 — "값이 전달됐다"와 "제약이 작동했다"는 다른 주장이기 때문이다.
- **인증된 턴에서 쓰기는 실제로 막힌다 (2026-09-24, 1.0.41, `--privileged`로 bwrap 동작).** 컨테이너
  전용 로그인(별도 Docker 볼륨의 `GROK_HOME`, 측정 뒤 로그아웃·볼륨 삭제)으로 같은 4단계 과제를 두
  arm으로 돌렸다:

  | 쓰기 | `sandbox: workspace` | `sandbox: off` (통제) |
  |---|---|---|
  | cwd 안 (grok 파일 도구) | 성공 | 성공 |
  | `/srv` (파일 도구) | **실패** `Permission denied (os error 13)` | 성공 |
  | `/srv` (셸 `echo >`) | **실패** `Permission denied` | 성공 |
  | `/tmp` (파일 도구) | 성공 — 프로파일이 허용 | 성공 |

  통제가 전부 성공했으니 막은 것은 권한이 아니라 샌드박스다. **파일 도구와 셸이 똑같이 막힌다.**
  `/tmp`는 `workspace`가 허용한다. 그리고 두 arm 모두 응답의 `filesChanged`는 `["inside.txt"]`뿐이었다 —
  cwd 밖의 쓰기는 샌드박스가 없어도 `filesChanged`에 나타나지 않는다(차집합이 cwd 기준이다).

재현 환경(정확히 이것이어야 한다):

```
docker run --rm --network host --privileged \
  -v <scratch>:/probe:ro -v <repo>:/repo:ro <image> bash /probe/e2e.sh
```

- `--network host`가 **필수**다. 이 머신의 브리지 네트워크는 UDP 53이 블랙홀이라 컨테이너
  DNS가 죽는다(호스트 리졸버가 `198.18.0.33`/`127.0.0.1`). BuildKit은 `--network host`를
  빌드 스텝에 적용하지 않으므로 **빌드 타임에 네트워크를 쓰지 말 것** — grok 설치는 런타임에
  하고 `docker commit`으로 굳힌다. `deb.debian.org`는 이 리졸버에서 해석되지 않는다
  (`mirror.kakao.com`은 된다).
- `--privileged`가 없으면 bwrap이 user namespace를 못 만든다(seccomp/apparmor unconfined로도
  안 됨 — 실측). 없는 상태가 곧 "bwrap 실패" 케이스라 그것대로 쓸모는 있다.

## 14. grok은 설치된 Claude Code 플러그인을 **자기 것으로 로드한다 — 이 플러그인까지** (2026-09-24)

> 이 플러그인이 띄우는 **모든 워커 안에 이 플러그인의 MCP 서버 사본이 뜬다.** 래퍼 대응은 A34
> (`GROK_BUILD_WORKER`, `docs/04` "워커 안에서는…"). 근거는 세 층이다: 세션 기록(win32, 1.0.13 —
> 이 머신은 2026-09-13에 1.0.30이 됐다 — 과 1.0.30에 걸침), 실측 1.0.30 win32, 실측 1.0.41 Linux.
> **plan 모드 동작은 릴리스마다 뒤집히므로(§6) 아래 수치는 버전을 붙여 읽을 것.**

- **무엇을 로드하나.** `grok inspect --json`의 `externalCompat.cells`에서 vendor `claude`의
  `skills·rules·agents·mcps·hooks·sessions`가 모두 `enabled: true (source: default)`다. 설치된 `grok`
  플러그인에서 MCP `grok-build`(도구 9), 스킬 29(커맨드 27 + 스킬 2), 에이전트 `grok:grok-worker`,
  `hooks/hooks.json`을 가져간다. 전역 `~/.claude/CLAUDE.md`도 projectInstructions로 읽는다.
- **어디서 찾나.** `~/.claude/plugins/installed_plugins.json`(`installPath`)과 `~/.claude/settings.json`
  (`enabledPlugins`). 1.0.41 컨테이너에 이 두 파일만 만들어(installPath = 레포) 같은 로드를
  재현했다 — `grok mcp doctor`가 레포 번들에 붙어 도구 9개를 봤다.
- **정말 뜬다 (win32).** 워커 `grok.exe`의 자식으로 `node …/grok/0.2.31/mcp-server/dist/index.js`가
  뜨는 것을 프로세스 트리에서 4회 봤다. **MCP를 구성한 세션은 전부** `grok-build`를 시작했다
  (2026-09-24 기록 937개 중 932개. 나머지 5개는 MCP를 구성하기 전에 끝났거나 MCP를 구성하지 않은
  하위 세션이다 — 문서 검토자 재계수).
- **env는 그대로 넘어간다 — A34가 기대는 유일한 전제다.** 실제 사본과 같은 조건으로 쟀다: **헤드리스
  `--single` 세션**이 **플러그인 출처** MCP 서버를 띄울 때 부모의 `GROK_BUILD_WORKER=1`이 도달했다 —
  1.0.30 win32, 1.0.41 Linux(샌드박스 없음 / `GROK_SANDBOX=workspace` bwrap 둘 다). 합성 `auth.json`이라
  세션은 MCP 서버를 띄운 뒤 첫 요청이 401로 끝나 쿼터를 쓰지 않는다. 이 측정이 곧
  `npm run probe:contract`의 `workerMarker`다(`scripts/worker-marker-probe.mjs`) — grok이 업데이트로
  이 동작을 바꾸면 거기서 `reached: false`가 되고 `--strict`가 실패한다. 서버 설정에 `env` 블록이 있어도
  **대체가 아니라 합쳐진다** — api 모드용 `"env": { "GROK_BUILD_AUTH_MODE": "api" }`를 둔 프로브가
  설정값과 부모의 `GROK_BUILD_WORKER=1`을 둘 다 받았다(doctor, 1.0.30). 이 probe는 부모 env의
  `GROK_*`·`XAI_*`를 전부 지우고 돈다 — 토큰 발급기가 합성 세션을 진짜로 인증할 수 있기 때문이다(§10 끝).
  세션이 **받아들여지면**(exit 0) `sessionAccepted`로, grok이 플러그인 서버를 아예 안 띄우면 `blind`로
  보고하며 둘 다 `--strict`를 실패시킨다.
- **끄는 스위치는 이 플러그인을 못 끈다.** 바이너리 문자열에 `GROK_CLAUDE_{SKILLS,RULES,AGENTS,MCPS,
  HOOKS,SESSIONS}_ENABLED`가 있다(헬프에는 없다). `GROK_CLAUDE_MCPS_ENABLED=0`은 셀을 `false (env)`로
  바꾸고 `~/.claude.json` 출처 서버를 `compatibilityStatus: disabled`로 만들지만, **플러그인 출처
  서버는 이 플러그인을 포함해 그대로 로드된다.**
- **워커는 실제로 부른다.** 형태는 메타도구 `use_tool` + `tool_name: "grok-build__grok_build_delegate"`
  (먼저 `search_tool`로 찾는다). 실사용 기록에서 3회(09-06·07·12, **셋 다 1.0.13**) 나왔고, 전부
  리뷰형 프롬프트를 `grok_build_verify`로 다시 넘기려 한 것이다. 1회는 worktree로 격리된 런에서
  **본 저장소** cwd를 지목했다.
- **권한 게이트는 모드가 가른다.** plan(`yolo_mode: false`)은 헤드리스에서 MCP `use_tool`을 취소했다
  ("User cancelled…", 6/6). 그중 이 플러그인 도구 3회와 context7 1회는 **1.0.13**, 1.0.30에서는
  context7 2회만 관측됐다 — 1.0.30의 plan이 **이 플러그인 도구를** 막는 것은 직접 보지 못했다.
  `--always-approve`(`yolo_mode: true`)는 실행한다(context7 9/9, 1.0.13·1.0.30 혼재 / 재현 1/1, 1.0.30).
  grok이 MCP 도구 호출에 주는 제한은 `timeout_sec: 6000`이다.
- **재현 (A34 이전 번들).** 바깥 delegate는 `filesChanged: []`를 돌려줬고, 그 사이 중첩 런이 다른
  디렉터리에 파일을 쓰고 자기 이력 행을 남겼다(10.5초, `mcp_tool_call_completed success: true`).
- **수정 후 끝단 (0.2.32).** 같은 요청의 중첩 호출이 `blocked / inside_grok_worker`로 거절됐다 — win32
  1.0.30(설치된 0.2.32 사본, 2ms, `success: false`)과 Linux 1.0.41(인증된 컨테이너, 설치본 자리에 레포 번들)
  둘 다. 중첩 이력 행·대상 디렉터리 파일 0.
- **grok 쪽 결함 — 8 KiB를 넘는 메시지.** grok의 stdio MCP 디코더가 이 서버의 `tools/list` 응답
  (한 줄, 12,625바이트)을 **바이트 8192에서 잘라** 뒷조각을 새 메시지로 해석한다
  (`mcp_transport_decode_error: data did not match any variant of untagged enum JsonRpcMessage`, 샘플이
  정확히 그 오프셋에서 시작) → 연결 타임아웃(1.0.13은 `65s`, 1.0.30은 `70s`). 2026-09-24 기록 937개 기준
  **해석 오류 335개(36%)**, **연결 실패 294개(31%)** 이고 그중 292개가 해석 오류를 동반했다(문서 검토자
  재계수 — 초판은 두 수를 섞어 "약 35%, 70초"라 적었다). 우리 출력은 정상이다(LF 2개, CR·U+2028·U+2029
  0개). **이 결함이 A34를 간헐적으로 가렸다** — 재현이 두 번 실패한 이유다. 첫 턴은 MCP 초기화를
  기다리지 않는다(서버 시작 0.16초 뒤 `turn_started`).
- ⚠️ **세션 기록을 grep하는 사람을 위한 함정.** grok 자신의 내부 네임스페이스가 `grok_build`다
  (모든 도구 호출의 `_meta` — 제품명이 Grok Build다). 이 플러그인의 도구 이름으로 넓게 grep하면
  전부 걸린다(1471건 오탐 실측). `use_tool`의 `tool_name`으로 좁힐 것. 기록 위치:
  `~/.grok/sessions/<cwd 인코딩>/<id>/{events,updates}.jsonl`.
- **헤드리스 워커는 데몬을 남기지 않았다.** 이 세션의 워커 실행 11회에서 `leader` 등 호출보다 오래
  사는 grok 프로세스는 0개였다 — 표식이 데몬을 타고 사용자 셸로 새는 경로는 보이지 않았다.
- **아직 측정 안 된 것:** 이 플러그인의 PreToolUse 훅(matcher는 Claude 식 이름
  `mcp__plugin_grok_grok-build__…`)이 grok 안에서 발화하는가. `installed_plugins.json`의 한 플러그인에
  scope별 항목이 여러 개(버전이 다름) 있을 때 grok이 어느 설치본을 고르는가 — A34의 보호는 grok이
  **고른 설치본**의 버전을 따른다.
