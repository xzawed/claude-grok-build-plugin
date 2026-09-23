# CLAUDE.md — claude-grok-build-plugin

이 파일은 Claude Code가 이 프로젝트에서 세션을 시작할 때 자동으로 읽는 컨텍스트 파일입니다.
사람이 읽는 개요는 `README.md`(영문 기본) 또는 `README.ko.md`(한글), 상세 설계는
`docs/`를 참조하세요.

> ⚠️ 이 CLAUDE.md는 **이 저장소에서 개발할 때만** 로드된다. 플러그인이 **설치된**
> 엔드유저에게는 플러그인 루트의 CLAUDE.md가 컨텍스트로 전달되지 않는다 (플러그인은
> skill/agent/hook으로 컨텍스트를 제공). 따라서 절대 원칙(예: API 키 env 정제)이
> 엔드유저 런타임에 강제돼야 한다면 반드시 코드/hook에 구현해야 하며, 이 문서에만
> 적어두면 안 된다.

## 프로젝트 한 줄 요약

Claude Code 플러그인. Claude가 코딩 작업 중 일부를 xAI의 **Grok Build CLI**에 위임할 수 있게
하는 MCP 서버 래퍼. 과금은 **API 종량제가 아니라 사용자의 xAI 구독**(SuperGrok / X Premium+)을
사용하는 것을 최우선 제약 조건으로 한다.

**제품 본질 (SSOT: `docs/00-product-vision.md`):** 개발자가 Grok을 잘 쓰게 하고, 플러그인으로
Grok의 코딩 실력을 체감하게 하며, Claude(오케스트레이터) ↔ Grok(워커) 협업 경험을 만든다.
다리를 만드는 것만이 아니라 **멋진 협업 경험**이 목표다.

## 세션 핸드오프 (Claude·Grok·사람 — 필수)

의미 있는 작업 후에는 다음 세션이 **즉시** 진행 상황을 알 수 있게 문서를 맞춘다.

| 읽을 곳 | 담는 것 |
|---|---|
| 이 파일 `현재 상태` | 지금 사실·다음 할 일만 (이력 나열 금지, 짧게) |
| `docs/00-product-vision.md` | 왜 / 제품 목표 |
| `docs/06-roadmap.md` | Phase 완료 체크리스트 |
| `docs/09-scope-and-residuals.md` | 이 레포 범위 완료·잔여 분류·polish 금지 |
| `docs/10-service-audit-queue.md` | **열린 코드 결함 큐** (기능 감사 실측) — 고치면 지운다 |
| `docs/specs/`, `docs/plans/` | 결정 근거·구현 서사 |

같은 사실을 여러 문서에 복사하지 않는다 — 원천 하나를 고치고 나머지는 포인터. 전역 규칙과 동일.

## 현재 상태 (먼저 읽을 것)

**최신 릴리스 `v0.2.30`.** 무엇이 왜 나갔는지는 `docs/releases/`와 `CHANGELOG.md`가 원천이다 —
여기 옮겨 적지 말 것. 이 절은 **지금 사실과 함정**만 담고 이력은 담지 않는다.

- **다음 할 일: 없음** (`.claude/skills/repo-scope`). 오너가 목표를 줄 때까지 기본값은 "없음"이다.
  `docs/10-service-audit-queue.md`의 A 섹션이 비어 있으면 그 말이 맞다. 새 결함은 거기 A 섹션에
  적고 **번호는 재사용하지 않는다 — 다음은 A33이다.** 범위 밖(외부/수동/보류)은 `docs/09`.
  기각·반증된 항목을 다시 제기하기 전에 `docs/09`·`docs/releases/`의 근거부터 읽을 것.
- **⚠️ grok CLI는 스스로 업데이트된다.** `1.0.5`→`1.0.13`→`1.0.30`이 **아무도 눈치채지 못한 채**
  일어났다(17개 릴리스). 계약 스냅샷이 낡는 것을 **전제로** 설계한다 — 그래서 `grok-cli.ts`의 차단
  판정은 목록에 의존하지 않는다. **`npm run probe:contract`가 이 드리프트를 잡는다**(쿼터 0).
  유닛 테스트는 전부 DI 목이라 **어떤 grok에서도 녹색**이다 — 실제 CLI를 보는 건 이 probe뿐이다.
  계약 SSOT는 `docs/specs/grok-cli-contract.md`이고 **절마다 유효 버전이 다르다.**
