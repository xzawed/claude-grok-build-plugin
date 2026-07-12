# 02. 인증 전략 — 구독 기반 (API 종량제 아님)

이 프로젝트에서 가장 중요한 제약 조건이다. 구현 시 이 문서를 최우선으로 검증할 것.

## 배경 사실

- `grok` CLI는 브라우저 OAuth로 로그인하며(`grok login`), 토큰은 `~/.grok/auth.json`에
  캐시된다. 이 경로는 **SuperGrok 또는 X Premium+ 구독**에 결제가 귀속된다
  (API 종량제 아님).
- `grok` CLI는 `XAI_API_KEY` 또는 `GROK_CODE_XAI_API_KEY` 환경변수가 설정돼 있으면
  **API 키 인증이 세션 토큰보다 우선**한다. 즉 환경변수에 키가 하나라도 남아있으면
  구독이 아니라 종량제 API 과금으로 새어나간다.
- 세션 토큰은 발급 후 **7일**이 지나면 만료되며, 이후 호출은 재인증을 요구한다.
- 엔터프라이즈 환경에서는 `/etc/grok/requirements.toml`의 `disable_api_key_auth`로
  아예 API 키 경로를 조직 차원에서 차단할 수 있다 (1인 개발 환경에서는 해당 없음,
  참고용으로만 기재).

## 이 프로젝트의 정책

1. **로그인은 플러그인 밖에서, 사용자가 수동으로.**
   `grok login`은 브라우저 상호작용이 필요해 자동화할 수 없고, 자동화해서도 안 된다
   (자격증명 처리 관련 원칙과도 일치). README의 "사전 준비" 단계에 명시.

2. **MCP 서버는 grok subprocess에 전달하는 환경변수에서 API 키 관련 항목을 항상 제거한다.**
   사용자의 셸 프로파일(`.bashrc`, `.zshrc` 등)에 실수로 `XAI_API_KEY`가 export돼
   있어도, 이 플러그인을 통한 호출에서만큼은 무시되도록 방어적으로 구현한다.

   ```typescript
   function buildGrokEnv(): NodeJS.ProcessEnv {
     const env = { ...process.env };
     delete env.XAI_API_KEY;
     delete env.GROK_CODE_XAI_API_KEY;
     return env;
   }
   ```

3. **MCP 서버는 어떤 형태로도 API 키나 세션 토큰을 저장/로깅하지 않는다.**
   `~/.grok/auth.json`을 읽지도 않는다 — 존재 여부만 확인하고, 실제 인증은 grok
   CLI 자신에게 위임한다.

4. **인증 상태 확인은 "존재 여부 체크"와 "스모크 테스트"를 구분한다.**
   - 존재 여부 체크 (빠름, 매 호출 전 실행 가능): `~/.grok/auth.json` 파일 존재 확인
   - 스모크 테스트 (느림, 실패 시에만 실행): `grok --no-auto-update -p "Say ok."`
     실제로 성공하는지 확인. 매 위임 요청마다 실행하면 불필요한 API 호출/지연이
     누적되므로, "존재하지만 실패"하는 케이스(만료)에서만 트리거.

5. **만료 감지는 사후(reactive) 방식.**
   위임 실행이 실패했을 때 stderr/exit code에서 인증 관련 신호(401/403,
   "not authenticated", "login" 키워드 등)를 감지하면 그때 재인증 안내 메시지로
   전환한다. 사전에 매번 검증하지 않는다.

## 검증 체크리스트 (구현 완료 기준)

- [ ] `~/.grok/auth.json`이 없는 상태에서 delegate tool 호출 → 즉시 로그인 안내,
      subprocess 실행 안 됨
- [ ] 셸 환경변수에 `XAI_API_KEY`가 설정된 상태에서도 delegate tool을 통한 호출은
      구독 세션으로 인증됨 (grok 프로세스 env 덤프로 검증)
- [ ] 세션 만료 상태를 인위적으로 재현했을 때, 재로그인 안내 메시지가 명확히 반환됨
- [ ] 어떤 로그 파일에도 `~/.grok/auth.json`의 토큰 값이 기록되지 않음
