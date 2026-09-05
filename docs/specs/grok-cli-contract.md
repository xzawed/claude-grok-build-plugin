# grok CLI 계약 (실측)

- 플랫폼 Windows 11. 방법: `grok --help`, `grok models`, scratch git + 플러그인 `runDelegate` 실경로
- 측정 이력: 2026-07-12 against **0.2.93** → 2026-08-14 against **1.0.3** → 2026-09-02 against
  **1.0.13 (5e9a58528b76) [stable]**. 아래 본문의 "1.0.3에서 제거됨" 류 서술은 **유래**를 적은
  것이라 그대로 유효하다 — 바꾸지 말 것.

> **유효 버전은 절마다 다르다.** 헤더의 버전 하나로 문서 전체를 대표시키면, 일부만 재실측했을 때
> 나머지까지 검증된 것처럼 읽힌다 (실제로 1.0.3 헤더가 1.0.5·1.0.13까지 유효한 것처럼 읽혔다).
> 재측정한 절만 날짜를 올린다.

| 절 | 마지막 실측 | 버전 |
|---|---|---|
| §1 헤드리스 호출 형태 | 2026-09-02 | 1.0.13 |
| §2 출력 스키마 | 2026-09-02 | 1.0.13 |
| §3 변경 파일 탐지 | 2026-09-02 | 1.0.13 |
| §4 종료 코드 | 2026-09-02 | 1.0.13 |
| §5 안전 모델 | 2026-09-02 | 1.0.13 |
| §6 부수 확인 | 2026-09-03 | 1.0.13 |
| §7 auth 만료 신호 | 2026-09-05 | 1.0.13 (부재 + 거부 봉투; A는 재현 안 됨) |
| §8 grok home 위치 | 2026-09-02 | 1.0.13 |
| §9 확인 프롬프트 · stdin | 2026-09-02 | 1.0.13 |
| §10 인증 우선순위 | 2026-09-02 | 1.0.13 |
| §11 resume × sandbox | 2026-09-03 | 1.0.13 |

이 문서는 [Task 0](../plans/2026-07-12-phase1-two-track-mvp.md)에서 시작했다.

> ⚠️ **CLI는 스스로 업데이트된다.** 2026-09-02 세션 도중 `1.0.5 → 1.0.13`으로 자동 갱신된 것이
> 실측됐다(바이너리 mtime). 즉 이 문서의 버전은 "사용자 머신에 있는 버전"이 아니라 "마지막으로
> 재실측한 버전"이다. 계약에 의존하는 코드는 스냅샷이 낡는 것을 전제로 설계한다 —
> `grok-cli.ts`의 차단 판정이 값-플래그 목록에 의존하지 않는 이유가 이것이다.

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
- `--permission-mode plan` 헤드리스는 1.0.3에서 **`end_turn` + text**로 끝나며 파일을
  쓰지 않았다 (0.2.x는 `Cancelled` + text). 플러그인 plan은 text 유무로 성공 판정.

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