- **⚠️ 새 서브커맨드를 `KNOWN_SUBCOMMANDS`에 넣는 것이 기본값이 아니다** (A29 실측). 두 집합은
  **반대 방향으로 실패한다**: denylist(`NON_HEADLESS`)는 낯선 선행 플래그가 있어도 막고,
  allowlist는 파스가 불확실하면 설계상 물러난다 — 그래서 `cursor-worker`가 spawn됐다. 헤드리스로
  못 돌거나, 호출보다 오래 살거나, 계정에 작용하는 것은 **`NON_HEADLESS`** 행이다.
- **⚠️ plan 모드의 쓰기 차단 여부는 릴리스마다 뒤집힌다**(1.0.3 막음 → 1.0.13 안 막음 → 1.0.30 막음,
  전부 실측). `planWroteFiles`는 **지우지 않는다** — 탐지는 이번 실행의 사실이라 버전과 무관하다.
  사용자 대상 문구에 "grok X.Y는 …한다"를 **단정하지 말 것**(그렇게 적어뒀다가 거짓이 됐다).
- **⚠️ 버전을 선언하고 태그를 안 끊는 사고는 한 번이 아니다.** 캐시는 **버전 키**이므로 그 사이
  설치자가 옛 번들을 그 번호로 캐시한다. **머지 직후 바로 태그를 끊는다.** 번들이 바뀌면 같은
  번호로 재배포하지 말고 범프한다. 경위는 `docs/releases/`, 감시는 `release-tag-check`.
- **의존성 PR: dist 재빌드는 사람이 아니라 에이전트가 한다.** esbuild가 런타임 의존성을 인라인하므로
  lockfile만 바뀌어도 번들이 바뀔 수 있다 — 단 **패키지마다 다르다.**
  `grep -c "node_modules/<pkg>" dist/index.js`가 0이면 재빌드 없이 머지한다. 근거: `CONTRIBUTING.md`.
- **다시 열지 말 것 — SCAManager 토큰 건은 2026-09-04에 실측으로 닫혔다.** 발급처에서 무력함이
  확인됐다. 다시 열기 전에 `CHANGELOG.md` 그 날짜 항목과 `docs/09` §5부터 읽을 것.
  ⚠️ **Dependabot 경보 건수는 여기 적지 않는다** — 박아뒀다가 새 경보를 "확인 불필요"로 읽힐 뻔했다.
  원천은 `gh api …/dependabot/alerts?state=open`과 `npm audit`이다.
- **릴리스 수락 — 마지막 한 칸은 언제나 다음 세션 몫이다.** 순서는 머지 내용 검증 → **즉시**
  태그·릴리스 → `origin/main` dist blob = 태그 blob → 클론 먼저 설치본 갱신 → 캐시 = 태그 blob →
  `accept-release` 레포·캐시 양쪽. **버전 번호는 여기 적지 않는다** — 실행 기록의 원천은
  `docs/09` §5이고, 여기 박아두면 네 릴리스 뒤까지 낡은 채 남는다(2026-09-23 실측: 실제로 그랬다).
  ⚠️ **왜 한 칸이 남는가:** 세션은 시작 시점의 MCP 프로세스를 물고 있어 갱신을 수행한 세션도 옛
  번호를 말한다. **프로세스 명령줄의 버전 디렉터리가 `serverVersion` 자기보고보다 강한 증거다.**
  같이 재야 할 것: 캐시 파일의 개행 정규화 sha256 = **태그 blob**(`origin/main`이 아니다).


### 다른 PC(또는 새 클론)에서 이어받을 때

절차는 **`CONTRIBUTING.md`와 `docs/09` §5가 원천이다** — 같은 셸 블록이 세 곳에 복사돼 있었고,
그중 하나만 고치면 나머지가 거짓이 된다(2026-09-23에 여기 사본을 지웠다).

⚠️ **여기 남기는 것은 순서 하나뿐이다: 클론이 먼저다.** 마켓플레이스 클론은 `autoUpdate: false`라
클론이 낡으면 `claude plugin update`가 새 버전을 **아예 보지 못한다**(2026-09-04 실측). 설치본이
안 올라간다고 캐시를 의심하기 전에 `claude plugin marketplace update`부터 돌릴 것.

