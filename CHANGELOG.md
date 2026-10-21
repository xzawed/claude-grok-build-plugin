# Changelog

무엇이 언제 바뀌었는지의 **색인**이다. 항목 하나는 작업일(`## YYYY-MM-DD`, 최신이 위) 아래 `- `로 시작하는 한 줄이고,
무엇이 바뀌었는지와 원천만 적는다(300자 이하). 경위·수치·검토 회차는 원천에 쓴다: 릴리스는 `docs/releases/v<버전>.md`,
수락은 `docs/09` §5, 결함은 `docs/10`(고치면 그 릴리스 노트), 결정 근거는 `docs/specs/`·`docs/plans/`, 다시 밟을 함정은
`CLAUDE.md`에 한 줄. 원천이 따로 없는 작업(결함 0건인 감사 같은)은 그 한 줄이 기록이다.

항목은 평문 한 줄이다 — 줄을 나누지 않고, 제목·목록·인용 같은 블록 표기로 시작하지 않고, HTML·문자 참조(`&…;`)·이미지·
`$$`를 쓰지 않는다(`details`·`div`·`table`·`img`처럼 자기 항목 밖까지 닿을 수 있는 태그, `id`·`name` 속성, 주석·처리
명령·선언·CDATA, 문자 참조는 백틱 안에서도 안 된다 — 꺾쇠 없이 쓴다). 글자 사이에 붙여 쓴 `~` 둘은 `A50~A57, A59~A60`처럼
취소선이 될 수 있으니 범위의 `~`는 띄어 쓴다.

**옮기기 전의 항목 106개(2026-07-25 ~ 2026-10-09)는 맨 아래 "옮긴 항목 색인"에 날짜와 제목만 남겼다.** 제목의 `~`를
GitHub가 취소선으로 짝지으면 색인에는 `\~`로 적었다. 전문은 `docs/history/<작업일>.md`에 같은 제목으로, 글자 그대로
있다(옮긴 뒤로 고치지 않는다). 다른 문서가 "`CHANGELOG.md` v0.2.35"·"`CHANGELOG.md` 2026-09-12"처럼 가리키면 색인에서 그
버전·날짜를 찾아 그 파일로 간다(한 버전에 릴리스와 수락 두 줄이 있으면 제목으로 고른다). "CHANGELOG 57"·"CHANGELOG 19번"처럼
번호만 대면 그 문서가 다루는 릴리스 항목 안의 목록 번호다 — `docs/releases/v0.2.36-review.md`·`docs/09`의 번호는 v0.2.36
항목, `docs/releases/v0.2.37.md`의 번호는 v0.2.37 항목. 왜 이렇게 나눴는지는 `docs/specs/2026-10-09-changelog-index-design.md`.

지금 상태는 루트 `CLAUDE.md`, 제품 본질은 `docs/00-product-vision.md`. 이 머리말과 파일의 모양은
`mcp-server/test/changelog-shape.test.ts`가 지킨다.

## 2026-10-21

- #181을 머지했다(오너 승인, ce9041a — 트리 = 검토한 6c5b6db). #180의 후속(A71 수정·`.claude/tools` 분석·A68 보류 확대)이 main에 올랐다. 릴리스 없음(테스트·문서·CI만). 원천 `docs/09` §4 H, `docs/10` A68·A71.
- 리뷰 라운드 규율을 `docs/11`과 `CLAUDE.md`에 넣었다 — 종료는 비용·라운드 수가 아니라 품질(BLOCKER·MAJOR 0, 모든 finding 처리, Grok HOLDS, CI green, 변이 바닥)로 하고, 토큰은 타당성 없는 낭비만 줄이며 신뢰도·완성도는 유지한다. #181이 33라운드를 돈 뒤 오너 지시. 원천 `docs/11` "리뷰 라운드 규율".

## 2026-10-19

- #181 16차·17차 검토가 찾은 A75(과금 프로브는 읽는 쪽이 출력을 먼저 닫으면 상태와 무관하게 판정 없이 exit 1, "과금 안 됨"으로 끝난다)를 기록만 해 열었다. 원천 `docs/10` A75.

## 2026-10-18

