# Plan: v0.2.38부터 — fast-uri 보안 패치와 열린 결함 A50–A57·A59

> **열린 계획 — 2026-09-30 작성.** 오너 지시(원문): "머지해주시고 나머지 작업은 다음세션에서 할수 있게 정리해주세요". 머지한
> 것: #155(ip-address 락파일, 번들 밖) → `ea0d317`. 그 직후 Dependabot이 #157(fast-uri)을 열었다.
> 이 문서는 `CLAUDE.md` 현재 상태의 "다음 할 일" 줄이 가리킨다. 순서·방법·완료 조건의 **권고**다 — 결함의 사실은 `docs/10` A와
> 계약(`docs/specs/grok-cli-contract.md`)이 원천이라 가리키기만 한다(행 번호는 `ea0d317` 기준). 착수는 오너 승인 후이고, 머지는
> `CLAUDE.md` 7단계(오너 squash-merge)대로다. 오너 판단의 원천은 `docs/09` §4 F와 A 항목의 "오너 판단" 문장이다 — 일하다 새 판단이
> 생기면 여기가 아니라 그곳에 먼저 적는다.
> 항목이 나가면 `docs/10`에서 지우고 아래 "나간 것"에 적는다. 다 나가거나 버려지면 "SHIPPED — 이력 문서. 실행하지 말 것."으로 바꾼다.

**나간 것:** fast-uri(v0.2.38), A50(v0.2.39)

## 먼저 읽을 것

- 루트 `CLAUDE.md` "작업 수행 방법"(8단계)과 근거 `docs/11`("8번"·"5번 조리법"). 아래는 항목마다 다른 것만 적는다.
- `docs/10` A와 B7·B8·B9. 계약: §1 ③(A59) · §6 마지막 항목(A50) · §7 D(A56) · §9(A57) · §10 "플러그인의 감지"의 "놓치는 것
  하나"와 "1.0.44 재측정 — 새 자격 env는 없다"(A51) · §11(A54·A55) · §12(A53) · §13(A54) · §15(A52). 절마다 유효 버전이 다르다.
- `docs/09` §4 F(오너 판단)·§5(수락), `CONTRIBUTING.md` "Release"·"Dependabot", `.claude/skills/repo-scope`·`maintainer-preflight`.
- 착수 전 `npm run probe:contract`(쿼터 0) — `drifted`와 `snapshotBehindLatest`를 둘 다 본다. grok이 1.0.44를 떠났으면 그 항목의
  계약 절부터 다시 잰다.

## 릴리스 묶음과 순서 (권고)

PR 하나 = 릴리스 하나. squash PR을 쌓지 않는다 — 다음 브랜치는 앞 릴리스 태그 뒤의 `main`에서 딴다(`delegate.ts`는 다섯 항목이
고친다). 범프는 릴리스마다 한 번이고, `src/version.ts` 범프만으로 두 dist가 바뀌므로 범프 **뒤에** 빌드해 둘 다 커밋한다(CONTRIBUTING "Release").

| 순서 | 묶음 | 이유 |
|---|---|---|
| 1 | fast-uri → **v0.2.38** | 착수 승인 말고는 걸리는 판단이 없고 작다. 공개된 권고가 걸린 코드가 배포 번들에 들어 있다. 벤더 hunk가 A 수정의 dist diff에 섞이지 않는다(v0.2.6·v0.2.15도 의존성만 따로 냈다) |
| 2 | A50 | 피해 1순위. `docs/10` A50이 적은 대가(plan이 읽기 셸도 못 쓴다)를 받아들일지는 착수 승인과 따로 묻는다(아래 A50) |
| 3 | A51 | `config-keys.ts` 하나. 차등 비교 하네스를 다시 만드는 비용이 가장 크다 |
| 4 | A52 + A57 | 둘 다 `grok_cli` 표면이고 `commands/cli.md`를 같이 고친다 |
| 5 | A59 | `runDelegate` 끝과 배포 프롬프트 12곳. 세션 폴더를 찾는 헬퍼를 만들고 A53이 그것을 쓴다 |
| 6 | A54 + A55 + A53 | A53·A54는 `ClassifyCtx`·`classifySpawnResult`를, A55는 `annotateResumedCwd`를 고치고 A54의 거부 신호를 쓴다. 나눠야 하면 A54+A55 먼저 |
| 7 | A56 | 문자열 하나와 문서. `commands/setup.md`가 A50과 겹친다 |

줄이려면 겹치는 파일이 적은 묶음끼리 합친다. 다만 PR이 클수록 머지 전 검토 회차가 늘었다(v0.2.36: 12건에 27회차, `docs/09` §5).

**공통 함정.**
- 사용자 문구에 "grok X.Y는 …한다"를 단정하지 않는다. 파일·fixture를 셸 문자열로 만들지 않는다(Edit/Write; 코드 포인트는
  `String.fromCharCode` — Edit/Write가 역슬래시-u를 푼다).
- `CLAUDE.md`는 200줄 상한(`claude-md-claims.test.ts`)이라 교체로 고친다. 새로 이름 대는 경로·식별자는 그 테스트가 실재를 본다.
- esbuild는 문자열의 비ASCII를 `\uXXXX`로 이스케이프한다(정규식 리터럴의 한글은 그대로 남는다) — 한글 메시지 문구를 dist에서
  grep하면 0이라 아무것도 증명하지 않는다.
- `SessionsIndex`를 주입하지 않은 테스트는 실제 grok 홈을 읽는다.
- 고친 항목의 번호와 옛 문구는 손 목록이 아니라 트리 전체 grep으로 찾는다(`git grep -nE '\bA5[0-79]\b'` + 항목별 옛 문구).

## 후보 — 재지 않았다

- **`accept-release`의 A11 칸이 옛 번들에서 쿼터를 쓸 수 있다.** `mcpSession()`은 부모 env를 그대로 넘기고, A11 칸은
  `grok_cli ["sesions"]`를 보낸다. A11을 고친 v0.2.21 전의 캐시를 채점하면 그 번들은 grok을 띄운다. A52의 측정대로라면 대화형 UI가
  그 맨 단어를 모델에 보낼 수 있다. 이것은 파일 머리 주석과 `docs/09` §5a의 "구독 쿼터를 쓰지 않는다 — 수정 전 번들을 채점할
  때도 그렇다"와 어긋난다. 합성 세션과 401 루프백으로 옛 태그의 dist를 재 보고, 재현되면 `docs/10`에 다음 A 번호(지금 A60)로 연다.