- **감사 하네스는 `.claude/tools/mcpcall.mjs`다** — 세션의 MCP(설치 시점 버전에 고정)가 아니라
  **배포 번들을 stdio로** 띄워 채점한다. 엉뚱한 산출물을 채점하는 사고를 막는 유일한 방법이다.
  ⚠️ **이건 실제 쿼터를 쓴다** — 쿼터 0으로 배선만 확인하려면 `accept-release.mjs`.
  ⚠️ 지우면 안 되는 불변식: 만료 세션은 **폐기**이므로 `AUTH_ERROR_SIGNALS`의
  `invalid or expired credentials`(계약 §7 C). `planWroteFiles`는 위 plan 모드 항목이 원천이다.
- **레포 밖/수동/보류:** 외부 오케스트레이터 실배선(소비자) · GUI 클릭 수동 수락 · ACP 보류.
  분류: **`docs/09-scope-and-residuals.md`**.
- 치명 회귀 주의(`hooks/hooks.json` 스키마 등)는 아래 **Gotchas**. 이력은 `CHANGELOG.md`.
- 비전: `docs/00` · Phase: `docs/06` · 릴리스 노트: `docs/releases/`.

## 작업 수행 방법 — 결함 하나를 고치는 절차

v0.2.20(감사 큐 A1~A6)을 만든 절차이고, 다음 세션이 트랜스크립트 없이 같은 품질로 일하기 위한
**최소 조건**이다. 순서를 바꾸지 말 것 — 각 단계는 앞 단계가 만든 증거에 기댄다.

1. **배포 번들로 재현한다.**
   `node .claude/tools/mcpcall.mjs call <tool> '<json args>'`
   세션의 MCP 연결로 재현하지 말 것 — 그건 **세션이 시작될 때 설치돼 있던 버전에 고정**돼 있어
   엉뚱한 산출물을 채점한다(설치본이 지금 레포에서 빌드한 것과 같다는 보장은 없다 —
   같은지는 `claude plugin list`와 `mcp-server/package.json`을 대조해서 확인한다).
   재현되지 않으면 거기서 멈춘다. 문서에 적힌 증상은 증거가 아니다.
2. **실패하는 테스트를 먼저 쓴다.** fixture는 1번에서 **실제로 보낸 페이로드 그대로**, 주석에는
   실측한 before/after 수치. 증상을 문장으로 옮겨 적지 말고 페이로드를 박아 넣는다 — 그래야
   회귀가 같은 모양으로 다시 잡힌다.
3. **고친다.** 근거(왜 이 판단이 맞는지, 무엇을 일부러 안 했는지)는 코드 주석에 남긴다.
4. **같은 페이로드로 다시 잰다.** `npm run build` 후 1번과 **동일한** 호출.
   숫자가 바뀐 것을 눈으로 보기 전에는 고쳤다고 말하지 않는다.
5. **Grok에게 반증을 시킨다** (아래 조리법대로 — 안 지키면 답이 오지 않는다).
6. **preflight.** `.claude/skills/maintainer-preflight` (test·typecheck·build + 번들 2개 커밋).
7. **PR.** `CONTRIBUTING.md` "Branch & PR" → CI 2개 green → 오너 squash-merge →
   **머지 직후** 태그·릴리스(`CONTRIBUTING.md` "Release"). 태그를 미루면 버전 키 캐시가 오염된다.
8. **수행 후 검증 + 과정 감사 (필수 — 건너뛰지 않는다).** 아래 8번 절.

### 8번 — 결과 검증과 과정 감사 (2026-09-12 신설, 오너 지시)

**끝났다고 말하기 전에 두 가지를 한다. 하나는 산출물을, 하나는 그것을 잰 방법을 검사한다.**

**(a) 결과 검증 — 산출물이 실제로 나갔나.**

- 머지 후 `origin/main`의 **내용**을 본다 (`git show origin/main:<path>`). squash가 커밋을
  떨어뜨린 전례가 있다 — 로그가 아니라 내용이 증거다.
- 버전이 올랐으면 `accept-release.mjs`를 **레포와 캐시 양쪽**에 돌린다.
- 배포 번들을 `.claude/tools/mcpcall.mjs`로 다시 띄워 **1번의 재현 페이로드를 한 번 더** 친다.
- `serverVersion`은 **갱신 뒤 새로 시작된 세션**만이 증명한다 (세션은 시작 시점의 MCP 프로세스를
  물고 있다).

**(b) 과정 감사 — 나를 여기까지 데려온 측정이 거짓말하지 않았나.**

- **모든 findings는 두 번째 독립 방법으로 재도출한 뒤에만 행동한다.** 한 하네스가 낸 숫자
  하나로 코드를 고치지 않는다.
- 결과가 **그럴듯하면 더 의심한다.** 명백히 이상한 출력은 저절로 잡히지만, 그럴듯하게 틀린
  숫자는 그대로 보고된다.