- #180을 머지했다(오너 승인, ab531c2 — 트리 = 검토한 004a61e). 오너가 남은 판단마다 권장안을 골랐고 후속은 Grok과 함께 했다. 원천 `docs/09` §4 H, `docs/10` A68.
- A71을 고쳤다 — 과금 프로브는 500 이상의 상태를 판정 줄부터 UNKNOWN으로 찍고, 본문을 못 읽으면 2xx에서만 요청을 받았다고 말한다(종료 코드는 그대로). e2e가 출력 전체를 줄마다 고정한다. Grok의 설계 검토와 반증을 거쳤다. 원천 `mcp-server/test/probe-metered-output.test.ts`.
- `.sonarcloud.properties`가 점 폴더 안의 파일을 하나씩 이름으로 둔다 — 로컬 재측정에서 `.claude/tools`의 세 스크립트가 처음 JS 분석을 받고, 새 지적 4건은 Claude와 Grok이 각자 판정해 실제 결함이 없었다. 그 대신 숨은 유니코드 규칙에서 빠진 두 스킬은 `hiding-characters.test.ts`가 모든 추적 파일과 함께 본다. 원천 `docs/specs/2026-10-17-sonarcloud-review.md`.
- A68의 보류를 같은 격리로 grok을 띄우는 측정으로 넓혔고, #181 검토가 찾은 A72(과금 프로브가 JSON으로 시작하는 아주 큰 본문에서 판정 없이, 또는 billed 판정 뒤에 죽는다), A73(응답이 되돌려 주거나 fetch가 오류에 담은 키를 그대로 찍는다), A74(키 프롬프트가 빈 입력을 "터미널이 아니다"라고 하고, 공백만 친 키로 빈 키 요청을 보낸다)를 기록만 해 열었다. 원천 `docs/10` A68·A72·A73·A74.

## 2026-10-17

- SonarCloud 검토(Grok과 함께) — 마지막 분석(2026-09-23, fa0d493)의 87건과, 같은 프로파일로 로컬에서 다시 잰 eae57ea의 158건 중 등급을 정하거나 결함을 숨길 수 있는 56건을 판정했고 실제 결함은 없었다. 신뢰성 D는 문자열 정렬(S2871), 보안 C는 이름용 난수(S2245)와 CI 설치 스크립트(S6505)에서 나온다. 자동 분석은 꺼져 있었다. 원천 `docs/specs/2026-10-17-sonarcloud-review.md`.
- 보강(Grok의 설계 검토, 격리 worktree에서 구현) — CI는 `npm ci --ignore-scripts`로 설치하고(S6505), 과금 프로브는 응답·오류에서 온 값을 `scripts/printable.mjs`로 제어·서식 문자가 보이게 찍고 원문 본문은 접두사 뒤에 줄마다 찍으며(S5145), Windows 전용 테스트는 `skipIf`로 건너뛴다(S8968). `.sonarcloud.properties`가 테스트를 구분한다. 원천 같은 스펙.
- A70을 찾아 고쳤다 — 과금 프로브는 과금된 응답의 `id`·`status`·`model`이나 usage 값이 원시값이 되지 못하는 객체일 때와, 너무 깊은 JSON 본문의 5xx에서 죽어 exit 1("과금 안 됨")로 끝났다. usage는 이제 유한한 숫자만 센다(있는 total이 결정하고, 없으면 있는 부분이 모두 숫자여야 한다) — 숫자 문자열(`"5"`)·불리언·배열(`[5]`)은 과금이 아니라 UNKNOWN(exit 2)이다. 원천 `mcp-server/test/probe-metered-output.test.ts`.
- A71을 열었다(기록만) — 과금 프로브는 5xx에 `--- NOT billed ---`를 찍고 exit 2로 끝나며, 본문을 못 읽은 4xx에 "accepted"를 찍는다. A68에 grok 1.0.62의 관측을 더했다: `probe:contract`가 STOP(`sessionAccepted`)을 냈고, 원인을 알기 전엔 다시 돌리지 않는다(오너). 원천 `docs/10` A68·A71.

## 2026-10-15

- v0.2.44 수락 — 머지 트리 = 검토 tip, 태그·릴리스(Latest), dist = 태그 = 캐시 blob, `accept-release` 레포·캐시 15/15, 캐시 번들 재현, 헤드리스 새 세션의 `serverVersion` 0.2.44까지 닫았다. 원천 `docs/09` §5.

## 2026-10-14

