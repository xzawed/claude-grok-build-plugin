# 06. 로드맵

기존 멀티에이전트 오케스트레이터 프로젝트와 동일하게 Phase 단위로 진행하며,
**Phase 1이 끝나기 전까지 다음 Phase로 넘어가지 않는다** (Verum 프로젝트에서 얻은
교훈: 범위 통제가 아키텍처 야심보다 중요, "완료"는 시작 전에 정의돼야 함).

## Phase 1 — 최소 동작 (MVP)

**"done" 정의:** 터미널에서 `grok login` 완료 후, Claude Code 세션에서 슬래시
커맨드로 실제 코드 한 건을 Grok Build에 위임해 성공적으로 diff를 받아온다.

- [ ] `.claude-plugin/plugin.json` 최소 스펙 작성
- [ ] `.mcp.json`으로 MCP 서버 등록
- [ ] MCP 서버: `grok_auth_check`, `grok_build_delegate` 두 tool만 구현
- [ ] `buildGrokEnv()` — API 키 제거 로직 (`docs/02-auth-strategy.md` 체크리스트 통과)
- [ ] `/grok-build:delegate` 슬래시 커맨드
- [ ] 로컬에서 실제 토이 프로젝트로 end-to-end 테스트 1회

Hook, 이력 로깅, `/verify` 연동은 이 단계에 포함하지 않는다.

## Phase 2 — 안전장치

**"done" 정의:** 인증 실패/만료/CLI 미설치/타임아웃 4가지 실패 모드를 인위적으로
재현했을 때 모두 명확한 한국어 안내 메시지를 받는다.

- [ ] `pre-delegate-auth-check` hook 추가 (harness 레벨 방어)
- [ ] 실패 모드별 에러 분류 로직 (`grok_error` vs `auth_error` vs `timeout`)
- [ ] 위임 이력 로컬 로깅 (커밋 추적용)
- [ ] `/grok-build:check-auth` 진단용 커맨드

## Phase 3 — 확장

- [ ] `grok_build_verify` (샌드박스 빌드/테스트/스크린샷) 연동
- [ ] `mode: "plan"` 지원 — 위임 전 계획만 미리 확인하는 흐름
- [ ] 위임 이력을 기반으로 한 간단한 사용량 대시보드 (선택)

## Phase 4 — 오케스트레이터 통합

- [ ] 멀티에이전트 오케스트레이터의 Task Manager가 Grok Build를 "저비용 병렬 워커"
      옵션으로 인식하도록 라우팅 로직 연결 (`docs/05-routing-policy.md` 기준 코드화)
- [ ] ACP 직접 연동 검토 (MCP 래퍼 대비 이점이 실제로 있는지 재평가 후 착수 여부 결정)

## 명시적으로 하지 않는 것 (스코프 제외)

- Grok Build 결과의 자동 커밋/자동 PR 생성 — 항상 사람/Claude 검토 후 수동
- API 키 경로 지원 — 이 프로젝트는 구독 전용으로 의도적으로 좁힌다
  (필요해지면 별도 브랜치/플러그인으로 분리, 이 프로젝트에 옵션으로 섞지 않는다)
- Windows 네이티브 지원 — 개발 환경(Linux 홈서버, macOS/Linux 워크플로) 기준으로
  우선 검증