- 하네스가 틀렸던 사실은 **CHANGELOG에 남긴다.** 다음 세션이 같은 함정을 다시 밟는다.

⚠️ **이 규칙이 왜 필수인가 — 2026-09-12 감사 실측:** 진짜 결함 **2건**을 찾는 동안 측정 하네스가
**6번** 틀렸다 (heredoc이 역슬래시를 접어 정규식 무력화 → 실재하는 식별자 25개가 "없음",
`tail -1`이 사전순이라 `0.2.23` 대신 `0.2.3`을 채점, CRLF 바이트차를 번들 불일치로 오인, grok에
없는 `--prompt`로 게이트 오판 2건, docs 스윕이 외부 인용을 죽은 포인터로 오인 → 후보 10건 전부
오탐). **하네스 오류가 진짜 결함보다 3배 많았다.** 전부 출력이 명백히 이상해서 잡았을 뿐이다.

⚠️ **파일 내용을 셸 명령 문자열 안에서 만들지 말 것.** heredoc이든 `node -e "…"`든 `python - <<PY`든
전부 해당한다. 셸이 한 겹을 먹고, 무엇을 먹는지는 따옴표 종류마다 다르다 — 역슬래시(`\s`→`s`,
`\n`→`n`), 백틱(**명령으로 실행된다**), `$`, `!`. **대개 조용히 0건 치환으로 끝나 성공처럼 보이고,
나쁠 때는 파일을 깨뜨리거나 의도치 않은 명령을 실행한다.** 파일 편집은 **Edit/Write 도구로** 한다.
검사는 역슬래시 없는 `includes()`로 짠다. 셸은 읽기·실행에만 쓴다.

> 이 규칙은 **두 번 넓혀졌고, 두 번 다 넓히자마자 다시 당했다.** 2026-09-12 원문은 "heredoc으로
> **정규식**을 쓰지 말 것"이었다 — 그때 죽은 게 정규식이라서다. 2026-09-23 한 세션에서 **5번** 더
> 당했고 **3번은 정규식이 아니었다**. 그래서 "heredoc에 **역슬래시**"로 넓혔는데, 그 직후
> `node -e "…"` 안의 **백틱**이 실행되어 이 문단 바로 위 블록을 깨뜨렸다(`claude plugin marketplace
> update`가 실제로 돌았다). heredoc도 아니고 역슬래시도 아니었다.
>
> **교훈은 규칙의 내용이 아니라 규칙을 쓰는 방식이다.** 관측한 증상에 맞춰 쓰면, 지키면서도 같은
> 메커니즘에 당한다. 매번 한 칸씩 넓히는 대신 **메커니즘을 금지**한다 — 여기서는 "셸로 파일을
> 만들지 않는다".

### 5번 조리법 — 리뷰 프롬프트를 이렇게 쓴다 (2026-09-06 실측, 2026-09-12 부분 반증)

⚠️ **이 절의 "왜"는 더 이상 현재 사실이 아니다. 조리법은 유지하되 법칙으로 인용하지 말 것.**
원래 문장은 "산문 답만 요구하는 리뷰 프롬프트는 **끝나지 않는다**"였고 2026-09-06에는 실측이었다
(180~300초 timeout 5연속, 한 번은 1800초에 중단). **2026-09-12에 재현되지 않았다** — 배포 번들에
산문 전용 리뷰를 기본 180초 캡으로 두 번 쳤더니 **83초·33초에 정상 완료**했다(작은 픽스처 1회,
실제 레포 1회, 둘 다 정확한 답). 오너 코퍼스도 지지하지 않는다: 9월 리뷰형 283건 중 **244건 완료**,
종료 지시를 **명시한** 프롬프트의 timeout율이 오히려 더 높다(5/14 vs 34/269 — n이 작고 선택편향
있음). grok은 스스로 업데이트하므로 그 사이 동작이 바뀌었을 수 있다. **이 조리법으로 쓴 리뷰는 실제로
빨리 돌아오므로 계속 쓴다.** 다만 "산문이면 매달린다"를 근거로 제품 표면을 바꾸려 하지 말 것 —
2026-09-12에 그 시도가 재현 단계에서 멈췄다(`CHANGELOG.md`).

아래는 그 조리법이다. 같은 질문이 1분 안에 돌아오게 만드는 조건:

- 프롬프트를 **`WRITE your answer to verdict.md and stop`** 으로 끝낸다. 헤드리스 grok은 "done"
  이라 부를 수 있는 **도구 사용 턴**에서 끝난다 — 파일 쓰기가 그 턴이고, 산문은 아니다.
- **`STATIC ANALYSIS ONLY. Run NO shell commands.`** 로 시작한다. 인자 배열이나 명령 모양을
  추론 대상으로 주면 grok이 그걸 **실행한다** (1800초 행의 원인).
- 검토 대상을 **빈 스크래치 디렉터리에 함수 하나로** 떼어 놓는다. 레포를 가리키면 탐색만 한다.
- 답 형식을 **표 + 마지막 줄은 둘 중 하나인 enum 문자열**로 못 박는다.
- **한 번에 한 가지 주장만.** 여러 질문을 실으면 timeout으로 돌아온다.
- 도구가 돌려준 요약이 아니라 **`verdict.md`를 직접 읽는다** — 요약이 더 얇을 수 있다.

**Grok은 자주 옳다.** v0.2.20에서 **6건 중 4건**이 "내 수정 안에 있던 진짜 결함"을 물고 돌아왔다
(`.git` 디렉터리 오판, `git status`의 상위 탐색, 짧은 플래그 뭉침 `-vp x`, 사용자명 없는
`redis://:pw@`). 그러나 **받은 지적은 행동 전에 실측으로 확인한다** — 같은 릴리스에서 2건은
근거가 없어 기각했다. 확인 없이 반영하는 것도, 무시하는 것도 둘 다 틀렸다.


## 절대 원칙 (변경 금지)

1. **인증은 서버 레벨 env `GROK_BUILD_AUTH_MODE`(기본 `subscription`, opt-in `api`)로
   결정되는 투트랙이며, 모드에 따라 API 키 env 처리가 갈린다 — 호출별 오버라이드는
   없다.**
   - `subscription`(기본, 미설정 시): grok 프로세스에 넘기는 env에서
     `XAI_API_KEY`·`GROK_CODE_XAI_API_KEY`를 항상 제거한다(`env.ts`의
     `buildGrokEnv`). **이유(2026-09-02 실측으로 정정):** "키가 세션보다 우선이라서"가
     아니다 — 1.0.13에서 유효 세션이 있으면 grok은 `auth_type=SessionToken`으로 가며
     env 키를 시도조차 하지 않는다(헤드리스 `-p` 5형태 실측; 그 밖은 미측정).
     진짜 이유는 세션이 없거나 만료된 순간 env 키가
     **폴백 자격증명**이 되어 구독 모드 실행이 조용히 종량제로 넘어갈 수 있기 때문이다.
     키를 지우면 그 실행은 조용히 과금되는 대신 `auth_error`로 명시적으로 실패한다.
     즉 구독 모드는 종량제 자격증명을 아예 쥐지 않는다는 **정책 보장**이다.
     ⚠️ `grok models`의 "You are using XAI_API_KEY." 문구는 env 변수 존재만 보고하며
     요청 인증과 다르다 — 이를 근거로 삼지 말 것. 실측 전문: `docs/specs/grok-cli-contract.md` §10.
   - `api`(opt-in, `GROK_BUILD_AUTH_MODE=api`일 때만): env의 API 키를 그대로
     통과시킨다 — 종량제(`billing: "metered_api"`)로 명시적으로 청구된다.
   - 모든 `grok_build_delegate` 응답은 설정된 `mode`와 그로부터 파생된 `billing`을
     명시한다 — `billingFor(mode)`이며 관측값이 아니다. 상세:
     `docs/02-auth-strategy.md`, `docs/specs/grok-cli-contract.md` §2.
   - ⚠️ **안전 모델 (헤드리스 편집을 위해 필수):** grok에 실제 편집을 시키려면
     `--always-approve`가 필수다 (없으면 grok이 `stopReason: Cancelled`로
     끝나고 아무 파일도 바꾸지 않는다 — 실측, `docs/specs/grok-cli-contract.md`
     §1·§5). 즉 이 플러그인은 승인을 대화식으로 보류하지 않는다 — grok은 대상
     `cwd`(또는 `--worktree` 격리)에서 **직접 편집**하되, **자동 커밋은 하지
     않는다**. Claude/사람이 diff를 검토한 뒤에만 커밋한다
     (`docs/05-routing-policy.md` "위임 시에도 지켜야 할 것" 참고).