- A68을 열었다(기록만, Grok의 판단 — 오너가 맡겼다) — grok 1.0.52에서 거절된 세션은 `auth_error`가 아니라 브라우저 로그인을 기다리다 `timeout`으로 끝난다. @로 붙인 파일 32개 상한은 새 항목으로 열지 않고 계약에 기록만 한다. 원천 `docs/10` A68.
- A69를 열었다(기록만, Grok의 판단대로 먼저 쟀다) — 인코딩한 cwd가 255바이트를 넘으면 grok은 세션 폴더를 slug-해시로 짓고, 래퍼는 그 이름을 cwd로 풀어 resume에 거짓 위치 안내를 붙인다(v0.2.43 번들로 재현). 원천 `docs/10` A69·계약 §12.
- A59 검토 13라운드에서 grok 1.0.52를 더 쟀다(Windows, 쿼터 0) — `@`와 파일 이름 사이의 공백은 건너뛰어 붙이고, `/`로 부른 스킬은 질의 뒤에 블록을 두어 경계에 함께 센다. 원천 계약 §1 ③.
- A59 검토 14–15라운드에서 grok 1.0.44·1.0.50·1.0.52를 더 쟀다(Windows, 쿼터 0) — 명령 파일과 Claude Code 쪽 스킬·명령도 `/`로 부르면 같은 스킬 블록을 받는다. 원천 계약 §1 ③.

## 2026-10-13

- v0.2.44 — grok이 모델 요청에서 프롬프트나 @로 붙인 파일, /로 부른 스킬의 일부를 뺀 실행이 그 사실을 `message`로 말하고, 그 턴의 grok 기록이 파일을 넘기지 못했다고 적었으면 빠진 부분이 모델에 닿지 않았다고 말한다(A59, 오너 판단 "경고만"). `hooks.json` 설명도 고쳤다(A67). 원천 `docs/releases/v0.2.44.md`.
- A59 검토 중 grok 1.0.50을 더 쟀다(Windows, 쿼터 0) — 한 세션을 두 실행이 함께 쓸 수 있고 같은 순간에 시작한 둘은 같은 `prompt_index`를 받아 앞 파일이 덮이며, 기록에는 도구 호출 줄이 더해지고 grok이 빼는 가운데만 다른 두 프롬프트가 같은 질의로, CRLF는 그대로 남는다. 원천 계약 §1 ③.
- A59 검토 7–9라운드에서 grok 1.0.52(블록과 넘칠 때의 자르기는 1.0.50도)를 더 쟀다(Windows, 쿼터 0) — @로 붙인 파일은 앞의 32개까지 질의 뒤 블록에 줄마다 번호를 달고 들어가 경계에 함께 세이고, 넘치면 grok은 질의를(약 75 KB까지) 두고 파일을 뒤에서 자른다. 429·500에도 파일과 턴은 요청 전에 쓰인다. 원천 계약 §1 ③.
- grok 1.0.52(그날의 stable)로 A59를 다시 쟀다(쿼터 0) — 맨 앞의 U+FEFF를 하나 지우고 깎은 뒤 하나를 더 지우며(1.0.50은 지우지 않는다), 거절된 세션에서는 브라우저 로그인을 기다린다(A68). 앞에서 깎는 글자는 Unicode White_Space(열두 글자를 쟀다)이고, 잰 제어 문자 셋과 프롬프트 안의 짝 없는 CR은 남긴다. 원천 계약 §1 ③.

## 2026-10-12

