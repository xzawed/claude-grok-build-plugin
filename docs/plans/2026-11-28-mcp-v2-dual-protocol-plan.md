# MCP 2.0(SDK v2) 이중 계열 도입 — 구현 계획

> **SHIPPED — 이력 문서. 실행하지 말 것.** 구현 PR 셋으로 나갔다 — v0.2.55(grok 1.0.92 drift)·v0.2.56(SDK v2 이중 계열, Node 20
> 하한)·README 개편(2026-11-29). 그 앞의 0a·0b는 CHANGELOG 옮기기와 이 설계·계획의 PR이다. 아래의 체크 상자는 그때 계획의 흔적이지 남은 일이 아니다. 지금 동작의 원천은 `mcp-server/src/`와
> `docs/04-mcp-server-spec.md`, 남은 작업의 순서는 `docs/plans/2026-11-04-residual-plan.md`다.
>
> *(열린 계획이던 동안 이 자리는 실행 스킬로 이 계획을 실행하라고 일렀다. 그 지시는 철회됐다 — 계획이 나가 기록으로만 남는다.)*

**Goal:** 서버를 `@modelcontextprotocol/server` 2.x로 옮겨 stdio 진입점 하나가 2025 계열과 2026-07-28을 둘 다 받게
하고, Node 하한을 20으로 올려 밝히고, 실측으로 전면 재검증하고, README를 다시 쓴다.

**Architecture:** `serveStdio(() => buildServer(…))`가 연결마다 계열을 고르고 같은 공장이 두 계열을 서빙한다. 도구
아홉 개의 등록·핸들러는 그대로다. 배포되는 검사 도구는 SDK 없이 원시 프레임으로 두 계열을 말한다.

**Tech Stack:** TypeScript·Node 20+, `@modelcontextprotocol/server`·`client` 2.x, zod 4, esbuild, vitest.

**Spec:** `docs/specs/2026-11-28-mcp-v2-dual-protocol-design.md` (승인됨 2026-11-28). 계획과 설계가 어긋나면 설계가 이긴다.

## Global Constraints

- Node 하한 `engines` `>=20`과 `build.mjs`의 `target: 'node20'`을 함께 옮기고(`plugin-surface.test.ts`가 둘을 맞춘다), README·README.ko·`docs/08`에 처음으로 밝힌다.
- 실행 의존성 `@modelcontextprotocol/server`(하한 = 실측한 판, 2026-11-28 기준 2.4.0), 개발 의존성 `@modelcontextprotocol/client`(같은 판), `@modelcontextprotocol/sdk` 제거, `zod` ^4.6.7 유지.
- stdio 진입점은 `serveStdio(() => buildServer(mode, defaultServerDeps, { insideWorker }))`. `legacy: 'reject'`를 주지 않는다(2025 계열을 계속 받는다).
- `.claude/tools/*.mjs`는 Node 내장 모듈만 쓴다 — SDK import 금지, 원시 JSON-RPC 프레임만.
- `accept-release.mjs`는 쿼터 0이고, 설치된 옛 번들(2025 계열만 받음)의 채점 결과를 바꾸지 않는다.
- CLAUDE.md 절대 원칙(인증 투트랙·subscription 키 제거·`--no-auto-update`·자격증명 비기록)과 응답의 `mode`/`billing`은 그대로다.
- 번들이 바뀌면 릴리스다: 버전 자리 전부(CONTRIBUTING "Release" 1), 게이트(2, `accept-release --repo` 포함), 머지 직후 태그(3).
- 다음 버전 번호는 범프 전에 `CLAUDE.md`·`CHANGELOG.md`·`docs/09`에 쓰지 않는다(파일 이름도).
- 락파일은 `npx npm@11`로, 실행 의존성 전후 대조 필수. 파일 내용은 셸 문자열로 만들지 않는다(Edit/Write, 커밋은 `-F`).
- Docker는 `docker run --rm --label project=claude-grok-build-plugin`, 턴 끝에 회수 스크립트(전역 규칙).
- 리뷰는 `docs/11` "리뷰 라운드 규율", 리뷰어·Grok을 여럿 돌리기 전 비용을 밝히고 묻는다. 머지는 오너의 상시 승인(설계 §10 4번)대로:
  리뷰어 1명(릴리스는 Grok 반증도)으로 BLOCKER·MAJOR 0·모든 지적 처리·CI 녹색이면 실행자가 squash 머지하고, 릴리스는 곧바로 태그한다.
  아래 단계의 "오너 머지"는 이 기준을 말한다.

## Review Focus