2. 인증은 `grok login`(브라우저 OAuth, 사용자가 터미널에서 최초 1회 수동 실행)으로
   생성되는 `~/.grok/auth.json` 세션 토큰(구독 모드) 또는 env의 API 키(API 모드)에
   전적으로 의존한다. 이 플러그인은 자격증명을 저장하거나 대신 로그인하지 않는다.
3. 자동화 실행에는 항상 `--no-auto-update` 플래그를 붙인다 (헤드리스 환경에서
   업데이트 체크로 인한 행 방지). 실측 결과 헬프에는 없지만 에러 없이 수용된다
   (exit 0) — 붙여도 안전.
4. MCP 서버는 **자신이 쥔 credential**(env의 API 키, 세션 토큰, `rawStderrTail`)을 로깅하거나
   파일에 쓰지 않는다. API 모드에서도 키를 저장하지 않고 env에서 읽어 통과만 시킨다.
   ⚠️ **이 원칙이 덮지 않는 것 — 위임 이력의 프롬프트 미리보기.** `~/.grok-build/history.jsonl`은
   프롬프트 앞 200자를 기록하고, `grok_build_usage`·`grok_build_status`가 그것을 Claude에게
   되돌려준다. 즉 **사용자가 프롬프트에 붙여넣은** 시크릿은 서버가 쥔 자격증명이 아니지만
   기록될 수 있다. `history.ts`의 `redactSecrets`가 알려진 형태(xAI·AWS·GitHub·Slack·JWT·
   Bearer·`password:` 류 대입·PEM 블록)를 가리지만 **모든 형태를 가릴 수는 없다** — 마스킹은
   완화이지 보장이 아니다. 2026-09-03 실측 전에는 xAI 키만 가렸고 나머지는 그대로 기록됐다.

## 컴포넌트 지도

**원천은 여기가 아니다** — 배치는 `docs/03-plugin-spec.md`, tool 스펙은 `docs/04-mcp-server-spec.md`,
Phase는 `docs/06-roadmap.md`, 그리고 각 파일의 **소스 주석**이다. 이 절은 파일이 무엇을 하는지
설명하지 않는다(그건 소스가 한다). **손대기 전에 알아야 할 것**만 남긴다.

- `mcp-server/src/` — MCP 서버. 9 tools: `grok_build_delegate` · `grok_build_plan` ·
  `grok_build_verify` · `grok_build_route` · `grok_build_worktree` · `grok_build_usage` ·
  `grok_build_status` · `grok_auth_check` · `grok_cli`.
- `hooks/hooks.json` + `src/hook-entry.ts` → `dist/hook.js` — PreToolUse 인증 게이트.
- `.claude/tools/` — 유지보수자 도구. **엔드유저 디스크에 그대로 내려간다**(마켓플레이스 소스가 `./`).

### 여기 함정이 있다 (상세는 각 파일의 주석)

- `server.ts` — 핸들러를 `main()` 안 익명 클로저로 되돌리지 말 것. 호출이 불가능해지면
  `isError` 계약을 뒤집어도 **전 스위트가 녹색**이다(실측).
- `prompt-flags.ts` — **리프 모듈인 이유가 있다.** hook이 import해도 delegation 엔진이
  `dist/hook.js`로 딸려 들어가지 않게 하려는 것이다.
- `delegate.ts` — `AUTH_ERROR_SIGNALS`의 `invalid or expired credentials`를 **지우지 말 것**
  (지우면 정반대 안내가 나간다). `bestOfN` 거부는 `accept-release.mjs`의 **쿼터 0 보증을
  떠받친다** — 죽은 호환 코드가 아니다.
- `worktree.ts` — 삭제는 baseDir 하위만, **브랜치는 래퍼가 만든 이름만**.
- `version.ts` — SSOT는 `package.json`. 하드코딩 폴백 리터럴도 **같이** 범프한다.
- `build.mjs` — 번들 **2개**(`dist/index.js`·`dist/hook.js`)를 만들고 둘 다 커밋 대상.
  런타임 floor(`target`)는 `package.json`의 `engines`와 어긋나면 테스트가 잡는다.
- `scripts/check-release-tag.mjs` — schedule/dispatch **전용**. 버전 선언 커밋은 태그보다 먼저
  머지되므로 push/PR에 걸면 모든 릴리스 PR이 오탐이 된다.
- `scripts/probe-contract-drift.mjs` — `npm run probe:contract`. grok 표면 드리프트 감시(쿼터 0).

## 개발 명령

사용자가 **사전에 수동으로** 해야 하는 것(플러그인이 대신 하지 않는다): grok CLI 설치 → `grok login`
→ 스모크. 명령 전문은 `docs/08-getting-started-with-grok.md`와 `README`가 원천이다.