- grok 1.0.50에서 A59의 오프로드를 다시 쟀다(쿼터 0; 경계와 앞 공백은 Windows와 Linux Docker, 나머지는 Windows) — 경계는 그대로이고 grok이 앞뒤 공백을 깎은 뒤에 세며(U+FEFF·U+200B는 남긴다), resume·continue한 턴은 `prompt_<N>.txt`에 쓴다. 원천 계약 §1 ③.
- #176 뒤에 남겨 둔 여섯 항목을 Grok과 논의해 정리했다 — Windows CI에서 한 번 5초를 넘은 테스트의 한도를 20초로 늘리고, `CLAUDE.md`는 이어 붙인 줄을 풀고 "더 큰 그림" 절을 덜어(같은 글이 `docs/11`에 있다) 199줄로, GitHub가 `**`로 그리던 굵은 글씨 네 곳(`docs/09`·`docs/06`)과 "read-only"라 부르던 `src/` 주석 다섯을 고치고, `*.stackdump`를 무시한다.
- A67 열림(기록만) — `hooks/hooks.json`의 설명이 프롬프트 없는 `grok_cli` 호출을 "read-only queries"라 부른다. 배포 파일이라 다음 릴리스에 싣고, 옛 글을 그대로 실으면 `hooks-contract.test.ts`가 막는다. 원천 `docs/releases/v0.2.44.md`.
- Grok CLI 기능 보강 후보를 Grok이 이끈 검토 세 라운드(1.0.44·1.0.50)로 정리해 착수 전 할 일로 남겼다 — P1 usage 읽기·웹 검색 끄기·verify 출력 스키마, 그리고 `probe:contract`의 도움말 본문 비교(오너 판단 대기). `docs/09` §4 G로 분류하고, A60의 단서는 `docs/10` A60에도 적었다. 원천 `docs/plans/2026-10-12-grok-enhancement-backlog.md`.
- A66 열림(기록만) — `npm run typecheck`가 `src/`만 봐 테스트 파일의 타입 오류가 어디서도 드러나지 않는다. 원천 `docs/10`.
- `docs/09`의 v0.2.26 실행 기록에서 GitHub가 "A32·B1"을 취소선으로 그리던 `~` 둘을 `\~`로 적었다(색인의 v0.2.26 제목과 같은 종류).
- v0.2.43 수락 — 머지 트리 = 검토 tip, 태그·릴리스(Latest), dist = 태그 = 캐시 blob, `accept-release` 레포·캐시 15/15, 캐시 번들 재현, 헤드리스 새 세션의 `serverVersion` 0.2.43까지 닫았다. v0.2.42의 마지막 칸도 v0.2.42 갱신 뒤에 시작된 세션이 닫았다. 설치 기록의 `gitCommitSha`가 이번엔 바뀌어 `CLAUDE.md`의 단정("바뀌지 않는다")도 고쳤다. 원천 `docs/09` §5.
- v0.2.43 — `/grok:memory`가 범위를 확인받을 때 범위마다 폴더 전체가 지워질 수 있다고 말하고(A64), `/grok:cli`와 `grok_cli` 도구 설명이 `-f`/`--force`와 지우는 범위를 넓히는 권유 플래그를 사용자 확인 없이 붙이지 않는다(A65). 원천 `docs/releases/v0.2.43.md`.
- grok 1.0.50을 다시 쟀다 — 계약 스냅샷을 1.0.50으로 올리고, probe가 보지 않는 차이(서브커맨드 도움말 다섯 쪽, `memory clear`가 지우는 대상, `worktree rm`의 `-f` 가드)를 계약에 적었다. 숨은 플래그 분류는 1.0.44와 같았다. 원천 `docs/specs/grok-cli-contract.md`("1.0.50 표면"·§9·§15·§16).
- A64·A65 열림 — `/grok:memory` 안내가 1.0.50의 `memory clear`가 지우는 것(`memory-v2/` 범위 폴더 통째로)을 좁게 말하고, `/grok:cli` 안내가 grok의 `-f` 권유를 막지 않는다. 원천 `docs/releases/v0.2.43.md`(grok 쪽 사실은 계약 §9·§15).
- 오너 규칙 "측정·리뷰·개발 전에 grok과 Claude Code를 최신으로"를 `CLAUDE.md` 현재 상태에 두었다(근거는 계약 머리). 식 안과 클래스 본문의 주석이 번들에 남는다는 함정도 Gotchas에 더했다.

## 2026-10-11

- Claude Code mods를 쓸 수 있는 곳을 Claude·Grok 2라운드 논의로 정리해 착수 전 할 일로 남겼다(서버 JSON을 보여 주는 표시 층만, 별도 opt-in 플러그인, 오너 판단 대기). `docs/09` §4 G로 분류. 원천 `docs/plans/2026-10-11-claude-mods-backlog.md`.

## 2026-10-09

- 옮긴 색인의 v0.2.26 제목이 GitHub에서 취소선으로 그어지던 것을 고쳤다 — 짝지어지는 `~`만 `\~`로 적고 얼린 이력 파일은 그대로 둔다. 원천 `docs/specs/2026-10-09-changelog-index-design.md`.
- CHANGELOG를 색인으로 바꿨다 — 항목 전문은 작업일별 `docs/history/`로 글자 그대로 옮겼고, 하네스가 틀린 사실은 메커니즘 한 줄로 남기게 했다(`CLAUDE.md` 8단계). 원천 `docs/specs/2026-10-09-changelog-index-design.md`.

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
- v0.2.26 — Grok 4.7 / grok CLI 1.0.30 대응 (A28\~A32 · B1\~B3 · probe:contract)
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