1. Claude Code가 2026 계열을 탐색하며 서버를 **두 번** 띄울 때 — 짧게 산 쪽이 위임 이력·임시 파일·자식 프로세스를 남기지 않아야 한다 → Task 2.3의 `probe sibling leaves nothing` 테스트.
2. 옛 `protocolVersion`(`2024-11-05`)으로 `initialize`하는 2025 클라이언트 — v2 서버가 협상해 그대로 받아야 한다 → Task 2.3의 `legacy 2024-11-05 opening` 테스트.
3. 위임 도중 stdin EOF(두 계열) — 서버가 끝나고 가짜 grok 자식이 고아로 남지 않아야 한다(지금과 같은 수명) → Task 2.3의 `stdin EOF mid-delegation` 테스트(쿼터 0 가짜 grok).
4. Node 18 사용자 — 스택 대신 한 줄 안내와 종료 코드 1 → Task 2.1의 `node-guard` 테스트 + 매트릭스 #5.
5. 10MB에 가까운 요청이 2026 계열로 올 때 — 2025 계열과 같은 한도·같은 결말 → Task 2.3에서 `stdio-limit.test.ts`를 두 계열로.

---

## PR 0a — CHANGELOG 이관 (문서, 이 PR만)

> **완료** — #227로 머지(2026-11-28, main `44c966a`). 설계는 `docs/specs/2026-11-28-changelog-second-move-out.md`(이력 파일 하나로
> 옮긴 이유 포함).

오너 원문(2026-11-05): "2026-10-09~10-29의 한 줄 항목을 docs/history/로 글자 그대로 옮기고 CHANGELOG에는 포인터만 남기는
별도 docs PR. 선례(docs/specs/2026-10-09-changelog-index-design.md)대로 완료 기준부터 쓰고, 해시로 고정된 머리말과 테스트도
함께 고칩니다."

### Task 0a.1: 완료 기준을 먼저 쓰고 옮긴다

**Files:**
- Create: `docs/specs/2026-11-28-changelog-second-move-out.md` (완료 기준·설계 — 선례의 "완료 조건"·"설계" 절 형식)
- Create: `docs/history/<작업일>.md` — 2026-10-09 … 2026-10-29의 작업일마다 하나(2026-10-09는 이미 있는 파일이 FROZEN이라 새 이름 규칙은 선례 문서를 따라 정한다)
- Modify: `CHANGELOG.md` (해당 항목 제거, 머리말·"옮긴 항목 색인" 갱신), `mcp-server/test/changelog-shape.test.ts` (`FROZEN`·`FIRST_NEW_DATE`·머리말 해시·"holds exactly the files moved on 2026-10-09" 테스트)

- [ ] **Step 1:** 선례 문서의 "완료 조건"·"설계"·"알려진 한계"를 읽고, 이번 이관의 완료 기준을 새 스펙에 먼저 쓴다 — 최소한: 옮긴 줄이 바이트 그대로(옮기기 전 `CHANGELOG.md`의 해당 줄 집합 = 새 history 파일들의 해당 줄 집합, LF 기준), CHANGELOG ≤ 40,000바이트이고 다음 릴리스 줄을 넣을 여유, 기존 FROZEN 해시 불변, 다른 문서의 포인터("`CHANGELOG.md` <날짜>")가 여전히 찾아가짐, GitHub 렌더 요소 수 대조.
- [ ] **Step 2:** `changelog-shape.test.ts`를 새 완료 기준대로 먼저 고친다(새 파일의 해시, 새 경계 날짜) → 실행: `cd mcp-server && npx vitest run test/changelog-shape.test.ts` / 기대: FAIL(아직 안 옮김).
- [ ] **Step 3:** 항목을 Edit/Write로 옮긴다(셸 문자열 금지). 
- [ ] **Step 4:** 같은 명령 / 기대: PASS. 이어서 `npm test`·`npm run typecheck` 전부 녹색.
- [ ] **Step 5:** 렌더 대조 — `gh api -X POST markdown`으로 main과 브랜치의 `CHANGELOG.md`를 그려 `h2`·`li`·`code`·`del` 수를 비교(`del`이 늘면 안 된다).
- [ ] **Step 6:** 커밋(`git commit -F`), 브랜치 `docs/changelog-second-move-out`, draft PR → 리뷰(`docs/11`) → 오너 머지 → `origin/main` 트리 = 리뷰한 끝 커밋 트리 확인.

## PR 0b — 설계·계획 기록과 오늘 작업 색인 (문서)

### Task 0b.1: 설계·계획을 커밋하고 현재 상태를 옮긴다