`mcp-server/` 안에서: `npm test` · `npm run typecheck` · `npm run build` ·
`npm run probe:contract`(grok 표면 드리프트, 쿼터 0).
번들 2개가 커밋 대상이라는 점은 위 Gotchas에 있다.

> ⚠️ **의존성 버전은 이 문서에 적지 않는다.** floor는 `package.json`, 해석값은 `package-lock.json`,
> 설치된 것은 Gotchas의 `--no-save` 확인 명령이 말한다 — 셋 중 무엇을 알아야 하는지부터 정하고 그
> 원천을 읽을 것. (여기 박아둔 번호가 floor 인상 뒤에도 남아 거짓이 된 적이 있다.)
>
> `test/claude-md-claims.test.ts`가 이것을 고정한다 — floor 재등장 금지 + 이 문서가 이름 대는
> 경로·식별자·npm 스크립트·tool이 실재하는지. ⚠️ **이름이 있는지만 본다.** 설명이 맞는지는 보지
> 않으므로, 실재하는 함수에 틀린 동작을 적어두면 그대로 통과한다 — 그쪽은 사람이 소스와 대조해야
> 한다.


## 설계 문서 인덱스

| 문서 | 내용 |
|---|---|
| `docs/00-product-vision.md` | 제품 본질·협업 경험 목표·성공 감각 (왜) |
| `docs/01-architecture.md` | 전체 아키텍처, Claude ↔ MCP 서버 ↔ grok CLI 흐름 |
| `docs/02-auth-strategy.md` | 투트랙 인증 전략(구독 기본 + API opt-in), env 정제, 만료 처리 |
| `docs/03-plugin-spec.md` | 플러그인 디렉토리 구조, manifest 필드 |
| `docs/04-mcp-server-spec.md` | MCP tool 정의 (요청/응답 스키마) |
| `docs/05-routing-policy.md` | 어떤 작업을 Grok Build에 위임할지 판단 기준 |
| `docs/06-roadmap.md` | 구현 단계 (Phase 1~5) |
| `docs/07-orchestrator-integration.md` | 오케스트레이터 JSON/MCP 연동 계약 |
| `docs/08-getting-started-with-grok.md` | 사람용 Grok 시작 지도 (15분 경로) |
| `docs/09-scope-and-residuals.md` | 범위 종료·잔여 반복 이유·수동 수락 |
| `docs/10-service-audit-queue.md` | 열린 결함 큐 · 측정 불가 항목 · 재현 방법 (**건수는 그 문서가 원천** — 여기 적으면 낡는다) |

## 이 프로젝트가 속한 더 큰 그림

이 플러그인은 별도로 설계 중인 **멀티에이전트 오케스트레이터**(Orchestrator ↔ PM/Dev/
Designer/Tester/Security/Wiki/QA agents) 프로젝트의 한 축으로 편입될 예정이다.
Grok Build는 오케스트레이터 관점에서 "병렬 탐색/저비용 반복 작업"을 처리하는
서브에이전트 워커로 취급하며, QA Agent의 위험도 기반 모델 라우팅(LOW/MEDIUM/HIGH)과
유사한 방식으로 Claude와 Grok Build 사이의 작업 분배 기준을 둔다.
(자세한 기준은 `docs/05-routing-policy.md` 참조.)

## 코딩 컨벤션

- MCP 서버: TypeScript, Node.js. `@modelcontextprotocol/sdk` 사용.
- 서브프로세스 실행은 `spawn` 사용, `exec`/`execSync`로 셸 인젝션 위험 있는 문자열
  조립 금지 — 프롬프트는 반드시 인자 배열로 전달.
- 모든 tool 응답은 구조화된 JSON을 텍스트로 요약해서 반환 (grok의 raw stdout을
  그대로 Claude에게 넘기지 않는다 — 토큰 낭비 및 파싱 부담).

## Gotchas

각 항목은 **함정의 존재**만 말한다. 근거와 재현은 가리키는 문서·소스 주석에 있다.
분류 기준: *세부를 모르면 잘못 고치게 되는 것*만 여기 전문으로 남겼다.

**한 줄이면 되는 것들**

