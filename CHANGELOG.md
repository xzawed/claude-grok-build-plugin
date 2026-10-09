# Changelog

무엇이 언제 바뀌었는지의 **색인**이다. 항목 하나는 작업일(`## YYYY-MM-DD`, 최신이 위) 아래 `- `로 시작하는 한 줄로,
무엇이 바뀌었는지와 원천만 적는다 — 300자 이하, 줄을 나누지 않고 HTML을 쓰지 않는다. 경위·수치·검토 회차는 원천에
쓴다: 릴리스는 `docs/releases/v<버전>.md`, 수락은 `docs/09` §5, 결함은 `docs/10`(고치면 그 릴리스 노트), 결정 근거는
`docs/specs/`·`docs/plans/`, 다시 밟을 함정은 `CLAUDE.md`에 한 줄. 원천이 따로 없는 작업(결함 0건인 감사 같은)은 그 한
줄이 기록이다.

**옮기기 전의 항목 106개(2026-07-25 ~ 2026-10-09)는 맨 아래 "옮긴 항목 색인"에 날짜와 제목만 남겼다.** 전문은
`docs/history/<작업일>.md`에 같은 제목으로, 글자 그대로 있다(옮긴 뒤로 고치지 않는다). 다른 문서가 "`CHANGELOG.md` v0.2.35"·
"`CHANGELOG.md` 2026-09-12"처럼 가리키면 색인에서 그 버전·날짜를 찾아 그 파일로 간다(한 버전에 릴리스와 수락 두 줄이 있으면
제목으로 고른다). "CHANGELOG 57"·"CHANGELOG 19번"처럼 번호만 대면 그 문서가 다루는 릴리스 항목 안의 목록 번호다 —
`docs/releases/v0.2.36-review.md`·`docs/09`의 번호는 v0.2.36 항목, `docs/releases/v0.2.37.md`의 번호는 v0.2.37 항목.
왜 이렇게 나눴는지는 `docs/specs/2026-10-09-changelog-index-design.md`.

지금 상태는 루트 `CLAUDE.md`, 제품 본질은 `docs/00-product-vision.md`. 이 머리말과 파일의 모양은
`mcp-server/test/changelog-shape.test.ts`가 지킨다.

## 2026-10-09

- CHANGELOG를 색인으로 바꿨다 — 항목 전문은 작업일별 `docs/history/`로 글자 그대로 옮겼고, 하네스가 틀린 사실은 한 줄로 남기게 했다(`CLAUDE.md` 8단계). 원천 `docs/specs/2026-10-09-changelog-index-design.md`.

## 옮긴 항목 색인 — 2026-07-25 ~ 2026-10-09

### 2026-10-09 — 전문 `docs/history/2026-10-09.md`

- v0.2.42 수락 — 머지 트리 = 검토 tip, dist=태그=캐시 blob, 캐시 15/15; 새 세션 칸만 남겼다(누가 무엇으로는 `docs/09` §5)
- v0.2.42 — `grok_cli`가 게이트 없는 턴을 돌리던 두 길(A52 플래그 뒤의 맨 단어, A62 `--print`)과 확인 안내(A57)
- v0.2.41 수락 — 새 세션과 그 MCP 자식이 0.2.41을 돌렸고, 수락 사실을 다시 쟀다(누가 무엇으로는 `docs/09` §5)
- v0.2.41 — MCP SDK 1.32.1, 락파일의 권고 셋 (GHSA-6qxp-vccf-f47h · GHSA-jqcg-44mw-7w3h · GHSA-68fv-2mgg-jv7q)
- v0.2.40 머지 뒤 검토 — 검토 없이 머지된 마지막 커밋에서 주석 결함 하나와 테스트 공백 하나 (번들은 그대로)
- A61 열림 — 계획의 "후보"(옛 번들 채점이 쿼터를 쓸 수 있다)를 재서 기록만 했다
- v0.2.40 수락 — 새 세션과 그 MCP 자식이 0.2.40을 돌렸고, 수락 사실을 다시 쟀다(누가 무엇으로는 `docs/09` §5)
- v0.2.40 — `billingCaveat`이 `[model_providers]`에서 물려받은 키를 놓치던 결함 (A51)

### 2026-10-05 — 전문 `docs/history/2026-10-05.md`

- v0.2.39 수락 — 새 세션과 그 MCP 자식이 0.2.39를 돌렸고, 수락 사실을 다시 쟀다(누가 무엇으로는 `docs/09` §5)

### 2026-10-04 — 전문 `docs/history/2026-10-04.md`

- v0.2.39 — `/grok:plan`이 사용자 허용 규칙대로 쓰기·커밋·push를 하던 결함 (A50)
- v0.2.38 수락 — 새 세션과 그 MCP 자식이 0.2.38을 돌렸고, 수락 사실을 다시 쟀다(누가 무엇으로는 `docs/09` §5)
- v0.2.38 — fast-uri 3.1.8, 번들 안에 있던 권고 하나 (GHSA-hrr3-gc8f-f4qj)

