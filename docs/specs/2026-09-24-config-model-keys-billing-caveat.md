# config.toml 모델별 키 경고 (`billingCaveat`) — 완료 조건과 설계

- 날짜: 2026-09-24 · 분류: E(새 기능, 오너 목표) · 목표 릴리스: v0.2.33
- 오너 결정(원문): "GROK_HOME/config.toml에서 모델별 api_key·env_key를 찾아 /grok:status와 위임 응답이
  '이 설정이면 종량제로 청구될 수 있다'고 알리게 합니다. 실행을 막지는 않습니다."

## 왜

구독 모드는 env의 종량제 키 둘을 지운다(절대 원칙 #1). 그런데 사용자가 `config.toml`에 직접 적은
**모델별 자격증명**은 env 정제로 막을 수 없고, 세션이 있어도 그쪽이 먼저 쓰인다 — 실측과 판별 방법의
원천은 `docs/specs/grok-cli-contract.md` §10(1.0.13·1.0.30·1.0.41). 그 상태에서도 응답은
`billing: "subscription"`을 말한다. `billing`은 설정된 모드에서 파생된 태그이고 관측값이 아니기
때문이다(설계상 그대로 둔다). 그래서 사용자는 구독으로 돈다고 믿는 실행이 다른 계정으로 청구돼도
알 길이 없다. 이 기능은 그 틈을 **알린다**. 막지는 않는다.

`docs/00` 대조: "Grok을 잘 쓰게"의 **구독 우선 과금 안전·명확한 안내**에 직접 해당한다. "의도적으로
하지 않는 것"(자동 커밋, 호출별 과금 모드 오버라이드, 강제 위임)과 겹치지 않는다 — 모드도 `billing`
값도 바꾸지 않는다.

## 완료 조건

1. **감지.** 구독 모드에서 `$GROK_HOME/config.toml`(기본 `~/.grok/config.toml`, `grokHome()`)의
   `model.<id>` 표에 다음 중 하나가 있으면 그 모델 id를 보고한다.
   - 비어 있지 않은 문자열 `api_key`
   - `env_key`(문자열 또는 배열)가 가리키는 변수 중 하나가 **grok이 받을 env**에서 비어 있지 않음.
     grok이 받는 env는 `buildGrokEnv` 결과다. 그래서 `env_key = "XAI_API_KEY"`는 구독 모드에서
     지워지므로 보고하지 않는다. win32에서는 변수 이름을 대소문자 구분 없이 찾는다.
   - 같은 표를 dotted key나 inline table로 적은 형태(`model."id".api_key = …`,
     `[model]` 아래 `"id" = { … }`)도 같은 것으로 읽는다.
   - grok이 **무시하는** 형태는 보고하지 않는다. 따옴표 없는 `[model.grok-4.6]`은 `model.grok-4` 아래
     `6`이 되어 조용히 무시된다(계약 §10 TOML 함정). grok과 같은 해석을 해야 오경보가 없다.
2. **표면.** `grok_build_status` 응답과 `grok_build_delegate`/`grok_build_plan`/`grok_build_verify`
   응답에 선택 필드 `billingCaveat`가 붙는다. 조건은 구독 모드이면서 감지가 됐을 때뿐이다.
   api 모드에서는 붙지 않는다(`billing`이 이미 `metered_api`다).
3. **막지 않는다.** 감지 결과와 무관하게 실행 여부, `status`, `isError`, 이력 행은 지금과 같다.
   `billingCaveat`는 이력(`history.jsonl`)에 싣지 않는다.
4. **모름은 모름으로.** 파일을 읽거나 해석하지 못하면 예외로 번지지 않는다. 그 경우
   `reason: "config_unreadable"`로 "확인하지 못했다"를 말한다 — "키 없음"으로 뭉개지 않는다.
   파일이 **없으면**(ENOENT) grok도 기본값으로 돌므로 caveat가 없다.
5. **자격증명을 싣지 않는다(원칙 #4).** 출력에는 모델 id, 경로 종류(`api_key`/`env_key`),
   env_key의 변수 **이름**, 설정 파일 경로만 담는다. 키 값과 변수 값은 어떤 출력·오류 문구에도 없다.
   해석 오류 문구에도 파일 내용을 싣지 않는다.
6. **사용자에게 보인다.** `/grok:status`·`/grok:delegate`·`/grok:plan`·`/grok:verify` 템플릿과
   `/grok:review`, `grok-worker` 에이전트, `grok-routing` 스킬이 이 필드를 사용자에게 알리라고
   지시한다. 알리되 멈추라고 하지 않는다.
7. **문서가 사실과 맞다.** "감지도 하지 않는다"라고 적은 곳(`docs/02`, 계약 §10)을 고친다.
   `docs/04`에 필드를, `docs/07`과 `observeBilling`에 포인터를, README에 문제 해결 행을 둔다.
   CHANGELOG와 릴리스 노트도 쓴다.
8. **검증.**
   - (a) 배포 번들을 합성 `GROK_HOME`(가짜 키)으로 띄워 `grok_build_status`가 caveat를 보고한다.
     spawn이 없으므로 쿼터 0이다.
   - (b) 같은 환경에서 delegate가 caveat를 싣고 실행은 막히지 않는다. 가짜 자격증명이라 401이므로
     쿼터 0이다.
   - (c) Grok 반증.
   - (d) preflight.
   - (e) 릴리스 수락(레포·캐시).

## 하지 않는 것 (근거)

- **그 모델이 실제로 돌았는지 판정하지 않는다.** 카탈로그 id와 실행 id가 다르다
  (`-m grok-4.7` → 봉투의 `grok-4.7-build`, 계약 §1). 기본 모델도 grok이 스스로 옮긴다. 그래서
  문구는 "그 모델로 도는 실행은 … 청구될 수 있다"로, 설정에 대한 사실만 말한다.
- **감지하지 않는 자격증명 경로.** 모델의 `auth_provider`, `extra_headers`·`env_http_headers`에 담은 키,
  `[model_providers.*]`, `managed_config.toml`·`requirements.toml`은 보지 않는다. 앞의 것들은
  실측하지 않았다. 뒤의 둘은 조직 배포 계층이다. `GROK_CONFIG*` 오버레이는 모델별 키를
  **버린다**(계약 §10 실측)는 이유로 보지 않는다. 프로젝트 `.grok/config.toml`은 grok 문서상 모델 설정을 줄 수
  없다(`26-config-reference.md`: mcp_servers·plugins·permission만).
- **`grok_cli`·`grok_auth_check`·PreToolUse 훅에는 붙이지 않는다.** 오너 범위는 status와 위임 응답이다.
- **`billing` 값은 바꾸지 않는다.** 소비자 계약(`observeBilling`)이 그 enum에 기대고 있다.

## 설계

- `mcp-server/src/config-keys.ts`
  - `modelCredentialDecls(text)`: 순수 함수. 이 질문 하나에 필요한 만큼만 읽는 TOML 판독기다.
    표 머리, key path, 네 가지 문자열, 배열, inline table의 구조를 따라가고, 경로가 정확히
    `model / <id> / api_key|env_key`인 것만 모은다. 형식이 깨지면 던진다.
  - `liveModelCredentials(decls, childEnv, platform)`: grok이 실제로 쥘 자격증명만 남긴다.
    모델마다 하나이고, `api_key`가 `env_key`보다 앞선다(grok 문서의 순서).
  - `configBillingCaveat(mode, env, deps)`: IO와 판정을 묶는다. 구독 모드가 아니면 `undefined`를
    돌려준다. 어떤 경우에도 던지지 않는다.
- 새 런타임 의존성은 없다. TOML 파서를 들이면 번들에 인라인되고, 이 레포의 npm 경로 함정
  (`CLAUDE.md` Gotchas)을 새로 밟게 된다. 필요한 문법이 작다.
- `server.ts`: `ServerDeps.billingCaveat`를 추가한다. 위임 3종은 spawn **전에** 계산해 결과에 붙인다.
  grok이 시작할 때 읽은 설정이 대상이기 때문이다. status는 `buildStatusSnapshot`의 세 번째 인자로
  넘긴다. 호출부는 예외를 삼킨다. 실제 구현은 던지지 않으므로 이것은 주입된 가짜를 위한 최후 방어다.

```ts
type BillingCaveat =
  | { reason: 'config_model_keys'; configPath: string;
      models: { model: string; via: 'api_key' | 'env_key'; envVar?: string }[]; message: string }
  | { reason: 'config_unreadable'; configPath: string; message: string };
```
