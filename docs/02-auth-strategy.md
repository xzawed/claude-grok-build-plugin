# 02. 인증 전략 — 투트랙 (구독 기본 + API 종량제 opt-in)

이 프로젝트에서 가장 중요한 제약 조건이다. 구현 시 이 문서를 최우선으로 검증할 것.

> 이 문서는 원래 "구독 전용"으로 설계됐으나, 비구독자도 지원하도록 **투트랙**으로
> 확장했다(설계 근거: `docs/specs/2026-07-12-two-track-auth-design.md`). 아래 정책은
> 두 모드 모두에 적용되며, **기본값은 여전히 구독**이다 — 아무 설정도 하지 않으면
> 기존과 동일하게 동작한다.

## 배경 사실

- `grok` CLI는 브라우저 OAuth로 로그인하며(`grok login`), 토큰은 **grok home 아래
  `auth.json`** 에 캐시된다. 이 경로는 **SuperGrok 또는 X Premium+ 구독**에 결제가 귀속된다
  (API 종량제 아님).
- **grok home은 `~/.grok`이 기본일 뿐 고정이 아니다.** `GROK_HOME`이 설정돼 있으면 그쪽으로
  통째로 옮겨가며 **`~/.grok`으로의 폴백이 없다** — `GROK_HOME` 아래 토큰이 없으면
  `~/.grok/auth.json`이 멀쩡해도 미인증이다. 그래서 이 플러그인의 auth 탐지는
  `env.ts`의 `grokHome()` / `auth.ts`의 `authFilePath()`를 통해 반드시 `GROK_HOME`을 따른다.
  하드코딩하면 `GROK_HOME` 사용자는 **복구 불가능하게 잠긴다**(안내대로 `grok login`을 해도
  토큰이 플러그인이 보지 않는 경로에 쓰인다). 실측: `docs/specs/grok-cli-contract.md` §8.
  주의 — 바이너리 위치(`GROK_BIN_DIR`||`~/.grok/bin`)는 `GROK_HOME`을 따라가지 **않는다**.
- `grok` CLI의 자격증명 우선순위는 **① per-model `api_key`/`env_key`(config.toml) →
  ② 활성 세션 토큰 → ③ `XAI_API_KEY` 폴백** 이다 (xAI user-guide
  `02-authentication.md` L289–291).
  **실측(2026-09-02, 1.0.13):** 유효 세션이 있는 상태에서 env에 키를 넣고 실제 한 턴을
  돌리면 exit 0으로 성공하고, 디버그 로그는 `method=cached_token` /
  **`auth_type=SessionToken`** — **API 키는 시도조차 되지 않는다.** (헤드리스 `-p` 5가지
  형태에서 재현. `-p` 밖 서브커맨드·만료 세션·`--resume`은 미측정 — 일반화 금지.)
  ⚠️ **`grok models`의 "You are using XAI_API_KEY." 문구를 근거로 삼지 말 것.** 그건 env에
  변수가 있는지만 보고하며, 요청이 실제로 어느 자격증명으로 나가는지와 **다르다**. 한 번
  이 문구를 근거로 반대 결론을 낸 적이 있다. 전체 실측: `docs/specs/grok-cli-contract.md` §10.
- **그렇다면 왜 env에서 키를 지우나 (아래 "안전 보장"의 진짜 이유).** 키가 세션을 이기기
  때문이 **아니다**. 세션이 없거나 만료된 순간 env 키가 **폴백 경로(③)** 가 되어, 구독
  모드로 시작한 실행이 조용히 종량제로 넘어갈 수 있기 때문이다. 키를 지우면 그런 실행은
  조용히 과금되는 대신 `auth_error`로 **명시적으로 실패**한다. 즉 구독 모드는 종량제
  자격증명을 아예 쥐지 않는다는 **정책 보장**이다 — 문서 두 곳이 서로 반대이고 CLI가 스스로
  업데이트되는 상황에서, 관측되지 않은 조합에 과금 정확성을 걸지 않는다.
- ⚠️ `~/.grok/config.toml`에 per-model `api_key`(①)를 박아둔 경우는 env 정제로 막을 수 없다.
  실측으로 확인했다 — 이 플러그인의 범위 밖이며 감지도 하지 않는다.
- 이 우선순위 규칙을 뒤집어서 활용한 것이 **API 모드**다: 서버 설정으로 API 모드를
  켜면(`GROK_BUILD_AUTH_MODE=api`) env의 키를 의도적으로 통과시켜, 구독이 없는
  사용자도 종량제로 위임을 쓸 수 있게 한다.
