# Changelog

이 파일은 **완료된 작업의 서사**용이다. 에이전트가 매 세션 읽는 “지금 상태”는 루트
`CLAUDE.md`와 `docs/06-roadmap.md`를 본다. 제품 본질은 `docs/00-product-vision.md`.

형식: 최신이 위. 날짜는 작업일 기준.

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
  `git worktree remove`는 레포별이다. 실측 — 36개가 3개 레포에 흩어져 있어(34/1/1) 어느
  프로젝트에서 돌려도 거의 아무것도 회수 못 하고 나머지는 실패로 보고됐다. 이제 각 트리의
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
커버리지 80% 미달과 함께 범위 밖으로 유지. `npm test` 259 → 270.

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


## 2026-08-15

### Fix — 분류기 오탐 + 이력/env 보안 위생 (v0.2.8)

- **원인:** 성공/`plan` JSON의 `text`에 `grok login`이 있으면 `looksLikeAuthFailure`가
  `auth_error`로 뒤집었다. 타임아웃 경로는 stdout을 이미 안 보는데 성공 경로는 봤다.
- parse-fail `auth_error`가 `filesChanged`를 빼먹던 불일치 수정.
- 이력 preview의 `XAI_API_KEY`/`GROK_CODE_XAI_API_KEY` 대입 마스킹.
- 구독 모드 env 키 제거를 대소문자 무시(Windows).
- 살아 있는 문서 SSOT (`docs/03`·`06`·계약서 §3–4·CLAUDE Windows hook).

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
