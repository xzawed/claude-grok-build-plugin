# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

## 2026-09-05 (4)

### v0.2.20 — 감사 큐 A1~A5

`docs/10`의 상위 다섯 건. 전부 배포 번들을 `.claude/tools/mcpcall.mjs`로 구동해 재현하고,
고친 뒤 같은 페이로드로 재측정했다. 전문: `docs/releases/v0.2.20.md`.

- **A1** 명시 `signals`의 `security:false` 하나로 HIGH→MEDIUM, 전 필드 구조체면 LOW까지 내려갔다.
  `RISK_RAISING`이 모든 위험 상승 키가 됐다(방향은 한쪽 — 올리는 것은 여전히 가능). Grok의 반증
  시도는 강등 20종 0건 성공, 대신 트레이드오프를 짚었다 → 탈출구(`task` 없이 `signals`만)를 못박음.
  같은 도구가 광고만 하던 `additionalProperties:false`를 `.strict()`로 실제로 강제.
- **A2** `-p`를 실은 `grok_cli`가 파일을 고치고 턴을 쓰면서 이력 0행·hook 게이트 0. matcher에
  `grok_cli`를 넣되 **게이트는 프롬프트를 따라간다**(읽기 전용 서브커맨드는 로그아웃 상태에서도
  통과 — 로그아웃을 진단하는 명령이 막히면 안 된다). 프롬프트 런은 porcelain 델타와 함께
  `via:"grok_cli"`로 기록된다.
  **Grok이 여기서도 구멍을 찾았다** — 첫 판본은 토큰 전체로만 매치해서 `["-vp","x"]`를 놓쳤는데
  clap은 그걸 `-v -p x`로 읽는다(실측: `grok -vp` → "a value is required for '--single'").
  기록용 `extractPromptRun`(확신할 때만)과 게이트용 `mayRunTurn`(모호하면 게이트)로 분리했다.
- **A3** resume이 caller의 cwd를 무시하고 원 세션 디렉터리에 쓰면서 `filesChanged: []`로 성공
  보고. 세션의 소유 디렉터리를 spawn 전에 찾아 `resumedCwd`와 두 디렉터리 합집합을 보고한다.
  못 찾으면 아무 주장도 하지 않는다. 계약 §12 신설.
- **A4** `worktree remove`가 무조건 `--force`라 미적용 산출물을 복구 불가하게 지웠다. 이제 먼저
  재고, 모르면 dirty로 치고, 위태로운 파일을 이름으로 말하며 거부한다. `force:true`는 명시.
- **A5** `prune`이 진짜 고아(소유 repo 삭제)를 매번 건너뛰고, 대신 baseDir에 우연히 놓인 독립
  repo의 커밋된 이력을 지울 수 있었다. 고아를 분류로 찾고, rmSync는 이 래퍼가 지은 이름에만.
  **Grok이 이 수정의 첫 판본에서 구멍을 찾았다** — `.git`이 디렉터리면 readFileSync가
  EISDIR로 던져서 평범한 체크아웃이 "git이 모르는 디렉터리"와 구별되지 않았고, 이름 정규식은
  `grok-build-plugin`에도 매치했다. PATH에 git이 없으면 진짜 저장소들이 한꺼번에 삭제될 수
  있었다. `.git` 엔트리 종류를 직접 보고, 이름 패턴을 실제 생성 모양으로 좁혔다.

- **A6** 프롬프트에 붙여넣은 시크릿 8형태가 `history.jsonl`에 원문으로 남고 대시보드 호출마다
  Claude에게 되돌아왔다(실측 8/8 통과). URL 자격증명·`DATABASE_URL`류 키·`Basic`·종결 마커 없는
  PEM·Stripe·Google을 덮었다. **실제 이력 3,114개 필드에 돌려 오탐 0건**을 확인했다 — 감사가
  "이 규칙은 실사용으로 검증된 적이 없다"고 지적한 부분의 절반이 닫혔다(잡는 쪽은 여전히 합성
  테스트로만 증명돼 있고, 유일한 `<redacted>`는 감사가 주입한 시험 행이다).

### 문서 — 지금 이 레포에서 일하는 방법을 적었다 (Grok과 합의)

v0.2.20을 만든 절차(배포 번들로 재현 → 실측 페이로드를 fixture로 쓰는 실패 테스트 → 수정 →
같은 페이로드 재측정 → Grok 반증 → preflight → PR → 머지 직후 태그)가 **어디에도 적혀 있지 않았다.**
루트 `CLAUDE.md`에 "작업 수행 방법" 절로 넣었다 — 새 문서도, 세 번째 스킬도 만들지 않는다는 게
Grok의 판단이었고 동의했다. `docs/10`은 절차를 소유하지 않고 가리키기만 한다 (큐는 언젠가 비지만
절차는 남아야 한다 — Grok이 짚은 지점).

5번 조리법도 함께 적었다: **산문 답만 요구하는 Grok 리뷰 프롬프트는 끝나지 않는다** (180~300초
timeout 5연속, 한 번은 1800초에 하네스가 중단). `WRITE your answer to verdict.md and stop` +
`Run NO shell commands` (안 막으면 추론 대상으로 준 인자 배열을 **실행한다**)로 1분 안에 돌아온다.

곁들여: `docs/06`의 "다음 코딩 기본값 = 없음"은 이제 거짓이라 교체, `CONTRIBUTING.md` Docs SSOT에
행 1개 추가, `maintainer-preflight`에 Grok 패스 요구 1줄(조리법은 복사하지 않는다),
`package-lock.json` 0.2.19 → 0.2.20 (테스트 없는 버전 사이트 3곳 중 하나 — Grok이 "머지 전"으로
판정했고 맞다: 태그가 머지 직후라 후속 커밋은 릴리스에 못 들어간다).

`0.2.19` → `0.2.20`. 유닛 484(+64).
## 2026-09-05 (3)

### 세션 핸드오프 — 감사 결과를 레포에 남긴다 (릴리스 아님)

기능 감사는 세션 안에서만 살아 있었다. 남기지 않으면 다음 세션이 같은 53개 항목을 다시 실행해야
한다. **`docs/10-service-audit-queue.md`** 를 신설해 열린 결함 20건·측정 불가 5건·견고한 것·
재현 방법을 담았다 — 이제 그것이 **열린 코드 결함의 SSOT**다(`docs/09`는 범위, `docs/10`은 고장).

감사 하네스도 `.claude/tools/mcpcall.mjs`로 커밋했다(배포 안 되는 유지보수자 표면). 세션의 MCP는
설치 시점 버전에 고정돼 있어 그걸로 채점하면 엉뚱한 산출물을 채점하게 된다 — 이 하네스는
`.mcp.json`이 하는 것과 똑같이 `dist/index.js`를 stdio로 띄운다. 클론 상대 경로로 배선했다.

**`repo-scope` 스킬의 기본 답을 정정했다.** "다음 할 일 = 없음"이 이제 거짓이다 — 큐가 비어
있지 않으면 큐의 맨 위가 답이다. 다만 큐가 있다는 것이 작업 승인은 아니라는 단서를 함께 달았다.

**v0.2.19가 다 고치지 못한 것도 기록했다.** 명시 `signals`의 위험 무력화는 `destructive`·
`production`만 막혔고, `security:false` 하나로 HIGH가 MEDIUM으로 내려간다(실측). 큐 1순위(A1).

## 2026-09-05 (2)

### v0.2.19 — 서비스 감사가 찾은 네 가지 실패

배포 번들(0.2.18)을 stdio로 직접 구동해 **53개 기능 항목을 실행**하고 각 항목을 독립 재실행자가
재측정했다. PASS 29 · DEGRADED 20 · FAIL 4. 이 릴리스는 그 FAIL 4건이다. 핵심 안전 계약(구독
과금 보장·자동 커밋 금지·worktree baseDir 가드·spawn 이전 검증)은 메커니즘 수준에서 전부 통과했다.