### 2026-09-30 — 전문 `docs/history/2026-09-30.md`

- 다음 세션 계획 — fast-uri 권고가 먼저, 그다음 열린 결함 9건
- grok 1.0.44 계약 재측정 — 1.0.44가 깬 것은 없었고, 그 전부터 있던 결함 9건(A50~A57, A59)을 열었다

### 2026-09-28 — 전문 `docs/history/2026-09-28.md`

- v0.2.37 수락 — 새 세션과 그 MCP 자식이 0.2.37을 돌렸고, 수락 사실을 다시 쟀다(누가 무엇으로는 `docs/09` §5)
- v0.2.37 — 감사의 문서 항목 8건, 커밋이 보고되지 않던 결함 (A49)
- v0.2.36 수락 — 마지막 칸까지, 이번에는 세션 프로세스의 명령줄도 쟀다

### 2026-09-25 — 전문 `docs/history/2026-09-25.md`

- v0.2.36 — 전체 감사가 찾은 결함 12건 (A37~A48)
- v0.2.35 — Windows에서 grok이 여는 이름으로 세션을 찾는다; 끝 공백은 원인을 말한다 (A36)

### 2026-09-24 — 전문 `docs/history/2026-09-24.md`

- v0.2.34 — 상대 경로 `GROK_HOME`을 grok처럼 grok이 실행될 폴더 기준으로 푼다 (A35)
- v0.2.33 — config.toml의 모델별 키를 `billing` 옆에 알린다 (오너 목표 E)
- 후속 — v0.2.32 마지막 칸, B6 닫힘, 이 머신과 계약을 1.0.41로
- B4 닫힘 — 인증된 턴에서 Linux 샌드박스는 실제로 쓰기를 막는다
- v0.2.32 — 워커가 우리 플러그인을 다시 불러와 또 다른 Grok을 띄울 수 있었다 (A34)
- v0.2.32 수락 — 거절을 끝단에서 봤다
- v0.2.31 수락 — 마지막 칸을 새 세션이 닫았다

### 2026-09-23 — 전문 `docs/history/2026-09-23.md`

- probe:contract가 두 번째 질문을 하게 됐다 — "새 사용자는 무엇을 받나"
- v0.2.31 — 못 잰다고 적어둔 것을 재러 갔더니, 결함은 우리 쪽에 있었다 (A33)
- 릴리스 게이트가 확인하지 못한 것을 단정했다
- 최소 런타임이 번들러 안에만 있었다 — 그리고 격리 프로브는 깨끗했다
- 배포되는 나머지 도구도 봤다 — 이웃의 약속이 침묵을 덮고 있었다
- 감사 범위를 감사했다 — 배포되는데 한 번도 안 본 코드
- 감사 라운드 종료 — `mcp-server/src/` 전수 판정
- v0.2.30 — 남은 모듈을 다 보고, 깨끗한 것도 기록했다

### 2026-09-22 — 전문 `docs/history/2026-09-22.md`

- v0.2.29 — 집계가 받은 데이터보다 많이 말했다
- v0.2.28 — remove가 지우라고 하지 않은 브랜치를 지웠다
- v0.2.27 — 감사: 은닉성 코드 · 고아 문서 · 불필요한 내용
- v0.2.26 — Grok 4.7 / grok CLI 1.0.30 대응 (A28~A32 · B1~B3 · probe:contract)
- 왜 17개 릴리스를 아무도 못 봤나 — `npm run probe:contract` (C)
- Grok 4.7가 실제로 바꾼 것 — 긴 실행을 견디게 만들기 (B1~B3)
- Grok 4.7 / grok CLI 1.0.30 대응 — 결함 5건 (A28~A32)

### 2026-09-13 — 전문 `docs/history/2026-09-13.md`

- v0.2.25 — 강도 높은 전체 감사: 결함 5건 (F1~F5)
- B3 — 콘솔은 브라우저 자동화로 읽을 수 없다. 우회는 하지 않는다

### 2026-09-12 — 전문 `docs/history/2026-09-12.md`

- B3 계측기 프로브를 레포에 남겼다 (`npm run probe:metered`) — 버전은 올리지 않는다
- 승인받은 변경을 재현 단계에서 중단했다 — "산문 리뷰는 매달린다"가 오늘은 재현되지 않는다
- B1을 코퍼스로 좁혔다 — "편집 런이 매달린다"는 근거가 없다
- B5(win32 손자 프로세스 정리)를 닫았다 — 답은 "정리된다"가 아니라 **조건부**다
- v0.2.24 수락의 마지막 칸 — 새 세션이 닫았다, 단 Grok이 두 번 반려한 뒤에
- 개발 의존성 보안 패치 — vitest GHSA-82fw-gwwq-j7x9
- 같은 날 감사 — 결함 0건, 그러나 증거는 남긴다
- 잔여 검토 — 열린 코드 작업 0건, 문서 드리프트 1건
- 2차 검증 — 핸드오프 파일의 기계 검증 가능한 주장을 테스트로 고정
- v0.2.24 — 안정성·신뢰성 감사 7라운드 (A26·A27)
- 절차 — 8단계(수행 후 검증 + 과정 감사)를 필수로 넣었다
- 수락 실행 기록 — v0.2.24 (릴리스 아님) · 8단계 첫 적용

