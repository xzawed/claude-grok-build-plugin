# 투트랙 인증 설계 (구독 + API)

- 날짜: 2026-07-12
- 상태: 설계 확정, 구현 전
- 영향 문서: `CLAUDE.md`, `docs/02-auth-strategy.md`, `docs/03-plugin-spec.md`,
  `docs/04-mcp-server-spec.md`, `docs/05-routing-policy.md`, `docs/06-roadmap.md`,
  `README.md`, `README.ko.md`

## 1. 배경 & 목표

기존 설계는 **구독 전용**이었다 — 절대 원칙 #1이 "API 키 관련 env를 무조건 제거"였고,
로드맵은 API 키 경로를 스코프에서 명시적으로 제외했다.

이 플러그인은 공개 오픈소스이며, 참조 모델인 **OpenAI Codex CLI가 구독(ChatGPT
로그인)과 API 키를 모두 지원**한다는 사실을 확인했다(참고: developers.openai.com/codex/auth).
따라서 사용자층을 넓히기 위해 **비구독자(API 종량제)도 지원하는 투트랙**으로 확장한다.

**목표:** grok 구독자는 세션 인증으로, 비구독자는 API 키로 위임을 수행한다. 단,
"구독으로 쓰려다 실수로 API 종량제로 과금이 새는 사고"(Codex 이슈 #2000에서 실제 보고된
문제)를 설계로 방어한다.

## 2. 결정 사항 (요약)

| 항목 | 결정 |
|---|---|
| 트랙 선택 | 서버 레벨 env `GROK_BUILD_AUTH_MODE` = `subscription`(기본) \| `api` |
| 기본값 | `subscription` (미설정 시) |
| 호출별 오버라이드 | **없음** (YAGNI + 사고 방지) |
| API 키 출처(api 모드) | **환경변수 그대로 통과** — 플러그인은 키를 저장하지 않음 |
| 투명성 | 모든 delegate 응답에 `mode`·`billing` 명시 |
| 플러그인 구조 | 단일 플러그인 / 단일 MCP 서버 (분리하지 않음) |

## 3. 인증 정책 상세

### 3.1 두 모드