- **세션 = 액세스 토큰 + 리프레시 토큰이고, 만료 주기가 서로 다르다** (2026-09-05 실측,
  `~/.grok/auth.json`의 값이 아니라 **시간 차이만** 계산):
  액세스 토큰은 ES256 `at+jwt`이고 `expires_at`은 그 JWT의 `exp`와 같으며,
  수명은 **6시간**이다(`expires_at − create_time` = `exp − iat` = 6.00h).
  이전 문서의 "약 7일" 추정은 **틀렸다** — 액세스 토큰 기준으로는.
  사용자가 6시간마다 다시 로그인하지 않는 이유는 별도의 `refresh_token`이 조용히
  갱신하기 때문이다. **리프레시 토큰의 수명은 여전히 미측정**이고, 재로그인을 부르는
  것은 그쪽이다 (`grok login`이 필요해지는 순간 = 갱신이 실패하는 순간).
  거부된 세션이 실제로 어떻게 보이는지는 `docs/specs/grok-cli-contract.md` §7 C.
- 엔터프라이즈 환경에서는 `/etc/grok/requirements.toml`의 `disable_api_key_auth`로
  아예 API 키 경로를 조직 차원에서 차단할 수 있다 (1인 개발 환경에서는 해당 없음,
  참고용으로만 기재).

## 두 모드 요약

| | 구독 모드 (기본) | API 모드 (opt-in) |
|---|---|---|
| 트리거 | 미설정 또는 `GROK_BUILD_AUTH_MODE=subscription` | `GROK_BUILD_AUTH_MODE=api` |
| env 처리 | `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY` **제거** | env의 키 **그대로 통과** |
| 인증 근거 | `~/.grok/auth.json` 세션 토큰 | env의 API 키(grok CLI가 자체 소비) |
| 과금 | 구독 정액 (SuperGrok / X Premium+) | API 종량제 |
| 응답 `billing` 값 | `"subscription"` | `"metered_api"` |

전환은 **서버 레벨 env 1곳**에서만 이뤄지며, **호출별 오버라이드는 없다** — "이번
호출만 API로"가 새어나갈 경로를 원천 차단하기 위한 의도적 설계.

## 이 프로젝트의 정책

1. **로그인은 플러그인 밖에서, 사용자가 수동으로.**
   `grok login`은 브라우저 상호작용이 필요해 자동화할 수 없고, 자동화해서도 안 된다
   (자격증명 처리 관련 원칙과도 일치). README의 "사전 준비" 단계에 명시. (API 모드는
   대신 사용자가 자신의 셸 환경에 `XAI_API_KEY`를 직접 export해두는 것으로 대체된다
   — 플러그인이 키를 발급/저장하지 않는다.)