### 2026-09-06 — 전문 `docs/history/2026-09-06.md`

- 수락 실행 기록 — v0.2.23 (릴리스 아님)
- v0.2.23 — 붙여 쓴 프롬프트도 프롬프트다 (릴리스+전체 코드 감사 A24·A25)
- 수락 실행 기록 — v0.2.22 · `docs/10` B4가 닫혔다 (릴리스 아님)
- v0.2.22 — 광고한 계약을 실제로 지키게 한다 (전체 감사 A21~A23)
- v0.2.21 — 감사 큐 A7~A20 (큐가 비었다)

### 2026-09-05 — 전문 `docs/history/2026-09-05.md`

- v0.2.20 — 감사 큐 A1~A5
- 문서 — 지금 이 레포에서 일하는 방법을 적었다 (Grok과 합의)
- 세션 핸드오프 — 감사 결과를 레포에 남긴다 (릴리스 아님)
- v0.2.19 — 서비스 감사가 찾은 네 가지 실패
- v0.2.18 — 만료 세션은 폐기된다, 그리고 우리는 정반대를 안내했다

### 2026-09-04 — 전문 `docs/history/2026-09-04.md`

- 수락 실행 기록 — v0.2.17 (릴리스 아님)
- v0.2.17 — 게이트를 지키던 것이 아무것도 없던 자리

### 2026-09-03 — 전문 `docs/history/2026-09-03.md`

- v0.2.16 — 문서가 코드와 반대로 말하던 곳들
- v0.2.15 — 취약점 6건, 그중 4건은 실제로 배포되고 있었다
- v0.2.14 — 아무도 열지 않았던 곳
- v0.2.13 — 감사: 재현되지 않은 것은 고치지 않았다

### 2026-09-02 — 전문 `docs/history/2026-09-02.md`

- v0.2.12 — 계약을 다시 재고 나서야 보인 것들

### 2026-08-24 — 전문 `docs/history/2026-08-24.md`

- Docs — README 가독성 재구성 + 코드와 어긋난 문장 교정

### 2026-08-23 — 전문 `docs/history/2026-08-23.md`

- Fix — v0.2.10의 회귀와 미완성 절반 (v0.2.11)
- Fix — 자원 누수 수리 (v0.2.10)
- Fix — SonarCloud 오버롤 기준 보안·정확성 수리 (v0.2.9)

### 2026-08-15 — 전문 `docs/history/2026-08-15.md`

- Fix — 분류기 오탐 + 이력/env 보안 위생 (v0.2.8)

### 2026-08-14 — 전문 `docs/history/2026-08-14.md`

- Docs — README를 v0.2.7 배포 표면에 맞춤
- Fix — Grok Build CLI 1.0.3 / Grok 4.6 헤드리스 계약 (v0.2.7)

### 2026-08-09 — 전문 `docs/history/2026-08-09.md`

- Ops — GitHub 표면 정리 + 머지 게이트 강화 (제품 변경 없음)
- Ops — `npm ci` 조건 정정 (실측 사고)
- Security — 추적되던 서드파티 자격증명 제거 (PR #53)

### 2026-08-08 — 전문 `docs/history/2026-08-08.md`

- Security — 번들에 인라인된 `fast-uri` 패치 (v0.2.6)

### 2026-07-29 — 전문 `docs/history/2026-07-29.md`

- Ops — 의존성 PR의 dist 재빌드는 에이전트 소유 (배포 변경 없음)

### 2026-07-28 — 전문 `docs/history/2026-07-28.md`

- Ops — maintainer surface + shipped consistency (v0.2.5)

### 2026-07-25 — 전문 `docs/history/2026-07-25.md`

- Fix — hooks.json schema (v0.2.4) — plugin failed to load
- Release — v0.2.3 (GitHub Release for end users)
- Docs — close in-repo residual loop
- Fix/Feat — pack integrity + billingMismatch (v0.2.3)
- Feat — status dashboard (v0.2.2)
- Release — v0.2.1 consumer kit
- Feat — orchestrator nextAction + post-delegate review
- Test — PreToolUse hook harness e2e
- Feat — session resume provenance + auth surface + dep hygiene
- Fix — MCP server version SSOT
- Fix — P1 reliability (apply untracked + timeout auth)
- Feat — first-mile Grok starting point
- Fix — unauth / expired-session signals (modern grok)
- Docs/fix — sandbox profiles measured + tests
- Fix — Windows platform hardening
- Chore — Phase 4 Slice B (CI + contract hardening)
- Feat — Phase 4 Slice A (routing engine)
- Feat — Phase 3.5 Slice C (worktree lifecycle + usage insights)
- Feat — Phase 3.5 Slice B (stable delegate quality)
- Feat — Phase 3.5 Slice A (routing skill · presets · setup)
- Docs — 제품 본질 · 세션 핸드오프