## fast-uri 3.1.8 — v0.2.38

- **요지** 사용자에게 보이는 변화는 없다. 번들에 들어 있는 fast-uri 3.1.7에 GHSA-hrr3-gc8f-f4qj(moderate, 3.1.8에서 고침)가 걸려
  있다. 제품 결함이 아니라 `docs/10`에 넣지 않는다. 원천: Dependabot 경보 #30, PR #157(락파일 세 줄, ubuntu "Verify dist is up to
  date" 빨강), `npm audit`.
- **도달 경로** SDK의 Server 생성자가 시작 때 Ajv를 만든다(dist `new AjvJsonSchemaValidator()`). 그래서 fast-uri는 정적 스키마
  id에서 돈다. `getValidator`를 부르는 `elicitInput`은 `src/`가 쓰지 않는다. 릴리스 노트에 "닿지 않는다"고 쓰지 말고, 공격자가 준
  URI가 판단에 쓰이는 경로가 없다고 쓴다(v0.2.6 노트의 판단).
- **바꿀 곳**(순서대로) `main`에서 자기 브랜치 → `git fetch origin pull/157/head` → `git cherry-pick -n 5cb3637`(락파일 세 줄) →
  `npm ci` → `npm run build` → `git diff --exit-code -- dist/`(빨강; CI처럼 `mcp-server/` 안에서 — 거기서 `mcp-server/dist/`로 쓰면
  아무것도 안 잡혀 조용히 exit 0이다) → `package.json`만 범프 → `handoff-version`·`plugin-surface`(빨간 목록 = 범프할 자리) → 나머지
  버전 자리(CONTRIBUTING "Release" 1단계 표와 그 아래 문단: 락파일 두 곳·`docs/03`·CHANGELOG) → `npm test`·`npm run typecheck` →
  `npm run build` → dist 둘 다 커밋. 같은 PR에서 CONTRIBUTING "Dependabot"과 `.claude/skills/maintainer-preflight`의 "Dependency PRs
  (Dependabot)"을 고친다 — 둘 다 PR 브랜치에서 재빌드해 push하면 사람은 검토하고 머지만 하면 된다고 했다. preflight는 바로 아래 절("If the
  rebuild changed `dist/` for end users")이 범프·릴리스 노트를 이미 요구하니 범프 규칙은 다시 적지 말고 그 절을 가리킨다. 재빌드가
  dist를 바꾸면 릴리스라 자기 브랜치에서 "Release"대로 범프·태그한다(선례 #75 → v0.2.15, 아래 함정).
- **먼저 빨간 것** 유닛 테스트는 없다(산출물로 증명 — v0.2.15). 위 순서의 두 빨강이 그 증거다.
- **쿼터 0 재현** `npm audit`(1 → 0), `grep -c "node_modules/fast-uri"`(index 6·hook 0), 3.1.8에만 있는
  `normalizePercentEncoding(host.toLowerCase())`가 `dist/index.js`에서 0 → 1(고정 문자열로 센다 — `grep -cF`; `grep -E`·`rg`(Grep
  도구)로 세면 괄호가 그룹이 되어 패치 뒤에도 0이다).
- **함정** #157 브랜치에 재빌드만 얹으면 다른 번들이 0.2.37로 나간다 — v0.2.37까지의 CONTRIBUTING "Dependabot"·preflight
  "Dependency PRs"대로 하면 그렇게 된다. 자기 브랜치로 하는 이유: squash 설정(`COMMIT_MESSAGES`)은 Dependabot 커밋 본문을 `main`에
  남긴다(#155도 자기 브랜치였다). 맨 npm(10.9.3)으로 `npm install`·`npm update`를 돌리지 않는다 — `update … --package-lock-only`도
  락파일의 `libc` 블록을 지운다(#155 커밋 메시지). cherry-pick이면 락파일을 만들려고 npm을 부를 일이 없다(`npm ci`는 락파일을 쓰지 않으니 위
  순서대로 돌린다 — 빠뜨리면 남은 3.1.7로 빌드될 수 있다). dist는 `git diff`로 본다(Windows의 `git status`는 CRLF 때문에 거짓이다).
- **완료 조건** 락파일 diff = fast-uri 세 줄 + 루트 버전 두 곳. `npm audit` 0, 표식 1, 경보 #30 fixed, #157 닫힘(Dependabot이 안
  닫으면 닫는다), 릴리스 수락(아래 완료 조건).

## A50 — plan이 허용 규칙대로 쓰기·push를 한다

- **요지** `docs/10` A50, 계약 §6 마지막 항목. **번들 영향** `dist/index.js`. **오너 판단** 최소 수정의 대가를
  받아들일지(`docs/10` A50) — 착수 승인과 따로 묻는다.
- **바꿀 곳** `delegate.ts`: `NO_COMMIT_PROMPT_SUFFIX` 옆에 plan 전용 상수(`--deny Bash --deny Edit --deny Write --deny MCPTool(*)`,
  근거 계약 §1·§6)를 두고 `runDelegate` argv(1275행)의 `--permission-mode plan` 바로 뒤에 싣는다. 비 plan 경로와 탐지(`planWrote`·
  지문·`committed`·`PLAN_WROTE_MESSAGE`)는 그대로 둔다. 문구: `docs/10` A50이 나열한 곳 전부(사람 승인 게이트 여섯 곳에는 "plan
  결과의 `planWroteFiles`·`committed`가 true면 이미 바뀐 것" 한 줄), README 두 판의 plan 행(README.md 210행·README.ko.md 208행 — "허용
  규칙을 따른다"가 틀리게 된다), `types.ts` 92행, `docs/04` 240행과 §2b, `SECURITY.md`, `docs/06` 82행, `docs/11`, `CLAUDE.md`의 plan
  줄, 계약 §6. "래퍼는 막지 않는다"는 주석: `delegate.ts` 1221–1226·980–991행, `delegate.test.ts` 1265–1268행, 번들에 남는
  `server.ts` 283–292행. 마무리는 트리 grep이다.
- **실패 먼저 쓸 테스트** `delegate.test.ts` — plan argv의 8토큰을 **리터럴**과 비교한다(상수를 import하면 오타가 양쪽에 들어가도
  녹색이다). fresh·resume·continue·`sandbox`·`worktree`·`--prompt-file` 분기 전부. delegate·verify에는 `--deny`가 없고
  `--always-approve`가 있다. 빨강이어야 할 변이: `bash`·`Bsh`, 규칙 하나 빼기, `--disallowed-tools`, 비 plan에 싣기.
- **쿼터 0 재현** 가짜 모델(아래 측정 도구), 버릴 홈(`[ui] permission_mode = "always-approve"`, arm마다
  `<home>/.claude/settings.json`의 허용 규칙), bare 원격, PATH 앞의 가짜 `gh`, 가짜 stdio MCP. arm: push·`gh api`·MCP / `Write` /
  `git commit` / 읽기 셸. 판정은 부수 효과로 한다.
- **함정** 규칙 이름은 대소문자를 가리고 틀리면 조용히 버려진다. `--tools`·`--agent`·`--disallowed-tools`는 저마다 열린 쪽으로
  실패한다(계약 §1). 문구는 "막는다"가 아니라 "규칙을 넘긴다"로 쓴다 — push·`gh`·MCP 효과는 탐지에 안 보이고, 규칙 밖 도구는 재지 않았다
  (`docs/10` A50). worktree arm은 짧은 루트에서 돌린다(긴 경로면 취소돼 수정 효과처럼 보인다 — §6). `Read`는 거부하지 않는다.
  하위 에이전트에 미치는 효과는 세션 로컬 증거에만 있다 — 1단계에서 다시 재서 계약 §6 "닫는 옵션"에 먼저 적는다. `--deny`를
  모르는 옛 grok에서 plan이 어떻게 되는지는 재지 않았다 — 옛 버전의 `--help`를 컨테이너에서 재고, 지원 범위에 없으면 오너에게
  가져간다.
- **완료 조건** 1번에서 push arm이 A50 증상을 다시 낸다 → 빌드 뒤 원격 ref·`gh`·MCP 0, `Write` 파일 없음, HEAD 불변, 읽기 셸 거부,
  `read_file` 성공. 옛 문구 grep 0, 탐지 코드 diff 없음. Grok 반증 주장: "plan spawn만, 모두, 네 규칙을 정확한 철자로 싣는다".

## A51 — `billingCaveat`이 `[model_providers]` 상속을 놓친다

- **요지** `docs/10` A51, 계약 §10 "놓치는 것 하나". **번들 영향** `dist/index.js`만(hook은 import하지 않는다). **오너 판단** 없음 —
  `docs/09` §4 F "`billingCaveat`이 보지 않는 경로"와 caveat의 "그 모델로 도는" 절(`docs/10` A51 "함께 볼 것", B7의 벽)은 앞지르지 않는다.
- **바꿀 곳** `config-keys.ts`만. `Reader.record`(252행)가 `model_providers/<id>/api_key`(그 자리에서 `nonEmpty`로)·`env_key`와
  `model/<id>/model_provider`(문자열만)도 기록한다. `liveModelCredentials`는 제공자 표를 Map으로 한 번 만들고, 모델마다 자기 자격증명을
  먼저 보고 없으면 1단계에서 잰 규칙대로 물려받는다. **응답 필드는 더하지 않는다** — `ModelCredential`은 `billingCaveat.models[]`로
  응답에 나가므로(`docs/04`) 제공자 이름은 메시지에만 싣는다(`via`·`envVar`는 지금 뜻 그대로 쓴다). 해결책 문구에
  `[model_providers."…"]`(id도 `clipName`), 머리 주석의 "the one metered path". 문서: 계약 §10, `docs/specs/2026-09-24-config-model-keys-billing-caveat.md`,
  caveat을 모델 자신의 키로만 설명하는 곳(트리 grep `billingCaveat`).
- **실패 먼저 쓸 테스트** `config-keys.test.ts` — 1단계의 `config.toml` 그대로(제공자 `api_key`, 설정된 변수의 제공자 `env_key`)면
  caveat이 제공자를 말하고 값은 없다. 보고하지 않음: 참조되지 않는 제공자·설정되지 않은 변수·구독 모드가 지우는 변수. 114–118행의
  루트·깊이 가드는 같은 힘으로 다시 쓴다. 빨강이어야 할 변이: `record` 되돌리기, 링크 무시, `buildGrokEnv` 없이 판정, 모델마다 재탐색.
- **쿼터 0 재현** 플러그인 쪽은 spawn이 없다 — 버릴 홈에 가짜 키 `config.toml`과 `syntheticAuth`를 두고 `grok_build_status`.
  grok 쪽 상속 규칙은 루프백(주 턴 추론에만 401, 나머지 404)과 디버그 로그의 `model_byok`로 잰다(계약 §10 "1.0.44 재측정"의 방법).
  `env_key`가 가리키는 변수 이름은 부모 env에 없는 것으로 짓는다(예: `PROBE_PROVIDER_KEY`) — `isolatedGrokEnv`는 `GROK_*`·`XAI_*`
  밖의 부모 변수를 그대로 넘기므로, 이름이 겹치면 실제 키가 루프백 캡처에 평문으로 남는다. 설정된 arm은 overrides로 가짜 값을 준다.
- **함정** 섞인 모양(모델의 설정 안 된 `env_key`나 빈 `api_key` + 제공자 키, 둘 다 있을 때, 따옴표 없는 점 id)은 코드보다 먼저
  재서 계약 §10에 적는다 — 추측하지 않는다. 판독기는 모든 spawn 전과 status에서 동기로 돈다(선형, `readRegularFileCapped` 유지). 고치면
  차등 비교를 축을 넓혀 다시 돌린다(`CHANGELOG.md` v0.2.33 "판독기를 고칠 때 다시 돌리는 법"; 비교용 파서는 스크래치에만).
- **완료 조건** v0.2.37 status는 두 모양에 caveat이 없다 → 새 번들은 메시지에 제공자를 대며 보고하고 값은 없다. 루프백 delegate는
  caveat을 싣되 막히지 않고, 이력 행에는 caveat이 없다. 차등 비교 불일치 0.

## A52 — `grok_cli`로 게이트도 기록도 없는 턴이 돈다

- **요지** `docs/10` A52, 계약 §15 마지막 항목. **번들 영향** `dist/index.js`(`dist/hook.js`는 버전 리터럴뿐). **오너 판단** 최소
  수정에는 없다. 넓히려면(프롬프트 없는 대화형 실행 — `-w <이름>`·`-r`·`-c`·`--always-approve` 단독 — 도 거부) 오너에게 묻고 `docs/10`
  A52에 판단 문장부터 적는다.
- **바꿀 곳** `grok-cli.ts`. 권고안은 `unknownGrokSubcommand`(140행)만 쓰는 정밀 파서다. 표는 1.0.44 `grok --help`에서 옮긴다 —
  불리언, 값이 선택인 플래그(`-r`/`--resume`·`-w`/`--worktree`), 짧은 글자, 별칭. 스냅샷의 `flags`는 긴 이름만 있고 짧은 글자·별칭·값
  여부가 없으므로, 테스트는 스냅샷의 긴 이름이 표 하나에만 있는지만 본다. 값이 선택인 플래그는 다음 맨 토큰을 먹는다(서브커맨드
  이름이어도 — §15). 그래도 불확실하면 알려진 서브커맨드가 있을 때만 물러난다. `blockedGrokWord`·`keepsHead`는 지금의 느슨한
  `grokPositionals`에 둔다 — 불확실하면 위치 인자를 전부 훑는 거부 목록이 닫힌 쪽으로 실패해야 한다(`BLOCKED_WORDS`·`NON_HEADLESS`
  주석). `docs/10`의 "`grokPositionals`에서"와 다른 것은 그래서다 — 커밋 메시지와 릴리스 노트에 적는다(squash 메시지는 커밋
  메시지로 만들어져 PR 본문은 `main`에 남지 않는다). A11 메시지(481행)는 실측대로 고치고, 모르는
  플래그와 먹힌 값을 이름으로 말한다. 반증된 말을 되풀이하는 주석: `VALUE_FLAGS`(27–33행 "fails CLOSED"), `unknownGrokSubcommand` JSDoc
  (128–138행), A11 주석(471–473행), `grok-cli.test.ts` 36–38·110–112행. 문서: `commands/cli.md` 9–15행, `docs/04` §5, `server.ts`의
  `grok_cli` 설명, `docs/11` 60행, `probe-contract-drift.mjs` 367행.
- **실패 먼저 쓸 테스트** `grok-cli.test.ts` — `docs/10` A52의 args와 변형(`--worktree`·`-wfeat`·`-r worktree create`, 앞의
  `--continue`)이 spawn 없이 `blocked`. 계속 spawn: `["-w","feat","-p","say ok"]`·`["worktree","create"]`, 알려진 서브커맨드가 뒤에 있는
  불확실 파싱. 1003–1009행은 뒤집고, 43–47·106–115행(거부 목록 바닥)은 그대로. 빨강이어야 할 변이: `-r`/`-w`가 값을 안 먹음, 물러남 되살리기.
- **쿼터 0 재현** `throwawayHomeEnv` + `syntheticAuth` + 모두 401인 루프백 + 버릴 git 폴더로 띄운 `mcpcall.mjs call grok_cli`(짧은
  `timeout_ms`). 볼 것: status·`promptRun`, 이력 행, 세션 기록의 `<user_query>`, 요청의 `x-grok-client-mode`, `<home>/worktrees`와
  `git worktree list`. `-r`·`-c` arm은 이어갈 세션을 먼저 만든다. ⚠️ 실제 env로 넣으면 옛 번들이 실제 턴과 worktree를 남긴다.
- **함정** 새 표는 손으로 유지된다. `parseFlags`는 이름만 봐서 값 여부가 바뀌어도 드리프트가 안 뜬다. `prompt-flags.ts`는 리프로 둔다.
  `KNOWN_SUBCOMMANDS`·`NON_HEADLESS`·`--debug-file`은 그대로다(B8, `docs/09` §4 F).
- **완료 조건** 빌드 뒤 A52 페이로드 전부 `blocked`이고 루프백 요청·세션·worktree·이력이 0이다. 대조군(`-p "say ok"`는 `promptRun`과
  이력 1, `sessions list`는 `ok`)은 그대로다.

## A59 — 아주 긴 프롬프트가 가운데가 빠진 채 `completed`로 끝난다

- **요지** `docs/10` A59, 계약 §1 ③. **번들 영향** `dist/index.js`. 배포 표면·문서도 같은 릴리스로. **오너 판단** 거절 여부(`docs/10`
  A59) — 최소 수정은 경고뿐이고 status·`isError`·이력은 그대로다.
- **코드 전에 잴 것** ① 99,977바이트를 grok이 공백을 깎기 전에 세는지 뒤에 세는지 — 계약 §1 ①은 깎는다고만 말한다. fixture에
  U+FEFF·U+0085·U+200B를 넣는다. ② POSIX — 이 크기는 argv에 들어가 `--single=`로 가고(`promptFitsArgv`), Linux·macOS의 오프로드는
  재지 않았다. Docker(계약 §13)로 재기 전에는 POSIX에 노트를 싣지 않는다. 둘 다 계약 §1 ③에 먼저 적는다.
- **바꿀 곳** `delegate.ts`: export하는 순수 함수(`platform` 인자). 경계, win32 경로 한계 259(`WIN32_CWD_MAX`처럼 허용 최대), 노트
  문구를 담는다. 노트는 `runDelegate` 끝(1318행) 결과에만 `joinMessage`로 싣는다. 그 실행의 `<세션 폴더>/prompts/prompt_0.txt`가
  디스크에 있을 때만 싣고, 길이도 그 경로로 잰다 — 세션을 만들지 못한 결말(A53의 모양)에는 오프로드가 없었다. 세는 대상은 접미사를
  붙인 `prompt`(1250–1252행)다. 세션 폴더는 `grokHomeFor(env, effectiveCwd)`에서 raw 이름으로 찾는다(헬퍼는 `resolveSessionCwd` 옆,
  A53과 공유). 배포 프롬프트 12곳(`plugin-surface.test.ts`의 `REPORTS_A_RESULT`)은 completed의 `message`를 `committed: true`일 때만
  보여 준다(`commands/plan.md`는 `planWroteFiles`가 없을 때도) — "있으면 보여 준다(경고)"로 바꾸고, `docs/04` 성공 출력과 `docs/07`도
  고친다.
- **실패 먼저 쓸 테스트** `delegate.test.ts` — 접미사 포함 99,976/99,977바이트, 깎이는·안 깎이는 앞 공백(1단계대로), 한글 3바이트,
  259·260 양쪽(1단계에서 잰 홈·폴더 이름·id, 퍼센트 인코딩된 raw 이름 그대로). `runDelegate`: 99,977은 completed에 message가 붙고,
  spawnError와 시작 전 거부(깨진 `config.toml`, 1 ms 캡)의 100 KB 프롬프트에는 붙지 않는다. win32 전용은
  `it.skipIf(process.platform !== 'win32')`, 12곳의 문장은 `plugin-surface.test.ts`. 빨강이어야 할 변이: 노트 호출 삭제, `>=`→`>`,
  259↔260, `trim()`, UTF-16 `.length`, `input.prompt`로 셈, 존재 확인 빼기.
- **쿼터 0 재현** 짧은 버릴 루트에 `isolatedGrokEnv`(HOME·USERPROFILE·APPDATA·LOCALAPPDATA·TEMP·TMP), 길이 조절용 `GROK_HOME`은
  따로, `syntheticAuth`. 루프백은 받은 `<user_query>`의 줄 번호와 안내 종류를 Responses SSE로 되돌린다. 번들 호출은 인자를 파일에서
  읽는 `mcpcall.mjs` 사본으로 한다(원본은 argv라 win32 명령줄에 약 100KB를 못 싣는다). 두 번째 방법은 디렉터리 워크로 잰 경로 길이다.
  259/260 경계는 원시 grok으로 쟀고, 번들 실행은 긴 작업 폴더(286·309자 경로)로 쟀다.
- **함정** 12곳을 안 고치면 사용자는 경고를 못 본다. 경계가 글자 수 단위라 CI Windows 러너의 8.3 TEMP에 걸린다 — 경계는 합성 경로
  문자열로 순수 함수에 고정하고, 실제 폴더를 쓰는 win32 테스트는 grok에 넘긴 문자열 그대로 잰다(`realpathSync.native`와 섞지 않는다).
  폴더 이름을 계산하면 `docs/09` §4 F 첫 행과 겹친다. resume 턴의 파일 이름은 재지 않았다. 해결책으로 `GROK_HOME` 변경을 권하지
  않는다(세션이 그 홈에 있다 — 계약 §8).
- **완료 조건** 빌드 뒤 같은 페이로드: 99,976은 message 없음, 99,977의 짧은 경로·259는 일반 경고, 260 이상은 "가운데가 닿지 않았다"와
  그 길이. 래퍼가 말한 길이 = 디렉터리 워크로 잰 길이. 시작 전 거부에는 노트가 없다.

## A57 — `grok_cli` 안내가 확인 플래그를 잘못 가르친다

- **요지** `docs/10` A57, 계약 §9. **번들 영향** 버전 리터럴뿐이지만 배포 표면이라 범프한다(캐시는 버전 키 — `docs/releases/v0.2.16.md`).
  **오너 판단** 없음. 확인 플래그 없는 파괴적 서브커맨드를 `grok_cli`가 거절하게 하는 것은 새 표면이라(`repo-scope` E) 오너 목표가 먼저다.
- **고치기 전에 잴 것** 이 항목은 독립 재도출이 없었다(`docs/10` A57) — 문구를 고치기 전에 두 번째 방법(새 하네스나 Linux
  컨테이너)으로 단일 플러그인 uninstall을 다시 잰다. 재도출되지 않으면 멈춘다.
- **바꿀 곳** 문서만. `commands/cli.md`의 `cancelled` 불릿(19–25행): "§9 lists them"을 지운다. 확인 프롬프트는 안전장치가 아니니
  지우기·설치·설정 변경은 **보내기 전에** 범위를 확인하고, 플래그를 대신 붙이지 않는다(예: `plugin uninstall`). `commands/memory.md`:
  `memory-v2/` 위치와 `--all -y`의 삭제 범위(재지 않은 `--global` 단독은 주장하지 않는다). 계약 §9 끝에 포인터.
- **실패 먼저 쓸 테스트** `plugin-surface.test.ts` — cli.md가 프롬프트 없이 도는 예와 사전 확인을 말하고 "§9 lists them"이 없다.
  memory.md가 `memory_v2`와 `topics/`·`observations/`·`archive/`를 말한다. `POINTS_ONLY`의 cli.md 분류 문장은 남긴다.
- **쿼터 0 재현** auth.json 없는 `throwawayHomeEnv` 홈(`isolatedGrokEnv`만으로는 홈이 옮겨지지 않는다 — 아래 측정 도구의 격리
  확인을 먼저 통과한 뒤): 버릴 플러그인을 `grok --no-auto-update plugin install <폴더> --trust`로 넣고 번들로
  `grok_cli ["plugin","uninstall","<name>"]` → `ok`, `cancelled` 없음, `plugin list --json`에서 사라짐. `memory_v2`는
  `[memory_v2] enabled = true`로 레이아웃을 만든 뒤 `--all -y`. ⚠️ 격리 없이 돌리면 실제 플러그인·메모리가 지워진다.
- **함정** "`-y` 없이 한 번 보내 보라" 같은 안내는 금지다 — 프롬프트에 기대는 것 자체가 결함이다. `--debug-file`을 끼우지 않는다.
- **완료 조건** 4단계에서 바뀌는 것은 grok 동작이 아니라 문서다 — 빨강→초록은 `plugin-surface.test.ts`의 새 단언이고, 같은
  페이로드의 `ok`는 그대로여야 한다(달라지면 계약 §9부터 다시 잰다). 8단계에서 1번 재현과 두 번째 방법을 머지 뒤 다시 친다.

## A53·A55 — 시작도 못 한 실행을 시작한 것처럼 말한다

- **요지** `docs/10` A53(계약 §12 마지막 항목)과 A55(계약 §11 1.0.44 항목). **번들 영향** `dist/index.js`. **오너 판단** 없음 —
  이미 기록된 dangling id 정리와 A54의 전용 문구는 선점하지 않는다.
- **코드 전에 잴 것** A53의 시작 전 모양 하나(예: 깨진 `config.toml`)를 폴더를 옮긴 resume에서 재서, 거기에도 "그 디렉터리에서
  작업했습니다"가 붙으면 A55의 신호 집합을 넓히거나 다음 A 번호로 연다(R2-D1은 프로필 불일치만 쟀다). 세션 로컬 증거에는 `docs/10` A53에
  없는 다섯 번째 모양(모르는 `model` — "Couldn't set model", 세션 없음)이 있다 — 다시 재서 맞으면 A53에 더한다.
- **바꿀 곳** `delegate.ts`. A53: `SessionsIndex` 옆에 존재 판정을 둔다. 모든 인코딩 폴더에서 `sessionDirHasId`로 보고, decode는
  하지 않는다(decode가 실패하면 undefined인 `resolveSessionCwd`는 쓰지 않는다). `--session-id`는 그대로 넘긴다.
  `ClassifyCtx.mintedSessionId`(594행)는 필요할 때 한 번 확인하는 클로저로 바꾼다. 그래서 `handle`(889–892행)과 `timeoutMessage`(905행)가
  세션 폴더가 있을 때만 id를 쓴다(봉투에 sid가 있으면 색인을 안 읽는다). A55: "시작 전 거부"를 계산한다(`!timedOut`, 빈 stdout,
  A54와 한 상수인 stderr 신호). 그러면 `annotateResumedCwd`(1341행)가 `resumedCwd`와 안내를 싣지 않는다. 문서: `docs/04`의 두 필드
  정의, 계약 §11–§13의 귀결 문장.
- **실패 먼저 쓸 테스트** `delegate.test.ts`. A53: 시작 전 네 모양(깨진 `config.toml`, 시작 전 캡, 갱신 실패 봉투, Linux 거부) × 빈
  색인이면 결과와 `buildHistoryEntry`(history.ts)에 id도 resume 약속도 없다. 세션을 만든 색인이면 id가 남는다(B1). `latestResumableSession`
  (usage.ts — `usage.test.ts`)은 앞선 진짜 세션을 고른다. 새 id는 `randomUUID`라 spawn 인자에서 잡는다(980·1013행 테스트처럼).
  A55: 계약 §11의 거부 문장이면 안내가 없고 `buildHistoryEntry`에도 `resumedCwd`가 없다. 대조군(캡, 취소 봉투, stdout에만 있는 문장,
  앞선 다른 stderr 줄)은 유지된다. 980·1013·1371·1382·1745행 테스트는 색인을 주입한다. 빨강이어야 할 변이: `handle`만 막기, 즉시
  확인(2063행이 잡는다), status만 보고 끄기, 빈 stdout만으로 끄기, 앵커 없음.
- **쿼터 0 재현** arm마다 새 버릴 홈 + `syntheticAuth` + 커밋 하나 있는 저장소. A53: `timeout_ms: 1`, 깨진 `config.toml`,
  `syntheticAuth(now-3600)`, 대조군은 유효한 합성 토큰이다. 응답·이력·`lastSession`·`<GROK_HOME>/sessions/*/<id>`를 본다. A55: 한
  저장소의 `sandbox:"workspace"` 세션을 다른 저장소에서 `sandbox:"read-only"`로 resume한다(delegate·plan). sandbox 없는 대조군은 맨 뒤에.
- **함정** 세션 레이아웃은 이 레포 소유가 아니다(계약 §12) — B1 핸들도 거기 기대게 되고, 레이아웃이 바뀌면 핸들이 조용히 사라진다.
  B1의 전제(캡으로 죽은 실행도 세션이 남는다)는 1.0.30에서만 쟀다 — 가짜 모델로 실행 도중 캡을 쳐서 1.0.44에서 먼저 확인한다.
  A55를 status나 빈 stdout만으로 끄지 않는다(부분 편집을 남긴 timeout·취소에는 안내가 필요하다 — 1603행 테스트는 커밋하고 exit 1로
  끝난 실행이라 timeout·취소 대조군을 따로 둔다).
- **완료 조건** 시작 전 arm의 응답·이력·`lastSession`에 id와 resume 약속이 없고, 대조군과 실행 도중 캡은 그대로다. 거부된 resume에는
  `resumedCwd`가 없고 시작한 resume은 그대로다. 이미 기록된 dangling id가 남는다는 것은 릴리스 노트에 적는다.

## A54 — 샌드박스 안내가 원인을 짚지 못한다

- **요지** `docs/10` A54 ①②③, 계약 §11·§13의 1.0.44 항목. **번들 영향** `dist/index.js`. **오너 판단** 없음 — 세션 프로필 자동
  주입, `GROK_SANDBOX` 제거(B4 판정), 응답의 출처 필드, config 값 읽기는 선점하지 않는다.
- **바꿀 곳** `delegate.ts`의 메시지만(argv·env 그대로). `classifySpawnResult`의 파싱 실패 분기(auth → A33 → 일반)에서 auth 다음,
  A33 앞에 resume 불일치 분기를 둔다(resume·continue일 때만). 신호 `cannot resume this session under sandbox profile`은 stderr 머리에
  앵커한다(`m` 플래그 금지 — A33 초판의 오탐, CHANGELOG v0.2.31). 두 프로필을 뽑는 순수 함수는 A55와 공유한다.
  `sandboxRefusalMessage`(90행, 지금은 고정 문구)는 사유(모르는 프로필·bubblewrap 없음·namespace 거부) + 출처 + 해결로 조립한다.
  출처는 요청 `sandbox` → env `GROK_SANDBOX`(`ClassifyCtx`에 두 값) 순이다. 둘 다 없을 때만 남은 후보로 `config.toml`의
  `[sandbox] profile`을 경로로만 댄다 — 값은 읽지 않는다(②③의 stderr는 프로필을 말하지 않는다). 문서: A33 머리 주석, `docs/04`
  203–206행, 계약 §11·§13.
- **실패 먼저 쓸 테스트** A33 describe(2092행) 뒤 — stderr는 1단계 원문, env는 늘 명시한다. ①은 세션 프로필·받은 값·출처와
  `sandbox: "<세션 프로필>"`을 말하고, `off`는 세션이 `off`일 때만 권한다. ②③은 출처·사유가 섞이지 않는다. 다른 줄 뒤의 같은 문장은
  A54가 아니다. A33 루프의 bubblewrap 두 arm은 실측대로 env `GROK_SANDBOX=workspace`를 넘긴다. 모르는 프로필 arm의 fixture는 원시
  grok에서 떴고 출처가 기록되지 않았다 — stderr가 말하는 이름(`zzz-not-a-profile`)을 요청이나 env 한 곳으로 넘기고 그 출처를
  단언한다. 빨강이어야 할 변이: resume 분기 삭제, 해결책을 늘 `off`로, env가 있으면 요청 무시, 사유 순서 바꿈, `^` 제거나 `m` 추가.
- **쿼터 0 재현** win32는 `throwawayHomeEnv` + 호출마다 `syntheticAuth`: `read-only` 세션 생성 → resume + env
  `GROK_SANDBOX=workspace`(거부) → + `sandbox:"read-only"`(401까지 감) → + `sandbox:"off"`(거부) → env 없이. ②③은 Docker(계약 §13
  "재현 환경", 레포 `:ro`): bwrap 없이 config·env·요청 출처별로, bwrap은 있고 `--privileged` 없이 root·uid 1000으로, 모르는 프로필.
- **함정** 확인하지 않은 원인을 단정하지 않는다(A33이 고친 모양). 메시지가 기대는 실측(플래그가 env를 이긴다, resume은 `off`도
  거부한다, `GROK_SANDBOX=off`가 config를 이긴다)은 계약에 먼저 옮긴다 — A54를 지우면 "②③에서는 `off`가 통한다"도 레포에서 사라진다.
  `<cwd>/.grok/config.toml`은 적용되지 않았다(§13). Linux 하네스의 경로 변환·인자 키 오타 선례는 CHANGELOG v0.2.31.
- **완료 조건** 빌드 뒤 두 거부 arm은 세션 프로필·받은 값·출처를 말하고 `off`를 권하지 않는다. ②③은 출처별·사유별로 맞고, 대조군은 그대로다.

## A56 — grok이 받지 않는 `auth.json`에 "준비됨"이라고 한다

- **요지** `docs/10` A56, 계약 §7 D. **번들 영향** `dist/index.js`·`dist/hook.js` 둘 다(문자열). **오너 판단** `docs/09` §4 F
  "`auth.json` 내용을 읽을지" — 이 수정은 문구만 바꿔 선점하지 않는다.
- **바꿀 곳** `auth.ts` `checkAuth` 105행의 구독 ok 메시지만 — "세션 파일이 있다, 검증하지 않았다"(A13 api 문구의 틀). `ok: true`는
  그대로 두고, 85–92행 감사 주석을 구독까지 넓힌다. `commands/logout.md` 8행, (권장) `commands/setup.md` 29행·`server.ts` 190행.
  문서: `docs/04` §1에 `ok: true`의 뜻, 계약 §7 D와 `docs/09` §4 F의 A56 포인터(행은 남긴다).
- **실패 먼저 쓸 테스트** `auth.test.ts` — 계약 §7 D의 모양을 임시 `GROK_HOME`에 둔다: `ok === true`, message에 "검증"이 있고
  "준비됨"이 없다. 208행 `toBe`는 설계상 깨진다 — 의미로 다시 쓴다. `relative-home-e2e.test.ts`(이미 `{}` auth.json을 쓴다)에 커밋된
  번들 대상 describe(`ready`·hook 허용 불변). `status.test.ts` 12행의 제품 문자열은 stub으로. `plugin-surface.test.ts`: logout.md.
  기존 가드 `spawn-safety.test.ts` "auth.json is existence-checked only"는 그대로 둔다.
- **쿼터 0 재현** `throwawayHomeEnv` 홈에 모양별 auth.json → `grok_auth_check`·`grok_build_status`(grok을 띄우지 않는다), `dist/hook.js`에
  PreToolUse 페이로드. 대조군: 파일 없음 → `not_logged_in`·deny.
- **함정** 파일 내용을 읽거나 `ok`를 false로 바꾸지 않는다 — 정책이다(`docs/02` 정책 3·5). 메시지는 두 번들에 다 들어간다.
- **완료 조건** 빌드 뒤 같은 모양에서 `ok: true`·`ready: true`와 새 문구, hook 허용과 대조군은 그대로다.

## 측정 도구

2026-09-30 측정의 증거와 하네스는 **레포에 없다** — 그 세션의 스크래치에만 있고 사라질 수 있다. 있으면 참고하고, 없으면 아래처럼
레포 스크립트로 다시 만든다. 위치: `%TEMP%/claude/d--Source-claude-grok-build-plugin/c40e820d-eeba-4e85-aa57-f9c4f3941fea/scratchpad/`
아래 `grok144/evidence/`의 트랙별 폴더 — A50 `R2-P1`·`R2-P2`, A51 `R2-B1*`, A52 `R2-D5`, A53 `R2-D3`, A54 `R2-D2`·`T7`, A55 `R2-D1`,
A56 `R2-D6`, A57 `R2-C1`, A59 `B8-now`. 항목별 분석 원본은 `handoff/`, 통과 가짜 grok은 `r4-fakegrok/`(둘 다
`grok144/evidence/`가 아니라 스크래치 바로 아래).

| 하네스 (세션 로컬) | 한 일 | 다시 만드는 법 |
|---|---|---|
| 합성 세션 | 사전 확인과 grok의 세션 시작만 통과시키고 첫 모델 요청은 401 | `mcp-server/scripts/synthetic-auth.mjs`의 `syntheticAuth(만료 초)`·`isolatedGrokEnv`·`throwawayHomeEnv`. `isolatedGrokEnv`는 부모의 `GROK_*`·`XAI_*`를 전부 지운다 — `GROK_BUILD_AUTH_MODE`·`GROK_SANDBOX`·`GROK_BIN_DIR`이 필요하면 overrides로 다시 넣는다. 쓰는 예 `probe-expired-session.mjs`·`worker-marker-probe.mjs` |
| 루프백 | `GROK_XAI_API_BASE_URL`·`GROK_CLI_CHAT_PROXY_BASE_URL`을 127.0.0.1로 돌려 요청을 받아 적는다 — 모두 401(A52·A53), 주 턴에만 401(A51), 받은 것을 SSE로 되돌림(A59) | 계약 §10 "1.0.44 재측정 — 새 자격 env는 없다"의 방법. `isolatedGrokEnv`의 overrides로 넣는다 |
| 가짜 모델 `R2-P2-plan-mitigations/mock-model.mjs` | chat-completions 서버가 대본대로 도구 호출을 강제한다(제공하지 않은 도구도) — 권한 계층(A50), 실행 도중 캡(A53의 B1 대조) | 버릴 홈의 `config.toml`: `[models] default = "mock"`, `[model.mock]`에 `model = "mock-model"`·`base_url`(루프백 `/v1`)·`name`·가짜 `api_key`·`api_backend = "chat_completions"`·`context_window` |
| 긴 경로 러너 `B8-now/` | `GROK_HOME` 길이로 오프로드 파일 경로 259·260자를 만들어 번들로 위임(A59) | 위 셋 + 인자를 파일에서 읽는 `mcpcall.mjs` 사본. 사본은 `SERVER` 경로(스크립트 기준 `../../mcp-server/dist/index.js`)와 `./rpc-timeout.mjs` import를 고쳐야 한다 |
| 통과 가짜 grok `r4-fakegrok/FakeGrok.cs` | 진짜 grok 앞의 래퍼 — 인자를 적고 넘기되 `--no-auto-update` 거부·`--help` 실패를 흉내 냈다(`probe:contract` 실패 경로, A58) | win32에서는 `.exe`여야 한다(Node는 셸 없이 `.cmd`를 못 띄운다) — .NET `csc`로 컴파일해 `GROK_BIN_DIR`이나 PATH 맨 앞에 `grok`으로 둔다 |

- 격리부터 확인한다: auth.json 없이 `grok_auth_check`가 거절하고, `grok inspect --json`의 `permissions.sources`에 스크래치 경로만
  있다. 실제 `~/.grok`·`~/.claude`와 `grok login`/`logout`은 금지다.
- `mcpcall.mjs`는 부모 env 전체를 서버에 넘긴다 — 격리 env로 띄운다. 격리 없는 delegate·plan·verify·프롬프트 있는 `grok_cli`는
  실제 쿼터를 쓴다. grok을 PATH로 못 찾으면 `GROK_BIN_DIR`(바이너리 폴더만)을 overrides에 넣는다.
- grok은 401 뒤 합성 auth.json을 지운다 — 호출마다 다시 쓰고, 통제군 없이 "차이 없음"으로 닫지 않는다(CHANGELOG v0.2.31). 디버그
  로그는 가짜 값을 평문으로 남기니 스크래치에만 둔다. Linux는 Docker(계약 §13). 실쿼터가 꼭 필요한 곳은 5단계 Grok 반증(`effort: low`)
  이다 — 1단계를 실모델로 재야 하면 작게 한다.
- 같은 하네스를 매번 다시 만들기 싫으면 가짜 모델을 `mcp-server/scripts/`에 올리는 것도 방법이다 — 새 코드라 검토가 따로 필요하다.

## 오너 판단 (다음 세션이 정하지 않는다)

- 착수 승인(`docs/10` A 머리말, `.claude/skills/repo-scope`)과 릴리스 묶음·번호 — 위 순서는 권고다. 머지는 `CLAUDE.md`
  7단계(오너 squash-merge)대로다.
- `docs/09` §4 F의 모든 행(목록과 개수는 그곳이 원천이다).
- A 항목 안의 판단: A59 거절(`docs/10` A59), A56의 파일 내용·이력 판정(`docs/09` §4 F), A50 최소 수정의 대가를
  받아들일지(`docs/10` A50).
- 일하다 새로 생기는 판단(A52를 프롬프트 없는 대화형 실행까지 넓히기, A57의 파괴적 서브커맨드 거절, A51·A54·A59·B4에 응답 필드
  더하기 등)은 오너에게 묻고, 정해지면 `docs/10`의 그 항목이나 `docs/09` §4 F에 먼저 적는다. 최소 수정은 응답 필드를 더하지 않고,
  새로 알릴 것은 `message`에 싣는다.
- 환경이 있어야 재는 것: B7·B9는 오너의 실세션(컨테이너 전용 로그인)이 필요하다 — A51 caveat의 "그 모델로 도는" 절도 같은 벽이다.
  B8은 진짜 grove(Linux FUSE·macOS NFS·Client-ProjFS를 켠 win32)가 필요하다. B는 할 일 목록이라 환경을 만들 수 있으면 지금 잰다.

## 완료 조건

- 항목마다 `CLAUDE.md` 8단계를 다 밟는다 — 1번이 재현되지 않으면 멈추고, 숫자가 바뀐 것을 보기 전에는 고쳤다고 말하지 않는다.
  머지 전 검토는 수정 커밋마다 다시 한다.
- 고친 항목은 `docs/10`에서 지우고 머리 건수·닫힌 목록·방법 문단을 고친다. 그 항목을 가리키던 포인터(`SECURITY.md`, `docs/04`,
  `docs/09` §4 F, 계약 각 절, 설계 문서)는 새 동작이나 릴리스 노트로 옮긴다 — 잡는 테스트가 없으니 트리 grep으로. 새 결함은
  `CLAUDE.md`가 말하는 다음 번호(지금 A60)로 열고, 같은 PR에서 그 줄을 올린다.
- spawn 없이 재는 수정에는 `accept-release` 칸을 더한다(선례: `docs/09` §5 v0.2.35의 "새 `A36` 칸"). A51(status caveat)·A56(`{}`
  auth.json의 `grok_auth_check`)이 그렇다. A52는 옛 번들이 spawn하므로 칸을 만들지 않는다(위 후보).
- 릴리스마다 `CLAUDE.md` 현재 상태의 "릴리스 수락"과 CONTRIBUTING "Release"를 그대로 밟는다 — 순서·칸, 릴리스 노트 한도와 링크
  규칙은 그곳이 원천이다.
- `docs/09` §5 실행 기록과 수락 CHANGELOG는 수락이 끝난 뒤에 쓰고, 실제로 한 것만 적는다.
- 이 계획: 나간 항목을 머리의 "나간 것"에 적고, 다 끝나면 SHIPPED 주석을 단다. 릴리스마다 `CLAUDE.md` 현재 상태의 "다음 할 일"
  줄에서 나간 항목을 빼고, SHIPPED로 바꿀 때 그 줄도 바꾼다.