| | 구독 모드 (기본) | API 모드 (opt-in) |
|---|---|---|
| 트리거 | 미설정 or `GROK_BUILD_AUTH_MODE=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| env 처리 | `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY` **제거** | env 키 **그대로 통과** |
| 인증 근거 | `~/.grok/auth.json` 세션 토큰 | env의 API 키 (grok CLI가 자체 소비) |
| 과금 | 구독 정액 (SuperGrok / X Premium+) | API 종량제 |
| `billing` 값 | `subscription` | `metered_api` |

### 3.2 안전 보장 (원래 "과금 누수 방지"의 유지)

투트랙으로 넓히되 원래 우려는 세 겹으로 방어한다:

1. **기본값이 구독** — 아무 설정도 안 하면 기존과 동일하게 키가 제거된다.
2. **전환은 단일 서버 설정 1곳** — 세션 중 실수로 바뀌지 않으며, 호출별 오버라이드가
   없어 "이번 호출만 API"로 새는 경로가 원천 차단된다.
3. **투명성** — delegate 응답이 항상 어느 모드/과금으로 실행됐는지 밝혀,
   Claude와 사용자가 종량제 여부를 즉시 인지한다.

## 4. 절대 원칙 재구성

`CLAUDE.md`의 절대 원칙 #1을 **무조건 → 모드 조건부**로 바꾼다.

- (기존) "Grok Build 프로세스를 실행할 때 `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY`를
  절대 전달하지 않는다."
- (신규) "**구독 모드에서는** `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY`를 항상 env에서
  제거한다. **API 모드(`GROK_BUILD_AUTH_MODE=api`)에서만** 이 키를 grok에 통과시킨다.
  API 모드는 서버 설정으로 명시적으로 켠 경우에만 동작하며, 호출별로 전환할 수 없다."

나머지 원칙(#2 로그인은 사용자 수동, #3 `--no-auto-update`, #4 credential 미저장/미로깅)은
그대로 유지된다. API 모드에서도 플러그인은 키를 **저장하지 않고** env에서 읽어 통과만 한다.

## 5. 컴포넌트/코드 영향 (`mcp-server/src/`)

| 파일 | 변경 |
|---|---|
| `config.ts` (신규) | `resolveAuthMode(): "subscription" \| "api"` — `GROK_BUILD_AUTH_MODE` 읽어 검증, 기본 `subscription`, 잘못된 값이면 서버 시작 시 에러 |
| `env.ts` | `buildGrokEnv(mode)` — subscription: 두 키 `delete` / api: `{...process.env}` 그대로 반환 |
| `auth.ts` | `grok_auth_check`가 모드 분기 (아래 6.1) |
| `delegate.ts` | `buildGrokEnv(mode)` 사용, 출력에 `mode`·`billing` 추가, 에러 분류를 모드별 안내로 분기 |
| `types.ts` | delegate 출력 타입에 `mode`·`billing` 필드 추가 |

### 5.1 `grok_auth_check` 모드 분기

- 공통: grok CLI 설치 확인 → 없으면 `grok_not_installed`
- 구독 모드: `~/.grok/auth.json` 존재? → 없으면 `not_logged_in`
- API 모드: env에 `XAI_API_KEY` 또는 `GROK_CODE_XAI_API_KEY` 존재? → 없으면 `no_api_key`
- 통과 시 `ok: true` (+ 응답에 현재 `mode` 포함)

### 5.2 `grok_build_delegate` 출력 확장

- 성공: 기존 필드 + `mode: "subscription"|"api"`, `billing: "subscription"|"metered_api"`
- 실패(auth): 모드별 안내 — 구독은 "`grok login` 실행", API는 "`XAI_API_KEY` 설정 확인"

## 6. 문서 영향

- **CLAUDE.md** — 절대 원칙 #1 모드 조건부화(§4), 컴포넌트 지도에 `config.ts` 반영
- **docs/02-auth-strategy.md** — "구독 전용" → "투트랙, 구독 기본, opt-in 안전장치"로
  재작성. 과금 누수 근거는 *opt-in·호출별 오버라이드 없음*의 정당화로 보존. 검증
  체크리스트에 API 모드 항목 추가
- **docs/03-plugin-spec.md** — `.mcp.json` 예시에 `env: { "GROK_BUILD_AUTH_MODE": "..." }`,
  `mcp-server/src/`에 `config.ts` 추가
- **docs/04-mcp-server-spec.md** — 두 tool 스펙에 모드 분기·출력 스키마(`mode`/`billing`)·
  `no_api_key` reason 반영
- **docs/05-routing-policy.md** — "구독 정액이라 위임 횟수 아낄 이유 없음"을 *모드 조건부*로
  (API 모드는 종량제이므로 비용 고려가 부활)
- **docs/06-roadmap.md** — "API 키 경로 미지원" 스코프 제외 삭제, API 모드를 Phase 1로 편입
- **README.md / README.ko.md** — 투트랙 설명 추가, 가치 제안 확장(구독자 + 비구독자),
  핵심 제약 섹션을 모드 조건부로 수정

## 7. 테스트 전략

**유닛**
- `buildGrokEnv("subscription")`: 두 키가 env에 있어도 결과에서 제거됨
- `buildGrokEnv("api")`: 두 키가 결과에 보존됨
- `resolveAuthMode()`: 미설정 시 `subscription`, 잘못된 값이면 에러
- `grok_auth_check`: 구독/API 모드별 reason 분기 (fs·env 목킹)

**E2E** (양쪽 모두 수행 — 사용자가 구독 세션과 API 키 둘 다 보유)
- 구독 모드: 토이 프로젝트에 실제 위임 → diff 수신, `billing=subscription`
- API 모드: `GROK_BUILD_AUTH_MODE=api` + `XAI_API_KEY`로 실제 위임 → diff 수신,
  `billing=metered_api`
- 교차 검증: 구독 모드에서 env에 `XAI_API_KEY`를 넣어도 grok 프로세스 env 덤프에
  키가 없음(누수 없음) 확인

## 8. 스코프

**Phase 1에 포함**
- `config.ts`, `buildGrokEnv(mode)`, 모드 분기된 `grok_auth_check`·`grok_build_delegate`
- 양쪽 모드 유닛 + E2E 검증
- 위 문서 일괄 갱신

**명시적 제외 (변동 없음)**
- 호출별 authMode 오버라이드
- 자동 커밋/PR
- Hook·이력 로깅·`/verify`·`plan` 모드 (Phase 2~3 그대로)

## 9. 구현 전 선행 확인 (전제 검증)

투트랙의 전제가 실제 grok CLI에서 성립하는지 코드 착수 전에 확인한다:
- 구독: env에 API 키가 있으면 세션보다 우선한다는 override 동작 → 그래서 구독 모드는
  키를 제거해야 한다는 전제 (docs/02 체크리스트)
- API: env의 `XAI_API_KEY`만으로 grok이 종량제 인증에 성공하는지
- grok headless 인터페이스(`-p`, `--output-format streaming-json`, `--no-auto-update`)와
  streaming-json 이벤트 스키마 실측
