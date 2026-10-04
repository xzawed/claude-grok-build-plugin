# grok CLI 계약 (실측)

- 플랫폼 Windows 11. 방법: `grok --help`, `grok models`, scratch git + 플러그인 `runDelegate` 실경로
- 측정 이력: 2026-07-12 against **0.2.93** → 2026-08-14 against **1.0.3** → 2026-09-02 against
  **1.0.13 (5e9a58528b76) [stable]** → 2026-09-22 against **1.0.30 (04b7ffed98c6) [stable]** →
  2026-09-24 against **1.0.41 (4220f3b224a6) [stable]** → 2026-09-30 against **1.0.44 (5b807183dd79) [stable]**
  (둘 다 이 머신 갱신 + 스냅샷 갱신).
  아래 본문의 "1.0.3에서 제거됨" 류 서술은 **유래**를 적은 것이라 그대로 유효하다 — 바꾸지 말 것.

> **유효 버전은 절마다 다르다.** 헤더의 버전 하나로 문서 전체를 대표시키면, 일부만 재실측했을 때
> 나머지까지 검증된 것처럼 읽힌다 (실제로 1.0.3 헤더가 1.0.5·1.0.13까지 유효한 것처럼 읽혔다).
> 재측정한 절만 날짜를 올린다(절 제목의 날짜는 원측정이다).

| 절 | 마지막 실측 | 버전 |
|---|---|---|
| §1 헤드리스 호출 형태 | 2026-09-30 · 2026-10-04 | 1.0.44 (win32: 배포 번들 위임·§1 argv 원시 실행·`--prompt-file` ASCII·한글) · Linux delegate 봉투는 1.0.41 · `--rules`의 1.0.13 `--help` 재확인은 2026-10-04 |
| §2 출력 스키마 | 2026-09-30 | 1.0.44 (win32 원시 봉투 2개 — `thought`는 선택) |
| §3 변경 파일 탐지 | 2026-09-02 | 1.0.13 |
| §4 종료 코드 | 2026-09-30 | 1.0.44 (성공·권한 취소 모두 exit 0; `--max-turns` 취소의 exit 1은 1.0.30) |
| §5 안전 모델 | 2026-09-02 | 1.0.13 |
| §6 부수 확인 | 2026-09-30 · 2026-10-04~05 | 1.0.44·1.0.41 (**허용 규칙이 없으면** plan이 쓰기를 취소한다 — 규칙이 있으면 쓴다). 거부 규칙(래퍼가 v0.2.39부터 넘긴다)은 1.0.13·1.0.30·1.0.44·1.0.46에서 잰 경로를 막았다 — 예약·백그라운드 도구는 1.0.44·1.0.46에서만(A60) |
| §7 auth 만료 신호 | 2026-09-30 | 1.0.44 (win32 B·C1·C2, 1.0.41 A/B; C2 문구 변경 — 트레일러는 경로에 따라) |
| §8 grok home 위치 | 2026-09-30 | 1.0.44 (`probe:home` 728·0·0, 분류별 표·폴백 없음·`USERPROFILE`이 1.0.41과 같다) · 바이너리 위치는 1.0.13 |
| §9 확인 프롬프트 · stdin | 2026-09-30 | 1.0.44 · 일부 1.0.41 (`memory clear`는 그대로; 나머지 셋은 `[y/N]`이 없다 — 1.0.41로도 잰 것은 절 본문) |
| §10 인증 우선순위 | 2026-09-30 | 1.0.44 (자격 env·설정 키 모양·플러그인 감지 대조, 1.0.41 A/B) · 토큰 발급기(`GROK_AUTH_PROVIDER_COMMAND`)·`GROK_AUTH_PATH`·`GROK_DISABLE_API_KEY_AUTH`는 1.0.30·1.0.41 · 앞부분은 1.0.13 |
| §11 resume × sandbox | 2026-09-30 | 1.0.44 (win32 실세션) |
| §12 resume × cwd | 2026-09-30 | 1.0.44 (win32 실세션) |
| §13 sandbox on **Linux** | 2026-09-30 | 1.0.44 (**Linux에서 잰 절**, 합성 세션 — 인증된 쓰기 표는 1.0.41) |
| §14 워커가 **이 플러그인을** 로드 | 2026-09-30 | 1.0.13·1.0.30 (win32, 세션 기록) · 1.0.30 (win32 실측) · 1.0.41 (Linux 실측) · 1.0.44 (`workerMarker` win32·Linux) |
| §15 `grok worktree create` | 2026-09-30 | 1.0.44 (win32; Grove 게이트는 Linux 가짜 데몬 1회) |

> **1.0.41 표면 (2026-09-24, Docker, 쿼터 0):** `probe:contract`를 컨테이너에서 돌린 결과 플래그·
> 서브커맨드는 1.0.30 스냅샷과 **동일**하고 `--no-auto-update`도 수용된다 — `NON_HEADLESS`/
> `KNOWN_SUBCOMMANDS` 재분류는 필요 없다. 모델 목록은 두 개(`grok-4.7`, `grok-4.7-build-fast`)가
> 빠져 보였지만 **미인증 상태에서 잰 값**이었다 — 합성 인증 세션은 1.0.30·1.0.41 모두
> `Available: grok-4.6, grok-4.5`만 말했고, **인증된 1.0.41**의 `grok models`는 `grok-4.7`(기본)·
> `grok-4.7-build-fast`·`grok-4.6`·`grok-4.5`로 probe의 모델 diff가 **0**이었다(2026-09-24). 목록은 인증 상태를 따른다.
> **같은 날 이 머신을 1.0.41로 올리고**(`grok update --version 1.0.41`) 스냅샷을 갱신했다 — 표면 diff 0,
> `--strict` 녹색, `drifted`·`snapshotBehindLatest` 둘 다 `false`. 머신이 먼저, 스냅샷이 나중이다: 순서를
> 바꾸면 이 머신이 갱신될 때까지 `drifted`가 참이 된다.