**`/grok:plan`이 read-only가 아니었다.** 빈 디렉터리에 plan을 돌리면 파일이 생성되는데 응답은
`filesChanged: []`였다 — 쓰고서 안 썼다고 보고했다. 귀속을 갈랐다: 플러그인은
`--permission-mode plan`을 정확히 넘기고, **grok CLI 1.0.13이 그것을 무시한다**(플러그인 없이
직접 실행해도 동일). `--sandbox read-only`·`strict`·`--always-approve` 생략도 전부 막지
못했다 — 1.0.13에는 쓰기를 막는 플래그가 없다. 막을 수 없으므로 숨기지 않기로 했다(오너 결정):
plan도 before/after porcelain 차집합으로 `filesChanged`를 채우고, 경로 차집합이 놓치는
**이미 더티했던 파일의 추가 편집**까지 `git diff HEAD` 해시로 잡는다(Grok이 설계 리뷰에서
반박해 추가된 부분). `planWroteFiles`는 true/false/**생략**(git 저장소 아님)으로 구분한다.

**라우터의 보안 판정이 영어에만 있었다.** 9개 규칙 중 `security`만 한국어 대체어가 없어
"운영 서버의 인증 토큰…"이 MEDIUM(영어 쌍둥이는 HIGH)이었고, 대량 작업 단어가 섞이면
**LOW/delegate**까지 내려갔다.

**맨 bulk 동사가 파괴적 운영 작업을 통과시켰다.** `migrate the production customer database …
drop the old columns` → LOW/delegate, 게이트 없음. `destructive`·`production` 신호를 추가해
둘 다면 HIGH, 하나만이어도 MEDIUM 바닥으로 고정했고, 명시 `false`로 끌 수 없게 했다.
과차단은 실측 확인 — 정상 작업 6건 등급 불변.

**같은 디렉터리가 대시보드에서 갈렸다.** `cwd` 필터가 정확한 문자열 일치라 실제 1779행 중
**386행(21.7%)이 가려졌다**(SCAManager 377/79/37 → 493). 구분자·후행 슬래시는 접고, 대소문자는
win32에서만 접는다.

상세: `docs/releases/v0.2.19.md`.

## 2026-09-05

### v0.2.18 — 만료 세션은 폐기된다, 그리고 우리는 정반대를 안내했다

이월된 두 항목을 오너에게 묻지 않고 **실측으로** 닫았다.

**GUI 슬래시 커맨드 칸.** 재시작된 세션에서 플러그인이 띄운 MCP 서버의 `grok_build_status`가
`serverVersion: 0.2.17` · `ready: true` · `billing: subscription`. `docs/09` §5에 열린 칸 없음.

**만료 세션 = 폐기.** 만료는 세션의 *부재*가 아니라 auth.json이 **있는데 거부되는** 경우이므로,
격리 `GROK_HOME` + 합성 auth.json으로 재현된다 (`npm run probe:expired`, 실 `~/.grok` 무손상).
1.0.13 · win32 · 3회 연속: 갱신 실패 → `Not signed in.`, 서버 거부 → 401
`Invalid or expired credentials`. **둘 다 exit 1이고 아무것도 기다리지 않는다** — 사람이 만료
순간을 캡처해 줄 필요가 사라졌다. 옛 device-flow 블록 경로는 재현되지 않았다(신호는 유지).

**그래서 나온 결함.** 401 봉투에는 옛 auth 신호가 하나도 매칭되지 않아 `grok_error`로 분류됐고,
xAI 상용구 *"Your session is still signed in … no need to run /login"* 이 **그대로 사용자
안내가 됐다** — 구독 세션이 죽는 바로 그 순간에. Grok이 독립 작성한 테스트로 재현했다.
`AUTH_ERROR_SIGNALS`에 `invalid or expired credentials` 한 줄을 추가해 `auth_error` +
`grok login` 안내로 고쳤다(상태코드가 아니라 자격증명 문구를 매칭 — 광범위 401/403 제외는 유지).
회귀 3건.

**부수 정정.** 액세스 토큰 수명은 "약 7일 추정"이 아니라 **6.00시간** 실측(값이 아니라 시간
차이만 계산). 재로그인을 부르는 것은 `refresh_token` 쪽이고 그 수명은 여전히 미측정.

상세: `docs/releases/v0.2.18.md` · 계약 §7 C.

## 2026-09-04 (2)

### 수락 실행 기록 — v0.2.17 (릴리스 아님)

`docs/09` §5의 수동 수락 2~8단계를 **배포 산출물에 직접** 실행했다. 이 세션의 MCP는 갱신 전
0.2.11 프로세스를 물고 있어 GUI로 클릭했다면 낡은 번들을 수락하게 되므로, `.mcp.json`이 하는
것과 같은 방식으로 `dist/index.js`를 stdio로 띄워 툴을 호출했다.

`serverVersion 0.2.17` · 위임은 `completed` / `billing: subscription` / `filesChanged: [a.txt]`이고
**자동 커밋 없음** · worktree는 격리 확인 → list → diff → apply(커밋 없이 반영) → remove(동반
브랜치 삭제)까지 · 배포 `dist/hook.js`는 정상 인증에서 allow, 세션 부재와 grok 미설치에서 각각
**deny**. `grok_build_usage` 집계도 성공률 100% · 구독 과금 100%로 일관.

같은 날 SCAManager 토큰도 발급처에 직접 물어 **무력함을 실측**했다 — 발급 대상 repo로도 무작위
64자리 토큰과 동일하게 404이고, `install-hook.sh:26`의 `STATUS = 200` 게이트 때문에 토큰을 본문에
싣는 `POST /api/hook/result`까지 막힌다. 설치본은 `claude plugin update`로 0.2.11 → **0.2.17**
(`claude plugin list` = enabled).

남은 사람 몫은 GUI 슬래시 커맨드 확인(세션 재시작 후 `/grok:status` 1회)과 만료 세션 실측뿐이다.

상세: `docs/09-scope-and-residuals.md` §5 실행 기록.

## 2026-09-04

### v0.2.17 — 게이트를 지키던 것이 아무것도 없던 자리

세 번째 스윕이 남긴 새 기능 4건(E1~E4)을 오너 승인 후 전부 구현했다. 넷 다 "기능이 없다"가
아니라 **"검사가 없다"** 였고, 착수 전에 각 항목을 다시 실측하고 Grok으로 반증시킨 뒤 done
정의를 먼저 썼다. **동작은 하나도 바뀌지 않았다** — 범프 이유는 `index.ts`가 쪼개져 번들
바이트가 달라졌기 때문이다.

**E1.** MCP 툴 핸들러를 아무 테스트도 실행하지 않았다. 착수 전 실측: `isError`를 delegate·
plan·verify 세 곳에서 `false`로 고정해도 typecheck 통과 + 352개 전부 녹색이었다. `isError`는
클라이언트가 실패를 아는 유일한 신호다. 원인은 핸들러가 `main()` 안 익명 클로저라 호출 자체가
불가능했던 것. 등록·핸들러를 `src/server.ts`로 옮기고(`hook-entry.ts`/`hook.ts`와 같은 분리)
부작용을 `ServerDeps`로 주입 가능하게 만들어, 테스트가 **인메모리 전송으로 진짜 등록된 tool을**
클라이언트처럼 호출한다. 같은 뮤테이션이 이제 3건 실패한다(E1만으로 352 → 376).

**E2.** 배포되는 `skills/`·`agents/` 프론트매터는 `existsSync`만 받고 있었다(내부 `.claude/`
스킬은 name+description까지 검증). 이유가 핵심이다 — 셋 다 `description: >` 폴드 스칼라라
기존 헬퍼는 값으로 `">"` 를 돌려준다. 길이 검사를 걸었어도 `">"`의 길이를 재고 통과했을 것이다.
폴드 스칼라를 이해하는 파서를 더하고 파서가 실제로 펴는지도 픽스처로 고정했다.

**E3.** 선언된 버전에 태그·릴리스가 있는지 보는 검사가 없었다 — `v0.2.12` 사고 그대로다.
`check-release-tag.mjs` + `release-tag-check.yml`을 추가했다. ⚠️ 일부러 push/PR이 아니라
schedule/dispatch다: 버전 선언 커밋은 태그보다 **먼저** 머지되므로 PR 시점 검사는 모든 릴리스
PR을 오탐한다. 체크아웃은 `fetch-depth: 0`(얕은 클론엔 태그가 없다). 실측 3케이스로 검증:
`0.2.16` 통과 / `0.2.12` **실패**(정확히 역사적 사고) / `9.9.9` 실패.

**E4.** `marketplace.json`을 파싱하는 것이 하나도 없었다. 유효 JSON·`grok-marketplace`·
엔트리 1개·`plugin.json`과 이름 일치·`source: "./"`(버전 키 캐시 규칙이 의존)를 고정했다.

검증: `npm test` **379 passed / 1 skipped**, typecheck, build(번들 재생성). 뮤테이션을 실제로
넣었다 빼며 RED→GREEN 확인(E1·E2·E4), 스크립트 3케이스 실측(E3), Grok 적대적 교차검증 4건
전부 CONFIRMED.

상세: `docs/releases/v0.2.17.md`.

## 2026-09-03

### v0.2.16 — 문서가 코드와 반대로 말하던 곳들

세 번째 스윕은 결함이 아니라 **드리프트**를 찾았다. 7개 렌즈로 전수 스윕 → 후보 33건을
"이미 닫혔다고 가정하고 반증하라"는 검증에 태워 23건 생존 → **코드 동작을 바꾸는 것은 0건**.

가장 나쁜 것은 두 README였다. 위험한 작업의 격리 방법으로 `--worktree` / `--sandbox`
**플래그**를 안내하는데, grok의 `--worktree`는 헤드리스에서 no-op이고 이 래퍼는 그것을
넘기지도 않는다 — 따라 해도 아무 격리가 일어나지 않는 안내였다. 격리는 tool 필드
`worktree: true` / `sandbox: "…"`로만 일어난다. v0.2.13의 auth 우선순위 사고와 같은 유형이다.

`docs/01`·`docs/04`의 spawn 스니펫은 아직 `-p prompt`였고(코드는 v0.2.13부터
`--single=${prompt}`), `docs/04`의 마스킹 서술과 `GrokCliResult`는 v0.2.14를 반영하지
않았으며, `docs/06`의 `[~]` 체크박스는 **삭제된 `check-auth` 커맨드**를 가리키고 있었다.
세션 만료가 "왜 미검증인가"는 문서 세 곳이 서로 다른 이야기를 했다 — 실측이 말하는 진짜
이유(만료 ≠ 부재, 실계정+시간 경과 필요)로 통일했다.

배포되는 실행 표면 한 곳이 바뀌었다: `/grok:cli` 패스스루가 `stdoutTruncated`를 무시하고
잘린 꼬리를 전체로 제시하라고 지시하고 있었다(컷 4,000자, `inspect --json`은 ~81 KB 실측).

새로 실측한 것은 **resume × sandbox**다(계약 §11 신설). 세션의 sandbox 프로필은 수명 동안
고정이며 다른 프로필로 재개하면 grok이 exit 1로 거부한다. 래퍼는 `grok_error`로 보고하되
grok의 안내가 `rawStderrTail`에 그대로 실려 호출자가 조치를 알 수 있다 — 그래서 코드 가드는
넣지 않았다. 소스 주석 세 곳의 "measured on 1.0.5" 스탬프는 귀속을 추측하는 대신 1.0.13에서
**다시 쟀고**, 세 주장 모두 그대로였다.

그리고 `v0.2.13.md`가 가리키던 "세션 보고서"는 레포에 없는 파일이었다. 실제 원천인 감사
리포트 아티팩트에서 **반증 4건**을 복구해 릴리스 노트에 표로 옮겼다 — 이제 레포만 읽고도
자립한다. `CLAUDE.md`가 이월하던 "사람이 해야 할 2건" 중 Dependabot은 이미 닫혀 있었고
(open 0건 / 21건 전부 fixed), SCAManager 토큰 서술은 `CHANGELOG`(PR #53)의 revoke 기록과
충돌해 사실 관계와 귀속을 정정했다.

`v0.2.15`는 태그·릴리스가 이미 나갔고 이번에 실행 표면과 번들이 바뀌므로 0.2.16으로
범프했다 — 캐시는 버전 키다.

상세: `docs/releases/v0.2.16.md`.

### v0.2.15 — 취약점 6건, 그중 4건은 실제로 배포되고 있었다

Dependabot 경보 6건. 흥미로운 건 숫자가 아니라 **어느 것이 실제로 사용자에게 도달했느냐**였다.

`CLAUDE.md`는 이미 답하는 법을 적어두고 있었다 — 이름으로 판단하지 말고
`grep -c "node_modules/<pkg>/" dist/index.js`로 재라. 재보니 `fast-uri`는 **6곳 인라인**,
`qs`와 `express`는 **0**이었다. 즉 high 4건은 설치한 사용자가 실행하는 코드 안에 있었고,
medium 2건은 이 stdio 서버가 로드하지 않는 SDK의 HTTP 전송 계층에 속했다. 같은 "경보 6건"이
전혀 다른 두 가지였던 셈이다.

`npm audit fix`로 lockfile만 바뀌었고(8/8행) `package.json`도 SDK 버전도 그대로다. SDK를
굳이 대조한 이유는 이 저장소가 이미 한 번 데였기 때문이다 — 2026-08-23에 `npm i --no-save`가
런타임 의존성을 조용히 올려 소스와 어긋난 번들을 커밋할 뻔했다.

재빌드로 `dist/index.js`가 409/126행 바뀌었고, 54개 hunk 중 **53개가 `fast-uri` 영역**·1개가
버전 문자열임을 확인했다. 플러그인 로직은 한 줄도 바뀌지 않았다. 그리고 lockfile이 아니라
**배포물** 기준으로 증명했다 — 3.1.7에만 있는 문자열이 새 번들에 있고 이전 번들에 없다. `v0.2.14`는 이미 태그·릴리스가 나갔고 번들이
바뀌었으므로 0.2.15로 범프했다 — 캐시는 버전 키다.

상세: `docs/releases/v0.2.15.md`.

### v0.2.14 — 아무도 열지 않았던 곳

1차 감사가 "이 영역은 아무도 보지 않았다"고 남긴 목록을 같은 방식으로 다시 감사했다. **결과는
얇았고 그게 정직한 결과다** — 10건이 교차검증에 들어가 2건만 양쪽 렌즈를 통과했다. 심각한
결함을 막 고친 저장소는 이런 모양이어야 한다.

그런데 그 2건 중 하나가 뼈아팠다. **문서가 약속한 것과 코드가 한 것이 달랐다.** 절대 원칙 #4는
"credential을 로깅하지 않는다", 설계 스펙은 "No credentials, ever."라고 적혀 있었는데 실제로는
xAI 빌링 키 두 개만 가리고 있었다. 프롬프트에 붙여넣은 Bearer JWT·AWS 시크릿·GitHub PAT·
`password:` 줄은 `history.jsonl`에 원문 그대로 들어갔고, `grok_build_usage`가 그것을 이후
세션의 Claude에게 되돌려줬다. 측정으로 확인했다.

마스킹을 흔한 형태 전반으로 넓혔지만, 더 중요한 것은 **문장을 사실에 맞춘 것**이다. 원칙 #4는
이제 "서버가 쥔 자격증명"으로 범위를 밝히고, 프롬프트 미리보기는 이 원칙이 덮지 않으며
마스킹은 완화이지 보장이 아니라고 말한다. 절대적으로 적힌 문장이 실제보다 넓으면, 그 문장을
믿는 사람이 손해를 본다.

그리고 **어떤 사용자 문서도 그 로그의 존재를 말하지 않고 있었다.** README 두 개와
`/grok:usage`가 이제 무엇이 기록되고 어디로 되돌아오며 어떻게 지우는지 말한다.

다른 하나는 게이트였다. `tool-surface` 테스트는 툴 이름이 번들 어딘가에 문자열로 있으면
통과했는데, `routing.ts`가 라우팅 조언으로 그 이름들을 품고 있다. 그래서 **hook이 게이트하는
바로 그 세 툴**이 게이트가 보호하지 못하는 세 툴이었다 — 등록 블록을 통째로 지우고 재빌드해도
스위트가 green이었다. 이제 `registerTool()` 호출 인자를 정확한 집합으로 검사한다.

반증된 것도 남겼다. CI 부동 태그, 히스토리 전체 읽기 비용(총 대기의 3.6%), "4개 릴리스가 태그
없이 나갔다"(`ls-remote | tail -1`이 문자열 정렬이었다) — 측정 앞에서 무너진 주장들이다.

상세: `docs/releases/v0.2.14.md`.

### v0.2.13 — 감사: 재현되지 않은 것은 고치지 않았다

전체 코드·문서 감사를 돌렸다. 규칙은 하나였다 — **명령으로 재현되지 않으면 결함이 아니다.**
8개 영역이 31건을 올렸고, 각 항목을 두 개의 독립 렌즈(실제로 재현해보기 / 결함이 아님을
논증해보기)에 통과시켰다. 8건이 살아남았고, 그중 중대한 것은 Grok이 처음부터 다시 재현했다.
반증 렌즈가 죽인 4건도 기록에 남겼다 — "봤다"와 "없었다"의 차이가 거기서 갈린다.

가장 뼈아픈 세 건은 전부 `worktree.ts`에 있었고, **사용자의 작업을 없앴다.**

`prune`은 상태를 확인할 수 없는 트리를 지웠다. 코드에는 "clean이라고 추측하느니 모른다고
두자"는 주석과 함께 `dirty`를 `undefined`로 남기는 catch가 있었는데, 정작 그 값을 읽는 두 곳이
`if (c.dirty)`였다. **주석이 지키려던 상태가, falsy라는 이유로 "지워도 됨"이 되어 있었다.**
게다가 프로브를 실패시키는 조건과 강제 삭제 경로로 보내는 조건이 같아 둘은 항상 함께 왔다.

`apply`는 UTF-8이 아닌 텍스트 파일을 조용히 망가뜨렸다. 패치가 문자열을 거쳐 왕복하는데
양끝이 `utf8`이었고, `--binary`는 git이 binary로 *분류한* 파일만 보호한다. CP949·EUC-KR로
쓰인 파일이 `ok:true`와 함께 손상된 채 워킹트리에 들어갔다. 한국어 환경에서 개발하는
저장소가 이 결함을 갖고 있었다는 것이 이번 감사에서 가장 아팠다.

`apply`에는 경로 봉쇄가 없었다. `remove`·`prune`은 막는데 `apply`만 빠져 있었고, 파괴적인
스테이징이 중단 게이트보다 **먼저** 돌았다. 일반 저장소를 가리키면 아무것도 적용하지 못한
채로 그 저장소의 staged index만 날렸다.

나머지는 조용한 오보고였다. 하위 디렉토리에서의 apply가 루트 파일을 누락하고도 적용했다고
말했고, untracked 디렉토리 안의 파일은 `filesChanged`에서 통째로 사라졌으며(그래서 두 번째
위임부터는 "변경 없음"이 나왔다), `diffStat`은 grok이 가장 많이 만드는 것 — 새 파일 — 에
눈이 멀어 있었다. `-`로 시작하는 프롬프트는 모델에 닿지도 못했는데 래퍼는 "grok 출력을 해석할
수 없다"고 보고했다. 없는 출력을 탓하고 있었던 셈이다.

문서 쪽에서는 **부작용을 숨기던 커맨드 두 개**가 나왔다. `/grok:trace`는 기본이 원격
업로드인데 문서에 그 말이 없었고 — 세션을 외부로 보내는 유일한 커맨드가 그 사실을 안 적은
유일한 문서였다 — `/grok:update`는 기본이 설치인데 "확인 또는 설치"라고만 적혀 있었다.
그리고 지난 세션에 고쳤다고 여긴 auth 우선순위 정정이 **README 두 개에는 반영되지 않았다**.
사용자가 실제로 읽는 표면만 옛 문장을 갖고 있었다.

`v0.2.12`는 태그도 릴리스도 만들어지지 않은 채 main에 선언돼 있었다. 마켓플레이스 소스가
`./`라 그 사이 설치자는 옛 번들을 0.2.12로 캐시한다 — 같은 번호로 다른 번들을 내보내지 말라는
자신의 규칙에 걸려 0.2.13으로 범프했다.

감사 범위 밖에서 하나 더 나왔다. 어느 영역에도 속하지 않아 아무도 열지 않은
`.scamanager/install-hook.sh`가 diff를 외부로 보내고 bearer 토큰을 본문에 담아 제3자 서버로
POST하고 있었다. 이 플러그인이 호출하지도, config 없이는 동작하지도 않지만 공개 저장소에
추적된 채였다. 추적에서 뺐다(파일은 로컬에 남는다). 편집기 설정 디렉토리도 함께 무시 목록에
넣었다 — `git add -A` 한 번이면 배포 플러그인에 들어간다.

상세: `docs/releases/v0.2.13.md`.

## 2026-09-02

### v0.2.12 — 계약을 다시 재고 나서야 보인 것들

시작은 단순한 질문이었다: "지금 grok 최신 버전과 우리가 서비스하는 버전이 같은가?" 답은
**세 갈래로 아니오**였다 — 계약 문서 1.0.3, 설치본 1.0.5, upstream stable 1.0.13.

그런데 정작 중요한 건 버전 격차가 아니었다. 1.0.13에서 재실측한 **핵심 계약은 변화가 없었다**
(exit 0 · 단일 JSON 봉투 · `stopReason: end_turn` · `--always-approve` 헤드리스 편집 · 자동 커밋
없음 · porcelain). 대신 버전과 **무관하게 처음부터 있던** 결함 셋이 드러났다. 계약을 다시 재는
행위 자체가 감사였던 셈이다.

- **`GROK_HOME` 사용자는 잠겨 있었다.** grok은 `GROK_HOME`으로 설정 홈을 통째로 옮기고
  폴백이 없는데, 플러그인은 `~/.grok/auth.json`을 하드코딩했다. hook이 막고, 안내대로
  `grok login`을 해도 토큰은 플러그인이 보지 않는 경로에 쓰였다 — 나갈 문이 없었다.
  배포 번들 대조로 확인: 같은 입력에 v0.2.11은 deny, v0.2.12는 allow.
- **`/grok:cli` 차단이 fail-open이었다.** 주석은 "차단 쪽으로 기운다"고 적혀 있었지만
  첫 positional에서 멈추는 파서라 값-플래그 뒤에 숨긴 `dashboard`가 그대로 통과했다.
  플래그 8개를 채우는 건 곁가지고, 진짜 수정은 **목록에 의존하지 않게 만든 것**이다.
  세션 도중 CLI가 1.0.5 → 1.0.13으로 스스로 업데이트되는 걸 목격한 뒤라 더 분명해졌다:
  스냅샷은 반드시 낡는다.
- **확인 프롬프트가 호출을 멈췄다.** `memory clear`가 60초를 다 쓰고 아무것도 안 지웠다.
  stdin만 `ignore`로 바꾸니 25초 강제 종료가 428ms `Cancelled.`가 됐다. 헤드리스 전용
  래퍼가 stdin을 열어둘 이유가 없었다.

부수적으로, "실 홈 손상 없음"이라던 `probe:unauth`가 개발자에게 `GROK_HOME`이 있으면 격리를
잃고 **실제 세션으로 과금**하고 있었다. 그 원인은 `env.ts` 주석에 박혀 있던 잘못된 전제
("grok이 HOME을 필요로 한다")였다 — 틀린 주석은 언젠가 틀린 코드가 된다.

계약 문서는 헤더 버전 하나로 전체를 대표시키던 방식을 버리고 **절별 유효 버전 표**로 바꿨다.
1.0.3 헤더가 1.0.5·1.0.13까지 검증된 것처럼 읽혔던 것이 이번 사태의 절반이다.

`docs/09` §C에 보류돼 있던 `~/.grok-build` 퍼미션 3줄은 문서가 정한 트리거
("진짜 이유가 있는 변경에 동승")를 충족해 함께 태웠다.

상세: `docs/releases/v0.2.12.md`.

## 2026-08-24

### Docs — README 가독성 재구성 + 코드와 어긋난 문장 교정

두 단계로 손봤다. **1단계는 서식만** — 문장은 그대로 두고, 영문 기준 과금 안전 문단 683자,
유틸 동사 문단 608자처럼 서로 다른 사실 4~5개가 한 소스 줄에 뭉쳐 있던 벽을 리드 문단 + 불릿으로
쪼갰고, 소스는 저장소의 나머지 문서와 같은 100자 하드랩으로 맞췄다. 문서 목록의 `0.`~`9.` 번호는
파일 이름의 `00`~`09`와 어긋나 보여 불릿으로 바꿨다. 이 단계는 렌더러(markdown-it)로 HEAD와
대조해 렌더된 텍스트 · 링크(EN 28 · KO 29) · 표 22행 · 제목 9/3개가 그대로임을 확인했다.

**2단계에서 내용을 고쳤다** — 코드와 어긋나 있던 문장 7건을 grok 1.0.5 실측과 소스 대조로
잡았다. 이때 KO의 중복 링크 1개가 빠져 지금은 EN·KO 모두 28개다.

- **"최대 8 subagent 병렬"은 근거가 없었다.** `grok --help`에 그 수치가 없다. 있는 것은
  `--agents`(subagent 정의)와 `--no-subagents`("Disable subagent spawning" — 즉 기본 켜짐)뿐이고,
  `--worktree`는 "Headless (`-p`) does not create a worktree from this flag"라 격리는 grok이
  아니라 이 플러그인이 `git worktree add`로 한다. 두 사실을 분리해 다시 썼고 `docs/05`의 같은
  문구도 고쳤다.
- **`/grok:worktree` 표에 `prune`이 빠져 있었다** — v0.2.11에서 추가된 다섯 번째 액션이다.
- **"인증 hook이 막는다"는 절반만 맞았다.** env 미설정(기본)이면 `resolveHookMode`가 `unknown`
  이라 hook은 통과시키고 서버 `checkAuth`가 막는다. hook과 서버가 이중으로 막되 기본값에서는
  서버가 막는다고 고쳤다.
- 폴더 트리에 `examples/`가 없는데 본문은 그 디렉토리로 링크하고 있었다 —
  `CHANGELOG.md`·`CONTRIBUTING.md`·`docs/plans`·`docs/releases`·`.github/workflows`와 함께 넣었다.
- KO에서 hook이 "9개 tool"의 열 번째처럼 읽히던 문장을 별도 문장으로 떼어냈다.
- EN보다 절이 빠져 있던 KO 불릿 4개, `billingMismatch` 지침 불일치(EN "watch for" vs KO "중단"),
  중복 링크 1개를 정리했다. 지침은 `status.ts`의 nextSteps("과금 경로를 먼저 정리한 뒤 위임을
  재개")에 맞췄다.
- 두 파일에 2릴리스 낡은 `(v0.2.9)`가 박혀 있었다 — `docs/09` §1이 금지한 하드코딩이라 지웠다.

**한글 문서의 굵게 표시 함정도 실측으로 잡혔다.** 닫는 `**` 앞이 문장부호(백틱·`)`)이고 뒤가
한글이면 CommonMark right-flanking 조건에 걸려 emphasis가 **닫히지 않는다** — GitHub 화면에
`**`가 그대로 보인다. `README.ko.md`, `docs/05`, `docs/04`, `CLAUDE.md`가 그 상태였고, 조사를
붙이는 대신 문장부호를 굵게 밖으로 빼는 방식으로 고쳤다. 세는 방법도 함께 남긴다 — 코드 스팬
안의 `**`(예: 글롭 패턴)는 정상이므로 렌더된 HTML에서 `<code>`/`<pre>`를 걷어낸 뒤 세야 한다.
그러지 않으면 13개 파일 141곳처럼 크게 부풀려진다 — 실제로는 4개 파일에 8곳이었다.

**3단계에서 가시성을 다시 잡았다** (PR #66). 서식만으로는 부족했다 — 절 제목이 그 절이 담은
내용을 말하지 않았고, 이 플러그인의 본질인 "무엇을 위임할지"를 README가 한 번도 답하지 않았다.

- GFM 알림 3개(`[!IMPORTANT]` cmd.exe/WSL · `[!CAUTION]` 키 우선순위 · `[!WARNING]`
  `--always-approve`의 실제 승인 범위)로, 스킴을 견뎌야 하는 사실을 색 있는 레일로 올렸다.
  한글 파일도 마커는 영문이어야 GitHub이 렌더한다.
- 커맨드 15행 벽을 "매일 쓰는 흐름"과 "설치·프리셋·패스스루" 두 표로 나누고, 산문에 묻혀
  있던 유틸 12개를 접이식 표로 올려 배포되는 **27개 전부**가 보이게 했다.
- 절 두 개를 새로 넣었다: "언제 위임하고, 언제 하지 않나"(`docs/05`와 `grok-routing` 스킬에서
  그대로 옮김), "문제 해결"(흩어져 있던 실패 경로 4가지를 증상·의미·조치 표로).
- 정적 `tests-passing` 배지를 실제 CI 배지로 바꿨다 — 모든 테스트가 깨져도 초록으로 남는
  이미지였다. 아무것도 주장하지 않던 status 배지는 뺐다.
- 근거 없는 비교("Claude 단독보다 빠르게")를 지우고, 유지보수자용 문장을 사용자 관점으로
  바꿨으며, 번역투로 남아 있던 한글(`종량제 샌드`, `tool이 행 대신`)을 고쳤다.

Grok 리뷰가 커밋 전에 두 가지를 막았다. 라우팅 표가 `routing.ts` `HIGH_KEYS`의 `regulated`를
빠뜨린 채 "`/grok:route`가 이 기준을 적용한다"고 쓴 것 — 그대로 나갔으면 README를 따르는
독자가 규제 도메인 작업을 Grok에 넘겨도 된다고 읽을 수 있었다. 그리고 접힌 12개의 제목이
`/grok:login`·`/grok:import`까지 "빌링 안전 env로 실행"이라고 주장한 것 — 둘은 grok을 아예
띄우지 않는다.
핸드오프: `CLAUDE.md`의 "다음 할 일 — 배포 마무리 확인"은 이 세션에서 닫혔다. MCP 서버 재시작
후 `/grok:status`의 `serverVersion`이 **0.2.11**이고 `claude plugin list`가 여전히 **enabled**임을
확인했다.

> Grok 협업 기록: 문구 확정은 `grok --help` · `grok inspect` 실측, 편집 실행은
> `grok_build_delegate`(17블록 일괄 + 후속 2건), 검증은 `grok_build_verify`를 내용 보존 ·
> 렌더 HTML · 코드 대조로 나눠 돌렸다. 전부 subscription 과금, 자동 커밋 없음.

## 2026-08-23 (3)

### Fix — v0.2.10의 회귀와 미완성 절반 (v0.2.11)

v0.2.9/v0.2.10 재감사(6차원 병렬 + 적대적 검증 + Grok 교차검증). **v0.2.9는 모든 공격을 견뎠고**,
같은 14개 SonarSource 룰을 감사 이전 트리에 돌린 대조에서 +271줄이 추가한 룰 위반은 **0건**,
라인 커버리지는 75.62% → 78.09%, 브랜치는 80% 게이트를 넘겼다. 문제는 v0.2.10에 있었다.

- **회귀: 30초 git 예산이 `git worktree add`에도 걸렸다.** v0.2.10 이전에는 무제한이었다.
  실측 — 2만 파일 레포가 **87%(17,400개) 지점에서 SIGTERM으로 죽었고**, 6천 파일 레포는 이미
  예산의 31~61%를 썼다. 죽을 때마다 부분 체크아웃 디렉토리 + `.git/worktrees/<name>` 등록 +
  `grok/<name>` 브랜치가 남아, **누수를 막으려던 릴리스가 새 누수를 만들었다.**
  체크아웃급 작업에 별도 예산 `GIT_BULK_TIMEOUT_MS`(10분)를 주고, 실패한 add의 잔여물 3종을
  정리한 뒤 rethrow하며, delegate 오류 메시지가 실제 원인을 담는다.
- **미완: `prune`이 호출한 레포 소유 트리만 지울 수 있었다.** base dir는 전역인데
  `git worktree remove`는 레포별이다. 실측 — 수십 개가 여러 레포에 흩어져 있고 대다수가
  호출자가 아닌 한 프로젝트 소유라, 어느 프로젝트에서 돌려도 거의 아무것도 회수 못 하고
  나머지는 실패로 보고됐다 (정확한 개수는 작업에 따라 계속 변한다 — 요점은 분산이다). 이제 각 트리의
  `.git` 파일(`gitdir: <repo>/.git/worktrees/<name>`)에서 등록한 레포를 읽어 그쪽에서 제거하고,
  git이 모르는 고아는 경로가 base dir 안임을 재확인한 뒤 디렉토리째 삭제(`removedOrphan`),
  소유 레포가 있으면 등록도 정리한다.
- **안전 구멍: prune의 나이가 디렉토리 mtime이었다.** 중첩 파일을 고쳐도 부모 mtime은 바뀌지
  않는다(두 번 독립 실측). 즉 "오래됨"은 "생성된 지 오래"였지 "안 쓴 지 오래"가 아니었고,
  `apply`가 적용하지 않은 grok 작업을 브랜치째 날릴 수 있었다. 필드명을 `createdDaysAgo`로
  바꿔 측정 대상을 명시하고, **미커밋 변경이 있는 트리는 apply해도 절대 삭제하지 않는다**
  (`skippedDirty`로 보고).

재감사가 깨끗하다고 확인한 것: prune의 base dir 탈출 불가(정션·`..`·절대경로·TOCTOU 전부 시도
후 거부), `grok/<name>` 브랜치 인자가 git 플래그로 읽힐 수 없음, `appendBounded`가 실제로 OOM을
막음(256MB 힙에 2GB 투입, 힙 5.3MB 유지), `--name-only -z` 전환이 옛 `+++ b/` 스크레이핑보다
엄격히 우수(옛 방식은 바이너리·모드·삭제·리네임에서 조용히 비어 있었다).

SonarSource 룰 4건(복잡도 2, collapsible if, 중첩 삼항)은 전부 감사 이전부터 있던 것이고
커버리지 80% 미달과 함께 범위 밖으로 유지. `npm test` 259 → 275.

상세: `docs/releases/v0.2.11.md`.

## 2026-08-23 (2)

### Fix — 자원 누수 수리 (v0.2.10)

누수 감사(6차원 병렬 + 적대적 검증 + Grok 교차검증, 실행 중인 grok 1.0.5 대조).
**과금 안전 원칙은 온전함이 실측 확인됐다** — 모든 자격증명 후보에 센티널을 심고 전 출구를
grep 한 결과, 구독 모드에서 `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 5가지 표기가 모두 제거되고
`history.jsonl`·자식 프로세스·모델 응답 어디에도 자격증명이 남지 않았다.

문제는 **뒷정리를 아무도 하지 않는다**는 것이었다. 격리 worktree마다 `grok/<name>` 브랜치가
영구히 쌓이고, 디렉터리는 지워지지 않아 실측 **37개 / 약 398 MiB**가 누적돼 있었다(과거 18개를
수동 아카이브한 흔적도 있었다).

- **worktree 브랜치 정리.** `remove`가 동반 브랜치를 `git branch -d`로 지운다. `-D`가 아니므로
  머지되지 않은 커밋이 있으면 git이 거절하고 `branchDeleted: false`로 보고만 한다 — grok이
  실제로 커밋한 작업을 조용히 파괴하지 않는다.
- **`prune` 액션 신설.** `~/.grok-build/worktrees` 아래 `max_age_days`(기본 7)보다 오래된 트리를
  찾는다. **기본 dry run**, `apply: true`일 때만 실제 삭제 — 아직 적용하지 않은 변경이 남아
  있을 수 있기 때문. 하나가 실패해도 나머지는 계속한다.
- **모든 git 호출에 상한.** `defaultRunGit`에는 타임아웃도 maxBuffer도 없었는데 형제인
  `defaultCaptureGit`에는 둘 다 있었다. git은 무한 대기할 수 있고(stdin 대기 plumbing,
  credential helper, lock 경합), `createGrokWorktree`/`applyGrokWorktree`는 grok spawn 타이머
  **밖·이전**에 돌기 때문에 멈춘 git이 `runDelegate`의 `timeout_ms`를 무력화했다. 두 러너를
  하나의 `runGitBounded`로 통합.
- **subprocess 출력 상한.** `defaultSpawn`이 stdout/stderr를 무한 누적해, 폭주하는 실행
  (`grok export` 대용량, `grok_cli --debug`)이 힙을 키우다 `data` 핸들러 안에서 V8이 던지면
  MCP 서버째 죽었다. stdout은 앞부분 16MB 유지(작은 정상 JSON은 항상 온전), stderr는 뒷부분
  1MB 유지(tail만 쓰이므로).
- **이력 파일 권한.** `~/.grok-build/`와 `history.jsonl`을 `0700`/`0600`으로 생성. 200자 프롬프트
  프리뷰와 절대 cwd 경로가 담기는데 기본값은 공유 POSIX 호스트에서 누구나 읽을 수 있었고,
  같은 릴리스에서 patch 파일은 이미 0600이었다. (`mode`는 생성 시점에만 적용 — 기존 파일은 유지.)
- **과금 오진단 정정.** `status.ts`·`usage.ts`·`orchestrator.ts`가 `metered_api` 태그와
  `billingMismatch`를 "키가 샜다"로 설명했다. 불가능하다 — 태그는 `billingFor(mode)`라
  `GROK_BUILD_AUTH_MODE=api`일 때만 나오고, 구독 모드는 키 env를 spawn 전에 제거한다. 이
  문자열들은 `grok_build_status`를 통해 Claude에게 전달되므로 잘못된 진단이 실제로 실행됐다.
  v0.2.9가 문서에서 고친 것을 코드에서 마무리.

MCP tool 수는 9개 그대로(`grok_build_worktree`에 `prune` 액션 추가). 스위트에 19건 추가
(수치는 `npm test`가 SSOT).

상세: `docs/releases/v0.2.10.md`.

## 2026-08-23

### Fix — SonarCloud 오버롤 기준 보안·정확성 수리 (v0.2.9)

Claude 다중 에이전트 감사 + Grok 독립 검증. 6건 모두 **고치기 전에 재현**했고 테스트 우선으로 반영.

- **이력 마스킹 우회 (`history.ts`).** v0.2.8 마스킹은 맨 `KEY=value`만 잡았다. 따옴표 키를
  허용해 JSON/`.mcp.json`·`.env`·YAML 형태를 덮고, 변수명 없이 붙여넣은 `xai-…` 토큰도
  별도 패턴으로 마스킹. 실측: 현실적 8개 형태 중 5개 유출 → 0개. `xai-cli` 같은 산문은 유지.
- **`worktree apply`의 `filesChanged` (`worktree.ts`).** 패치 본문의 `+++ b/` 스크레이핑을
  `git diff --cached --name-only -z`(+`core.quotepath=false`)로 교체. 한 번에 4건 해결 —
  삭제·100% 리네임 전면 누락, 비ASCII 경로 C-쿼팅 누락, 공백 파일명 뒤 TAB 잔류,
  `++ b/`로 시작하는 **파일 내용**이 존재하지 않는 파일로 보고되던 오탐.
- **patch 임시파일 (`worktree.ts`).** `mkdtempSync`(예측 불가·`0700`·원자적) 디렉터리에
  mode `0600`으로 쓰고 디렉터리째 제거. 기존엔 시계 기반 예측 가능 이름을 공유 temp 루트에
  기본 `w` 플래그로 기록 — 공유 POSIX 호스트에서 소스 diff 노출 + 심볼릭 링크 선점 쓰기.
  Sonar `S5443`/`S2612`.
- **PATH 키 대소문자 (`env.ts`).** `prependGrokBin`이 PATH 키를 대소문자 무시로 찾는다.
  Windows는 `Path`라서 대문자 `PATH`를 새로 만들면 케이스만 다른 두 키가 남고, 자식
  프로세스는 하나만 유지 → grok이 자기 bin 디렉터리만 PATH로 상속받을 수 있었다.
  `buildGrokEnv`가 이미 쓰던 대소문자 무시 처리와 일치시킴.
- **`--model` 통과 (`delegate.ts`).** 은퇴 별칭 검사를 `in` → `Object.hasOwn`. `in`은
  프로토타입 체인을 타서 `toString`/`constructor`/`valueOf`/`hasOwnProperty`/`isPrototypeOf`
  라는 모델명이 은퇴 취급돼 `--model`이 조용히 빠졌다. `grok-build`는 의도대로 계속 생략.
- **`grok_cli` cwd (`grok-cli.ts`).** 상대 경로 cwd를 spawn 전에 거절 — `runDelegate`가 이미
  쓰던 가드. 기존엔 MCP 서버 자신의 디렉터리로 해석돼 "설치/PATH 확인" 오안내로 표면화.

인증·구독 env 제거·`--always-approve`·자동 커밋 없음은 불변. MCP 9 tools 동일.
스위트에 12건 추가 (수치는 `npm test`가 SSOT — 고정 숫자는 드리프트한다). 실제 git worktree 통합 테스트 포함.

**범위 밖으로 남긴 것 (사용자 결정):** 인지복잡도 2건(`validateDelegateOptions` 18,
`parseWorktreePorcelain` 17 — SonarSource 룰 엔진 실측), `orchestrator.ts` 중첩 삼항,
`delegate.ts` 불필요 타입 단언, `parsePorcelain` 중복, `version.ts` `??` 인코딩 깨짐,
커버리지 75.62%(게이트 80%), SonarCloud 배선 부재.

상세: `docs/releases/v0.2.9.md`.


## 2026-08-15

### Fix — 분류기 오탐 + 이력/env 보안 위생 (v0.2.8)

- **원인:** 성공/`plan` JSON의 `text`에 `grok login`이 있으면 `looksLikeAuthFailure`가
  `auth_error`로 뒤집었다. 타임아웃 경로는 stdout을 이미 안 보는데 성공 경로는 봤다.
- parse-fail `auth_error`가 `filesChanged`를 빼먹던 불일치 수정.
- 이력 preview의 `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 대입 마스킹.
- 구독 모드 env 키 제거를 대소문자 무시(Windows).
- 살아 있는 문서 SSOT (`docs/03`·`06`·계약서 §3–4·CLAUDE Windows hook).

상세: `docs/releases/v0.2.8.md`.

## 2026-08-14

### Docs — README를 v0.2.7 배포 표면에 맞춤

- 본문의 고정 테스트 수(197) 삭제 — `npm test`가 SSOT (배지는 이미 `passing`).
- `import`를 되는 유틸로 적지 않음 — CLI 1.0에 서브커맨드 없음, `blocked`.
- 한글 README의 설치 후 검증·문서 목록·폴더 트리를 영문/배포 first-mile과 정렬.

### Fix — Grok Build CLI 1.0.3 / Grok 4.6 헤드리스 계약 (v0.2.7)

- **원인:** 플러그인은 0.2.93 실측(`EndTurn`, `--check`, `--best-of-n`)에 고정돼 있었다.
  1.0.3은 `stopReason: "end_turn"`, `--check`/`--best-of-n` 삭제, 기본 모델 `grok-4.6`.
- **효과:** 기본 위임이 파일을 쓰고도 `grok_error`로 집계됐고, verify는 스폰 전에 죽었다.
- 수리: `isSuccessfulStopReason`, verify 프롬프트 접미사, `best_of_n` 거절, `grok-build`
  alias, `import` 차단, Windows `HOME` 폴백. 계약 SSOT를 1.0.3으로 재실측.
- 설계: `docs/specs/2026-08-14-grok-1.0-compat-design.md`.

상세: `docs/releases/v0.2.7.md`.

## 2026-08-09

### Ops — GitHub 표면 정리 + 머지 게이트 강화 (제품 변경 없음)

- **정리:** 원격에서 이미 삭제된 로컬 브랜치 25개 제거, 빈 `Microsoft/` 디렉토리 제거,
  Actions 캐시 14개 삭제. Open PR·Issue는 원래 0이었다.
- **머지 게이트:** `PRIMARY` ruleset에 `required_status_checks`(`mcp-server (ubuntu-latest)`·
  `(windows-latest)`)를 추가했다. 기존 ruleset을 **확장**했고 별도 branch protection을 겹쳐
  만들지 않았다 — 규칙이 두 곳으로 갈라지면 어느 쪽이 이기는지 아무도 모르게 된다.
  `bypass_actors`는 비어 있어 소유자도 red CI를 통과 못 한다 (CI 40초, 감당 가능한 대가).
- **병합 방식:** merge commit·rebase를 저장소·ruleset 양쪽에서 끄고 squash만 남겼다.
  이력이 이미 전부 squash였으므로 실질은 "관행을 강제로 승격"이다.
- 반영: `CONTRIBUTING.md` "Branch & PR", `.claude/skills/maintainer-preflight` "Never".

### Ops — `npm ci` 조건 정정 (실측 사고)

- **낡은 `node_modules`는 없는 것보다 나쁘다.** 이 레포에서 `npm ci` 없이 `npm run build`를
  돌린 결과, `node_modules`의 `fast-uri` 3.1.4(lockfile은 3.1.5)가 인라인되면서 **v0.2.6이
  담은 보안 패치(GHSA-7p8r-x3mc-p8w7)가 번들에서 제거됐다.** 빌드는 성공하고 경고도 없다.
  `maintainer-preflight`의 "`npm ci`는 node_modules가 없을 때만"을 "없거나 낡았을 때"로 고치고
  버전 확인 한 줄을 추가.
- **Windows에서 `git status`는 `dist/`에 대해 거짓말한다.** `core.autocrlf=true`가 체크아웃을
  CRLF로 바꾸는데 esbuild는 LF로 쓰므로, 아무것도 안 바뀐 재빌드도 `M dist/index.js`로 뜬다.
  판단 근거는 `git diff`다 (빈 출력 = 커밋된 번들이 그대로 재현됨). CI의 dist 검사가 Linux
  전용인 이유와 같은 현상.

### Security — 추적되던 서드파티 자격증명 제거 (PR #53)

- 코드리뷰 도구(SCAManager)가 심어둔 `.scamanager/config.json`이 **평문 토큰을 담은 채 공개
  저장소에 커밋**돼 있었다. 추적 해제 + `.gitignore` 등록. 훅은 파일이 없으면 `exit 0`이라
  (`.scamanager/install-hook.sh`) 기능 손실 없이 노출만 멈춘다.
- **추적 해제는 무효화가 아니다.** 토큰은 히스토리·`refs/pull/*`·릴리스 tarball에 그대로
  남고, 공개 기간의 클론은 회수할 수 없다. 실제 조치는 **발급처에서의 revoke**였고 그것으로
  모든 사본이 무력해졌다. 히스토리 재작성은 기각 — 이미 공개된 값을 되돌리지 못하면서 커밋
  SHA·태그·릴리스·PR 링크만 전부 깨뜨린다.
- **근본 원인은 이 레포 밖이다.** 해당 도구가 토큰을 git에 커밋하는 구조 자체가 원인이며,
  수정은 그 도구의 저장소가 소유한다. 이 레포에서는 재발 방지선(`.gitignore` 한 줄)만 둔다.

## 2026-08-08

### Security — 번들에 인라인된 `fast-uri` 패치 (v0.2.6)

- **문제:** 이용자가 실행하는 `dist/index.js`에 `fast-uri` 3.1.4가 인라인돼 있었다 (GHSA-7p8r-x3mc-p8w7, high — 백슬래시 authority introducer를 통한 host confusion). `ajv`(MCP SDK 경유) → `fast-uri` 체인. 3.1.5로 올리고 번들 재빌드.
- **실제 위험은 낮음:** `fast-uri`는 `ajv`의 `$ref`/`$id` 해석(`normalizeId`/`resolveUrl`)에서만 쓰이고, 이 서버가 검증하는 건 저장소에 정의된 자기 자신의 정적 스키마다. 공격자 제어 URI가 신뢰 판단에 쓰이는 경로가 없다. 배포물 위생 차원의 패치.
- 함께 정리된 lockfile: `hono` 4.13.1, `ip-address` 10.4.0, `nanoid`·`postcss`(dev). **번들 delta 0** — SDK HTTP/express 트랜스포트와 vitest 트리 소속으로 이 stdio 서버는 로드하지 않는다. `npm audit` = 0 vulnerabilities.
- **배운 것 (재빌드 판단 기준 정정):** "의존성 PR = 항상 재빌드"는 과일반화였다. **패키지마다 다르다** — PR #48(`ip-address`)은 lockfile만 바뀌고 CI dist 체크를 그대로 통과했고, PR #49(`fast-uri`)는 실패했다. 판단은 `grep -c "node_modules/<pkg>" dist/index.js`로 한다. `CLAUDE.md`·`maintainer-preflight` 반영.
- **버전을 올린 이유:** 플러그인 캐시가 **버전 키**다 (`~/.claude/plugins/cache/<mk>/<plugin>/<version>/`, 실측: 버전 디렉토리가 업데이트마다 새로 생김). 같은 `0.2.5`로 다른 번들을 재배포하면 한 버전 문자열에 두 산출물이 붙고 `/grok:status`의 `serverVersion`이 식별력을 잃는다.

상세: `docs/releases/v0.2.6.md`.

## 2026-07-29

### Ops — 의존성 PR의 dist 재빌드는 에이전트 소유 (배포 변경 없음)

- **발견된 구멍:** `maintainer-preflight`의 재빌드 조건이 `mcp-server/src/**`뿐이라, `package-lock.json`만 바꾸는 Dependabot PR에서는 발동하지 않았다. esbuild `bundle: true`가 런타임 의존성을 번들에 인라인하므로 lockfile 변경만으로 `dist/index.js`가 바뀐다 (실측: PR #27 `fast-uri` 3.1.3→3.1.4는 소스 무변경).
- 재빌드 트리거를 `src/**` + `package-lock.json`/`package.json`으로 확대하고, 의존성 PR 처리 절차를 스킬에 명시.
- `CONTRIBUTING.md`: 재빌드 주체를 **사람 아님 / 에이전트**로 명문화. 사람은 리뷰·머지만.
- 회귀 방지: `plugin-surface.test.ts`가 스킬의 lockfile 트리거 언급을 단언.
- **기각 기록:** CI 자동 재빌드 워크플로는 **NO-GO**. 공개 저장소에 write 토큰 상시 표면이 필요하고, `GITHUB_TOKEN` 푸시는 워크플로를 재트리거하지 않아 App/PAT까지 얹어야 최종 트리가 검증된다 (GitHub 공식 문서 확인). 6개월 1건 빈도에 비해 과하다. Dependabot **버전** 업데이트도 계속 끔 (번들 diff 805KB). 근거는 `CONTRIBUTING.md` "Why this is not automated in CI".

## 2026-07-28

### Ops — maintainer surface + shipped consistency (v0.2.5)

- `.claude/skills/repo-scope`: "다음 할 일" 질문 시점에 `docs/09` A~E 분류를 강제하고 기본 답을 **없음**으로 고정 (배포 안 됨).
- `.claude/skills/maintainer-preflight`: done 선언·커밋 전 test/typecheck/build + 번들 커밋 규칙 (배포 안 됨).
- `commands/delegate.md`: status/`billingMismatch` 중단, route/`nextAction`, 위험 시 `worktree`, `/grok:review` 종료 — 에이전트·스킬이 이미 강제하던 계약과 정렬.
- `skills/grok-routing/SKILL.md`: `grok_cli` 편집 금지(훅 미적용·이력 미기록) + `billingMismatch` 중단 규칙.
- `handoff-version.test.ts`: 릴리스 노트 존재 + `CLAUDE.md`·`docs/09`의 버전 표기 일치를 강제. `docs/06`·`docs/00`은 의도적으로 미검사.
- `docs/06`·`docs/00`의 `(v0.2.3)` 고정 표기 제거 — 재드리프트 방지.
- `CONTRIBUTING.md`: 패키징 경계(배포 vs `.claude/`) 명문화.
- 협의 기록: Claude가 제안한 `git commit` PreToolUse dist 훅은 **기각**. 조건이 "dist 최신"을 보장하지 못하고 Claude 외부 커밋을 못 잡는다. dist 무결성은 CI 책임으로 유지. 상세: `docs/specs/2026-07-28-ops-surface-claude-grok-design.md`.

## 2026-07-25

### Fix — hooks.json schema (v0.2.4) — plugin failed to load

- Claude Code now requires `hooks/hooks.json` to wrap events under `{ "hooks": { "PreToolUse": … } }`.
- Old bare `{ "PreToolUse": … }` made **`claude plugin list` → Status: failed to load** — **no slash commands** after install/upgrade.
- Confirmed: after wrapping, plugin status becomes **enabled** and commands load.
- Guards: `hooks-contract` forbids top-level `PreToolUse`; CLAUDE/CONTRIBUTING/docs/03 critical notes; release notes `docs/releases/v0.2.4.md`.

### Release — v0.2.3 (GitHub Release for end users)

- User-facing notes: `docs/releases/v0.2.3.md` (English how-to + what changed since v0.1.0).
- README command tables include status / review / resume / nextAction.
- Tag: `v0.2.3` on GitHub Releases.

### Docs — close in-repo residual loop

- `docs/09-scope-and-residuals.md`: why residuals recur; A/B/C/D classification; manual GUI checklist; agent rules (no default polish PR).
- Roadmap/CLAUDE: this repo product scope **complete** at v0.2.3; open items are consumer / manual / deferred only.

### Fix/Feat — pack integrity + billingMismatch (v0.2.3)

- `StatusSnapshot.billingMismatch` when subscription mode but history has metered runs.
- `tool-surface` tests: all 9 MCP tool names present in committed `dist/index.js`.
- Agent `grok-worker`, setup/status, marketplace blurb, CONTRIBUTING tool checklist.

### Feat — status dashboard (v0.2.2)

- MCP `grok_build_status` + `/grok:status`: auth + usage + `lastSession` + `nextSteps` (read-only).
- `buildStatusSnapshot` pure helper; plugin/package version lock test; tour/docs/08 wired.

### Release — v0.2.1 consumer kit

- Plugin + mcp-server version **0.2.1**.
- `examples/orchestrator-consumer.md` — copy-paste Task Manager loop.
- Route fixtures include **`nextAction`** expectations; `grok-routing` / first-mile skills teach review + resume.

### Feat — orchestrator nextAction + post-delegate review

- `orchestrator.ts`: `planNextAction`, `afterPlanGate`, `observeBilling` (pure consumer helpers).
- `grok_build_route` response includes **`nextAction`** for Task Managers.
- `/grok:review` quality-gate command; docs/07 wiring checklist updated.
- CI Node **22** (GitHub Node 20 deprecation); plugin-surface command frontmatter tests.

### Test — PreToolUse hook harness e2e

- Spawn committed `dist/hook.js` with isolated HOME/`GROK_BIN_DIR`/PATH (deny/allow/exit 0).
- `hooks/hooks.json` matcher contract test (plugin `grok` + server `grok-build`).

### Feat — session resume provenance + auth surface + dep hygiene

- History records `sessionId` when grok returns it; `grok_build_usage` recent rows expose it for `resume`.
- `grok_auth_check` always includes `billing` (mode expectation) + `serverVersion`.
- `npm overrides` pin `@hono/node-server@2.0.11` (transitive of MCP SDK) — audit 0 vulnerabilities.
- `usage.lastSession` + pure `latestResumableSession`; slash command **`/grok:resume`**.

### Fix — MCP server version SSOT

- `McpServer` advertised version no longer hardcodes `0.1.0`; reads `mcp-server/package.json` via `getServerVersion()` (matches plugin **0.2.0**).

### Fix — P1 reliability (apply untracked + timeout auth)

- `applyGrokWorktree`: include untracked files via temp `git add -A` + `diff --cached`, always reset.
- Timeout → `auth_error` only on **stderr device-flow** markers (no stdout `grok login` false positive).

### Feat — first-mile Grok starting point

- `docs/08-getting-started-with-grok.md` — 15-minute human path and recipes.
- `/grok:tour` guided tour; skills `grok-first-mile` + agent `grok-worker`.
- README/vision positioned as the on-ramp for using Grok well in Claude Code.

### Fix — unauth / expired-session signals (modern grok)

- Live probe with isolated home: immediate `{"type":"error","message":"Not signed in..."}`.
- `parseGrokResult` handles `type:error`; `looksLikeAuthFailure` + expanded signals.
- `npm run probe:unauth` script; contract §7 + `docs/specs/2026-07-25-auth-unauth-signals.md`.

### Docs/fix — sandbox profiles measured + tests

- Document built-in profiles (`workspace`, `read-only`, `strict`, …) from grok guide.
- Tests cover hyphenated `read-only`; `KNOWN_SANDBOX_PROFILES` for tool messaging.
- Win32 headless `--sandbox workspace` accepted (EndTurn); kernel enforce not assumed on Windows.
- Spec: `docs/specs/2026-07-25-sandbox-profiles.md`.

### Fix — Windows platform hardening

- Robust grok discovery: `where.exe` + `~/.grok/bin/grok.exe` fallback.
- Platform-aware install message (`install.ps1` on Windows).
- CI matrix includes `windows-latest` unit tests/typecheck.
- Native hook smoke recorded (exit 0). Design:
  `docs/specs/2026-07-25-windows-platform-hardening-design.md`.

### Chore — Phase 4 Slice B (CI + contract hardening)

- GitHub Actions CI: test, typecheck, dist freshness on PR/push to main.
- `docs/04` worktree/route/usage insights; orchestrator pseudocode + fixtures.
- Fixture-backed routing test; plugin version **0.2.0**.

### Feat — Phase 4 Slice A (routing engine)

- `routeTask` pure policy (`routing.ts`) + MCP `grok_build_route` (recommend only).
- `/grok:route`; integration contract `docs/07-orchestrator-integration.md`.
- 144 unit tests; dist rebuild. No spawn/billing side effects from route.

### Feat — Phase 3.5 Slice C (worktree lifecycle + usage insights)

- MCP tool `grok_build_worktree`: list / diff / apply (patch, no commit) / remove
  (only under `~/.grok-build/worktrees`).
- `summarizeHistory` → `insights` (success rate, subscription share, headline, tips).
- `/grok:worktree` command updated; 133 tests; dist rebuild.
- Design: `docs/specs/2026-07-25-phase35-slice-c-worktree-usage-design.md`.

### Feat — Phase 3.5 Slice B (stable delegate quality)

- `filesChanged`: before/after porcelain delta (exclude pre-dirty noise).
- Result `sessionId` from grok JSON; opt-in `model` / `effort` / `best_of_n`(2–4) /
  `resume` / `continue` with fail-closed validation (no spawn on bad input).
- Tests 122; rebuild `dist/index.js` + `dist/hook.js`.
- Design: `docs/specs/2026-07-25-phase35-slice-b-stable-delegate-design.md`.

### Feat — Phase 3.5 Slice A (routing skill · presets · setup)

- `skills/grok-routing/SKILL.md`: 엔드유저 세션에서 위임 판단 기준 자동 로드.
- `/grok:tests`, `/grok:migrate`, `/grok:boilerplate` 프리셋 커맨드.
- `/grok:setup` 첫 성공 경로(샘플 위임 · `billing` · 다음 시나리오).
- 설계: `docs/specs/2026-07-25-phase35-routing-skill-design.md`.

### Docs — 제품 본질 · 세션 핸드오프

- `docs/00-product-vision.md` 추가: Grok을 잘 쓰게 / 실력 체감 / Claude↔Grok 협업 경험.
- `CLAUDE.md`: 제품 포인터, 세션 핸드오프 표, “현재 상태”를 Phase 3.5 경험 방향으로 정리.
- `docs/06-roadmap.md`: Phase 3.5(협업 경험) 체크리스트 (Slice A 완료 표시).
- README / README.ko, `docs/01`, `docs/05`에 비전 포인터 정렬.