**Files:**
- Add: `docs/specs/2026-11-28-mcp-v2-dual-protocol-design.md`, `docs/plans/2026-11-28-mcp-v2-dual-protocol-plan.md` (이 파일)
- Modify: `CLAUDE.md` "현재 상태"(다음 할 일 = 이 계획, 잔여 계획은 그 뒤), `CHANGELOG.md` `## 2026-11-28`(#225 hono 범프, #224→#226 라이선스 왕복, 이 설계·계획 — 한 줄씩), `docs/09` §4 G(오너가 연 새 기능 후보로 이 설계를 가리키는 한 줄)

- [ ] **Step 1:** 위 수정 → `npm test`(`claude-md-claims`·`changelog-shape`·`handoff-version` 포함) 녹색, CLAUDE.md 200줄 이내.
- [ ] **Step 2:** 커밋·draft PR → 리뷰 → 오너 머지 → 트리 확인.

## PR 1 — grok 1.0.92 계약 드리프트 (드리프트 릴리스)

> 2026-11-28 실측(Task 1.1)으로 범위를 넓혔다: 도움말 68쪽 중 59쪽이 바뀌었고, 플러그인이 기대는 것은 `-p`의 선택 값(값이 없으면
> stdin), 가변 `[PROMPT]...`(뒤 단어와 서브커맨드 이름까지 프롬프트로 흡수), `usage`의 새 문법, `--memory-flush`의 새 설명,
> `sessions list --all`, `--system-prompt-file`이다. 처음 잰 모양에서는 게이트 구멍이 없었고, 그 재측정과 머지 전 검토가 연 결함 넷 —
> **A80**(grok_cli 기록 미리보기가 grok이 실제로 보내는 프롬프트와 다름), **A81**(출력만 하고 끝나는 실행이 완료된 위임으로 기록됨),
> **A82**(헤드리스로 도는 `Say -p`를 맨 단어로 거부함 — Grok 반증의 UNKNOWN 행을 잰 것), **A83**(1.0.92의 새 숨은 플래그 뒤 `Say
> sessions`가 인증 확인·기록 없이 대화형 턴으로 돎 — 검토가 찾았고, 숨은 플래그를 다시 분류했다: 목록은 계약 §16) — 을 이 PR에서 고친다(`docs/10` §A,
> Task 1.3b). 1.0.92에서 바뀐 표면 중 `[PROMPT]...`와 `-p`의 선택 값은 그 넷으로 이어진다 — 선택 값은
> `-`로 시작하는 떨어진 다음 토큰을 받지 않는다(`-` 하나는 stdin이라 값이다: `-p - Say`는 "*`-p -` reads the prompt from stdin*", exit 2;
> `-p --help`는 도움말을 찍고, `-p --always-approve Say`는 "Say"를 보냈다; 모두 2026-11-28 실측). `--memory-flush`의 거절은 Task 1.3이
> 판단한다. `usage`와 `sessions list --all`은 래퍼가 바꿀 것이 없다 — `usage`는 세션 id 없이도 호출이 끝난 뒤 남는 프로세스가 없어
> `NON_HEADLESS` 행이 아니다(같은 날 실측). 계약 문서는 Task 1.1·1.3·1.3b가, 설명·주석은 그 동작을 다루는 Task(1.2·1.3·1.3b)가 고친다.
> 측정과 판단은 이 PR의 릴리스 노트가 원천이다.

### Task 1.1: 무엇이 바뀌었는지 실측으로 분류한다

**Files:** `docs/specs/grok-cli-contract.md`(바뀐 절에 1.0.92 날짜), 측정 메모는 스크래치

- [x] **Step 1:** 1.0.70 바이너리가 남아 있으면 버릴 폴더에 복사해 버릴 홈에서 `--help`를 받고(실제 설치는 내리지 않는다 — CLAUDE.md), 1.0.92의 같은 페이지와 diff한다. 없으면 `help-bodies.mjs`가 읽는 페이지를 1.0.92로 받아 바뀐 쪽을 계약 문서와 대조한다.
- [x] **Step 2:** 바뀐 내용을 "전역 옵션 목록 변화(모든 페이지)"와 "그 페이지만의 변화"로 나누고, 플러그인이 기대는 문장(계약의 각 절)에 닿는 것만 다음 Task로 넘긴다.

### Task 1.2: 스냅샷을 1.0.92로 올리고 `--system-prompt-file`을 분류한다 (TDD)

**Files:** Modify `mcp-server/scripts/contract-snapshot.json`(`--update`가 쓴다), `mcp-server/src/grok-cli.ts:59`(`VALUE_FLAGS`), Test `mcp-server/test/grok-cli.test.ts:1289`(스냅샷 플래그가 모두 분류됐는지 — 이미 있는 테스트)

**Interfaces:** Produces — `VALUE_FLAGS`에 `'--system-prompt-file'`(1.0.92 도움말: "`--system-prompt-file <PATH>` Override the agent's system prompt with the text of a file" — 프롬프트를 싣지 않으므로 `prompt-flags.ts`의 `PROMPT_FLAGS`에는 넣지 않는다. 근거: `--system-prompt`·`--system-prompt-override`가 같은 표에 있다).

- [x] **Step 1:** `cd mcp-server && node scripts/probe-contract-drift.mjs --update`
- [x] **Step 2:** `npx vitest run test/grok-cli.test.ts` / 기대: FAIL — `--system-prompt-file`이 어느 표에도 없다는 실패(`--memory-flush`·`--no-memory`는 이미 `BOOLEAN_FLAGS`에 있어 실패하지 않아야 한다 — 실패하면 그 자체가 발견이다).
- [x] **Step 3:** 동작 테스트를 먼저 더한다 — `grok_cli ["--system-prompt-file","sys.txt","-p","hi"]`가 맨 단어 프롬프트로 거절되지 **않고** `-p` 프롬프트 실행으로 분류된다(인증 훅·기록 경로를 탄다). 실행 / 기대: FAIL(지금은 `sys.txt`를 맨 단어로 읽는다 — 아니라면 실제 결과를 적고 기대를 그에 맞춰 정한다).
- [x] **Step 4:** `VALUE_FLAGS`에 `'--system-prompt-file'`를 넣고 근거 주석(도움말 원문, 측정일)을 단다. 실행: `npx vitest run test/grok-cli.test.ts` / 기대: PASS.

### Task 1.3: `--memory-flush`의 1.0.92 의미를 다시 잰다 (A63)

**Files:** `mcp-server/src/grok-cli.ts:356-372`(A63 주석·`memoryFlushRun`), `docs/specs/grok-cli-contract.md` §16

- [x] **Step 1:** 1.0.92 도움말은 "Wait for memory capture before a headless run exits"다. A63을 잰 방식(쿼터를 쓰지 않는 버릴 홈, 404를 답하는 루프백)으로 `--memory-flush` 단독·`-c --memory-flush`·`--memory-flush sessions list`를 다시 잰다.
- [x] **Step 2:** 프롬프트 없이 모델에 요청이 가면 거절을 유지하고 근거를 1.0.92로 갱신한다. 가지 않으면 거절이 허위 차단이 됐는지 판단해 테스트로 고정한다(결과에 따라 새 결함 번호는 `CLAUDE.md`의 다음 번호부터).

### Task 1.3b: A80·A81·A82·A83 — grok_cli의 기록, 끝에 선 프롬프트 플래그, 1.0.92의 숨은 플래그 (TDD)

A83(머지 전 검토, 2026-11-28 실측): 1.0.92의 숨은 플래그를 clap에게 가르게 해(계약 §16 — 방법과 목록) `grok-cli.ts` 표에 분류하고
(`-f`는 `prompt-flags.ts`의 `BOOLEAN_SHORTS`에도, `--workspace`는 훅의 `runFolder`), `bareGrokPrompt`는 표에 없는 플래그가 첫 단어
앞에 있으면 거부한다(그 플래그의 두 읽기를 흉내 내던 규칙은 검토마다 구멍이 나와 버렸다). 미리보기(`promptGrokSends`)는
`parseGrokArgs`의 `positionalAt`으로 원래 인자를 한 번만 읽는다(`-w -p Fix it` → "Fix it").

**Files:** Modify `mcp-server/src/prompt-flags.ts`(`extractPromptRun`, `mayRunTurn`, 새 `promptFlagTakes`·`trailingPromptFlag`), `mcp-server/src/grok-cli.ts`(`parseGrokArgs`가 읽는 새 `PROMPT_VALUE_FLAGS`, 새 `promptFlagBeforeSeparator`·`promptRunOf`와 그것을 쓰는 거부 규칙 셋, 새 `promptGrokSends`, `runGrokCli`의 `promptRun`), `mcp-server/src/server.ts`(기록); Test `mcp-server/test/server-tools.test.ts`, `mcp-server/test/grok-cli.test.ts`, `mcp-server/test/hook-e2e.test.ts`

**Interfaces:** Produces — `extractPromptRun(args): { prompt: string; at: number; valueAt: number; file: boolean } | undefined`(위치는 플래그 토큰과 값 토큰; 떨어진 다음 토큰이 있는데 플래그가 그것을 받지 않으면 `prompt: ''`·`valueAt: at`이고 여전히 정의된다 — 인증 훅 `mayRunTurn`이 그것으로 막는다; `-p`·`--single`·`--print`로 인자가 끝나면 지금처럼 undefined다 — 파일 형태는 값이 없어도 정의된다; leaf 모듈 유지), `export function trailingPromptFlag(args): number | undefined`(prompt-flags.ts — 인자를 끝내는 `-p`(스위치 묶음 끝 포함)·`--single`·`--print`의 위치; `mayRunTurn`이 그것도 센다 — A82), `promptRunOf(args, parse)`(grok-cli.ts — `extractPromptRun`의 결과, 없으면 첫 위치 인자가 프롬프트 단어일 때의 끝 플래그; `--` 뒤·모르는 플래그 뒤·서브커맨드 뒤·단어 없음은 아니다), `promptFlagBeforeSeparator(args, parse): boolean`(grok-cli.ts — 거부 규칙 셋이 `--` 앞만 잘라 읽지 않고 전체 인자에서 `promptRunOf`의 위치로 판단한다: 잘라 읽으면 `-p -- Say`가 홀로 남은 `-p`가 된다), `export function promptFlagTakes(next: string | undefined): boolean`(prompt-flags.ts — 떨어진 다음 토큰이 `-`로 시작하지 않거나 `-` 하나일 때만 값; `parseGrokArgs`도 이것으로 `-p`·`--single`을 읽는다), `export function promptGrokSends(args: string[]): string | undefined`(새 함수 — `promptRunOf`의 플래그 값과 그 플래그·값을 뺀 위치 인자를 명령줄 순서대로 공백 하나로; 빈 값은 넣지 않는다; 파일 형태와 `--` 뒤의 플래그는 예전대로).

- [x] **Step 1:** A80 행 — 1.0.92에서 잰 모양 그대로(아래 모두 2026-11-28 실측: `--single Say ok.`·`Say --single ok.`·`--single Say -- ok.`·`-p Say it ok.`·`-pSay ok.`·`--single=Say ok. --always-approve`·`--print Say ok.` → 보낸 질의, `--single= Say` → "Say", `-p --always-approve Say`·`--single --output-format json Say` → "Say", `-p -- Say --output-format json` → "Say --output-format json"), 기록된 `prompt`가 그 질의와 같다. A81 행 — `-vp x y`·`-p x --version`·`--help -p x`·`-p --help`·`--single --version`·`-cp --help`는 `promptRun`이 없고 git도 돌지 않는다. `--` 바로 앞의 프롬프트 플래그(`-p -- Say`·`--memory-flush -p -- x`·`-p --`)는 v0.2.54처럼 프롬프트 실행이다(거절되지 않는다). A82 행 — `Say -p`·`Say --single`·`Say --print`·`Say ok. -p`·`--memory-flush Say -p`는 spawn되는 프롬프트 실행이고 기록은 그 단어("Say"·"Say ok."), 인증 훅 번들은 `Say --single`·`Say --print`·`Say -p`를 막는다(auth.json 없이 deny); `-p`·`--single`·`--memory-flush -p` 단독은 지금처럼 거절, `sessions search -p`는 기록 없음, `-- Say -p`는 거절. 기대 FAIL.
- [x] **Step 2:** 구현 → PASS. `mayRunTurn`의 판정이 바뀌는 것은 인자를 끝내는 `--single`·`--print`뿐이다(더 막는 쪽 — 옛 훅 번들은 `Say --single`을 막지 않았다). 배포 번들로 전후를 잰다(쿼터 0).

### Task 1.4: 드리프트 릴리스

- [ ] **Step 1:** 버전 자리 전부 범프(CONTRIBUTING "Release" 1 — `src/version.ts` 폴백 포함), 릴리스 노트 `docs/releases/v<버전>.md`, `npm run build`, `node .claude/tools/accept-release.mjs --repo` 전부 PASS.
- [ ] **Step 2:** Grok 반증(CLAUDE.md 5번, `STATIC ANALYSIS ONLY`, effort low — 실행 전 비용을 밝히고 묻는다), `maintainer-preflight`, draft PR, CI 2개 녹색.
- [ ] **Step 3:** 오너 머지 승인 → squash → **즉시** 태그·릴리스 → dist blob = 태그 blob → 클론 먼저 설치본 갱신 → 캐시 = 태그 blob → `accept-release`(레포·캐시) → `docs/09` §5 기록 PR(마지막 칸은 새 세션 몫).

## PR 2 — MCP v2 이중 계열 (v2 릴리스)

### Task 2.1: 의존성 교체·Node 하한·Node 안내 (TDD)

**Files:** Modify `mcp-server/package.json`(deps·devDeps·`engines`), `mcp-server/package-lock.json`(`npx npm@11`); Create `mcp-server/src/node-guard.ts`; Test `mcp-server/test/node-guard.test.ts`

**Interfaces:** Produces — `export function nodeTooOld(version: string): string | undefined`(20 미만이면 한 줄 안내 문구, 아니면 `undefined`), 모듈 최상위에서 `process.versions.node`로 부르고 문구가 있으면 `console.error` 후 `process.exit(1)`. `src/index.ts`의 **첫 import**로 평가된다.

- [ ] **Step 1:** 테스트 — `nodeTooOld('18.20.4')`는 `Node 20` 이상이 필요하다는 한 줄(줄바꿈 없음)을, `nodeTooOld('20.0.0')`·`nodeTooOld('22.18.0')`은 `undefined`를 돌려준다. 실행 `npx vitest run test/node-guard.test.ts` / 기대 FAIL.
- [ ] **Step 2:** 구현 → 같은 명령 / 기대 PASS.
- [ ] **Step 3:** 의존성 교체(`@modelcontextprotocol/sdk` 제거, `server`·`client` 추가), `engines` `>=20`. 락파일 전후 대조: 추가·제거된 패키지 목록을 기록(`hono`·`@hono/node-server`가 빠지는지 확인), `npm audit` 0.

### Task 2.2: `serveStdio` 진입점과 서버 import

**Files:** Modify `mcp-server/src/index.ts`(진입점), `mcp-server/src/server.ts:17`(import), `mcp-server/src/server.ts:170-172`(워커 래퍼 타입)

**Interfaces:** Consumes — `serveStdio(factory: McpServerFactory, options?: ServeStdioOptions): StdioServerHandle`(`@modelcontextprotocol/server/stdio`), `McpServer`(`@modelcontextprotocol/server`). `buildServer`의 시그니처는 바꾸지 않는다.

- [ ] **Step 1:** `npm run typecheck` / 기대: import 실패로 FAIL(이전 전 확인).
- [ ] **Step 2:** import를 바꾸고 `index.ts`를 `serveStdio(() => buildServer(mode, defaultServerDeps, { insideWorker }))`로. 워커 래퍼의 `Parameters<…>[1]`는 폐기 예정 오버로드를 잡지만 타입체크를 통과하고 실행은 값의 모양으로 갈린다(2026-11-28 실측) — 그대로 두고 이유를 주석으로 남긴다; 워커 안 거절은 `worker-guard.test.ts`(번들, 원시 2025-06-18 `initialize`)가 지키고, 2026 계열은 Task 2.3이 더한다.
- [ ] **Step 3:** `npm run typecheck`·`npm test` / 기대: 남는 실패는 Task 2.3이 옮길 SDK 경로 테스트뿐.

### Task 2.3: 테스트 이전과 이중 계열 번들 테스트

**Files:** Modify `mcp-server/test/server-tools.test.ts`(`Client`·`InMemoryTransport`를 `@modelcontextprotocol/client`에서 — 쌍의 두 쪽을 같은 패키지에서), `mcp-server/test/stdio-limit.test.ts`(두 계열); Create `mcp-server/test/dual-era-bundle.test.ts`

**Interfaces:** Produces — 빌드한 `dist/index.js`를 띄워 v2 `Client`로 접속하는 공유 도우미 `connectBundle(era: 'legacy' | 'modern')`(테스트 도우미 모듈 — 진행 기록의 판단): legacy는 기본 연결(2025), modern은 `versionNegotiation`을 `2026-07-28`로 **고정**(`auto`는 탐색이 애매하면 조용히 2025로 떨어진다 — 리뷰)하고 `getProtocolEra()`가 `'modern'`인지 확인한다.

- [ ] **Step 1:** 테스트(빌드 후 실행) — 두 계열 모두: `tools/list`가 같은 9개 이름·같은 입력 스키마, **도구 9개 전부**가 같은 결과 모양(`isError`·`mode`·`billing`)이다 — grok을 띄우는 것(delegate·plan·verify·grok_cli)은 테스트용 가짜 grok으로, 나머지는 쿼터 0 경로로. 없는 도구는 JSON-RPC `-32602`, `.strict()`의 모르는 키는 `isError`에 키 이름 포함, 워커 안(`GROK_BUILD_WORKER=1`)에서는 두 계열 모두 아홉 도구가 거절된다. 서버가 광고하는 capabilities를 두 계열에서 고정한다(v1도 `tools.listChanged: true` — 차이가 없을 것으로 예측 — 2025는 `initialize` 결과, 2026은 `server/discover` 결과를 v1 번들의 값과 나란히).
- [ ] **Step 2:** Review Focus 1–3·5의 테스트 — `probe sibling leaves nothing`(탐색용으로 띄웠다 닫은 프로세스가 위임 이력 줄·임시 파일을 남기지 않음), `legacy 2024-11-05 opening`(원시 `initialize` `protocolVersion: '2024-11-05'` → 성공), `stdin EOF mid-delegation`(가짜 grok이 잠든 사이 stdin을 닫으면 서버가 끝나고 가짜 grok도 정리됨 — 지금 v1 번들에서 먼저 재서 기대값을 정한다), `stdio-limit` 두 계열.
- [ ] **Step 3:** `npm run build && npm test` / 기대: 전부 PASS, `dist/index.js`·`dist/hook.js`를 언급하는 테스트 파일 11개(셋은 주석에서만) 그대로 녹색.

### Task 2.4: 원시 프레임 두 계열 — `rpc-era.mjs`, 채점기, `mcpcall`

**Files:** Create `.claude/tools/rpc-era.mjs`; Modify `.claude/tools/accept-release.mjs`, `.claude/tools/mcpcall.mjs`; Test `mcp-server/test/accept-release.test.ts`(있는 파일), `mcp-server/test/rpc-era.test.ts`

**Interfaces:** Produces — `export async function openSession(child, era)`(`era`: `'legacy' | 'modern'`) → `{ request(method, params): Promise<unknown>, era }`. legacy는 지금의 `initialize`(`2024-11-05`) + `notifications/initialized`, modern은 2026-07-28 명세(<https://modelcontextprotocol.io/specification/2026-07-28>)의 stdio 오프닝. Node 내장 모듈만.

- [ ] **Step 1:** `rpc-era.test.ts` — 같은 번들에 `openSession(…,'modern')`과 `connectBundle('modern')`(2026-07-28 고정)으로 채점기의 검사 전부를 각각 돌려 판정이 모두 같다(원시 구현이 SDK와 같은 판정을 내는지 — 두 호출만 대조하면 부족하다, 리뷰). 기대 FAIL.
- [ ] **Step 2:** 구현 → PASS.
- [ ] **Step 3:** `accept-release.mjs`가 검사 전부(2026-11-28 실행 16행)를 계열마다 돌린다. A21은 `isError && text.includes('totally_bogus') && /unrecognized_keys|Unrecognized key/` — 새 문구도 이 식에 맞는지 v2 번들로 실측하고, 맞지 않으면 두 문구를 모두 받는 식으로. 옛 번들에서는 modern 행을 "이 판은 받지 않음"(실패 아님)으로. 실행: `node .claude/tools/accept-release.mjs --repo`(새 번들) 와 `node .claude/tools/accept-release.mjs`(설치된 v0.2.54 캐시) / 기대: 둘 다 exit 0, 옛 캐시 채점 행은 지금과 같다.
- [ ] **Step 4:** `mcpcall.mjs`에 `--era legacy|modern`(기본 legacy). 머리의 "실제 쿼터" 경고는 그대로.

### Task 2.5: CI에 Node 20

**Files:** Modify `.github/workflows/ci.yml`, `mcp-server/test/ci-workflow.test.ts`

브랜치 보호 규칙이 필수 체크를 이름으로 `mcp-server (ubuntu-latest)`·`mcp-server (windows-latest)` 둘로 고정하고(2026-11-28 실측), 잡 이름은
`mcp-server (${{ matrix.os }})`다 — 행렬에 Node 버전을 더하면 두 ubuntu 잡이 같은 필수 체크 이름을 나눠 갖는다(GitHub의 이름 규칙에서 읽은 것,
재지 않았다). 어느 잡이 그 체크를 채우는지 모호해지므로 Node 20은 **별도 잡**(필수 아님)으로 더한다; 필수로 올리는 것은 오너 몫이다.

- [ ] **Step 1:** `ci-workflow.test.ts`가 ci.yml에서 무엇을 읽는지 확인하고(리뷰: `node-version`은 읽지 않는다 — 326행은 테스트 안의 예제),
  새 잡이 기존 규칙(`npm ci --ignore-scripts`, 레지스트리 tarball만 등)을 지키며 두 필수 체크 이름이 그대로인지를 테스트로 먼저 고정한다. 기대 FAIL.
- [ ] **Step 2:** `ci.yml`에 Node 20 잡(ubuntu, 단위 테스트·타입체크) 추가 → PASS. PR에서 새 잡이 실제로 돌고 필수 체크 둘이 그대로 보고되는지 확인.

### Task 2.6: 제3자 라이선스 고지

**Files:** Modify `mcp-server/build.mjs`(esbuild `metafile`로 번들에 들어간 패키지 목록 → 각 패키지의 `package.json`·LICENSE 파일 → `dist/THIRD_PARTY_NOTICES.md`를 정렬된 결정적 순서로), `.github/workflows/ci.yml`(dist 검사에 이 파일 포함); Create `mcp-server/test/third-party-notices.test.ts`

v2 SDK 패키지는 제3자 코드(ajv·ajv-formats·fast-uri·json-schema-traverse·fast-deep-equal·content-type 등)를 **자기 dist 안에 묶어**
배포한다(`//#region …/.pnpm/<패키지>@<버전>` 표식 — 리뷰). 우리 번들에서는 그 코드가 `// node_modules/@modelcontextprotocol/server/…`
표식만 달고 들어오므로, 메타파일과 `node_modules` 표식만 보면 둘이 같이 틀린다. v2 SDK 자체는 Apache-2.0이다.

**Interfaces:** Produces — `mcp-server/dist/THIRD_PARTY_NOTICES.md`: 패키지마다 이름·버전·SPDX 라이선스·라이선스 전문(Apache-2.0이면 그 패키지의 NOTICE도) — `node_modules` 표식의 패키지와, 그 패키지 dist의 `//#region` 표식이 밝히는 묶인 패키지 모두.

- [ ] **Step 1:** 테스트 — 고지 파일의 패키지 집합 = 두 번들의 `// node_modules/<pkg>` 표식 + 번들에 들어간 SDK 파일의 `//#region` 표식에서 뽑은 집합, 각 항목에 라이선스 전문이 있다. 기대 FAIL.
- [ ] **Step 2:** 구현 → PASS. 두 번 빌드해 고지 파일이 바이트까지 같은지(결정적) 확인.

### Task 2.7: 문서

**Files:** `CLAUDE.md`(코딩 컨벤션의 SDK 줄, 컴포넌트 지도), `docs/01-architecture.md`, `docs/03-plugin-spec.md`, `docs/04-mcp-server-spec.md`(없는 도구 → `-32602`, 검증 오류 문구, 두 계열), `docs/08-getting-started-with-grok.md`(Node 20), `CONTRIBUTING.md`·`.claude/skills/maintainer-preflight/SKILL.md`(SDK·hono 언급)

- [ ] **Step 1:** 고친 뒤 `npm test`(`claude-md-claims` 포함) 녹색, CLAUDE.md 200줄 이내.

### Task 2.8: 실측 매트릭스 (설계 §6.7의 13행)

- [ ] **Step 1:** 쿼터 0 행부터(#1–#5, #7, #11–#13): win32와 Docker `node:20`(Linux)에서. Node 20 최저판·Node 18은 스크래치의 휴대용 Node로.
- [ ] **Step 2:** 쿼터를 쓰는 행(#6, #8–#10) — 실행 전에 예상 사용량(Grok 약 11턴, Claude 소량)을 다시 밝히고 시작한다. #8은 스크래치의 스파이 래퍼(받은 첫 프레임과 기동 시각을 파일에 적고 실제 번들로 넘기는 stdio 중계)로.
- [ ] **Step 3:** 각 행의 숫자를 릴리스 노트에 적는다(측정 시각·환경·명령·결과). 예측이 틀린 행은 설계 문서 §6.4·§6.7에 실측으로 고친다.

### Task 2.9: v2 릴리스

- [ ] **Step 1:** 버전 자리 범프, 릴리스 노트(Node 20 상향을 맨 위 경고로), `npm run build`, `accept-release --repo` 두 계열 PASS.
- [ ] **Step 2:** 리뷰(`docs/11` 규율 — 시작 전 비용을 밝히고 묻는다), Grok 반증, `maintainer-preflight`, CI(Node 20 잡 포함) 녹색.
- [ ] **Step 3:** 오너 머지 승인 → squash → 즉시 태그·릴리스 → Task 1.4 Step 3과 같은 수락 순서 → `docs/09` §5 기록 PR. 새 세션의 마지막 칸에서 Claude Code가 어느 계열로 붙었는지 함께 적는다.

## PR 3 — README 개편 (문서, v2 릴리스 뒤)

### Task 3.1: README 표–코드 대조 테스트 (TDD)

**Files:** Create `mcp-server/test/readme-tables.test.ts`

- [ ] **Step 1:** 테스트 — README.md·README.ko.md 각각: 명령 표의 `/grok:<이름>` 집합 = `commands/*.md` 27개, 도구 표 = 등록된 도구 9개, 요구 사항 표의 Node 하한 = `mcp-server/package.json` `engines`의 하한, 프로토콜 표에 `2025-11-25`와 `2026-07-28`. 기대 FAIL(지금 README에는 그 표가 없다).

### Task 3.2: 그림

**Files:** Create `docs/images/hero-light.svg`, `docs/images/hero-dark.svg`(머리 배너, `<picture>`로 나눔), `docs/images/status-dashboard.svg`(실제 `grok_build_status` 출력을 그대로 옮긴 터미널 그림 — 출력 텍스트는 실행에서만 얻는다), 구조도·위임 순서도는 README 안의 Mermaid

- [ ] **Step 1:** SVG는 손으로 쓴 정적 SVG(외부 글꼴·스크립트 없음), 밝은·어두운 둘 다 대비 확인.

### Task 3.3: README.md·README.ko.md 재작성

- [ ] **Step 1:** 설계 §6.8의 뼈대로 영문을 쓰고 한글을 같은 뼈대로. 각 주장(명령 수·도구 수·과금 동작·지원 프로토콜)은 코드·실측과 대조. 실행 `npx vitest run test/readme-tables.test.ts` / 기대 PASS.

### Task 3.4: 렌더링 확인

- [ ] **Step 1:** `gh api -X POST markdown`으로 표·제목·취소선(`del` 0) 수를 센다.
- [ ] **Step 2:** 브랜치의 README를 GitHub 페이지(공개, 로그인 불필요)에서 브라우저로 열어 밝은·어두운 테마(`prefers-color-scheme` 에뮬레이션) 스크린샷 — Mermaid가 그려지는지, 배너가 테마를 따르는지. 그다음 리뷰 → 오너 머지.