> **1.0.44 표면 (2026-09-30, 쿼터 0):** 이 머신을 1.0.44로 올리고(`grok update --version 1.0.44`) `probe:contract`를
> 돌렸다 — 플래그·서브커맨드·인증된 모델 목록이 1.0.41 스냅샷과 같고 `--no-auto-update`도 수용된다. 도움말을 모든
> 서브커맨드에 대해 깊이 3까지 떠서 비교하니(win32) 차이는 중첩 서브커맨드 `worktree create` 하나였다(§15). Linux
> 컨테이너(미인증)는 서브커맨드 한 단계까지 비교해 같은 한 줄이었다(그 probe는 미인증이라 모델 목록 차이를 냈다). 당시
> probe는 최상위만 비교해 이것을 보지 못했다 — 이제는 서브커맨드 한 단계 아래 목록도 스냅샷과 비교한다
> (`scripts/nested-subcommands.mjs`). 스냅샷은 그 뒤에 갱신했다(`drifted`·`snapshotBehindLatest` 둘 다 `false`).
> ⚠️ **버전 줄 끝의 `[stable]`/`[alpha]`는 바이너리를 말하지 않는다.** grok은 `<GROK_HOME>/version.json`에 캐시한
> `stable_version`과 비교해 붙인다 — 파일이 없으면 꼬리표가 없고, 캐시가 바이너리보다 오래됐으면 `[alpha]`, 같거나
> 새로우면 `[stable]`이다. 이 머신(grok 설정의 `auto_update = false`)에서 1.0.44는 `grok update --version` 직후 `[alpha]`,
> `grok update --check`가 캐시를 갱신한 뒤 `[stable]`이었다. 채널은 `grok update --check --json`의 `channel`로 본다. probe는
> 이제 끝의 `[<글자>]`를 빼고 버전을 비교한다(`scripts/published-version.mjs`의 `versionMoved`) — 전에는 꼬리표만 바뀌어도
> `versionMoved`가 참이었다.

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
  **v0.2.36부터 플랫폼별 한도를 넘는 프롬프트에만 쓴다(A39)** — 그 아래는 잰 `--single=` 그대로다. 한도의 값,
  그 실측(플랫폼마다 무엇을 쟀고 무엇을 재지 않았는지), argv로 되던 길이 중 어디가 파일로 옮겨 갔는지는
  `delegate.ts`의 `promptFitsArgv` 주석이 원천이다 — 여기 옮겨 적지 않는다.
  grok 쪽 실측 2026-09-25(win32, grok-4.7-build; CLI는 같은 날 `grok --version`으로 **1.0.41**): 9,134자 ASCII 프롬프트(유일한
  지시는 맨 끝)를 `--prompt-file`로 넘기자 정확히 따랐다 — 파일 전문이 프롬프트로 읽혔다. 파일은 비공개 `mkdtemp`
  폴더에 쓰고(POSIX에서 0600 — win32에서는 모드가 권한을 정하지 않는다) 실행이 끝나면 지운다(남은 폴더 0).
  **재지 않은 것(grok 쪽):** Linux·macOS에서 grok이 `--prompt-file`을 읽는지, ASCII가 아닌 프롬프트를 Linux·macOS에서 파일로
  넘긴 경우(win32는 2026-09-30에 쟀다 — 아래), 모든 플랫폼에서 `--sandbox`와 `--prompt-file`의 조합(파일이 프로필 밖이면 막힐
  수 있다 — 위 Grok 지적). argv 한도 쪽에서 잰 것과 재지 않은 것은 그 주석이다.
  **1.0.44 (2026-09-30, win32):** `--prompt-file`로 ASCII(배포 번들, 한도 초과 2회 — 17,801·15,133 units, 세션 기록으로
  확인)와 **한글**(합성 세션, 16,000자 NFC·29,000자 — 뒤쪽은 CRLF·탭·NFD·한자·이모지 포함, 세션 기록과 가짜 모델이 받은
  요청 본문으로 확인)이 그대로 도착했다. 한도는 no-commit 접미사를 붙인 **뒤의** 길이에 적용된다(14,900 + 233 > 15,000 →
  파일). 알아 둘 것 셋:
  ① grok은 모든 프롬프트의 **앞뒤 유니코드 공백을 깎는다**(`--single=`·`--prompt-file` 모두, 1.0.41도 같다; 래퍼는 접미사가
  끝을 채우므로 앞쪽만 보인다).
  ② 헤드리스 실행마다 따로 나가는 제목 생성 요청은 질문의 앞 8,000바이트만 싣는다(1.0.44에서만 쟀다; 합성 세션의 대체
  카탈로그에서 그 모델은 grok-4.6이었고, 실세션의 제목 모델은 재지 않았다).
  ③ 프롬프트가 **99,977바이트**에 이르면(바이트 기준 — 한글이면 약 3만 3천 자) grok은 전문을
  `<GROK_HOME>/sessions/<인코딩된 cwd>/<id>/prompts/prompt_0.txt`에 쓰고 모델에는 앞 약 94KB·뒤 약 4KB와 안내만 보낸다(1.0.41도
  같다). 안내는 그 파일의 절대 경로와 빠진 줄의 `read_file` offset/limit을 준다 — 안내대로 읽는 가짜 모델은 빠진 줄을 정확히
  받았다(실모델이 따르는지는 재지 않았다). **win32에서 그 파일 경로가 260자 이상이면**(259자 성공·260자 실패, MAX_PATH) grok은
  파일을 `\\?\` 경로로 온전히 쓴 뒤 권한을 거는 `SetNamedSecurityInfoW`를 보통 경로로 불러 실패하고(ERROR_INVALID_NAME, os error
  123 — 호출과 반환값은 디버거로 확인했다; grok은 같은 호출을 auth.json에도 쓰고 그쪽 메시지는 소유자 전용 권한을 말한다 —
  `prompt_0.txt`에 무엇을 거는지와 결과 ACL은 읽지 않았다), 파일 안내를 버린 채 "저장하지 못했다"는 안내만 보낸다. 가운데가 모델에 닿지 않는다. 경로 길이 = `GROK_HOME` 길이 + 인코딩된 cwd
  길이 + 68이고, 인코딩에서 `:`·`\`·공백은 3자, 한글 한 글자는 9자가 된다. 래퍼는 그때도 `completed`를 돌려준다 — `docs/10` A59.
- **`--rules <RULES>`** (2026-09-22 실측): 시스템 프롬프트에 규칙을 덧붙인다. 커밋 금지 규칙을
  주면 grok이 편집만 하고 커밋을 거부한다. 1.0.13 `--help`에도 있다(2026-10-04 재확인 — 2026-09-22의 "1.0.13 스냅샷에는
  없다"는 틀렸다). 래퍼는 그래도 프롬프트 접미사를 쓴다 — 접미사는 어떤 CLI 버전도 깨지 않는다.
- ⚠️ **`--tools` / `--disallowed-tools`는 이름을 검증하지 않는다** (2026-09-22 실측): 존재하지
  않는 툴 이름을 줘도 exit 0, 에러 없음. 안전장치로 쓰면 **오타 하나가 조용히 무력화**된다.
  2026-09-30(1.0.44·1.0.41, 가짜 모델 — `monitor` 도구의 셸과 `Bsh`는 1.0.44에서만)에 더 쟀다: `--disallowed-tools`는 내부 id를 받는다 — 세션 기록에 보이는 이름
  `run_terminal_command`는 조용히 무시되고 `run_terminal_cmd`여야 한다(그래도 `monitor` 도구의 셸이 남는다). `--tools`에
  오타 하나가 있으면 **셸·쓰기를 포함한 19개짜리 세트로 돌아간다**(열린 쪽으로 실패; 도구 플래그가 없을 때의 기본은 25개).
  `--deny <RULE>`(반복 가능, 별칭
  `--disallowedTools`)의 규칙 이름은 대소문자를 가리고 틀린 이름(`bash`, `Bsh`)은 경고 없이 버려진다. `--agent`의 틀린 이름은
  디버그 로그에 WARN만 남기고 기본 에이전트로 돈다. `--no-subagents`는 헤드리스에서 효과가 없었다. plan에서 무엇이 무엇을
  막는지는 §6.

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
                                    "cacheReadInputTokens": 27648, "cacheCreationInputTokens": 0,
                                    "modelCalls": 2, "costUSD": 0.02268684 } }
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
- **1.0.44 (2026-09-30, win32, 원시 봉투 2개):** 최상위 키·`usage` 키·`modelUsage` 필드가 위 1.0.30 봉투와 같았다 —
  단 **`thought`는 한 번 빠졌다**(키 9개). 플러그인은 `thought`를 읽지 않는다. 호출자가 준 `--session-id`는 봉투에
  그대로 돌아왔다. (위 발췌에서 빠져 있던 `cacheCreationInputTokens`를 이번에 넣었다 — 1.0.13 샘플과 1.0.30 픽스처에도 있었다.)
  헤드리스 실행마다 따로 나가는 제목 생성 요청은 `modelCalls`에 세지 않았다 — 제목이 생성된 1.0.44 실세션 실행에서 봉투와
  `usage.json`의 `modelCalls`는 1이었다. 그 요청이 쿼터에 잡히는지는 `docs/10` B3와 같은 벽이다.

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

**1.0.44 (2026-09-30):** 성공은 exit 0이고, `--permission-mode plan`에서 권한 취소로 끝난 실행도 exit 0이었다
(`stopReason: "cancelled"`). 1.0.30의 `--max-turns` 취소는 exit 1이었다(§1) — 원인 차이인지 버전 차이인지는 가르지
않았다(`--max-turns`는 1.0.44에서 재지 않았다). 어느 쪽이든 플러그인은 exit 코드로 판정하지 않는다.

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
- ✅ **1.0.41에서도 막는다 (2026-09-24 실측, win32).** 같은 과제의 plan 실행에서 grok은 `write` 도구를
  **호출했고**, 권한 요청이 `` User cancelled the execution for tool `write` ``로 거부됐다 — "안 썼다"가 아니라
  "쓰려다 막혔다"를 세션 기록으로 확인했다. 응답은 `planWroteFiles: false`·`filesChanged: []`.
  **1.0.44도 같았다**(2026-09-30, win32, 배포 번들과 원시 실행 각 1회, 같은 취소 문장·같은 권한 이벤트).
  ⚠️ 그렇다고 `planWroteFiles`를 지우면 안 된다. 이 절의 역사가 보여주는 것은 "plan이 안전하다"가
  아니라 **이 동작을 버전으로 단정할 수 없다**는 것이다(1.0.3 막음 → 1.0.13 안 막음 → 1.0.30·1.0.41·1.0.44 막음. 1.0.13의
  "안 막음"이 버전 때문이었는지 그때의 허용 규칙 때문이었는지는 이제 가를 수 없고, 허용 규칙이 있으면 1.0.41·1.0.44도 쓴다 —
  아래 마지막 항목).
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
- ⚠️ **plan은 쓰기를 막는 장치가 아니다 (2026-09-30, 1.0.44·1.0.41 동일).** 위의 "막는다"는 **허용 규칙이 없을 때**의
  사실이다. `--permission-mode plan`은 `default`와 같은 묻기 정책이고(1.0.44 문서는 "Accepted for compatibility"라 부른다;
  grok이 스스로 들어가는 쓰기 차단 plan 모드는 `enter_plan_mode`로 따로 있다), 헤드리스에는 물을 사람이 없어 승인되지 않은
  호출이 취소될 뿐이다. 승인된 호출은 plan에서도 돈다 — grok `config.toml`의 `[permission] allow`, 기억된 승인
  (`permission.toml`), 그리고 **Claude Code의 `~/.claude/settings.json`**(`permissions.allow`,
  `defaultMode: bypassPermissions`/`acceptEdits`; `grok inspect --json`의 `permissions.sources`에 보인다).
  - 실모델로 배포 번들의 `grok_build_plan`을 돌리니 `Write` 허용 하나로 파일이 생겼다(규칙이 없는 대조군은 취소).
  - 가짜 모델(도구 호출을 강제한다)로는 권한 계층이 `search_replace`·`git commit`·`git push`·`gh api`·MCP 도구·PowerShell
    쓰기·`monitor` 도구의 셸·하위 에이전트의 쓰기까지 승인했다. push·`gh`·MCP는 `planWroteFiles`·`committed`에 보이지 않는다.
  - win32의 `--sandbox read-only`는 아무것도 막지 않았고 경고도 없었다. `>` 리다이렉트는 시도한 여섯 허용 형태 모두에서
    승인되지 않았다.
  - grok 설정의 `[ui] permission_mode = "always-approve"`는 `--permission-mode default`·`plan`을 주면 쓰기를 승인하지 않았다 —
    같은 설정에서 두 모드의 쓰기는 취소됐고, 플래그가 없으면 썼다(1.0.41·1.0.44, 가짜 모델; 다른 모드 값은 재지 않았다).
  - `worktree`는 가두지 않는다(1.0.44, 가짜 모델). worktree에서 시작한 plan도 `git push` 허용 규칙대로 push했다 — HOME 안에 둔
    linked worktree(`<HOME>\w`, 174자)와 HOME 밖 linked worktree 둘 다. worktree 안을 가리킨 `Write`(절대 경로)는 worktree에
    떨어졌고, worktree 밖을 가리킨 쓰기는 재지 않았다(cwd 밖 쓰기가 막히는 것을 본 것은 Linux 커널 샌드박스뿐이다 — §13,
    샌드박스가 없으면 파일 도구·셸 모두 cwd 밖에 썼다). 배포 번들의 worktree plan(worktree 경로 212자)이 아무것도 하지 않은 것은
    경로 탓으로 보인다 — 래퍼의 배치(`<HOME>\.grok-build\worktrees\<이름>`)를 215자로 재현하니 grok 디버그 로그가 `git repo
    discovery failed unexpectedly error=path too long` 뒤에 `allow deferred to confirmation floor`를 남겼고 호출은 취소됐다.
  - 모델이 처음 부른 쓰기·셸 도구가 취소되면 헤드리스 턴이 끝난다(`num_turns` 1) — 그때 돌아오는 것은 의도 한 줄이거나
    오류다(파일을 만들라는 과제 세 번으로 봤다; 읽기 도구만 쓰는 실행은 끊기지 않는다).
  - 닫는 옵션: `--deny Bash --deny Edit --deny Write --deny MCPTool(*)`가 잰 경로를 전부 막았다(1.0.41·1.0.44, 거부 뒤에도
    턴은 이어진다). 대가로 `git status` 같은 읽기 셸도 막힌다. 규칙 이름은 대소문자를 가리고 틀린 이름은 경고 없이 버려진다.
    이 규칙 밖의 도구(`web_fetch`·`web_search`·이미지·영상 생성·`send_feedback`)는 재지 않았다(예약·백그라운드 도구는 이 절 마지막 항목).
  - 래퍼 대응(A50, v0.2.39): 모든 plan spawn이 `--permission-mode plan` 바로 뒤에 이 네 규칙을 넘긴다(`delegate.ts`의
    `PLAN_DENY_ARGS`). 2026-10-04에 배포 번들과 가짜 모델로 다시 쟀다(사용자식 허용 규칙을 버릴 홈의 `~/.claude/settings.json`에).
    v0.2.38 번들은 1.0.44·1.0.46 모두 push·`gh api`·MCP 호출을 돌렸고 결과는 `completed`·`planWroteFiles: false`·
    `committed: false`였다. 고친 번들은 1.0.13·1.0.30·1.0.44·1.0.46 모두 셸("deny rule on bash"), 쓰기와 하위
    에이전트(`spawn_subagent`도 "deny rule on edit"), MCP("deny rule on mcp")를 거부했고 파일 읽기는 됐다. `--deny`는 1.0.13·1.0.30
    `--help`에도 있다(같은 날, 스크래치에 받은 바이너리). `grok_cli`는 원시 통로라(`--no-auto-update`만 덧붙인다) 거기서 넘긴
    `--permission-mode plan`에는 이 규칙이 붙지 않는다.
  - 예약·백그라운드 도구(2026-10-04~05, 가짜 모델): `scheduler_create`·`workflow`는 1.0.44·1.0.46에서 "deny rule on edit"로
    거부됐지만 1.0.13·1.0.30에서는 네 규칙 아래에서도 돌았다. 허용 규칙 없이 잰 것은 `scheduler_create`다 — 1.0.13은 배포 번들
    한 번·직접 실행 두 번, 1.0.30은 직접 실행 세 번이다. 유지보수자의 직접 실행 두 번(버전마다 한 번)은 grok 설정에
    `[ui] permission_mode = "always-approve"`가 있었고, 나머지 넷(배포 번들 한 번, 머지 전 검토의 직접 실행 세 번)의 plan에는 그
    줄도 허용 규칙도 없었다. `workflow`는 `*` 허용 아래에서만 쟀다. `monitor`는 네 버전 모두 "deny rule on bash"였다.
    plan이 만든 durable 예약 작업은 plan 세션의 `resources_state.json`에 남고 결과는 `completed`·`planWroteFiles: false`다 — 머지 전
    검토가 고친 번들과 grok 직접 실행으로, 유지보수자가 같은 plan 모드·네 거부 규칙의 grok 직접 실행으로 쟀다. 그 세션을
    `--always-approve`로 resume하면 grok이 그 작업을 하위 에이전트로 발화해 파일을 썼다 — 1.0.13은 다섯 번 모두(고친 번들 셋,
    거부 규칙이 없던 v0.2.38 번들 하나(허용 `*`), grok 직접 실행 하나), 1.0.30은 세 번 중 두 번(고친 번들 하나와 grok 직접 실행
    하나; 고친 번들의 다른 한 번은 루프가 복원됐지만 실행이 끝날 때까지 발화하지 않았다). 새 세션은 발화하지 않았다(1.0.13에서
    한 번 쟀다). 이어가기 쪽은 모두 머지 전 검토가 쟀다.
    plan argv에 `--disallowed-tools scheduler_create,scheduler_delete,scheduler_list,workflow`를 더한 변이는 네 버전 모두
    `completed`였고 네 도구가 모델에 제시되지 않았다. 이 묶음의 일부만 넣은 변이는 세션 초기화가 "Requirements unsatisfied"
    (`GrokBuild:scheduler_delete`)로 실패했다(머지 전 검토, 고친 번들 변이). 래퍼 대응은 `docs/10` A60.

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

  **D. 2026-09-30 (1.0.44, win32; 1.0.41로 A/B — B·C1은 바이트 동일, C2는 `Version:`만 다름).** 세 변형 모두
  exit 1이고 device-OAuth도 대기도 없다. 첫 출력은 약 2–5초(1.95–5.3초)이고 종료는 그 뒤 0.03–0.13초다(위 표의 10–20초는 1.0.13
  기록이다 — 같은 날의 코드 주석은 보고까지 약 25–30초라 적었고, 원자료는 남지 않았다).
  - B·C1: 서로 바이트가 같고 위 B 문구 그대로다.
  - C2(요지 — 줄바꿈과 열 맞춤은 ` / `로, 괄호 안은 `…`로 줄였다): `Internal error: "Unauthorized (401) from
    https://cli-chat-proxy.grok.com/v1/responses: Invalid or expired credentials (auth_kind=…, x_xai_token_auth=xai-grok-cli,
    upstream=…, reason=…) / Model: grok-4.6 / Auth: ApiKey / Version: 1.0.44 / Available: grok-4.6, grok-4.5"`. 괄호 안은
    실행마다 다르다(`bearer`/`PermissionDenied` 또는 `none`/`Unauthenticated`). 이 경로에는 1.0.13 봉투의 트레일러
    (*"… no need to run /login"*)가 없다.
  - ⚠️ **트레일러가 없어진 것이 아니다.** grok이 거부된 자격증명을 **지우지 못하는** 경로에서는 1.0.44에도 나온다 —
    Linux `strict` 프로필(bwrap 동작)의 401이 `Auth: Oidc`와 함께 그 문장을 달았고 auth.json은 그대로였다(§13). 모델·제공자
    키만 거부되고 세션이 남는 경로(`docs/10` B7의 모양)도 1.0.44에서 같은 트레일러를 냈다 — 주 턴에만 401을 주는 루프백으로
    봤고, xAI의 실제 401 본문에 래퍼가 무엇을 말하는지는 재지 않았다. 그래서 `invalid or expired credentials` 신호를 지우면
    안 된다는 규칙과 그 이유는 그대로다.
  - 또 하나의 401 문구: `Auth recovery succeeded but 4 authenticated inference requests were still rejected (401); giving up
    after 3 retries` — 합성 세션으로 한 위임에서 나왔다(새 실행은 win32·Linux, resume은 win32; 1.0.41·1.0.44 — §10의 가짜 토큰
    발급기 경로에서도 같은 문구다). 래퍼는 이것을 원문 메시지 그대로 `grok_error`로 낸다 — 로그인 안내가 없다. 실계정에서 어떤
    상태가 이 문구를 내는지는 `docs/10` B9.
  - grok이 받지 않는 auth.json 모양(1.0.44, `grok models`로 판별): `{}`·0바이트·잘린 파일·다른 `<issuer>::<client_id>` 키는
    모두 "not authenticated"이고, grok은 이 파일들을 지우지 않는다. 레거시 scope 항목(`https://accounts.x.ai/sign-in`)은
    아직 읽는다 — 가짜 토큰이 거부되자 로그에 "entry removed"를 남기고도 파일에는 그대로 두었다. 래퍼의 사전 확인은 파일이
    있는지만 보므로 이 모양들에 "준비됨"이라고 답한다(`docs/10` A56).
  - 분류는 그대로다: B·C1은 `not signed in` 등으로, C2는 `invalid or expired credentials` 하나로 `auth_error`가
    된다(배포 번들로 확인).
  - **grok은 C1·C2 뒤에 `<GROK_HOME>/auth.json`을 지운다**(로그 `file deleted (no scopes left)`) — 위 "폐기"를 파일로
    본 것이다. 합성 C2는 액세스 토큰과 리프레시 토큰이 둘 다 거부된 경우다.