- 플랫폼: 1차 지원은 Linux/macOS지만 **네이티브 Windows에서 핵심 경로가 실측 동작한다.**
  POSIX 경로·셸을 하드코딩하지 말 것 (`homedir()`/`join`/`delimiter` + `process.platform` 분기).
  `~/.grok/…`은 **홈 축약 표기일 뿐** win32에선 `C:\Users\…\.grok\…`이다.
  ⚠️ **`--sandbox`의 커널 강제는 Linux/macOS만 가정한다** — win32에서 플래그는 수용되지만 막아주지
  않을 수 있다. 격리를 sandbox에 기대지 말 것.
  ⚠️ win32에서 timeout 캡은 **손자 프로세스를 보장 정리하지 않는다**(`killTree`는 grok만 죽인다).
  근거·한계·재현: `docs/06-roadmap.md` "플랫폼 지원 (실측)".
- `git status --porcelain`은 **`-z` + `core.quotepath=false`** 로 파싱한다(`parsePorcelain`).
  기본 포맷은 리네임과 비ASCII에서 깨진다.
- `filesChanged`는 spawn **전후 차집합**이라 이미 dirty인 경로는 under-report될 수 있다.
  정밀 귀속이 필요하면 `worktree: true`.
- `best_of_n`은 CLI 1.0에서 삭제됐고 값이 있으면 **spawn 없이** 거절된다. 이 거절은
  `accept-release.mjs`의 쿼터 0 보증을 떠받친다(위 컴포넌트 지도) — 죽은 코드가 아니다.
- worktree apply는 untracked를 포함하고, timeout→auth 재분류는 **stderr device-flow만** 본다
  (stdout의 `grok login`은 오탐). 상세: `worktree.ts`·`delegate.ts` 주석.
- `.claude-plugin/plugin.json`·`.mcp.json`을 고치면 `docs/03-plugin-spec.md`의 예시도 함께 맞춘다.
  ⚠️ 이 스키마는 **Claude Code가 소유하고 버전마다 바뀔 수 있다** — 손대기 전에 공식 레퍼런스로
  재검증할 것. (grok CLI 드리프트와 같은 계열이다: 우리가 소유하지 않은 계약은 조용히 움직인다.)

**세부를 모르면 잘못 고치는 것들**

- **⚠️ 이 레포에서 세션을 열면 `grok-build` MCP가 `CONNECTION_CLOSED`로 뜬다 — 정상이다.**
  레포 루트가 곧 플러그인 루트라 같은 `.mcp.json`이 프로젝트 스코프로도 읽히는데,
  `${CLAUDE_PLUGIN_ROOT}` 치환은 **플러그인 로더만** 한다. 엔드유저 경로인
  `plugin:grok:grok-build`는 같은 목록에서 `✓ Connected`다.
  ⚠️ **`${VAR:-기본값}`으로 "고치지" 말 것 — 실측했고 조용히 더 나빠진다.** 로더 치환이
  기본값 붙은 토큰을 매칭하지 못해, 엔드유저가 플러그인 캐시가 아니라 **세션 cwd**에서
  서버를 띄우게 된다. 세션에서 tool이 필요하면 `plugin:grok:grok-build`를 쓰고, 배포 번들
  채점은 `.claude/tools/mcpcall.mjs`로 한다.
- **⚠️ CRITICAL — `hooks/hooks.json`은 `{ "hooks": { "PreToolUse": [...] } }` 형태여야 한다.**
  최상위에 `PreToolUse`를 두면 플러그인이 **로드 실패**하고 **슬래시 커맨드가 전부 사라진다.**
  회귀 방지는 `test/hooks-contract.test.ts`.
- **⚠️ `npm i --no-save`는 부작용이 있다 (2026-08-23 실측).** npm이 트리를 다시 풀면서 런타임
  의존성을 올릴 수 있고, esbuild가 그걸 번들에 인라인하므로 **소스와 어긋난 dist가 커밋된다.**
  `--no-save` 설치를 했으면 **반드시 `npm ci` 후에 빌드한다.**
- **⚠️ 이 레포에서 `npm install`·`npm update`는 npm 10.9.3에서 죽는다 (2026-09-12 실측).**
  lockfile은 손상되지 않으니 `npx npm@11 install …`로 우회한다. 단 npm 11 경로는 dev 패키지를
  한꺼번에 움직이므로 **런타임 의존성 전후 대조가 필수**다(위 `--no-save` 항목과 같은 사고).
- **번들 2개(`dist/index.js`·`dist/hook.js`)는 커밋 대상이다.** 플러그인은 설치 시점에
  `npm install`/빌드를 하지 않으므로, `src/` 변경 후 빌드를 빠뜨리면 **소스보다 뒤처진 번들이
  배포된다.**