2. **모드 선택은 서버 레벨 env `GROK_BUILD_AUTH_MODE` 1곳, 호출별 오버라이드 없음.**
   미설정 시 기본값은 `subscription`이다. **구독 모드에서는** grok subprocess에
   전달하는 환경변수에서 API 키 관련 항목을 항상 제거한다 — 사용자의 셸 프로파일
   (`.bashrc`, `.zshrc` 등)에 실수로 `XAI_API_KEY`가 export돼 있어도, 이 플러그인을
   통한 호출에서만큼은 무시되도록 방어적으로 구현한다. **API 모드
   (`GROK_BUILD_AUTH_MODE=api`)에서만** env의 키를 그대로 통과시킨다.

   ```typescript
   // mcp-server/src/env.ts (구현됨) — 키 이름은 대소문자 무시(Windows env)
   // 구독 모드: XAI_API_KEY / GROK_CODE_XAI_API_KEY 제거
   // 두 모드: grok bin PATH prepend + HOME 폴백
   ```
   구현 SSOT는 `buildGrokEnv`다. 다른 시크릿(AWS/GitHub 토큰 등)은 정책상 제거하지 않는다
   (`--always-approve` 헤드리스가 프로세스 env를 상속하는 잔여 위험 — 위임 범위와 sandbox/worktree로 완화).

   이 설계가 "구독으로 쓰려다 실수로 종량제로 새는 사고"(참고 사례: OpenAI Codex
   CLI 이슈 #2000)를 세 겹으로 막는다: (a) 기본값이 구독이라 아무 설정도 안 하면
   기존과 동일, (b) 전환이 서버 설정 1곳뿐이라 세션 중 실수로 안 바뀜, (c) 모든
   delegate 응답이 설정된 `mode`와 그로부터 파생된 `billing`을 명시해 즉시 인지 가능
   (관측값이 아니라 `GROK_BUILD_AUTH_MODE` 파생 표기 — `docs/specs/grok-cli-contract.md` §2).

3. **MCP 서버는 어떤 형태로도 API 키나 세션 토큰을 저장/로깅하지 않는다.**
   `~/.grok/auth.json`을 읽지도 않는다 — 존재 여부만 확인하고, 실제 인증은 grok
   CLI 자신에게 위임한다. API 모드에서도 마찬가지로 env의 키를 읽어 통과시킬 뿐,
   별도로 저장하지 않는다.

4. **인증 상태 확인은 모드별로 분기한다** (`grok_auth_check` / `checkAuth`).
   - 공통: grok CLI 설치 여부 확인 → 없으면 `grok_not_installed`. 이 probe는
     `prependGrokBin`으로 grok 설치 dir(`GROK_BIN_DIR`||`~/.grok/bin`)를 PATH 앞에 붙여
     실행하므로, GUI/Dock 실행(최소 PATH)에서도 grok을 찾아 오탐을 방지한다(`env.ts`).
   - 구독 모드: **`authFilePath(env)`**(=`grokHome(env)/auth.json`, 즉 `GROK_HOME`||`~/.grok`)
     존재 여부만 확인(빠름, 매 호출 전 가능) → 없으면 `not_logged_in`. 실제로 성공하는지
     확인하는 스모크 테스트(`grok --no-auto-update -p "Say ok."`)는 비용/지연 문제로 매 호출
     시 실행하지 않는다.
     `GROK_HOME`은 `GROK_BIN_DIR`과 같은 hook 주의사항을 공유한다 — 서버 전용 `.mcp.json`
     env에만 두면 hook 프로세스가 못 보고 오차단하므로, **런치 env에 export**해야 한다.
   - API 모드: env에 `XAI_API_KEY` 또는 `GROK_CODE_XAI_API_KEY` 존재 여부 확인 →
     없으면 `no_api_key`.

5. **만료/무효 감지는 사후(reactive) 방식.**
   위임 실행의 출력 파싱이 실패했을 때, stderr/stdout에서 고특이도 인증 신호
   (`not authenticated` / `grok login` / `invalid or expired credentials`)를 감지하면
   모드별 안내 메시지(구독: `grok login` / API: 키 확인)로 전환한다.
   `401`/`403`/`unauthorized`/`logged in` 같은 광범위 토큰은 일반 grok 출력에
   오탐(예: HTTP 403 반환 코드)을 내 제거했다 — 마지막 신호가 매칭하는 것도
   **상태코드가 아니라 자격증명 문구**다.
   부재·만료 봉투 모두 앵커 완료다(계약 §7 A~C · `docs/06` Phase 2). 사전엔 매번 검증하지
   않는다 — 1차 방어선은 실행 전 `checkAuth`.

## 검증 체크리스트 (구현 완료 기준)

- [x] `~/.grok/auth.json`이 없는 상태(구독 모드)에서 delegate tool 호출 → 즉시 로그인
      안내, subprocess 실행 안 됨 (`checkAuth` 유닛 테스트로 커버)
- [x] 셸 환경변수에 `XAI_API_KEY`가 설정된 상태에서도 **구독 모드**의 delegate 호출은
      해당 키가 제거된 env로 grok을 실행함 (`buildGrokEnv` 유닛 테스트로 커버)
- [x] **API 모드**(`GROK_BUILD_AUTH_MODE=api`)에서 env에 API 키가 없으면 `no_api_key`
      반환, 위임 실행 안 됨 (`checkAuth` 유닛 테스트로 커버)
- [x] **API 모드**에서 env의 `XAI_API_KEY`가 grok subprocess env에 그대로 전달됨
      (`buildGrokEnv` 유닛 테스트로 커버)
- [x] 세션 만료 상태를 인위적으로 재현했을 때, 재로그인 안내 메시지가 명확히 반환됨
      (2026-09-05 실측: `npm run probe:expired`가 거부된 세션의 두 봉투를 격리
      `GROK_HOME`에서 재현 — grok은 **기다리지 않고 폐기**한다. 두 봉투 모두
      `auth_error` + `grok login` 안내로 분류됨을 `delegate.test.ts`가 고정.
      전문: `docs/specs/grok-cli-contract.md` §7 C)
- [x] 어떤 로그 파일에도 `~/.grok/auth.json`의 토큰 값이나 API 키 값이 기록되지 않음
      (MCP 서버는 파일을 읽지 않고 존재 여부/env 존재 여부만 확인)