## 8. grok home 위치 — `GROK_HOME`, 그리고 win32의 `USERPROFILE` (2026-09-02, 1.0.13)

grok README: `GROK_HOME — Override config directory (default: ~/.grok)`.

```
grok --no-auto-update du --json                    → grok_home: C:\Users\dirtc\.grok
GROK_HOME=<tmp> grok --no-auto-update du --json    → grok_home: <tmp>
grok --no-auto-update models                       → "You are logged in with grok.com."
GROK_HOME=<tmp> grok --no-auto-update models       → "You are not authenticated."
```

- **폴백이 없다.** `GROK_HOME` 아래 `auth.json`이 없으면, `~/.grok/auth.json`이 멀쩡해도
  미인증이다(2026-09-30에 1.0.44·1.0.41로 다시 같았다). 따라서 auth 탐지는 반드시 `GROK_HOME`을 따라가야 한다 (`env.ts` `grokHome`·`grokHomeFor`,
  `auth.ts` `authFilePath`).
- **상대 경로 `GROK_HOME`은 grok의 작업 폴더 기준으로 풀린다 — 묻는 쪽 프로세스가 아니다**
  (2026-09-24, 1.0.41, win32, `grok du --json`, 쿼터 0). `P`는 grok을 띄운 폴더다:
  ```
  GROK_HOME=rel-home            (P에서)           → grok_home: P\rel-home
  GROK_HOME=rel-home  --cwd F   (P에서)           → grok_home: F\rel-home    ← 플래그가 이긴다
  GROK_HOME=~/.x                (P에서)           → grok_home: P\~\.x        ← ~를 풀지 않는다
  ```
  grok은 시작할 때 이것을 절대 경로로 굳힌다(`du`가 절대 경로로 답한다). 그래서 grok 대신 홈을 찾는 곳 —
  인증 사전 확인·`billingCaveat`·세션 색인·hook — 은 모두 **grok이 실행될 폴더**를 기준으로 물어야 한다
  (`grokHomeFor`, docs/10 A35 — v0.2.33까지는 서버·hook 자기 폴더 기준이라, 세션이 `<작업 폴더>/rel-home`에 있는
  위임을 "로그인 필요"로 거절했다). 위임은 `--cwd <작업 폴더>`로, worktree 위임은 `--cwd <새 worktree>`로
  grok을 띄운다. `grok_cli`는 사용자 인자를 그대로 넘기므로 인자에 `--cwd`가 있으면 tool의 `cwd`는 grok의
  폴더를 말하지 않는다. `grok login`도 실행된 폴더 기준으로 홈을 잡는다 — `grok login --help`만으로 `P\rel-home`이
  생겼다(네트워크 없음; 실제 로그인은 재지 않았다). 폴더마다 다른 홈을 쓰는 사용자는 그 폴더에서 로그인해야 한다.
- **Windows에서는 드라이브 없는 루트 경로(`\x`, `/x`)도 폴더를 따라간다** (2026-09-24, 1.0.41, `grok du`):
  ```
  GROK_HOME=\p\gh   (C:에서)                     → grok_home: C:\p\gh
  GROK_HOME=\p\gh   (D:에서)                     → grok_home: D:\p\gh
  GROK_HOME=\p\gh   (C:에서, --cwd <D: 폴더>)     → grok_home: D:\p\gh
  GROK_HOME=/p/gh   (C:에서 / D:에서)             → grok_home: C:\p\gh / D:\p\gh
  ```
  Node의 `isAbsolute`는 이것을 절대 경로라 부르므로, 플러그인은 `grokHomeDependsOnFolder`로 따로 가린다
  (v0.2.34 머지 전 반례 검토가 찾았고 이 표로 재현). 드라이브와 루트가 다 있으면(`C:\x`) 한 곳이다. **UNC도 한
  곳이다**(2026-09-25, 재검토자가 재고 두 번째로 다시 쟀다): `GROK_HOME=\\localhost\<share>` → `grok_home`이 그대로.
  공유 없이 서버만 쓴 `\\localhost`·`//localhost`는 grok이 exit 1 *"cannot stat … (os error 161)"*로 거부한다.
  판정은 "절대 경로가 아니거나 구분자 **하나**로 시작"이다 — 첫 판은 끝 구분자 없는 공유 루트를 폴더 의존으로 잘못 봐
  main이 거부하던 호출을 통과시켰다(재검토가 찾음, `CHANGELOG.md` v0.2.34).
- **`grok du`의 `grok_home`은 grok이 세션을 찾는 곳이 아니다 — Windows 경로 정규화 (2026-09-25, 1.0.41, 쿼터 0).**
  `du`는 홈을 다듬어 보고하지만(`"<dir>\h "` → `<dir>\h`), 세션은 `<GROK_HOME>\auth.json`을 **보통의 Win32 경로로**
  연다. 그래서 여기서 쓰는 오라클은 `du`가 아니라, 합성 세션을 둔 `grok models`("You are logged in" / "not
  authenticated")와 위임 모양의 헤드리스 실행("Not signed in" / 401)이다 — 둘은 함께 잰 모든 칸에서 일치했다.
  이름이 점·공백으로 끝나는 실제 폴더를 포함해 손으로 고른 81가지와 생성한 357가지(세션 위치 2곳씩, 714회)에서
  grok의 조회는 규칙 둘로 전부 설명됐다:
  ```
  R1  뒤에 성분이 더 오는 성분은 끝의 점이 정확히 하나일 때 그 점을 잃는다   h. → h, "h ." → "h ", h..·h... 그대로
  R2  grok의 작업 폴더는 마지막 성분 끝의 공백·점을 잃는다(경로가 구분자로 끝나면 아니다)   "w " "w." "w.." "w. " → w
  끝 공백은 어느 쪽도 아니다: GROK_HOME="<dir>\h " → grok은 "<dir>\h \auth.json"을 찾고 Not signed in
  \\?\ 는 정규화되지 않는다. \\.\ · //?/ · UNC(\\localhost\C$\…)는 된다
  끝의 탭·CR·LF, 드라이브 경로 앞의 공백 → du·models exit 1 (os error 123)
  빈 값("") → 미설정과 같다(기본 홈). 공백뿐인 값(" ") → 미설정이 아니다: du exit 1, models "not authenticated"
  ```
  cmd에서 `set GROK_HOME=C:\x && …`는 `"C:\x "`를, `set GROK_HOME= && …`는 `" "`를 넣는다(`set "GROK_HOME=C:\x"`는 공백 없음, 실측).
  Node의 fs는 드라이브·UNC 경로를 `\\?\`로 바꿔 정규화를 건너뛴다(`\\.\`는 그대로 두므로 Windows가 정규화한다) —
  그래서 플러그인은 grok 대신 찾을 때 R1·R2를 적용하고, 끝 공백은 그대로 둔 채 그렇다고 말한다(`env.ts` `grokHome`·
  `grokHomeFor`·`grokHomeNote`, `docs/10` A36 → v0.2.35). **재측정: `npm run probe:home`**(win32, 쿼터 0 — 합성 세션 +
  `grok models`, 두 배치 × 생성한 표기; 2026-09-25에 1.0.41로 728회, 건너뜀 0, 불일치 0; 2026-09-30에 1.0.44로 다시
  728·0·0이고 분류별 표가 1.0.41과 같았다). 수치의 이력은 `CHANGELOG.md` v0.2.35.
  A35의 상대 경로·드라이브 없는 루트·`--cwd`가 이김은 이 세션 조회로도 다시 맞았다. `~`를 풀지 않음은 `du`로만 쟀다.
  남은 불일치 하나: `\??\`로 시작하는 `GROK_HOME`은 grok이 받아들이지만 Node의 fs는 그 경로를 조회하지 못해 플러그인은
  "로그인 필요"라 답한다(반례 검토, 같은 날 — 사람이 쓰는 표기가 아니고 거짓 거절 쪽이라 두었다). 2026-09-30(1.0.44)에
  긴 경로로 다시 재 보니 grok도 `models`만 로그인됐다고 할 뿐, 위임 모양의 헤드리스 실행은 os error 206으로 세션을 만들지
  못했다 — 그 경로에서는 거짓 거절이 아니다. 짧은 경로는 재지 않았다.
  v0.2.34 때 이 줄은 "끝 공백은 grok이 버린다"였고 `du` 하나로 쟀다.
- **`--cwd`의 약어는 받지 않는다:** `--cw <F>` → exit 2 *"unexpected argument '--cw' found"*(같은 날). 그래서 hook은
  `--cwd`·`--cwd=`만 보면 된다.
- **`HOME`은 grok home을 움직이지 못하지만, win32의 `USERPROFILE`은 움직인다** (`GROK_HOME` 미설정 시;
  2026-09-24, 1.0.41 — 2026-09-30에 1.0.44로 다시 같았다):
  ```
  HOME만 바꿈                      → grok_home 불변
  USERPROFILE만 바꿈               → grok_home: <USERPROFILE>\.grok
  HOME=a, USERPROFILE=b            → grok_home: b\.grok
  ```
  ⚠️ 2026-09-02의 이 줄은 "`HOME`/`USERPROFILE`은 움직이지 못한다"였지만, 그때 적은 명령 두 줄
  (`env -u HOME -u GROK_HOME …`, `env -u GROK_HOME HOME=<tmp> …`)은 **`HOME`만** 바꿨다 — `USERPROFILE`은 잰 적
  없이 같이 적혔다. 플러그인의 기본값(`os.homedir()`)도 win32에서 `USERPROFILE`을 읽으므로 둘은 일치한다.
  POSIX에서 무엇이 홈을 정하는지는 미측정이다.
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
둔다 → `defaultSpawn`. 실제로 지우려면 `-y`가 필요하다 (`commands/memory.md`).

**1.0.44 (2026-09-30):** `memory clear`는 위와 같다 — stdin을 닫으면 247ms에 `Are you sure? [y/N] Cancelled.`, 아무것도 안
지운다(1.0.41도 같다). `-y`를 주면 `[y/N]` 줄을 찍지 않고 지운다(1.0.41도 같다). 파이프에 `y`를 쓰면 지우므로 답은 콘솔이 아니라
stdin에서 읽는다. 배포 번들의 A9 탐지는 `cancelled: true`를 낸다. `[memory_v2] enabled = true`면 `memory-v2/` 아래 폴더를 통째로
지운다(`--all -y`는 `topics/`·`observations/`·`archive/`까지; 파이프와 memory_v2는 1.0.44에서만 쟀다). **2026-09-02에 이 자리에
적었던 문장 — `plugin install`(`--trust`)·`plugin uninstall`(`--confirm`)·`doctor fix`(`--yes`)에도 "같은 형태의 프롬프트가 있다" —
은 1.0.44에서 맞지 않는다**(`plugin install` 말고는 1.0.41로도 쟀다; 1.0.13에서 셋을 잰 기록은 없다). 헤드리스에서 셋 다
`[y/N]`을 띄우지 않았다:
- `plugin uninstall`은 저장소에 플러그인이 **하나뿐이면 `--confirm` 없이 바로 지운다**(exit 0, 배포 번들로도 `ok`). 여럿이면
  exit 1로 `--confirm`을 요구한다.
- `plugin install`은 `--trust` 없이 exit 1로 안내만 한다(로컬 폴더에서 설치하는 경우로 쟀다, 1.0.44).
- `doctor fix`는 고칠 것이 없으면 exit 0으로 끝난다(`No automatic fixes are available here.` — win32·Linux, 1.0.44). 고칠 것을
  지정한 `doctor fix ssh-wrap`은 win32에서 "not available on Windows"로 exit 1이고, Linux에서는 미리보기 뒤 exit 1 *"Cannot apply
  this fix without confirmation. Run it in an interactive terminal or add `--yes`"* — stdin이 아니라 터미널을 요구한다(둘 다
  1.0.41·1.0.44).

어느 것도 열린 파이프에 매달리지 않았다. 래퍼 안내의 교정은 `docs/10` A57.

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
→ **env 정제로는 막을 수 없다.** 막는 것은 여전히 범위 밖이다. **v0.2.33부터는 감지해서 알린다**
(`billingCaveat`, 막지 않음) — 설계·완료 조건은 `docs/specs/2026-09-24-config-model-keys-billing-caveat.md`,
그 감지를 잰 결과는 이 절 끝 "플러그인의 감지".

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

### 자격증명의 출처는 API 키 둘보다 넓다 (2026-09-24, 1.0.30·1.0.41)

- **`GROK_AUTH_PROVIDER_COMMAND`** — grok README가 문서화한 외부 토큰 발급기. 실측(가짜 발급기, 쿼터 0):
  합성 `auth.json`이 있는데도 grok은 **세션을 열 때 발급기를 불렀고**, 그 토큰으로 추론을 네 번 재시도한 뒤
  401로 끝냈다("Auth recovery succeeded but 4 authenticated inference requests were still rejected" — 같은 문구는 2026-09-30에
  발급기 없이 합성 세션의 위임(새 실행·resume)에서도 나왔다, §7 D). README는
  401 뒤 `GROK_AUTH_EXPIRED=1`을 붙여 다시 부르는 헤드리스 갱신 계약도 적는다. 즉 **발급기가 진짜면 거부될
  세션이 인증된다.**
- 그래서 **실계정에 닿으면 안 되는 프로브**(`probe-expired-session`, `worker-marker-probe`)는 부모 env의
  `GROK_*`·`XAI_*`를 **전부** 지운다(`scripts/synthetic-auth.mjs`의 `isolatedGrokEnv`). 플러그인 본체의
  구독 모드(`buildGrokEnv`)는 원칙 #1대로 종량제 키 둘만 지운다 — 그것으로 충분한지를 아래에서 쟀다.

**구독 모드에서 다른 변수가 API 키(종량제) 자격증명이 되는가 — `docs/10` B6의 답 (2026-09-24, 1.0.30·1.0.41).**
방법: 새 `GROK_HOME`, 부모의 `GROK_*`·`XAI_*` 제거, 시험할 변수만 **가짜 값**으로(쿼터 0). 판별은 grok 자신의
디버그 로그로 한다 — `auth_type=ApiKey`/`has_api_key=true`, 또는 `api.x.ai/v1/models`의 "Incorrect API key".
⚠️ 서버 401의 `auth_kind`나 세션 없을 때의 `auth_type=ApiKey`는 판별자가 아니다(아무것도 없어도 찍힌다 — 대조군).

| 변수 / 경로 | 결과 |
|---|---|
| `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY` | **API 키로 전송된다** (시작 시 모델 목록 조회) — 플러그인이 지운다 |
| `GROK_DEPLOYMENT_KEY` | 관리 정책(managed config) 조회와 텔레메트리 인증에만 쓰인다. 모델 API·추론에는 **안 쓰인다** |
| `GROK_ALPHA_TEST_KEY`, `GROK_LOCAL_AUTH`, `GROK_AGENT_SECRET`, `GROK_AUTH_PROVIDER_ACCESS_TOKEN`(단독) | 아무 데도 보내지 않았다 |
| `GROK_AUTH_PATH` | 세션 파일 위치를 바꾼다 — **세션** 인증(종량제 아님) |
| `GROK_CONFIG` / `GROK_CONFIG_PATH` 오버레이의 모델별 `api_key` | **버려진다** (세션만 쓰임 — 문서의 허용 목록과 일치) |
| `GROK_AUTH` | 문서에 없는 인라인 인증 저장소. auth.json 형식을 포함한 5가지 형식이 전부 파싱 실패 → 파일로 대체. **스키마 미상 — 미측정** |
| **`config.toml` 모델별 `api_key` / `env_key`(이름이 가리키는 변수)** | **세션이 있어도 쓰인다**(`auth_type=ApiKey`) — 1.0.13 결론이 현재도 유효. env 정제로 못 막는다. ⚠️ 판별력 주석(같은 날 뒤에 잼): 이 환경의 합성 세션에서는 `auth_type=ApiKey`가 자체 키 없는 모델에도 찍혔다. 1.0.41에서 모델을 가르는 판별자는 아래 "플러그인의 감지"의 `model_byok`다. 실세션 기준의 결론은 1.0.13 측정에 있다 |
| 위 설정 키 + `GROK_DISABLE_API_KEY_AUTH=1` | **여전히 쓰인다** — 이 스위치는 세션이 없을 때의 API 키 *로그인*만 거부한다. 대책이 아니다 |

즉 **env만으로 생기는 우발적 종량제 폴백은 두 키뿐이고 플러그인이 지운다.** 남는 경로는 사용자가 `config.toml`에
직접 적은 모델별 키이며(2026-09-30에 더 잰 경로 — `[model_providers]`로 물려받는 키, 제목 생성 요청에 실리는 키 — 는
아래 "1.0.44 재측정"), 막는 것은 범위 밖이다(Grok 반증은 `env_key`가 가리키는 변수를 "env가 관여하는 경로"로
짚었다 — 맞지만 뿌리는 같은 설정 파일이다). 알리는 것은 v0.2.33에서 했다 — 아래. 미측정: `GROK_AUTH`의 올바른
스키마, 유효한 자격증명에서의 동작(`GROK_OAUTH2_*`·`GROK_OIDC_*`는 2026-09-30에 가짜 값으로 쟀다 — 아래).

### 1.0.44 재측정 — 새 자격 env는 없다 (2026-09-30, win32; 1.0.41로 A/B 동일)

- **이름 비교.** 두 바이너리에서 env 이름을 바이트 수준으로 뽑아 비교했다. 1.0.44에만 있는 이름은 셋 —
  `GROK_ARTIFACTS_BIND_REMOUNT`, `GROK_FILE_ACCELERATION`, `GROK_FILE_ACCELERATION_ROUTES` — 이고 자격증명이 아니다.
  사라진 이름은 없다. 자격증명처럼 보이는 이름 46개와 바이너리에 내장된 환경 변수 표는 두 버전이 같다.
- **대조 실험.** 새 이름 셋, 위 표가 분류하지 않은 자격증명 모양 이름 30개(`GROK_OAUTH2_*`·`GROK_OIDC_*` 포함), 이미
  분류한 이름 6개를 가짜 값으로 세 세션 상태(만료 전이지만 서버가 거부하는 합성 세션·세션 없음·갱신이 실패하는 만료
  세션)에서 대조군과
  비교했다. 방법은 둘이다 — grok의 디버그 로그, 그리고 `GROK_XAI_API_BASE_URL`·`GROK_CLI_CHAT_PROXY_BASE_URL`을
  127.0.0.1로 돌려 요청의 `Authorization`을 받아 적는 루프백 캡처. **API 키로 전송되는 env는 여전히
  `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY` 둘뿐이고**, 구독 모드가 둘을 지운다는 것도 배포 번들로 끝단까지 확인했다.
  issuer와 client id를 함께 주면(OIDC·OAuth2) grok은 grok.com 세션을 버리고 기업 OIDC 로그인으로 가서 실패한다(닫힌
  쪽). `GROK_LOCAL_AUTH`는 세션 파일도 무시하게 만든다.
- **판별자 주의.** 세션이 있는 상태에서는 디버그 로그에 env 키의 판별자가 없다 — 그 상태에서 로그는 눈이 멀었다.
  모든 요청에 401로 답한 루프백에서는 1.0.41·1.0.44 모두, 세션의 `/v1/models`·`/v1/settings`가 401을 받은 **뒤에** env 키가
  `GET /v1/api-key`(키 확인 요청)로 나갔다. 서버가 거부하지 않은 세션에서도 그런지는 재지 않았으므로 위 1.0.13의 실세션
  결론("시도조차 되지 않는다")은 그대로 둔다. 갱신이 실패하는 만료 세션에서는 env 키가 `/v1/models`·`/v1/api-key`로 나갔고
  (추론 요청에 실리는 것은 보지 못했다), 세션이 없을 때는 드물게 추론까지 그 키로 갔다(실제 네트워크에서 `XAI_API_KEY`를 보낸
  1.0.44 실행 중 win32 7회에 1회, Linux 백수십 회에 14회 — 14회는 다섯 배치에 몰렸고 나머지는 모델 목록 확인에서 멈췄다; 1.0.41은
  두 번 모두 멈췄지만 실행이 적어 버전 차이로 읽지 않는다. 같은 조건에서 `GROK_CODE_XAI_API_KEY`를 보낸 실행(1.0.44 8회, 1.0.41 2회)은 모두 모델
  목록 확인에서 멈췄다 — 이 역시 실행이 적어 두 키의 차이로 읽지 않는다) — 원칙 #1이 막는 폴백 경로가 있다는 뜻이다.
- `GROK_DEPLOYMENT_KEY`는 프록시의 비추론 엔드포인트(`/v1/deployment/config`, `/v1/bundle/archive`,
  `/v1/feedback/config`)에만 Bearer로 실렸다.
- `GROK_INSTRUMENTATION`(값과 무관)과 `GROK_LOG_SAMPLING=true`는 디버그 로그에서 키 요청 줄을 지운다 — 키는 그대로
  나가므로 이 판별자를 쓸 때는 둘을 비워야 한다(Linux 1.0.44, 세션 없음 — 재도출 한 번으로만 봤다).
- `--debug-file`이 무엇을 평문으로 남기는지는 아래 "1.0.44 재측정"의 마지막 항목.

### 플러그인의 감지 — grok이 같은 파일을 어떻게 읽는지와 대조 (2026-09-24, 1.0.41)

`billingCaveat`(v0.2.33)는 `$GROK_HOME/config.toml`을 grok과 **같은 해석으로** 읽어야 맞다. 합성 `GROK_HOME`(가짜 세션·
가짜 키, 쿼터 0)에 네 형태를 넣고 grok 자신에게 물었다. 판별자는 디버그 로그의 **`model_byok`** 이다 —
`auth_type=ApiKey`는 세 모델 모두에 찍혀 판별자가 아니다(위 대조군 주의 그대로).

| `config.toml` | grok 1.0.41 | 플러그인 |
|---|---|---|
| `[model."grok-4.7"]` + `api_key` | `model_byok="byok"` | 보고 |
| `[model.grok-4.6]` + `api_key` (따옴표 없음) | `grok inspect`: `configWarnings` `key=grok-4 field=6 unknown-field` — 무시 | 보고 안 함 |
| `env_key = ["미설정", "설정됨"]` | `byok`, 둘째 변수의 값을 읽음 | 보고(`envVar`=둘째) |
| `env_key = "XAI_API_KEY"` (구독 모드가 지움) | `model_byok="not_byok"` | 보고 안 함 |

- ⚠️ **`--debug-file` 로그는 자격증명을 평문으로 남긴다.** 이 날(1.0.41, 위 합성 세션 설정)에는 쓰인 모델의 키 값이 남았다
  (인라인 키 1회, env 값 1회, 안 쓰인 모델은 0) — 2026-09-30 재측정의 만료 전 합성 세션과는 다른 결과다. 무엇이 남는지는 아래
  1.0.44 재측정의 마지막 항목이 원천이다. 플러그인은 이
  플래그를 쓰지 않는다. 재측정은 **가짜 키로만** 하고 로그는 스크래치에 둔다.
- **`model`이 배열 표(`[[model]]`)이면 grok은 모델 재정의를 전부 무시한다** — `inspect`: `modelSection not-a-table`
  "`model` must be a table of [model.<id>] entries, got array; all model overrides ignored". 그 뒤의 `[model."grok-4.7"]`
  (TOML상 배열 마지막 원소의 하위 표)에 적은 키도 쓰이지 않았다(`model_byok` 없음, 1.0.41). 플러그인도 보고하지 않는다.
- **깨진 `config.toml`이면 grok은 실행하지 않는다** — "Failed to load config: TOML parse error at line N", exit 1,
  모델 호출 없음(1.0.41). 그래서 판독기가 무효 TOML을 너그럽게 읽어도 청구될 실행이 없다. `grok inspect`는 같은
  파일에 exit 0을 낸다 — 설정이 유효하다는 증거로 쓰지 말 것.

**1.0.44 재측정 (2026-09-30, 합성 세션·가짜 키, 판별자 둘 — `model_byok`와 루프백으로 받은 요청 헤더; 1.0.41 A/B 동일, 따로
적은 것 빼고):**
- 위 표의 네 줄은 그대로다. 단 넷째 줄의 `model_byok="not_byok"`는 키가 있는 다른 모델이 같은 파일에 있고 세션이 없을 때만
  찍혔다(따로 둔 파일에 합성 세션이면 `model_byok` 줄 자체가 없다). 합성 세션의 대체 카탈로그에는 grok-4.7이 없어서 첫째 줄의
  grok-4.7은 사용자 정의 모델로 쟀다. **따옴표 없는 `[model.grok-4.6]`** — 1.0.44 문서가 예시로 쓰는 형태 — 도 여전히
  무시된다(`configWarnings` `key=grok-4 field=6`, 키가 요청에 실리지 않는다). 문서를 베낀 사용자의 키는 요청에 실리지 않으니
  플러그인의 침묵이 맞다.
- 새로 잰 모양: dotted key 세 가지·인라인 표 두 가지 → byok, 플러그인이 보고한다. 점 없는 `[model.<id>]`도 byok이고 보고한다
  (1.0.44에서만 쟀다). 프로젝트 `.grok/config.toml`의 모델 키는 신뢰한 폴더에서도 쓰이지 않았다(같은 파일의 `[permission]`은
  읽었다) — 설계 문서의 제외가 이제 실측이다. 깨진 TOML은 요청 없이 1초 안에(0.25~0.75초) 끝난다. 판독기가 너그럽게 받는
  무효 TOML은 과잉 보고다(요청이 없다).
- **놓치는 것 하나:** `[model_providers.<id>]`의 `api_key`·`env_key`를 `model_provider = "<id>"`로 물려받은 모델은 그 키로 요청이
  나가는데(`model_byok="byok"`, 요청 헤더에 키; 청구는 관측하지 않았다) 플러그인은 알리지 않는다 — `docs/10` A51. 발견은 요청
  헤더와 배포 번들 위임으로 했고, 두 번째 방법(grok의 디버그 로그 `model_byok`와 배포 번들 `grok_build_status`의 대조)으로 `api_key`
  모양을 다시 확인했다. `env_key` 모양은 한 방법으로만 봤다.
- 헤드리스 실행마다 따로 나가는 제목 생성 요청은 합성 세션의 대체 카탈로그에서 grok-4.6으로 나갔고, grok-4.6에 키가 있으면 주
  턴의 모델과 무관하게 그 키를 실었다(실세션의 제목 모델은 재지 않았다). 세션이 있으면 `managed_config.toml`·`requirements.toml`의
  모델 키, `[models]`·`[model.<id>]`의 `extra_headers`, `env_http_headers`, `GROK_CONFIG` 오버레이의 `models.extra_headers`에 둔
  `Authorization`도 이 제목 요청에만 실렸다. 세션이 없으면 `managed_config.toml`의 키는 주 턴에도 실렸다(1.0.44에서만 쟀다). 플러그인은 설계상 이
  경로들을 보지 않는다 — 그 제외를 이 사실 위에서도 유지할지는 오너 판단이다(`docs/09` §4 F).
- `--debug-file`(1.0.41·1.0.44, 합성·가짜 자격증명으로 봤다): 남은 자격증명은 새 세션 요청을 적는 줄(`NewSessionRequest`)에
  평문으로 있었고, 무엇이 남는지는 상태에 따라 달랐다.
  - 만료 전 세션: 세션 JWT 한 번(요청에 모델 키가 실려도 그 키는 없었다; 서버가 모든 요청을 거부해 grok이 세션을 버린 경우에도 JWT).
    같은 줄에 `[models]`·`[model.<id>]`의 `extra_headers`나 `GROK_CONFIG` 오버레이의 `models.extra_headers`에 둔 `Authorization`
    값도 함께 남았다(만료된 세션에서는 재지 않았다).
  - 만료돼 갱신이 실패한 세션: 주 턴 모델에 자체 키가 있으면 그 키, 없으면 만료된 세션 JWT(주 턴은 자격증명 없이 나갔다 — 다른
    모델의 키로 세션까지 간 실행에서 두 버전 각 1회).
  - 세션 없음: 주 턴 요청에 실린 키 — 주 턴 모델의 자체 키(`config.toml`, 그리고 1.0.44에서만 잰 `managed_config.toml`), 그 모델이
    `[model_providers.<id>]`에서 물려받은 키(1.0.44), 추론까지 간 env의 `XAI_API_KEY`(1.0.44). 주 턴에 실린 키가 없으면 아무것도
    남지 않았다(`api_key: None`, 두 버전 각 2회).
  - 모델 목록 확인에만 쓰인 env 키와 제목 요청에만 실린 모델 키는 남지 않았다. 2026-09-24 기록(1.0.41, 합성 세션)은 쓰인 모델의
    키를 봤다 — 만료 전 세션의 결과와 다르고, 그 차이는 가르지 않았다(위 "플러그인의 감지").

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
message *"Grok Build가 결과를 반환하지 않았습니다 (출력에 결과 envelope이 없음). 실제 사유는 rawStderrTail을
확인하세요."*(v0.2.31부터 — 그 전에는 "Grok Build 출력을 해석할 수 없습니다."), 그리고 **`rawStderrTail`에 grok의
안내 문구가 그대로 실린다**(191바이트 = 189자로 500자 컷 안). 즉 호출자는 무엇을 고쳐야 하는지 받는다 — 별도 가드를
넣지 않은 이유다. ⚠️ 그 전제는 호출자가 `sandbox`를 넘긴 경우에만 맞는다 — 아래 `GROK_SANDBOX`.

**1.0.44 (2026-09-30, win32 실세션):** 같은 프로필로 재개하면 `end_turn`, 다른 프로필이면 같은 거부 문장(exit 1,
stdout 0바이트, 모델 호출 전). 새로 잰 것:
- `--sandbox` 없이 만든 세션은 `sandbox_profile: "off"`로 저장되고 `off`도 고정이다 — `--sandbox workspace`로 재개하면
  같은 모양으로 거부된다(`--sandbox off`는 통과). 세션 사본으로 잰 1.0.41도 같았다.
- 플래그 없이 **`GROK_SANDBOX`만으로도** 같은 검사를 받는다(`workspace` 세션에 `GROK_SANDBOX=read-only` → 거부). 이때
  grok의 *"Omit --sandbox"* 안내는 맞지 않는다 — 호출자는 이미 생략했고, 래퍼 응답 어디에도 `GROK_SANDBOX`가 없다(`docs/10`
  A54). 세션 폴더와 다른 cwd에서 이렇게 거부되면 래퍼는 시작도 안 한 실행에 "그 폴더에서 작업했다"를 붙인다(A55).

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

**1.0.44 (2026-09-30, win32 실세션):** 그대로 재현됐다 — a.txt는 dirB에 생겼고, v0.2.37은 `resumedCwd`·경고를 맞게
붙였다. 두 번째 방법(재개한 세션에서 셸로 현재 폴더를 찍게 함)도 dirB를 가리켰다. 레이아웃도 같다. 새로 본 것:
- 재배치될 때 grok은 stderr에 `Session <id> found locally (originally in <folder>)`를 찍는다(1.0.41도 같다). 성공하면
  래퍼는 stderr를 보이지 않는다.
- 세션 루트에는 폴더별 디렉터리 옆에 `session_search.sqlite`(세션별 cwd와 내용의 색인)가 있고, 폴더별 디렉터리에는
  `prompt_history.jsonl`이 있다. 래퍼의 조회는 둘이 있어도 세션을 찾았다.
- 로컬에 없는 id로 `--resume`하면 grok은 `Session "<id>" not found locally, restoring conversation from remote...`를 찍고
  원격 복원을 한 번 시도한 뒤 끝난다(exit 1, 모델 요청 없음). 합성 토큰에서는 인증 오류였고 실토큰에서의 결과는 재지 않았다.
  래퍼가 시작도 못 한 실행의 id를 이어가라고 권하면 이 경로로 간다(`docs/10` A53).

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
- **이 검사는 요청보다 먼저다.** 같은 호출이 sandbox 없이는 401까지 갔고, `GROK_SANDBOX=workspace`
  에서는 모델에 닿지도 못했다. 즉 샌드박스 거부는 **과금되지 않는다** — 그래서 자격증명 없이
  잴 수 있었다(합성 `auth.json`으로 서버 게이트만 통과시킴). 자격증명을 아예 안 건드리는 것은 아니다: 거부
  경로에서도 grok은 auth.json을 읽고(로그 `AuthManager::new auth.json load result`) `GROK_HOME`에 `hooks/`·`logs/`
  따위를 만든다. auth.json을 쓰거나 요청을 보내지는 않는다(2026-09-30, 1.0.44).
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
- **1.0.44 (2026-09-30, Docker, 합성 세션 — 인증된 쓰기 표는 재지 않았다):** 네 arm이 그대로 재현되고, 거부 문구가
  같은 컨테이너의 1.0.41과 바이트 동일했다(401 봉투는 `Version:`만 다르다). 배포 번들은 거부마다 `GROK_SANDBOX`를
  말하는 A33 메시지를 냈다. 새로 잰 것:
  - namespace 거부 문구는 **uid에 따라 다르다**: root는 `bwrap: Creating new namespace failed: Operation not permitted`
    한 줄(62바이트), uid 1000은 Debian 문구 `bwrap: No permissions to create new namespace, likely because the kernel does
    not allow non-privileged user namespaces. …` 한 줄이다. 둘 다 `Refusing to start` 문장이 없고, 시작에 붙은
    `^\s*bwrap: ` 신호로만 A33이 된다.
  - `$GROK_HOME/config.toml`의 `[sandbox] profile = "workspace"`도 env·플래그 없이 같은 거부를 낸다(`--sandbox off`가
    이긴다). `<cwd>/.grok/config.toml`의 같은 키는 적용되지 않았다. 즉 호출자가 모르는 곳이 `GROK_SANDBOX` 하나가 아니다 —
    그런데 A33 메시지는 원인으로 `GROK_SANDBOX`만 말하고 `[sandbox] profile`은 말하지 않는다(`docs/10` A54; 메시지의 첫 해결책
    `sandbox: "off"`는 통한다). 거부된 실행의 응답·이력에는 래퍼가 미리 정한 세션 id가 남는데 그 id로는 세션이 없다(A53).
  - 모르는 프로필 이름은 해석 오류 뒤에 `the required bwrap plan could not be prepared … Refusing to start with denied
    paths unprotected.`로 죽는다(bwrap이 동작해도).
  - `strict` 프로필은 bwrap이 동작해도 401의 모양이 다르다 — `Auth: Oidc`에 *"… no need to run /login"* 트레일러가
    붙고 auth.json이 남는다(§7 D).
  - bwrap이 동작하면 grok은 `<GROK_HOME>/sessions/sandbox-events.jsonl`에 `ProfileApplied`(`enforced: true`, 허용
    경로 목록)를 남긴다. 응답은 여전히 아무것도 말하지 않는다 — B4 판정(응답에 "제약이 작동했다"를 싣지 않는다)은
    그대로다.

재현 환경(2026-09-23에 쓴 형태 — 어느 플래그가 필요한지는 아래 조건에 따라 다르다):

```
docker run --rm --network host --privileged \
  -v <scratch>:/probe:ro -v <repo>:/repo:ro <image> bash /probe/e2e.sh
```

- 2026-09-23에는 `--network host`가 **필수**였다. 이 머신의 브리지 네트워크는 UDP 53이 블랙홀이라 컨테이너
  DNS가 죽었다(호스트 리졸버가 `198.18.0.33`/`127.0.0.1`). 2026-09-30에는 기본 브리지에서 `api.x.ai`가 풀렸고
  컨테이너 안 `grok update`도 됐다 — 머신 상태에 따라 다르므로, DNS가 죽으면 `--network host`. BuildKit은
  `--network host`를 빌드 스텝에 적용하지 않으므로 **빌드 타임에 네트워크를 쓰지 말 것** — grok 설치는 런타임에
  하고 `docker commit`으로 굳힌다. `deb.debian.org`는 이 리졸버에서 해석되지 않는다
  (`mirror.kakao.com`은 된다).
- `--privileged`가 없으면 **root로 도는** bwrap이 새 namespace를 못 만든다(seccomp/apparmor unconfined로도 안 됨 —
  실측). 없는 상태가 곧 "bwrap 실패" 케이스라 그것대로 쓸모는 있다. 2026-09-30에 더 잰 것: 그 조건에서 root의
  `unshare -U`·`bwrap --unshare-user`는 성공하고 `unshare -m`은 실패했다 — grok은 root일 때 user namespace 없이 bwrap을
  부르는 것으로 보인다. uid 1000은 seccomp·apparmor unconfined만으로 동작했고, root는 거기에 `--cap-add SYS_ADMIN`을 더하면
  `--privileged` 없이 동작했다.

## 14. grok은 설치된 Claude Code 플러그인을 **자기 것으로 로드한다 — 이 플러그인까지** (2026-09-24)

> 이 플러그인이 띄우는 **모든 워커 안에 이 플러그인의 MCP 서버 사본이 뜬다.** 래퍼 대응은 A34
> (`GROK_BUILD_WORKER`, `docs/04` "워커 안에서는…"). 근거는 세 층이다: 세션 기록(win32, 1.0.13 —
> 이 머신은 2026-09-13에 1.0.30이 됐다 — 과 1.0.30에 걸침), 실측 1.0.30 win32, 실측 1.0.41 Linux.
> **plan 모드 동작은 허용 규칙에 따라 다르고 버전으로 단정할 수 없으므로(§6) 아래 수치는 버전을 붙여 읽을 것.**

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
- ⚠️ **세션 기록을 grep하는 사람을 위한 함정.** grok 자신의 내부 네임스페이스가 1.0.30에서는 `grok_build`다
  (모든 도구 호출의 `_meta` — 제품명이 Grok Build다). 이 플러그인의 도구 이름으로 넓게 grep하면
  전부 걸린다(1471건 오탐 실측). 1.0.41 세션 하나에서는 같은 자리가 `opencode`였다(관측 1회) — **네임스페이스에
  기대지 말고** `use_tool`의 `tool_name`으로 좁힐 것. 기록 위치:
  `~/.grok/sessions/<cwd 인코딩>/<id>/{events,updates}.jsonl`.
- **헤드리스 워커는 데몬을 남기지 않았다.** 이 세션의 워커 실행 11회에서 `leader` 등 호출보다 오래
  사는 grok 프로세스는 0개였다 — 표식이 데몬을 타고 사용자 셸로 새는 경로는 보이지 않았다.
- **1.0.44 (2026-09-30).** `probe:contract`의 `workerMarker`가 win32(호스트)와 Linux(컨테이너)에서 모두
  `reached: true`였다. 같은 날 plan 실행의 워커는 설치된 0.2.37 사본(도구 9개)을 띄웠고 Claude Code 훅도 돌렸다 — 전역
  `session_start`에 더해 다른 플러그인(security-guidance, awesome-statusline)의 훅까지. 1.0.41의 기준 세션(2026-09-24)은 전역
  `session_start` 훅만 기록했는데, 그 차이가 버전 때문인지 그 뒤 설치한 플러그인 때문인지는 가르지 않았다. 이 머신의 훅은
  한 실행의 세 이벤트에서 각각 1.9~3.7초 걸렸다(실행당 합계는 재지 않았다).
- **아직 측정 안 된 것:** 이 플러그인의 PreToolUse 훅(matcher는 Claude 식 이름
  `mcp__plugin_grok_grok-build__…`)이 grok 안에서 발화하는가. `installed_plugins.json`의 한 플러그인에
  scope별 항목이 여러 개(버전이 다름) 있을 때 grok이 어느 설치본을 고르는가 — A34의 보호는 grok이
  **고른 설치본**의 버전을 따른다.

## 15. `grok worktree create` — 1.0.44에 생긴 중첩 서브커맨드 (2026-09-30)

> 당시 `probe:contract`는 최상위 플래그·서브커맨드만 비교해 이것을 보지 못했다. 1.0.41과 1.0.44의 도움말을 모든
> 서브커맨드에 대해 깊이 3까지 떠서 비교하니(win32) 차이는 이것 하나였고, Linux 컨테이너는 서브커맨드 한 단계까지 비교해
> 같은 한 줄이었다. 이제 probe는 서브커맨드 한 단계 아래 목록도 스냅샷과 비교한다(`scripts/nested-subcommands.mjs` — 스냅샷의
> `worktree` 하위 목록만 1.0.41 상태로 되돌리면 `worktree create`를 보고한다; 중첩 목록이 없는 옛 스냅샷에는 "비교하지 않음"이라고
> 말하고, `--help`를 읽지 못한 부모도 그렇게 말한다). 그보다 깊은 단계와 플래그는 여전히 보지 않는다.

`grok worktree create [NAME] [--ref <REF>]` — *"Create a worktree the way `grok -w` does, without starting a session"*.

- **헤드리스이고 인증도 모델 호출도 없다.** 빈 `GROK_HOME`에서도 exit 0이었다. ACP 트래픽은 `initialize`와
  `x.ai/git/worktree/create_from_worktree_sync` 한 번뿐이고, 세션 폴더도 이력 행도 생기지 않는다(0.7~3.1초). 기본
  설정에서는 호출보다 오래 사는 프로세스가 없었다 — `[cli] use_leader = true`나 `--leader-socket`을 줘도 그랬다.
- **어디에 만드나.** `<GROK_HOME>/worktrees/<폴더>/<날짜>-<8hex>`(이름을 주면 `<NAME>`)에 만들고
  `<GROK_HOME>/worktrees.db`에 적는다. 새 홈에서는 원본 저장소에 등록된 detached worktree(Linked)이고, 설정이
  Standalone이면 제 `.git`과 `main`을 가진 사본(원본에 등록되지 않음)이다 — 이 머신의 계정은 원격 설정으로
  Standalone이 된다. 어느 쪽도 원본 저장소에 브랜치를 만들지 않는다. 지우는 것은 `grok worktree rm <id>`(id는
  `grok worktree list --json`)이고, 빈 상위 폴더가 남는다.
- **플러그인에서의 분류.** 분류는 최상위 서브커맨드로만 하므로 `worktree`(`KNOWN_SUBCOMMANDS`)를 물려받는다.
  `grok_cli {args:["worktree","create"]}`는 `ok`로 통과하고, hook은 턴을 쓰지 않는 호출이라 인증 확인 없이 허용한다 —
  기본 설정에서는 의도한 분류다(Grove 게이트는 아래). `grok_build_worktree`의 `list`는 grok의 Linked worktree를 detached
  항목으로 보여 주고, `remove`는 `~/.grok-build/worktrees` 밖이라 거부한다.
- 최상위의 프롬프트·세션 플래그를 서브커맨드 **앞에** 두면 1.0.44는 조용히 무시한다(`-p "x" worktree create`는 만들기만
  한다 — hook은 `-p`를 턴 가능성으로 보고 로그인되지 않았으면 막는다. 로그인돼 있으면 통과시키고, 래퍼는 턴이 없는 실행을
  `promptRun`으로 적는다 — 해가 없는 과잉 처리다). **뒤에** 두면 clap이 exit 2로 거부한다.
- ⚠️ **Grove 게이트가 켜져 있으면 호출보다 오래 사는 프로세스가 생긴다.** `GROK_WORKTREE_TYPE=grove`로 Linux
  컨테이너에서(가짜 grove 데몬으로 한 번) 쟀더니 grok이 `grove daemon --foreground`를 제 세션으로 띄우고 죽이지 않은
  채 exit 0했다. 배포 번들의 `grok_cli`는 `ok`를 돌려줬다(stderr 끝에만 흔적이 있다). 게이트는 기본값이 꺼져 있고
  (`grove_worktree=false`), 이 win32 호스트에는 Client-ProjFS가 없어 spawn 전에 건너뛰었다. A29 기준으로는 NON_HEADLESS
  쪽이지만 최상위 분류로는 이것만 가려낼 수 없다. 진짜 grove로 재는 것은 `docs/10` B8.
- ⚠️ 이 명령의 모양이 `grok -w`를 부르게 만든다: `grok_cli ["-w","worktree","create"]`는 `worktree create` 서브커맨드가
  아니다 — clap은 `-w`의 선택 값을 서브커맨드 이름보다 앞세워(`-w sessions list`도 worktree `sessions` + 프롬프트 `list`)
  이름이 `worktree`인 grok worktree를 만들고, 그 안에서 **프롬프트 `create`를 보내는 대화형 세션**을 연다. 대화형 UI는 TTY가
  없어도 시작 4초쯤 만에 맨 프롬프트를 모델에 보낸다(요청의 `x-grok-client-mode: interactive`). worktree는 Linked 설정이면
  저장소에 등록된 채 남는다(합성 세션·401 루프백으로만 쟀다) — `docs/10` A52.
