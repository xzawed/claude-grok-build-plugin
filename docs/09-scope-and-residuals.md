# 09. 범위 · 잔여 · “다음 할 일”이 반복되는 이유

이 문서는 **이 저장소(claude-grok-build-plugin) 안에서 무엇이 끝났는지**,  
**왜 체크리스트에 항목이 계속 남아 보이는지**,  
**에이전트가 다음에 무엇을 하면 안 되는지**의 SSOT다.

진행 Phase 체크: `docs/06-roadmap.md`  
제품 왜: `docs/00-product-vision.md`  
세션 즉시 컨텍스트: 루트 `CLAUDE.md`

---

## 1. 한 줄 결론

**이 플러그인 레포의 의도된 제품 범위(다리 + 협업 표면 + first-mile + 소비자 계약/키트)는 완료다 (최신 릴리스 `v0.2.42`).**  
남아 있는 문구는 “미구현 기능 백로그”가 아니라 **다른 레포 / 사람 손 / 의도적 보류**다.

> ⚠️ **범위가 끝난 것과 고장난 데가 없는 것은 다르다.** 2026-09-05 기능 감사(배포 번들 53개
> 항목 실행 + 독립 재실행)가 **열린 결함 20건**을 찾았다. 그 목록은
> **`docs/10-service-audit-queue.md`** 가 SSOT다 — 이 문서의 “polish 금지”는 그 큐에 적용되지
> 않는다. 큐에 있는 것은 발명된 일이 아니라 실측된 고장이다.

**Ship 상태 (핸드오프):** 배포 버전의 SSOT는 `mcp-server/package.json`이고, GitHub Releases
Latest는 그 버전의 태그여야 한다 — 확인은 `gh release list`. 이 줄에 버전을 박아두지 않는 이유는
그렇게 했을 때 두 번 연속으로 낡았기 때문이다 (릴리스를 끊기 전에 이미 끊은 것처럼 적혀 있었다).
이용자: marketplace 갱신 후 `claude plugin list` → enabled, `/grok:status`의 `serverVersion`이
`package.json` 버전과 같은지 확인.

> 의존성 보안 패치는 **범위 재개가 아니다** — 제품 표면은 그대로다. 배포물 위생은 상시 유지보수이고,
> 여기서 "다음 할 일"이 생기지 않는다.

에이전트가 “다음 작업”을 물을 때마다 새 polish PR을 만드는 것은 **잔여가 끝나지 않아서가 아니라**,  
로드맵에 **이 레포 밖 항목**이 열려 있고, 세션이 그걸 다시 “할 일”로 해석하기 때문이다.

---

## 2. 왜 잔여가 반복적으로 남아 보이나

| 원인 | 설명 |
|---|---|
| **범위 경계 혼동** | “오케스트레이터 실배선”은 **소비자 레포** 작업이다. 이 플러그인은 MCP 계약·헬퍼·예제만 제공한다. 체크박스를 이 레포에서 영원히 못 닫는다. |
| **자동화 불가** | Claude Code **GUI** 설치·클릭 풀 e2e는 CI/헤드리스로 대체 불가. 프로세스 하네스 e2e(`hook-e2e`)까지가 이 레포 한계다. |
| **의도적 보류** | ACP 연동은 재검토 트리거 전까지 **보류** (Claude Code가 ACP 클라이언트가 아님). 미완 ≠ 다음에 구현. |
| **완료 정의 없음** | “다음 할 일” 문구만 있고 **done 조건**이 없으면, 에이전트는 매 세션 polish를 발명한다 (status, resume, review…). |
| **핸드오프 문구 관성** | `CLAUDE.md`에 같은 잔여 세 줄을 두면, 머지를 아무리 해도 **다음 세션도 같은 세 줄을 본다**. |

### 잔여 ≠ 기술 부채 전부

- **이 레포 기술 부채(닫을 수 있음):** 테스트·dist 동기·문서 불일치 → CI로 이미 상당 부분 게이트.
- **제품 백로그(새 기능):** 원할 때만 연다. 기본 상태는 “열지 않음”.
- **외부/수동/보류:** 체크리스트에 두되 **이 레포 PR로 닫지 않는다**.

---

## 3. 이 레포에서 완료된 것 (요약)

| 영역 | 상태 |
|---|---|
| Phase 1–3 안전 다리 (auth 투트랙, delegate/plan/verify, worktree, usage, hook) | ✅ |
| Phase 3.5 협업 표면 (routing skill, presets, session/resume, worktree lifecycle) | ✅ |
| Phase 4 라우팅 엔진 + nextAction + consumer kit + `/grok:review` | ✅ (실배선은 소비자) |
| Phase 5 first-mile (docs/08, tour, skills, agent) | ✅ |
| 신뢰 게이트 (CI Node 22, hook e2e, tool-surface, billingMismatch, version SSOT) | ✅ |
| 오너 목표 E: config.toml 모델별 키 경고 (`billingCaveat`, 막지 않음) | ✅ v0.2.33 (`docs/specs/2026-09-24-config-model-keys-billing-caveat.md`) |
| A35: 상대 경로 `GROK_HOME`을 grok처럼 grok의 작업 폴더 기준으로 (오너 선택 "grok과 같게 풀기") | ✅ v0.2.34 (계약 §8, `docs/releases/v0.2.34.md`) |
| A36: Windows에서 grok이 **여는** 이름으로 세션을 찾는다(점·공백 정규화), 끝 공백은 원인을 말한다 | ✅ v0.2.35 (계약 §8, `docs/releases/v0.2.35.md`) |
| A37~A48: 2026-09-25 전체 감사(SonarQube·Grok)가 찾은 12건 — 가림·prune·긴 프롬프트·타임아웃·정규식 등 | ✅ v0.2.36 (`docs/releases/v0.2.36.md`) |
| 같은 감사의 문서 항목 8건(아래 §4 E) + A49(커밋하고 실패한 실행·옮겨 간 resume가 커밋을 말하지 않았다) | ✅ v0.2.37 (`docs/releases/v0.2.37.md`) |
| A50: plan이 셸·편집·쓰기·MCP 거부 규칙을 넘긴다 — 사용자 허용 규칙이 승인한 쓰기·커밋·push·MCP 호출을 plan이 돌리던 것 | ✅ v0.2.39 (계약 §6, `docs/releases/v0.2.39.md`) |
| A51: `billingCaveat`이 `[model_providers.<id>]`에서 물려받은 키도 알린다 — 그 키로 요청이 나가는데 `billing: "subscription"`만 말하던 것 | ✅ v0.2.40 (계약 §10 "`[model_providers]` 상속", `docs/releases/v0.2.40.md`) |
| A52: `grok_cli`가 grok이 프롬프트로 읽을 맨 단어를 플래그 뒤에서도 spawn 없이 거부한다 — `-w`·`-r`·`-c`·`--always-approve`·`--` 뒤의 맨 단어가 인증 확인도 이력도 없는 대화형 턴이 되던 것 · A62: 숨은 `--print`(`-p`의 별칭) 프롬프트 실행도 hook이 막고 이력이 적는다 · A57: `/grok:cli`·`/grok:memory` 안내가 프롬프트 없이 지우는 서브커맨드와 `memory_v2`의 삭제 범위를 말한다 | ✅ v0.2.42 (계약 §9·§15·§16, `docs/releases/v0.2.42.md`) |
| 신뢰 게이트 v0.2.17 (툴 핸들러 in-memory e2e, 배포 프론트매터, 태그·릴리스 검사, marketplace.json) | ✅ |
| 플랫폼 실측 (Win32 핵심 경로, sandbox/unauth 문서화) | ✅ (GUI 클릭 e2e 제외) |

현재 버전 원천: `mcp-server/package.json` · `.claude-plugin/plugin.json` (일치 테스트 있음).

---

## 4. 남아 있는 항목 — 분류 (닫는 방법)

### A. 이 레포 밖 (소비자 / 다른 제품)

| 항목 | 닫는 방법 |
|---|---|
| 외부 Task Manager가 MCP를 **실제로** 호출·배포 | **오케스트레이터 저장소**에서 `docs/07` + `examples/orchestrator-consumer.md`를 구현·연동 PR |
| 특정 제품 monorepo에 플러그인 번들 정책 | 그 제품의 설치/릴리즈 파이프라인 |

→ 이 레포 체크박스: **“계약·키트 제공 완료”**. “실배선 완료”는 **소비자 레포 이슈**로 옮긴다.

### B. 수동 운영 (사람 + Claude Code UI)

| 항목 | 닫는 방법 |
|---|---|
| 마켓플레이스 설치 → `/grok:setup` → 샘플 위임 클릭 경로 | 아래 **수동 수락 체크리스트**를 릴리즈 때 1회 실행·기록 |
| 실제 SuperGrok 구독 환경 billing 확인 | 사람 계정으로 `/grok:status` + 1회 delegate |

→ “CI 녹색” ≠ “UI 클릭 검증”. 후자는 **릴리즈 의식**이지 무한 개발 백로그가 아니다.

### C. 의도적 보류 (재검토 트리거 전 구현 금지)

| 항목 | 재검토 트리거 |
|---|---|
| ACP 직접 연동 | Claude Code가 ACP **클라이언트**가 되거나, 오케스트레이터가 MCP 불가·ACP 전용, 또는 실시간 액션 승인이 필수 요건 |

상세: `docs/06-roadmap.md` Phase 4 Slice B ACP 절.

### D. 명시적 스코프 제외 (하지 않음)

자동 커밋/PR, 호출별 `authMode` 오버라이드 — `docs/06` · `docs/00`.

### E. 2026-09-25 전체 감사의 문서 항목 — v0.2.37에서 처리

감사는 코드 결함(A37~A48, v0.2.36)과 함께 **작업 문서**의 문제도 보고했다. v0.2.36 동안은 오너 결정을 기다렸고, 2026-09-28
오너의 "잔여 및 후속작업을 Grok과 함께 수행" 지시로 v0.2.37에서 모두 처리했다(무엇을 어떻게는 `docs/releases/v0.2.37.md`).
이 항목들을 고치다 코드 결함 하나(A49)를 더 찾았다.

| 항목 | 어디 | 결과 |
|---|---|---|
| 배포 프롬프트가 `resumedCwd`를, `/grok:plan` 밖에서는 `committed`를 보지 않는다 | `commands/`·`skills/`·`agents/` | ✅ |
| `inspect`가 "마지막 4,000자"라고 말하지만 코드는 앞부분을 남긴다 | `commands/inspect.md` | ✅ |
| worktree 안내에 `force` 게이트가 없다 | `commands/worktree.md` | ✅ |
| 서브에이전트에게 "승인을 기다리라"고 하고 `tools` 제한이 없다 | `agents/grok-worker.md` | ✅ (grok 도구를 이름으로 적은 허용 목록 — 서버 단위 패턴은 아무것도 풀지 못했고 거부 목록은 셸을 남겼다, 실측) |
| 영구적인 `billingMismatch`에 "멈춰라" | `skills/grok-routing`·`agents/grok-worker.md` | ✅ |
| `CLAUDE.md` 길이(목표 200줄)와 8a 절의 `git show origin/main:<path>`가 Git Bash에서 `.`로 시작하는 경로면 실패 | `CLAUDE.md` | ✅ (상세는 `docs/11`로 이관, 200줄 상한은 테스트가 본다) |
| "실행하지 말 것" 계획 문서가 실행 스킬을 필수로 단다 | `docs/plans/` | ✅ |
| `max_turns`·worktree `force` 필드가 명세에 없다 | `docs/04` | ✅ |

### F. 2026-09-30 grok 1.0.44 재측정이 남긴 오너 판단

결함 큐(`docs/10` A)에 넣지 않은 것들이다 — 결함이 아니거나, 고치려면 이미 정한 것을 뒤집어야 한다. grok 쪽 사실의 원천은
계약 `docs/specs/grok-cli-contract.md`의 해당 절이다 — 첫 행의 새 두 사실은 래퍼 쪽이라 그 행이 원천이다(grok 쪽 규칙 R2는 계약 §8).

| 항목 | 잰 것 | 정할 것 |
|---|---|---|
| 끝에 점·공백이 붙은 Windows 작업 폴더 | v0.2.35가 "하지 않는 것"으로 둔 거절이다(`docs/releases/v0.2.35.md`). 새로 잰 것: 거절 메시지가 경로도 끝 문자도 말하지 않아 없는 폴더와 같은 문장이다. `\\?\` 도구로 만든 `w.` 폴더가 `w` 옆에 있으면 확인은 grok이 쓰지 않는 폴더에서 통과한다(드물다). `grok_cli`도 같은 확인을 쓴다 | 그대로 둘지, 메시지가 원인을 말하게 할지, `env.ts`의 `win32FolderAsEntered`(계약 §8 R2)로 폴더를 풀지 |
| 절대 원칙 #1의 괄호와 커밋 문구 | "`--always-approve`가 없으면 아무 파일도 바꾸지 않는다"는 허용 규칙과 `[ui] permission_mode`가 없을 때만 참이다(계약 §6; 그 괄호의 `Cancelled`는 0.2.x 값이고 1.0.x는 `cancelled`다). "grok은 … 자동 커밋은 하지 않는다"도 grok이 실행 중 커밋할 수 있으니(A49, `committed`) 주어가 플러그인이어야 맞다 — README 두 판·SECURITY.md·`commands/tour.md`는 그렇게 고쳤다 | 원칙은 변경 금지라 문구를 오너가 정한다 |
| `auth.json` 내용을 읽을지 | grok은 `{}`·0바이트·잘린 파일을 "not authenticated"로 본다(계약 §7 D). 래퍼는 `docs/02` 정책 3·5대로 파일이 있는지만 본다 | `docs/10` A56의 최소 수정(문구)을 넘어 정책을 뒤집을지. 이력으로 not ready를 정하는 규칙은 모델 키만 거부된 경우(B7)에 멀쩡한 세션을 막을 수 있다 |
| `billingCaveat`이 보지 않는 경로 | 세션이 있으면 `managed_config.toml`·`requirements.toml`의 모델 키와 `extra_headers`·`env_http_headers`·`GROK_CONFIG` 오버레이의 `Authorization`이 제목 생성 요청에 실렸다. 세션이 없으면 `managed_config.toml`의 키는 주 턴에도 실렸다(계약 §10) | 설계 문서의 제외(조직 배포 계층, 미측정)를 이 사실 위에서도 유지할지 |
| `grok_cli`가 넘기는 `--debug-file` | grok은 그 로그에 자격증명을 평문으로 남긴다 — 무엇이 남는지는 계약 §10·`SECURITY.md` | 문서로 둘지(절대 원칙 #4의 "덮지 않는 것"에 더할지), `grok_cli`가 거부할지 |
| 프롬프트 없는 대화형 `grok_cli` 실행(A52 수정이 남긴 것) | A52의 수정은 프롬프트가 될 맨 단어만 막는다. `-w <이름>`·`--always-approve` 단독은 모델 요청 없이 캡까지 매달렸고 `-w`는 grok worktree를 남겼다 — grok 쪽 사실은 계약 §16 "프롬프트 없는 대화형 실행" | 이것도 spawn 없이 거부할지 — 막으려면 "프롬프트 없는 대화형 실행"을 인자에서 읽어 내는 규칙이 새로 있어야 한다 |

---

## 5. 릴리스 수락

### 5a. 헤드리스 수락 — 먼저 이것을 돌린다 (자동)

```bash
node .claude/tools/accept-release.mjs            # 설치된 플러그인 캐시를 채점
node .claude/tools/accept-release.mjs --repo     # 설치본 없이 이 레포의 dist를 채점
node .claude/tools/accept-release.mjs --version 0.2.21   # 특정 캐시 버전을 채점
```

**왜 아래 GUI 체크리스트보다 먼저인가:** 실행 중인 Claude Code 세션은 시작할 때의 MCP 프로세스를
물고 있다. 갱신 직후 GUI로 클릭하면 **옛 번들을 수락**하게 된다 — v0.2.17 런이 그 함정을 기록했고,
그 이후 모든 릴리스는 배포 번들을 직접 구동해 수락했다. 이 스크립트가 그 절차다.

채점 대상은 **캐시 안의 번들**이다(사용자가 실제로 실행하는 것). 레포의 `dist/`도, 세션의 MCP도 아니다.
grok을 spawn하지 않으므로 **구독 쿼터를 쓰지 않는다** — 수정 전 번들을 채점할 때도 그렇다(프로브가
`best_of_n`을 실어 spawn 이전에 멈춘다; 그 장치가 없으면 옛 번들 채점이 실제 위임으로 새어 30초를
태운다 — 작성 중 실측).

통과하면 exit 0, 하나라도 실패하면 exit 1이다. 실패는 보통 둘 중 하나다 — 캐시가 낡았거나
(marketplace update → plugin update 재실행), 나간 수정이 회귀했거나.

### 5b. GUI 수동 체크리스트 (사람)

5a가 green인 뒤에 실행. 결과를 CHANGELOG 한 줄 또는 이슈 코멘트로 남기면 “GUI e2e 잔여”는
**운영 절차로 전환**된 것이다.

1. Claude Code에서 마켓플레이스 설치: `grok@grok-marketplace` → `/reload-plugins`
2. `/grok:status` — `ready`, `billing`, `serverVersion` 확인
3. `/grok:setup` 또는 status가 가리키는 로그인 안내 (필요 시 터미널 `grok login`)
4. `/grok:route` — `nextAction` 표시
5. throwaway cwd에서 작은 `/grok:delegate` — `billing` 기대값, `filesChanged`, **커밋 없음**
6. `/grok:review` 흐름으로 diff 검토
7. (선택) worktree 위임 → list/diff/apply 또는 discard
8. PreToolUse: 로그아웃/미설치 시나리오는 가능하면 재현; 불가 시 `npm test`의 `hook-e2e`로 대체 인정

> **5a가 2·4·8단계를 이미 기계로 덮는다.** 남았던 것은 **“재시작한 세션이 이 번들을 로드하는가”**
> 하나였고(`docs/10` B4), 그것도 2026-09-06에 닫혔다 — 사람의 클릭이 아니라 **갱신 뒤 새로 시작된**
> **세션**이 확인한다. `/grok:status`의 몸통은 `grok_build_status` 호출 한 줄이므로
> (`commands/status.md`), 새 세션에서 그 도구가 `mcp-server/package.json`과 같은 `serverVersion`을
> 돌려주면 그것이 증거다. 확인할 수 없는 것은 **갱신 직후의 그** 세션뿐이다 — 세션은 자기가 시작할
> 때의 MCP 프로세스를 물고 있다. 나머지 단계는 의심될 때 사람이 눈으로 보는 용도로 남긴다.

> ⚠️ **단, `serverVersion` 한 줄은 증거의 시작이지 끝이 아니다** (v0.2.24 런에서 Grok이 두 번
> 반증했다 — 아래 실행 기록). 그 문자열은 프로세스가 스스로 골라 내보낸 것이고 디렉터리 이름도
> 바이트 신원이 아니므로, 함께 재야 닫힌다: ① 캐시 번들의 개행 정규화 sha256 = **태그 blob**
> (`origin/main`이 아니다 — 릴리스 뒤 docs 커밋이 붙으면 갈라진다) ② `Win32_Process`(또는 `ps`)로
> **세션 프로세스**의 시작 시각이 캐시 mtime보다 뒤인지 — 자식 MCP만 재면 세션을 잰 것이 아니다.

**이 레포 CI가 이미 대신하는 것:** 유닛·typecheck·dist 동기·hook 서브프로세스 e2e·tool 이름 surface.

### 실행 기록 — v0.2.17 (2026-09-04)

2~8단계를 **배포 산출물에 직접** 실행했다. GUI 슬래시 커맨드가 아니라 `.mcp.json`이 하는 것과
같은 방식으로 `mcp-server/dist/index.js`를 stdio로 띄우고 툴을 호출했다 — 이 세션의 MCP는
갱신 전 0.2.11 프로세스를 물고 있어서, 그대로 클릭했다면 **낡은 번들을 수락**하게 된다.

| 단계 | 결과 |
|---|---|
| 2 `grok_auth_check` | `ok` · `mode/billing: subscription` · **`serverVersion: 0.2.17`** |
| 4 `grok_build_route` | `risk: MEDIUM` + `nextAction`(plan 선행 + 휴먼 게이트) 정상 |
| 5 delegate (throwaway cwd) | `completed` · `billing: subscription` · `filesChanged: [a.txt]` · **커밋 없음**(`git log`에 init 하나) |
| 6 diff 검토 | `-hello / +hi` 한 줄, 지시 외 변경 없음 |
| 7 worktree | 격리 확인(cwd는 `hello` 그대로) → `list` → `diff`(`diffStat: a.txt \| 1 +`) → `apply`(커밋 없이 반영) → `remove`(동반 브랜치 삭제) |
| 8 PreToolUse hook | 배포 `dist/hook.js` 직접 실행: 정상 인증 → 무출력(allow) / `GROK_BUILD_AUTH_MODE=subscription` + 격리 `GROK_HOME` → **deny**(`grok login` 안내) / `GROK_BIN_DIR`을 빈 디렉터리로 둔 미설치 시뮬레이션 → **deny**(설치 안내) |

집계도 일관됐다 — `grok_build_usage`: 위임 2건, 성공률 100%, **구독 과금 100%**.

**남아 있던 1단계 칸 — 2026-09-05에 닫혔다.** 재시작된 세션에서 플러그인이 띄운 MCP 서버의
`grok_build_status`(= `/grok:status`의 구동부)가 **`serverVersion: 0.2.17`**, `ready: true`,
`billing: subscription`을 반환했다. 즉 마켓플레이스 설치본이 실제로 로드돼 돌고 있고, 낡은
0.2.11 프로세스는 재시작으로 사라졌다. **v0.2.17 런은 이것으로 열린 칸 없이 끝났다.**

> 다음 릴리스에서 이 체크리스트를 다시 돌릴 때는 `serverVersion`이 `mcp-server/package.json`과
> 같은지만 보면 된다 — 다르면 마켓플레이스 클론이 낡았거나(`autoUpdate: false`) 세션이 옛
> 프로세스를 물고 있는 것이다.

### 실행 기록 — v0.2.21 (2026-09-06)

설치본을 `0.2.17 → 0.2.21`로 갱신했다(마켓플레이스 클론 먼저 — `autoUpdate: false`라 클론이
낡으면 `plugin update`가 새 버전을 보지 못한다). `claude plugin list` = Version **0.2.21** ·
Status enabled. 캐시에 `0.2.21` 디렉터리가 새로 생겼다(`0.2.7`·`0.2.11`·`0.2.17` 옆에).

**채점은 세션의 MCP가 아니라 새로 캐시된 번들을 직접 띄워서 했다.** 이 세션은 갱신 전 0.2.17
프로세스를 물고 있으므로, 그대로 클릭했다면 낡은 번들을 수락하게 된다 — v0.2.17 런에서 배운 것과
같은 이유다. 레포의 `dist/`도 아니다: 사용자가 실제로 실행하는 것은 **캐시 안의 번들**이다.

| 확인 | 캐시 번들 실측 결과 |
|---|---|
| 번들 신원 | `serverInfo` = `{"name":"grok-build","version":"0.2.21"}` — stdio 직접 기동 |
| ① hook이 무장됐는가 (A7) | env 없는 그대로 + 세션 없음 → 캐시의 `dist/hook.js`가 **deny**(`grok login` 안내). 0.2.17 번들에서는 무출력(allow)이었다 |
| ② serverVersion (B4 일부) | `grok_auth_check` → `serverVersion: 0.2.21` · `ok: true` · `mode: subscription` |
| ③ 한 단어 오타 (A11) | `grok_cli {"args":["sesions"]}` → `status: blocked` · `isError: true` · **675ms** (전에는 60초 timeout) |
| ④ cwd 스코프 headline (A17) | 이력 없는 디렉터리 → "이 디렉터리(…) 기준 위임 이력이 없습니다 — 다른 경로의 이력은 그대로 있습니다." |

④까지 통과했으므로 v0.2.18의 만료 세션 분류와 v0.2.19의 라우터 위험 게이트도 이 번들 안에 있다
(둘 다 유닛으로 고정돼 있고 `npm test` 555건이 머지 전 CI에서 green이었다).

**남은 칸 하나 — GUI 슬래시 커맨드 경로 (`docs/10` B4).** 갱신 후에도 **실행 중이던 세션은 옛
프로세스를 물고 있다.** 그래서 그 세션의 `/grok:status`는 여전히 0.2.17을 말했다 — 갱신이 안 된
것이 아니라 프로세스가 안 바뀐 것이다. **이 칸은 아래 v0.2.22 런에서 닫혔다.**

### 실행 기록 — v0.2.22 (2026-09-06) · B4가 닫힌 런

**갱신 뒤 새로 시작된 세션**에서 실행했다. 그 점이 이 런의 전부다 — 세션이 시작할 때 띄운 MCP
프로세스가 곧 채점 대상이므로, 갱신 이후에 시작된 세션에서는 B4가 **세션 안에서** 측정된다.
`claude plugin list` = `grok@grok-marketplace` Version **0.2.22** · Status enabled.

| 단계 | 결과 |
|---|---|
| 5a 헤드리스 | `accept-release.mjs` → 캐시(`…/grok/0.2.22`) **10/10 통과** |
| 2 `/grok:status` (**B4**) | 세션의 플러그인 MCP로 `grok_build_status` → `ready: true` · `subscription` · **`serverVersion: 0.2.22`** = `mcp-server/package.json`. 버전 키 캐시이므로 이 답은 0.2.22 디렉터리에서만 나온다 |
| 4 `/grok:route` | `risk: LOW` · `worker: grok` · `nextAction.phase: call_mcp_tool` |
| 5 delegate (throwaway cwd) | `completed` · `billing: subscription` · `filesChanged: [a.txt]` |
| 6 diff 검토 | `-hello / +hi` 한 줄뿐 · 추가 파일 없음 · **`git log`에 init 하나 = 커밋 없음** |
| 집계 | `grok_build_usage` → 위임 1건 · 성공률 100% · 구독 과금 100% |
| 8 PreToolUse | 5a가 덮는다 — 로그아웃 상태 위임 **deny**(A7) / 읽기 전용 `grok_cli` **allow**(A2) |

**B4 결론을 Grok에게 반증시켰다** (`CLAUDE.md` "5번 조리법"). 5개 공격 전부 실패 → `CLAIM_SOUND`.
가장 날카로운 지적은 **“`claude plugin list`만으로는 못 닫는다”** 였다 — 설치된 것과 세션이 말하고
있는 프로세스는 다르기 때문이고, 닫는 것은 오직 세션 안에서 읽은 `serverVersion`이다. 이 구분이
B4의 핵심이므로 위 표의 2단계도 그렇게 적혀 있다.

### 실행 기록 — v0.2.23 (2026-09-06)

머지 → **즉시** 태그·릴리스 → 클론 갱신 → 설치본 갱신(`0.2.22 → 0.2.23`, `plugin list` enabled)
→ 캐시 채점 순으로 돌렸다. 캐시의 두 번들이 레포 `dist`와 **바이트 동일**(sha256 앞 16자리 일치)이라,
어느 쪽을 채점해도 같은 산출물이다.

| 확인 | 결과 |
|---|---|
| 5a 헤드리스 | `accept-release.mjs` → 캐시(`…/grok/0.2.23`) **10/10 통과** |
| 번들 신원 | `grok_auth_check` → `ok` · `subscription` · **`serverVersion: 0.2.23`** |
| **A24가 실제로 나갔나** | 캐시의 `dist/hook.js`, 로그아웃 상태: `["-p2+2"]`·`["-p/tmp/x"]`·`["-pfoo.txt"]` 전부 **deny** (0.2.22에서는 셋 다 allow였다) · `["sessions","list"]`는 **allow** 유지 |
| 4 `/grok:route` | `risk: LOW` · `worker: grok` · `nextAction.phase: call_mcp_tool` |
| 5 delegate (throwaway cwd) | `completed` · `billing: subscription` · `filesChanged: [a.txt]` · sessionId 있음 |
| 6 diff 검토 | `-hello / +hi` 한 줄뿐 · 추가 파일 없음 · **`git log`에 init 하나 = 커밋 없음** |
| 집계 (**A25 경로**) | 그 디렉터리로 필터 → 1건 · 성공률 100% · 구독 과금 100% · `recent[0].cwd`가 그 디렉터리를 정확히 지목 |

**그리고 이 런이 B4의 규칙을 자기 자신에게 증명했다.** 갱신을 수행한 이 세션의 플러그인 MCP는
`grok_build_status`에 **`serverVersion: 0.2.22`**로 답했다 — 설치본과 캐시가 `0.2.23`인데도.
갱신 실패가 아니라 그 세션이 시작할 때 띄운 프로세스가 그대로이기 때문이고, 정확히 그래서
GUI 경로는 **다음 세션**이 확인한다. 같은 응답의 `lastSession`은 방금 끝난 수락 위임을 올바른
cwd와 함께 가리켰다 — 이력은 파일에서 매번 새로 읽으므로 프로세스에 고정되지 않는다는 뜻이다.

**그 한 줄이 닫혔다 (2026-09-06, 갱신 뒤 새로 시작된 세션).** 그 세션의 플러그인 MCP는
`grok_build_status`에 **`serverVersion: 0.2.23`**으로 답했다 — `mcp-server/package.json`과 동일.
같은 세션에서 `accept-release.mjs`를 다시 돌려 설치본 캐시 번들이 여전히 **10/10**임을 재확인했고,
`.claude-plugin/plugin.json`·`package-lock.json`·`src/version.ts` 폴백 리터럴까지 네 곳이 모두
`0.2.23`으로 일치한다. **v0.2.23 수락은 이로써 완결이며, 사람이 할 일은 남아 있지 않다.**

즉 B4의 규칙이 두 세션에 걸쳐 양방향으로 실측됐다 — 갱신한 세션은 옛 번호(`0.2.22`)를,
그 다음 세션은 새 번호(`0.2.23`)를 말한다. 다음 릴리스도 같은 순서로 닫는다.

### 실행 기록 — v0.2.24 (2026-09-12) · 8단계를 처음 적용한 런

이 런부터 `CLAUDE.md` "작업 수행 방법" **8단계(수행 후 검증 + 과정 감사)**가 적용된다. 차이는
하나다 — **머지가 됐다는 것을 로그가 아니라 내용으로, 그것도 두 번 이상 서로 다른 방법으로 본다.**

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | ⚠️ 1차 방법이 `.claude/…` 두 파일을 **MISSING으로 오보**했다. Git Bash(MSYS)가 `origin/main:.claude/…` 인자를 `originmain;.claude	ools…`로 경로 변환한 탓이다. `git grep` · `MSYS_NO_PATHCONV=1` · blob 해시 직접 조회 **세 방법 전부 실재 확인** — 머지 누락이 아니라 하네스 오류였다 |
| 태그·릴리스 | 머지 직후 `v0.2.24` 태그 + 릴리스(**Latest**), `check-release-tag.mjs` ok |
| 설치본 갱신 | 클론 먼저 → `plugin update` → `plugin list` **0.2.24 · enabled** |
| 번들 신원 | 캐시의 두 번들 = `origin/main` 커밋 blob (개행 정규화 후 sha256 일치) |
| 5a 헤드리스 | `accept-release.mjs` → 캐시 **10/10** |
| **A27 재현 (캐시 번들 직접)** | 적대적 이력 6형태 → **0 INCONSISTENT** (수정 전 10중 4 INCONSISTENT) |
| **A26 재현** | 잘못된 모드 → **296ms · exit 1 · 진단 출력** (수정 전 240초 정지, 120초 캡에서는 진단 소실) |
| 회귀 없음 | 실제 349행 이력: 세 breakdown 전부 total과 일치, `unknown` 3개 모두 **0** — 정상 데이터는 그대로다 |
| B4 (양방향 재실측) | 갱신을 수행한 세션은 설치본이 0.2.24인데도 `serverVersion: 0.2.23`이라 답했다 — 규칙대로다 |

**Grok에게 이 수락 주장 자체를 공격시켰다** (`CLAUDE.md` "5번 조리법"): 증거 9개를 주고 5개 주장을
판정시켜 **`ACCEPTANCE_SOUND`**(5/5 TRUE). 가장 날카로운 것은 **가장 약한 증거를 정확히 고른 것**이다 —
"갱신한 세션이 0.2.23을 말한다"는 항목은 **산출물에 대해 아무것도 증명하지 않으며** 규칙을 보여줄
뿐이다. 그리고 "설치본이 0.2.24다"만으로는 부족하고 **캐시 바이트·10/10·캐시 번들 재현**이
닫는다는 구분도 정확히 짚었다 — v0.2.22 런에서 배운 것과 같은 구분이다.

**마지막 칸 — 2026-09-12, 새 세션이 닫았다. v0.2.24 런은 열린 칸 없이 끝났다.**
갱신 뒤 새로 시작된 세션(claude.exe pid 61828, 15:23:44 시작)의 `grok_build_status`가
`serverVersion: 0.2.24` · `ready: true` · `billing: subscription`을 반환했다.

⚠️ **그 자기보고 한 줄로 닫지 않았다 — Grok이 두 번 반증했기 때문이다.** 절차는 `CLAUDE.md`
"5번 조리법"과 8(b)(모든 findings는 두 번째 독립 방법으로 재도출)이고, 라운드마다 증거를 보강해
다시 물었다.

| 라운드 | Grok 판정 | 무엇이 부족하다고 했나 | 그래서 무엇을 더 쟀나 |
|---|---|---|---|
| 1 (증거 5개) | `CLAIM_NOT_CLOSED` | 내용 동일성이 **릴리스 시점의 문서 기록**일 뿐, 지금 도는 프로세스가 읽은 바이트를 가리키지 않는다 | 캐시 두 번들의 개행 정규화 sha256을 **지금** 재서 커밋 blob과 대조 |
| 2 (증거 6개) | `CLAIM_NOT_CLOSED` | ① `origin/main` ≠ **태그** — 릴리스 뒤 docs 커밋(10613d1)이 붙어 둘이 갈라져 있다 ② 잰 것은 **자식 MCP 프로세스**이지 세션이 아니다 | 태그 blob 직접 대조 + `git ls-tree v0.2.24 mcp-server/dist/` 로 비교 대상 전체 열거 + 부모 claude.exe 시작 시각 |
| 3 (증거 7개) | **`CLAIM_CLOSED`** | "no gap survives" | — |

실측값(2라운드가 요구한 것들):

| 확인 | 값 |
|---|---|
| 태그 v0.2.24 | 커밋 `6f2c56f` — HEAD `10613d1`과 다르지만 `git diff --stat`는 CHANGELOG·CLAUDE.md·docs/09뿐 |
| dist blob id (태그 = HEAD) | `index.js` `0306350a…` · `hook.js` `bb092d41…` — 양쪽 **동일 객체** |
| 태그의 `mcp-server/dist/` 전체 | 정확히 두 파일. 비교 안 된 세 번째 번들은 **없다** |
| 캐시 = 태그 blob (CR 제거 sha256) | `index.js` `0cc3fc56…` · `hook.js` `a39474cc…` — 일치. 원바이트 크기 차(859060 vs 835448)는 Windows 체크아웃 CRLF |
| 로드 순서 | 캐시 mtime 13:23:08 → 세션 15:23:44 → MCP 자식 15:23:45. 릴리스 발행은 13:22:52(로컬). 로드 이후 파일 쓰기 없음 = 지금 잰 바이트가 로드된 바이트 |
| 규칙 재확인 (밖에서) | 같은 캐시 루트에서 `0.2.23` 번들을 도는 node 프로세스 **11개**가 그대로 있다 — 전부 더 일찍 시작된 claude.exe의 자식이다. "세션은 시작 시점 프로세스를 문다"를 플러그인 밖 `Win32_Process`로 재측정한 셈 |

> **남겨둘 정확한 한계:** `hook.js`는 MCP 커맨드라인에 없다 — 위 대조는 그 파일이 **디스크에서
> 태그 blob과 같다**까지이고, 이 세션의 PreToolUse가 그것을 로드했다는 증명은 아니다(그쪽은
> `hook-e2e`와 `accept-release.mjs`가 덮는다). Grok이 3라운드에서 이 구분을 명시하고 통과시켰다.

### 감사 라운드 종료 — 2026-09-23 · 은닉성 감사, `mcp-server/src/` 전수

**이 라운드는 닫혔다.** v0.2.27에서 시작해 v0.2.30까지, `mcp-server/src/`의 모든 파일이
한 번씩 판정을 받았다. 현황의 원천은 **여기 목록이 아니라 소스의 마커**다:

```bash
grep -rlnE "FOUND BY GROK|AUDITED BY GROK" mcp-server/src/
```

**결과의 모양:** 결함이 나온 곳은 `env.ts`·`server.ts`(툴 설명)·`worktree.ts`·`usage.ts`·
`status.ts`·`hook.ts`(주석 근거)였고, **판정을 받고 깨끗했던 곳이 더 많았다** —
`auth.ts`·`hook.ts`(decideHook)·`orchestrator.ts`·`routing.ts`·`grok-cli.ts`(runGrokCli)·
`grok-result.ts`·`server.ts`(runAndRecord)·기동 이음매(`config.ts`+`index.ts`+`version.ts`).
깨끗한 쪽이 많다는 것이 결함 쪽이 잡음이 아니라는 증거다.

**마커가 없는 넷 — 감사한 척하지 않는다.** 위 `grep`은 이 넷을 비워서 돌려주므로, 그 이유를
여기 적어둔다. (개수가 어긋나면 이 표가 낡은 것이다 — 2026-09-23 실측: 판정 15 / 미해당 4.)

| 파일 | 왜 해당 없음인가 |
|---|---|
| `types.ts` | 타입 선언만. 실행되는 동작이 없어 "선언하지 않은 일을 하는가"를 물을 대상이 없다 |
| `index.ts` | 기동 이음매로 `config.ts`와 **함께** 판정받았다 (한 파일만 떼면 질문이 성립하지 않는다) |
| `version.ts` | 같은 기동 이음매의 세 번째 조각. 판정은 `config.ts`의 마커에 적혀 있다 |
| `hook-entry.ts` | IO 글루. 그 fail-open은 `hook.ts`의 catch와 **같은 것**이고, 거기서 판정받았다 |

⚠️ **다음 감사는 여기서 이어받되, 같은 질문을 다시 묻지 말 것.** 마커에 그때 던진 주장과 판정이
같이 적혀 있다. 새 질문을 던지는 것과 닫힌 질문을 다시 여는 것은 다르다 — 후자를 하려면
`CHANGELOG`의 근거부터 읽는다.

⚠️ **이 라운드가 배운 것 셋.** ① 완결성은 *무엇을 봤는가*가 아니라 **무엇을 아직 안 봤는가**로
판단한다(v0.2.28은 v0.2.27이 안 본 곳에서 나왔다). ② **깨끗하다는 사실도 데이터이고, 기록하지
않으면 사라진다**(v0.2.30에서 그 결함을 내가 직접 만들었다). ③ Grok의 답이 **참이면서 결함이
아닐 수 있다** — `auth.ts`가 그랬고, 구분하지 못하면 없는 일을 만든다.

### 실행 기록 — v0.2.42 (2026-10-09) · A52·A57·A62, 머지 전 검토 3회차 뒤(2회차가 연 BLOCKER 포함)

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`08da4f4`) 트리 = PR #168 최종 커밋(`5bbf07b`)의 트리(`c3aed38…`) — squash가 빠뜨린 것 없음. 커밋 넷: `3b627b7`(릴리스) → `d44b8f4`(1회차) → `264460b`(2회차, 1회차가 연 `wrap` BLOCKER 수정) → `5bbf07b`(3회차, 문서·테스트·주석 — 파서 로직 무변경, `grok-cli.ts` 비주석 diff 0줄). 3회차 코드·반례 검토는 `264460b`에서 결함을 못 찾았고(반례는 어떤 비-헤드리스도 spawn 못 시킴), `5bbf07b`은 로직 무변경이라 마지막 커밋 검토자 하나가 표면 문구·새 테스트를 봤다("머지 가능") |
| CI | 푸시한 머리마다 두 작업 green — 최종 `5bbf07b` 양쪽 green |
| 태그·릴리스 | 머지 직후 `v0.2.42` (annotated, `08da4f4`) + GitHub 릴리스(Latest), `check-release-tag.mjs` **ok**. 본문은 11,973자(CRLF, 한도 125,000 안; 20,496바이트), `#n` 자동 링크 0, 저장된 본문 = 태그의 `docs/releases/v0.2.42.md`(개행 정규화 뒤) |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = PR 최종 커밋(`5bbf07b`)의 blob — `index.js` `a6e622d…`, `hook.js` `2c48dce…`(둘 다) |
| 설치본 갱신 | 클론 먼저(`git reset --hard origin/main` → HEAD `08da4f4`, autoUpdate:false라 git으로) → `claude plugin marketplace update` → `claude plugin update grok@grok-marketplace` **0.2.41 → 0.2.42**, 캐시에 `0.2.42/` 생성 |
| 캐시 바이트 신원 | 캐시 dist = **태그 blob** — `git hash-object`가 `index.js` `a6e622d…`·`hook.js` `2c48dce…`로 태그와 같고, 개행 정규화 sha256도 세 출처(태그·main·캐시) 일치(`index` `4bbbed1…`, `hook` `8ea0fee…`) |
| 5a 헤드리스 | `accept-release` 레포 **15/15** · 캐시 **15/15**(`serverVersion=0.2.42`) |
| 배포 번들 재현 | 설치된 **캐시** 번들(`…/0.2.42/…/dist/index.js`)을 쿼터 0 하네스(버릴 홈·합성 세션·401 루프백)로 몰아 2회차 BLOCKER를 다시 쳤다: `["anyword","wrap","echo","<표식>","-p","ignore"]`는 spawn 없이 `blocked`(요청·이력·worktree 0; `wrap`은 해롭지 않은 `echo`), 프롬프트 플래그 없는 같은 모양·`anyword dashboard`도 `blocked`, `sessions search wrap`(인자로서의 `wrap`)은 `ok`로 돈다. 머지 직전 `264460b` 번들로도 같았고, 1회차 `d44b8f4` 번들에서는 이 모양이 spawn했다(status ok·promptRun·이력 1 — 회귀 증거) |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(모두 성립): 머지 내용·태그·릴리스·dist blob — 검증자, GitHub REST(`commits/08da4f4`·`/5bbf07b`의 트리 `c3aed38…` 일치, `pulls/168` merged·merge_commit, 태그 객체 `6bcf3b57…`가 `08da4f4`로 deref, `releases/latest` = v0.2.42 draft=false)와 Python `hashlib`(`git hash-object` 아닌 두 번째 방법)로 정규화 sha256(index `4bbbed1…`, hook `8ea0fee…`) 세 출처 일치. 설치본 — 검증자가 클론 `rev-parse HEAD`(`08da4f4`)와 캐시의 `package.json`·`plugin.json`(0.2.42)로. 릴리스 본문 — 검증자가 태그의 `.md`와 게시 본문을 개행 정규화 뒤 바이트 비교(같다, `#n` 0). 5a — 검증자는 따로 돌리지 않았고(유지보수자가 레포·캐시 15/15), 캐시 채점의 `serverVersion=0.2.42`가 그 증거다. 배포 번들 재현 — 유지보수자가 캐시 번들로 한 번(검증자 재도출 없음). 마지막 칸 — 아래 |

**마지막 칸 — 새 세션 몫(이 세션으로는 못 닫는다).** §5b의 "갱신 뒤 **새로 시작된** 세션의 `grok_build_status` =
`serverVersion: 0.2.42`와 그 세션 MCP 자식의 `…/0.2.42/…` 명령줄"은 아직 남았다 — 이 세션(과 떠 있는 VS Code 세션들)은 시작
시점의 옛 MCP를 물고 있다. `accept-release` 캐시 채점이 캐시 번들을 직접 띄워 `serverVersion=0.2.42`를 이미 보였지만, 그것은 Claude
Code의 플러그인 로더를 거치지 않는다. 재시작한/새로 띄운 세션이 한 번 `grok_build_status`를 부르면 닫힌다(선례: 위 v0.2.41 칸).

### 실행 기록 — v0.2.41 (2026-10-09) · MCP SDK 1.32.1, 머지 전 검토 6회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`90af326`) 트리 = PR #166 최종 커밋(`087ca3a`)의 트리(`4da88b7…`) — squash가 빠뜨린 것 없음. `087ca3a`는 6회차 재검토(`68a21bc` 대상, 결함 없음)의 사소한 지적 하나를 검토자 문구 그대로 넣은 한 단어 수정이고 따로 다시 검토하지 않았다. 머지는 직전에 읽은 머리(`087ca3a`)에 고정했다(`--match-head-commit` — GitHub에는 남지 않는다). 그 전에 main(#165 `b15a87a`)을 브랜치에 병합하며 CHANGELOG 충돌 하나를 양쪽 모두 살려 풀었다 |
| CI | 푸시한 머리마다(7회, 최종 `087ca3a` 포함) 두 작업 green — `2278fd8`은 병합 커밋과 함께 올라가 따로 돌지 않았다 |
| 태그·릴리스 | 머지 직후 `v0.2.41` (annotated, `90af326`) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 LF로 저장됐다(노트를 `git show`로 꺼내 넘겨 전 릴리스들과 달리 LF다). ⚠️ 첫 본문의 "(#31–#33)"을 GitHub가 같은 번호의 옛 PR로 자동 링크했다(검증자가 찾았다) — 노트와 릴리스 본문을 "(31–33번)"으로 고쳤다. 고친 본문은 5,237자(CRLF로 세면 5,328자, 한도 안)이고, 렌더된 링크는 세 GHSA 권고뿐이며, 저장된 본문 = 이 PR의 노트다 |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = PR 최종 커밋의 blob = 마지막으로 검토한 `68a21bc`의 blob (`94d6d62…` / `950bcf4…`) |
| 설치본 갱신 | 클론 먼저(`claude plugin marketplace update` 뒤 클론 HEAD `90af326`) → `0.2.40 → 0.2.41`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **15/15** · 캐시 **15/15**(`serverVersion=0.2.41`) — A21·A14 칸은 이 릴리스에서 고친 것 |
| 배포 번들 재현 | 설치된 캐시 번들을 stdio로 직접 몰아(쿼터 0, `grok_build_route`와 인자 검증만) 동작 변화 셋을 다시 쟀다: 인자 검증 오류가 이슈마다 한 줄이고, `arguments` 없는 route 호출이 돌고, 줄바꿈까지 정확히 10,485,760바이트인 줄은 응답을 받고 1바이트 더는 그것도 뒤 요청도 무응답이었다(프로세스는 12초 동안 살아 있었다 — win32 Node 22.18). 10.1 MiB 줄은 응답 없이 exit 0 |
| 의존성 경보 | Dependabot #31–#33은 머지 시각에 fixed, 열린 경보 0, main 락파일의 `npm audit` 0 |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(여기 적은 것만 — 모두 성립): 머지 내용·태그·릴리스·dist blob — 검증자, git 객체와 GitHub REST API(PR의 head·merge 커밋, 커밋의 부모·트리, 태그 객체, contents의 sha). CI — 검증자, 커밋마다 check run·suite(머리 7개 green, `2278fd8`은 suite 없음). 릴리스 본문 — 검증자가 첫 본문(5,238자)을 그때 main의 노트와 바이트로 비교(같다)하고 렌더된 페이지의 링크를 셌다(위 ⚠️). 고친 본문은 머지 전 검토자가 다시 쟀다 — 저장된 본문 = 이 PR의 노트(바이트), 렌더(`POST /markdown`)와 릴리스 페이지 모두 링크는 세 GHSA뿐. 설치본 — 검증자가 클론의 HEAD·트리, `installed_plugins.json`(0.2.41), `plugin list`로. 캐시 blob — 검증자, .NET SHA1. 5a — 검증자가 **같은** `accept-release` 두 명령을 다시 돌려 15/15(같은 방법의 반복). 배포 번들 재현 — 검증자가 자기 클라이언트로 캐시 번들을 몰아 같은 결과(정확한 경계는 ASCII와 한글 줄 둘 다). 의존성 경보 — 검증자, REST·GraphQL로 열린 경보 0, 락파일 사본으로 `npm audit` 0. 마지막 칸 — 검증자가 따로 띄운 세션(아래). 머지 고정(`--match-head-commit`)은 GitHub에 남지 않아 확인하지 못했다(머리는 머지 때까지 `087ca3a`였다) |

**마지막 칸 — 2026-10-09, 헤드리스 새 세션이 닫았다(§5b의 두 조건).** 갱신(0.2.41 캐시 폴더 생성 10:00:14 KST, 그 dist 파일
10:00:17) 뒤 `claude -p`로 띄운 새 세션(10:04:10 시작)이 `grok_build_status`를 불렀고, 도구의 원래 결과(stream-json)에
`serverVersion: 0.2.41`이 있었다. 그 세션의 직계 MCP 자식의 명령줄은 `…/grok-marketplace/grok/0.2.41/mcp-server/dist/index.js`였다
(`Win32_Process`). 검증자가 10:16:57에 따로 띄운 세션도 같았고(원래 결과 `serverVersion: 0.2.41`), 그쪽은 MCP 자식의 명령줄을 세
방법(`Win32_Process`, PEB 읽기, `NtQueryInformationProcess`의 명령줄 클래스(60))으로 읽어 일치를 봤다. 유지보수자가 띄운 그
헤드리스 세션은 검증자가 볼 때 이미 끝나 그 시작 시각과 MCP 자식을 다시 읽을 수 없었고, 그 대화 기록의 원래 결과가 0.2.41이었다.
검증자의 프로세스 조회(10:16)에서 이미 떠 있던 VS Code 세션 둘(유지보수자가 작업하던 세션 포함)은 0.2.39 MCP 자식을 물고
있었다 — 재시작 전까지 옛 번들이다.

### 실행 기록 — v0.2.40 (2026-10-09) · A51, 머지 전 검토 3회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`c67a486`) 트리 = PR #164 최종 커밋(`f9340d5`)의 트리(`ce1e4d0…`) — squash가 빠뜨린 것 없음. ⚠️ `f9340d5`는 3회차 검토(`2da8f4e` 대상)의 지적을 고친 커밋(테스트·주석·문서 — 번들은 그대로)이고 머지 전에 다시 검토하지 않았다(머지 뒤 검토는 CHANGELOG). 머지는 직전에 읽은 머리(`f9340d5`)에 고정했고(`--match-head-commit` — GitHub에는 남지 않는다), squash 메시지는 네 커밋 메시지를 잇지 않고 최종 상태로 정리해 넣었다 |
| CI | 푸시한 머리 커밋마다(4회, 최종 `f9340d5` 포함) 두 작업 green |
| 태그·릴리스 | 머지 직후 `v0.2.40` (annotated, `c67a486`) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 CRLF 기준 5,320자(한도 안), 링크 없음. 저장된 본문 = main의 노트(개행 정규화 뒤) |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = PR 최종 커밋의 blob = 마지막으로 검토한 `2da8f4e`의 blob (`20bd0ba…` / `f724b66…`) |
| 설치본 갱신 | 클론 먼저(`claude plugin marketplace update` 뒤 클론 HEAD `c67a486`) → `0.2.39 → 0.2.40`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **15/15** · 캐시 **15/15**(`serverVersion=0.2.40`) — 새 A51 칸 포함 |
| 배포 번들 재현 | A51 하네스를 설치된 캐시의 `mcpcall.mjs`에 겨눠 102가지(89 + 반례 검토의 가설 13)를 `grok_build_status`로 다시 쟀다 — 설계상 차이 셋 밖의 불일치 0, 가짜 값 누출 0. 같은 캐시로 루프백 위임 셋: 제공자의 `api_key`·`env_key`를 물려받는 두 모양은 caveat을 싣고 막히지 않았고(요청에 그 제공자 키가 실렸다) 이력 행에는 caveat이 없었다. 자체 `env_key`가 물려받기를 막는 모양은 caveat이 없었다 |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(여기 적은 것만 — 모두 성립): 머지 내용·태그·릴리스·dist blob — 검증자, GitHub REST API(PR의 head·merge 커밋과 커밋 수, 커밋의 부모·트리, 태그 객체, contents·trees의 sha). 릴리스 본문 — 검증자가 저장된 본문과 main의 노트를 개행 정규화 뒤 비교(같다; 저장된 본문은 CRLF 5,320자, 링크 없음). 설치본 — 검증자가 클론의 `.git/HEAD`·`refs/heads/main`·`FETCH_HEAD`(`c67a486`)와 `installed_plugins.json`(0.2.40), 클론·캐시의 `plugin.json`·`package.json`으로. 캐시 blob — 검증자, PowerShell/.NET SHA1. 5a — 검증자가 **같은** `accept-release` 두 명령을 다시 돌려 15/15(같은 방법의 반복). 마지막 칸 — 검증자가 따로 띄운 세션 둘(아래). 배포 번들 재현은 다시 재지 않았다 — 유지보수자의 한 번뿐이다 |

**마지막 칸 — 2026-10-09, 헤드리스 새 세션이 닫았다(§5b의 두 조건).** 갱신(0.2.40 캐시 디렉터리 생성 05:10:45 KST) 뒤
`claude -p`로 띄운 새 세션(05:12:03 시작)이 `grok_build_status`를 불렀고, 도구의 원래 결과(stream-json)에 `serverVersion: 0.2.40`이
있었다. 그 세션을 조상으로 둔 MCP 자식의 명령줄은 `…/grok-marketplace/grok/0.2.40/mcp-server/dist/index.js`였다(`Win32_Process`).
검증자가 05:20에 따로 띄운 세션 둘(VS Code에 든 `claude.exe`와 PATH의 `claude`, 서로 다른 빌드)도 같았고, 그쪽은 MCP 자식의
명령줄을 세 방법(PEB 읽기, `NtQueryInformationProcess`의 명령줄 클래스(60), `Win32_Process`)으로 읽어 일치를 봤다. 그 조회(05:21)와 유지보수자의 재조회
모두에서 이미 떠 있던 세션 둘(유지보수자 세션 포함)은 0.2.39 MCP 자식을 물고 있었다 — 재시작 전까지 옛 번들이다.

### 실행 기록 — v0.2.39 (2026-10-05) · A50, 머지 전 검토 5회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`b43bfa5`) 트리 = 검토를 마친 PR #162 최종 커밋(`c05d46a`)의 트리(`fb880d9…`) — squash가 빠뜨린 것 없음 |
| CI | 푸시한 머리 커밋마다(5회, 최종 `c05d46a` 포함) 두 작업 green |
| 태그·릴리스 | 머지 직후 `v0.2.39` (annotated, `b43bfa5`) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 CRLF 기준 4,203자(한도 안), 링크 없음. 저장된 본문 = main의 노트(개행 정규화 뒤) |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = 검토한 커밋의 blob (`b988081…` / `e8bb1dd…`) |
| 설치본 갱신 | 클론 먼저(`claude plugin marketplace update` 뒤 클론 HEAD `b43bfa5`) → `0.2.38 → 0.2.39`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **14/14** · 캐시 **14/14**(`serverVersion=0.2.39`) |
| 배포 번들 재현 | 같은 하네스를 설치된 캐시에 겨눠 A50 시나리오를 쿼터 0으로 다시 쳤다(그중 한 번은 프로세스 표본으로 그 캐시의 `mcpcall.mjs`와 0.2.39 `dist/index.js`가 뜬 것을 봤다; 나머지는 어느 사본이 떴는지 기록이 없지만 두 dist는 개행 정규화 뒤 같다). push·`gh`·MCP 거부(1.0.13·1.0.44·1.0.46), 쓰기·커밋 거부(1.0.46), 파일 읽기는 되고 `git status`는 거부(1.0.46). 부수 효과는 모두 0 |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(여기 적은 것만 — 모두 성립): 머지 내용·태그·릴리스·dist blob — 검증자, GitHub REST API(커밋의 트리, PR의 head·merge 커밋, 태그 객체, contents·trees의 sha). 릴리스 본문 — 검증자가 저장된 본문과 main의 노트를 개행 정규화 뒤 비교(같다; 저장된 본문은 CRLF, 링크 없음). 설치본 — 검증자가 클론의 `.git/HEAD`·`refs/heads/main`(`b43bfa5`)·reflog와 `installed_plugins.json`(0.2.39)으로. 캐시 blob — 검증자, PowerShell/.NET SHA1. 5a — 검증자가 **같은** `accept-release` 두 명령을 다시 돌려 14/14(같은 방법의 반복). 배포 번들 재현 — 검증자가 0.2.39·0.2.38 캐시 번들의 plan argv를 정적으로 읽고(0.2.39에만 `PLAN_DENY_ARGS`), 실행 산출물(bare 원격의 ref, 가짜 `gh`·MCP의 기록, 저장소 로그)을 직접 읽었다. 마지막 칸 — 검증자가 따로 띄운 세션(아래) |

**마지막 칸 — 2026-10-05, 헤드리스 새 세션이 닫았다(§5b의 두 조건).** 갱신(0.2.39 캐시 디렉터리 생성 06:55:06 KST) 뒤
`claude -p`로 띄운 새 세션(06:58:32 시작)이 `grok_build_status`를 불렀고, 도구의 원래 결과(stream-json)에 `serverVersion: 0.2.39`가
있었다. 그 세션을 조상으로 둔 MCP 자식의 명령줄은 `…/grok-marketplace/grok/0.2.39/mcp-server/dist/index.js`였다(`Win32_Process`).
검증자가 07:09:47 KST에 따로 띄운 세션도 같았고, 그쪽은 프로세스를 WMI 없이(NT API) 읽고 WMI로 교차 확인했다. 그 조회에서
2026-09-30에 시작된 세션 둘은 0.2.37 MCP 자식을 물고 있었다 — 재시작 전까지 옛 번들이다.

### 실행 기록 — v0.2.38 (2026-10-04) · fast-uri 3.1.8, 머지 전 검토 2회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`ca6936a`) 트리 = 검토를 마친 PR #160 최종 커밋(`d5c43dc`)의 트리(`ed63590…`) — squash가 빠뜨린 것 없음 |
| CI | 푸시한 머리 커밋마다(3회, 최종 `d5c43dc` 포함) 두 작업 green |
| 태그·릴리스 | 머지 직후 `v0.2.38` (annotated, `ca6936a`) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 CRLF 기준 3,167자(한도 안), 링크 없음 |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = 검토한 커밋의 blob (`41aa485…` / `fd295ca…`) |
| 설치본 갱신 | 클론 먼저(`claude plugin marketplace update` 뒤 클론 HEAD `ca6936a`) → `0.2.37 → 0.2.38`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **14/14** · 캐시 **14/14**(`serverVersion=0.2.38`) |
| 배포 번들 재현 | 설치된 두 캐시에서 3.1.8에만 있는 줄(고정 문자열)이 0.2.37 **0**, 0.2.38 **1**. 권고의 예제를 npm 패키지로 돌렸다 — 3.1.7은 `parse("//%41.com").host`가 `A.com`이고 `equal("//%41.com","//a.com")`이 `false`, 3.1.8은 `a.com`·`true` |
| 경보·PR | 경보 #30은 머지 8초 뒤(12:16:13Z) fixed, #157은 2분 뒤(12:18:21Z) Dependabot이 닫았다 |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(여기 적은 것만 — 모두 성립): 머지 내용·태그·릴리스·dist blob — 검증자, GitHub REST API(커밋의 트리, 태그 객체, contents의 sha). 릴리스 본문 — 검증자가 저장된 본문과 main의 노트를 개행 정규화 뒤 비교(개행만 다르고 같다; 저장된 본문은 CRLF, main의 노트 blob은 LF). 설치본 — 검증자가 클론의 `.git/HEAD`가 가리키는 `refs/heads/main`(`ca6936a`)과 `installed_plugins.json`(0.2.38)으로. 캐시 blob — 검증자, PowerShell/.NET SHA1. 5a — 검증자가 **같은** `accept-release` 두 명령을 다시 돌려 14/14(같은 방법의 반복). 배포 번들 재현 — 검증자가 Select-String·IndexOf로 같은 0/1을 얻었고, 각 캐시 번들에서 떼어 낸 fast-uri 코드로 권고의 예제를 돌려 0.2.37 `A.com`·`false`, 0.2.38 `a.com`·`true`. 경보·PR — 검증자, GraphQL과 #157의 이벤트(봇이 닫았다). 마지막 칸 — 검증자가 따로 띄운 세션(아래) |

**마지막 칸 — 2026-10-04, 헤드리스 새 세션이 닫았다(§5b의 두 조건).** 갱신(0.2.38 캐시 디렉터리 생성 21:17:11 KST) 뒤
`claude -p`로 띄운 새 세션(21:18:55 시작)이 `grok_build_status`를 불렀고, 도구의 원래 결과(stream-json)에 `serverVersion: 0.2.38`이
있었다. 그 세션을 조상으로 둔 MCP 자식의 명령줄은 `…/grok-marketplace/grok/0.2.38/mcp-server/dist/index.js`였다(`Win32_Process`).
검증자가 21:39:33 KST에 따로 띄운 세션도 같았고, 그쪽은 프로세스를 WMI 없이(NT API) 읽고 WMI로 교차 확인했다. 유지보수자의 그
`Win32_Process` 조회(21:18:55–21:19:15)에서는 이미 떠 있던 세션 둘(유지보수자 세션 포함)이 0.2.37 MCP 자식을 물고 있었다 — 재시작
전까지 옛 번들이다.

### 실행 기록 — v0.2.37 (2026-09-28) · 감사의 문서 항목과 A49, 머지 전 검토 11회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`4844f0c`) 트리 = 검토를 마친 PR #150 최종 커밋(`7e8e8f5`)의 트리(`d23e8631…`) — squash가 빠뜨린 것 없음 |
| CI | 푸시한 머리 커밋마다(12회, 최종 `7e8e8f5` 포함) 두 작업 green — PR 트리거라 PR의 커밋 25개 중 나머지 13개는 그 자체로는 CI가 돌지 않았다 |
| 태그·릴리스 | 머지 직후 `v0.2.37` (annotated, `4844f0c`) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 CRLF 기준 17,436자(한도 안), 링크 없음. 머지 뒤 굵은 글씨 하나가 렌더되지 않아(닫는 `**`가 `)` 뒤·글자 앞) 노트를 고치고 릴리스 본문을 main의 노트로 갱신했다(06:35:11Z) — 태그 안의 파일과는 그 한 곳만 다르다 |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** = 검토한 커밋의 blob (`2d1e95c…` / `ecfadd5…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.36 → 0.2.37`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **14/14** · 캐시 **14/14**(`serverVersion=0.2.37`) |
| 배포 번들 재현 | 태그를 `git archive`로 떠 컨테이너에서 대역 grok(커밋 뒤 exit 1·캡 초과·완료)으로 쳤다(쿼터 0). v0.2.37은 세 결말 모두 `committed: true`·이력 `committed: true`이고, 안내가 폴더와 이전 커밋을 작은따옴표로 이름 댄다. 같은 조건의 v0.2.36은 exit 1·캡 초과에서 `committed`가 결과에도 이력 행에도 없었다(이력 행 자체는 남았다) |
| 독립 재도출 | 다시 잰 것과 누가 무엇으로(여기 적은 것만 — 모두 성립): 머지 내용·태그·dist blob·**갱신 전** 릴리스 본문 — 검증자, GitHub REST API. 설치본 갱신 — 검증자가 `claude plugin list`(0.2.37 enabled)와 마켓플레이스 클론 HEAD(`4844f0c`)로. 캐시 blob — 검증자, .NET SHA1과 `git hash-object --no-filters`. 마지막 칸 — 검증자가 따로 띄운 세션(도구의 원래 결과를 stream-json으로)과 NT API 프로세스 조회. 5a — 검증자가 **같은** `accept-release` 두 명령을 다시 돌려 14/14(같은 방법의 반복). 배포 번들 재현 — 기록 검토자가 같은 태그 아카이브(바이트가 `git archive`와 같음을 확인)로 다시 돌려 같은 결과. **갱신 뒤** 릴리스 본문(위 태그·릴리스 칸) — 갱신 직후 유지보수자가, 이어 #152의 기록 검토가 다른 비교로 main의 노트와 같고 태그 파일과 한 줄 다름을 확인(검증자는 갱신 전에 끝났다). CI — GitHub의 run 기록이 원천이고, #151·#152의 기록 검토가 그 기록을 다시 읽었다(run 12개, 모두 green) |

**마지막 칸 — 2026-09-28, 헤드리스 새 세션이 닫았다(§5b의 두 조건).** 갱신(0.2.37 캐시 디렉터리 생성 15:08:13) 뒤
`claude -p`로 띄운 새 세션(15:09:14 시작)이 `grok_build_status`를 불러 `serverVersion=0.2.37 ready=true billing=subscription`이라고
답했고(모델의 한 줄 답), 그 세션을 부모로 둔 MCP 자식의 명령줄은 `…/grok-marketplace/grok/0.2.37/mcp-server/dist/index.js`였다
(`Win32_Process`, 조상 사슬로 그 세션을 확인). 검증자가 15:14:32에 따로 띄운 세션도 같았고, 그쪽은 도구의 원래 결과를
stream-json으로 잡았다(NT API 조회). 그 시각 이미 떠
있던 세션 셋은 0.2.35 프로세스를 물고 있었다 — 재시작 전까지 옛 번들이다.

⚠️ **`installed_plugins.json`의 `gitCommitSha`는 설치된 커밋의 증거가 아니다.** 갱신 뒤 `version`·`installPath`·
`lastUpdated`는 0.2.37이었는데 `gitCommitSha`는 옛 커밋(`4a460ca`, PR #95)을 가리켰다 — `claude plugin update`가 이 칸을
고치지 않는 것으로 보인다. 신원은 위처럼 캐시 blob과 새 세션의 명령줄로 잰다.

### 실행 기록 — v0.2.36 (2026-09-28) · 전체 감사의 결함 12건(A37~A48), 머지 전 검토 27회차 뒤

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`(`274c090`) 트리 = 검토를 마친 PR #148 최종 커밋(`854fd3d`)의 트리(`06348151…`) — squash가 빠뜨린 것 없음 |
| CI | 이 브랜치의 첫 CI(27회차 내내 푸시되지 않았다)에서 windows가 A38 실제 git 테스트 하나를 떨어뜨렸다 — 러너 TEMP의 8.3 짧은 이름. 재현 뒤 테스트를 고쳐 두 작업 green(`CHANGELOG` 118) |
| 태그·릴리스 | 머지 직후 `v0.2.36` (annotated) + GitHub 릴리스, `check-release-tag.mjs` **ok**. 본문은 한도(125,000자) 안이고, 옮긴 회차별 기록으로 가는 절대 링크가 릴리스 페이지에서 열린다(HTTP 200) |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (`9b9464c…` / `eaaa273…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.35 → 0.2.36`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **14/14** · 캐시 **14/14** |
| 배포 번들 재현 | 캐시 안의 `mcpcall.mjs`로(쿼터 0): A44 — 영어 `token` 작업이 `HIGH`·Claude 유지. A46 — 하네스가 먼저 넘어졌다: `mcpcall.mjs`가 인자의 `timeout_ms`에 30초를 더해 자기 타이머로 쓰는데 3e9가 32비트를 넘어 1ms가 됐다(A46이 제품에서 고친 모양 그대로 — 다음 릴리스에서 고친다). 제품의 거절은 테스트가 고정한다 |

**마지막 칸 — 2026-09-28, 헤드리스 새 세션이 닫았다. 이번에는 §5b의 두 조건을 모두 쟀다.** 갱신(캐시 디렉터리 생성
00:34:19) 뒤 `claude -p`로 띄운 새 세션(00:35:08 시작)의 `grok_build_status`가 `serverVersion=0.2.36 ready=true
billing=subscription caveat=none`을 돌려줬고, 그 세션을 부모로 둔 MCP 자식의 명령줄은
`…/grok-marketplace/grok/0.2.36/mcp-server/dist/index.js`였다(`Win32_Process`). 캐시 = 태그 blob은 위에서 두 방법으로 쟀다.

### 실행 기록 — v0.2.35 (2026-09-25) · Windows에서 grok이 여는 이름으로 세션을 찾는 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 트리 해시 = 검토를 마친 PR 최종 커밋(`1454ef2`)의 트리(`d447e2c…`) — squash가 빠뜨린 것 없음 |
| 태그·릴리스 | 머지 직후 `v0.2.35` (annotated) + GitHub 릴리스(Latest), `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (`b8b3ad6…` / `c1fe99e…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.34 → 0.2.35`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **14/14** · 캐시 **14/14** (새 `A36` 칸 포함 — 수정 없는 0.2.34 설치본은 그 칸만 실패, 13/14) |
| **끝단 (A36)** | 합성 세션으로 grok과 나란히(쿼터 0): `GROK_HOME=<dir>.` → grok "logged in", 번들 `ok: true` / `<dir> ` → grok "not authenticated", 번들 `not_logged_in` + 공백을 말하는 메모. `npm run probe:home` 728회, 건너뜀 0, 불일치 0 |

**마지막 칸 — 2026-09-25, 헤드리스 새 세션이 닫았다.** 갱신 뒤 `claude -p`로 띄운 새 세션의 `grok_build_status`가
`serverVersion=0.2.35 ready=true billing=subscription caveat=none`을 돌려줬다. 캐시 = 태그 blob은 위에서 두 방법으로 쟀다.
⚠️ **이번 런은 세션 프로세스의 명령줄·시작 시각(§5b의 두 번째 조건)을 재지 않았다** — 새 세션의 자기보고, 버전 키 캐시에
0.2.35만 설치된 목록, 캐시 = 태그 blob으로 닫았다. 명령줄까지 보려면 다음 세션에서 떠 있는 MCP 자식의 경로를 확인하면 된다.

### 실행 기록 — v0.2.34 (2026-09-25) · 상대 경로 `GROK_HOME`을 grok처럼 푸는 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 트리 해시 = 검토를 마친 브랜치 최종 커밋(`e1c1fec`)의 트리(`3ad4495…`) — squash가 빠뜨린 것 없음 |
| 태그·릴리스 | 머지 직후 `v0.2.34` (annotated) + GitHub 릴리스, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (`d74a1ea…` / `ab0aa7e…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.33 → 0.2.34`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **13/13** · 캐시 **13/13** (새 `A35` 검사 포함 — 수정 없는 0.2.33 설치본은 그 칸만 실패, 12/13) |
| **끝단 (A35)** | 설치된 0.2.34 번들로 원 재현 스크립트를 다시 돌렸다(합성 세션·가짜 키, 쿼터 0). hook 통과, status `ready: true` + caveat + 메모, 위임은 작업 폴더에서 grok을 띄움(합성 401 → `auth_error`). 가상 폴더에 세션을 심어 둬도 worktree 위임은 268 ms에 거절되고 worktree는 0개. `grok_cli --cwd`는 통과, `--cwd`가 없으면 거부하며 확인한 홈을 말함 |

**마지막 칸 — 2026-09-25, 헤드리스 새 세션이 닫았다.** `claude -p`로 새 세션을 띄웠다. claude.exe 73544(00:11:03 시작,
캐시 갱신 뒤)의 MCP 자식 49676이 `…/grok/0.2.34/mcp-server/dist/index.js`로 떴고, 그 세션의 `grok_build_status`가
`serverVersion=0.2.34 ready=true billing=subscription caveat=none`을 돌려줬다. 캐시 = 태그 blob은 위에서 쟀다 — §5b 조건
전부. **v0.2.34 런은 열린 칸 없이 끝났다.**
⚠️ **하네스 오류:** 첫 시도는 MCP 명령줄을 역슬래시만 맞는 정규식으로 찾아 아무것도 못 봤다(세션 답은 같았다). 이 명령줄은
`…\grok\0.2.34/mcp-server/…`처럼 **구분자가 섞여** 있다 — 구분자에 무관한 패턴으로 다시 쟀다.
⚠️ **관측:** 같은 시각 다른 세션이 띄운 grok 워커(worktree 리뷰 위임)가 이 플러그인의 **0.2.34 사본**을 자식으로 띄웠다 —
grok은 설치된 플러그인을 워커에 로드한다(계약 §14). 그 사본이 스스로 거절하려면 위임한 세션의 서버가 0.2.32 이상이라
`GROK_BUILD_WORKER`를 붙여야 한다(A34). 그 grok은 확인 전에 끝나 위임한 서버의 버전은 재지 못했다. 그 시각 0.2.31 서버가
다섯, 0.2.32가 하나 떠 있었다 — **옛 세션은 재시작해야** A34 보호와 이 릴리스를 받는다.

### 실행 기록 — v0.2.33 (2026-09-24) · 설정 파일의 모델별 키를 `billing` 옆에 알리는 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 트리 해시 = 검토를 마친 브랜치 최종 커밋의 트리(`0b24646…`) — squash가 빠뜨린 것 없음 |
| 태그·릴리스 | 머지 직후 `v0.2.33` (annotated) + GitHub 릴리스, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (`6f85e49…` / `cb21acb…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.32 → 0.2.33`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 blob id = **태그 blob** — `git hash-object --path`와 직접 계산(CRLF→LF 뒤 sha1), 두 방법 일치 |
| 5a 헤드리스 | `accept-release` 레포 **12/12** · 캐시 **12/12** (새 `caveat` 검사 포함 — 기능 없는 0.2.32 설치본은 그 칸만 실패, 11/12) |
| **끝단 (`billingCaveat`)** | 캐시 수락의 `caveat` 칸: 임시 홈에 둔 가짜 모델 키를 status가 보고하고 값은 싣지 않음(쿼터 0). 합성 `GROK_HOME` 실측(배포 번들): status가 모델 둘을 보고, 위임은 막히지 않고 401로 끝나며 caveat를 싣고, 이력 행엔 없음 |
| 회귀 재측정 (Linux) | `config.toml`이 FIFO·`/dev/zero` 링크: 머지 전 검토 이전 번들은 status 8초·route 3초 무응답 → 태그와 같은 blob의 번들은 70ms·2ms(`config_unreadable`) |

**마지막 칸 — 2026-09-24, 헤드리스 새 세션이 닫았다.** 갱신한 세션(MCP pid 21468)은 여전히 `…/grok/0.2.31/…`을
물고 있어서 `claude -p`로 **새 세션**을 띄웠다. claude.exe 23628(21:17:44 시작, 캐시 갱신 직후)의 MCP 자식 22244가
`…/grok/0.2.33/mcp-server/dist/index.js`로 떴고, 그 세션의 `grok_build_status`가
`serverVersion=0.2.33 ready=true billing=subscription caveat=none`을 돌려줬다. 이 머신의 실제 설정에는 살아 있는
모델별 키가 없다는 뜻이며, 모델 이름은 출력하지 않게 했다. 캐시 = 태그 blob은 위에서 쟀다 — §5b 조건 전부.
**v0.2.33 런은 열린 칸 없이 끝났다.** ⚠️ 그 시각 떠 있던 세션 6개(0.2.31 다섯, 0.2.32 하나)는 **재시작해야**
0.2.32의 A34 보호와 0.2.33의 경고를 받는다 — 세션은 시작할 때의 MCP 프로세스를 문다.

### 실행 기록 — v0.2.32 (2026-09-24) · 워커가 다시 띄운 사본이 거절하는 것을 끝단에서 본 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`을 `git grep`으로 21항목(가드·거절·배선·번들·probe·수락 검사·버전·문서) |
| 태그·릴리스 | 머지 직후 `v0.2.32` (annotated) + GitHub 릴리스, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (`61f3bc8…` / `54ea178…`) |
| 설치본 갱신 | 클론 먼저 → `0.2.31 → 0.2.32`, `plugin list` enabled |
| 캐시 바이트 신원 | 개행 정규화 git blob id = **태그 blob** (`index.js`·`hook.js` 둘 다) |
| 5a 헤드리스 | `accept-release` 레포 **11/11** · 캐시 **11/11** (새 A34 검사 포함) |
| **끝단 (A34)** | 바깥 0.2.32(`mcpcall.mjs`) → 워커가 로드한 **설치된 `…/0.2.32/…` 사본**의 `grok_build_delegate` 호출 → grok 이벤트 `success: false`, **2ms**, `reason: inside_grok_worker`. 중첩 이력 행 0, 대상 디렉터리 파일 0. 수정 전(재현 M2c)은 `success: true`, 10.7초, 파일 생성 |
| 전제 감시 | `probe:contract`의 `workerMarker` → `reached: true` (1.0.30 win32, 1.0.41 Linux) |

**마지막 칸 — 2026-09-24, 헤드리스 새 세션이 닫았다.** 갱신한 세션(MCP pid 21468)은 여전히 `…/grok/0.2.31/…`를
물고 있어서, 사람의 재시작 대신 `claude -p`로 **새 세션**을 하나 띄웠다: claude.exe 36332(17:30 시작, 캐시 갱신
01:57 이후)의 MCP 자식 57164가 `…/grok/0.2.32/mcp-server/dist/index.js`로 떴고, 그 세션의 `grok_build_status`가
`serverVersion=0.2.32 ready=true billing=subscription`을 돌려줬다. 캐시 = 태그 blob은 위에서 쟀다 — §5b 조건 전부.
**v0.2.32 런은 열린 칸 없이 끝났다.** ⚠️ **A34 보호는 재시작한 세션부터 작동한다** — 표식은 바깥 서버가
붙이므로, 0.2.31 프로세스를 문 세션의 워커는 설치본이 0.2.32여도 표식 없이 뜬다.

### 실행 기록 — v0.2.31 (2026-09-23) · 못 잰다고 적어둔 것을 Docker로 잰 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 6항목 (신호 배열·앵커·dist 인라인·A33 테스트·계약 §13·릴리스 노트) |
| 태그·릴리스 | 머지 직후 `v0.2.31` (annotated) + GitHub 릴리스 |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (양쪽) |
| 설치본 갱신 | 클론 먼저 → `0.2.30 → 0.2.31` |
| **캐시 바이트 신원** | 개행 정규화 sha256(캐시) = **태그 blob** (`index.js`·`hook.js` 둘 다) |
| 5a 헤드리스 | `accept-release` **레포 10/10 · 캐시 10/10** |
| 라이브 재현 | **캐시 번들**을 리눅스 컨테이너에서 띄워 A33 재현 페이로드 재타격 — 처리군이 `GROK_SANDBOX`를 지목, 통제군 불변 |
| 번들 자기보고 | 캐시 번들의 `grok_build_status` → **`serverVersion: 0.2.31`** |

**마지막 칸(새 세션)은 이번에도 남았고, 이번엔 그 이유를 직접 봤다.** `Win32_Process`로 재보니
이 세션이 물고 있는 MCP는 `…/grok/**0.2.25**/mcp-server/dist/index.js` 3개(시작 09-21~22)였다.
즉 이 세션의 `/grok:status`는 갱신 실패가 아니라 **6개 릴리스 전 프로세스**를 말한다.
**프로세스 명령줄이 `serverVersion` 자기보고보다 강한 증거라는 규칙이 여기서 실물로 확인됐다** —
자기보고만 봤다면 "왜 안 올라갔지"로 잘못 읽었을 것이다.

**마지막 칸 — 2026-09-24, 새 세션이 닫았다. v0.2.31 런은 열린 칸 없이 끝났다.** §5b의 조건을 모두 쟀다:

| 확인 | 값 |
|---|---|
| 세션 프로세스 | claude.exe pid 32896, 00:08:03 시작 → 자식 MCP pid 21468의 명령줄이 `…/grok/0.2.31/…` |
| 로드 순서 | 캐시 mtime 09-23 22:49:37 → 세션 시작 09-24 00:08:03 |
| 캐시 = 태그 blob | 개행 정규화 git blob id가 태그와 일치 — `index.js` `511453f…` · `hook.js` `d4b5403…` (`origin/main`도 같은 객체, blob의 CR 0개) |
| 자기보고 | 그 세션의 `grok_build_status` → `serverVersion: 0.2.31` · `ready: true` · `subscription` |
| 5a 재확인 | `accept-release` 레포 10/10 · 캐시 10/10 |

그리고 어제 세션을 붙잡고 있던 `0.2.25` 프로세스는 사라졌다 — 떠 있는 플러그인 MCP 6개가 전부 `0.2.31`이었다.
**이 점검이 A34를 찾았다:** 그중 하나의 부모가 claude.exe가 아니라 **grok.exe**였다(계약 §14).

### 실행 기록 — v0.2.29 (2026-09-22) · 집계가 받은 데이터보다 많이 말했다

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 6항목 (`totalUnscoped` 수용·호출부 전달·metered 조건·칭찬 조건·한글·버전) |
| 태그·릴리스 | 머지 직후 `v0.2.29`, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (양쪽) |
| 설치본 갱신 | 클론 먼저 → `0.2.28 → 0.2.29` |
| 5a 헤드리스 | `accept-release` 캐시 **10/10** (번들이 `0.2.29` 보고) |
| **라이브 확인** | 스코프 호출이 "다른 경로에 **907건**" — 같은 순간 비필터 total도 907 |

### 실행 기록 — v0.2.28 (2026-09-22) · remove가 지우라고 하지 않은 브랜치

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main` 6항목 (가드·`-d` 유지·새 테스트·픽스처 현실화·한글 보존·버전) |
| 태그·릴리스 | 머지 직후 `v0.2.28`, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (양쪽) |
| 설치본 갱신 | 클론 먼저 → `0.2.27 → 0.2.28` |
| 5a 헤드리스 | `accept-release` 캐시 **10/10** (번들이 `0.2.28` 보고) |

**이 릴리스는 v0.2.27 감사가 보지 않은 곳에서 나왔다.** 그 감사는 `env.ts`·`server.ts`만 Grok에게
보여줬고, `worktree.ts`(858줄, 유일하게 되돌릴 수 없는 삭제)는 손대지 않았다.

⚠️ **모듈별 감사 현황의 원천은 소스의 마커이고, 마커는 둘이다** —
`grep -rlnE "FOUND BY GROK|AUDITED BY GROK" mcp-server/src/`. 여기 목록을 적으면 낡는다.
**2026-09-23 정정:** 이 줄은 처음에 `FOUND BY GROK` 하나만 원천이라고 적었고 **그게 거짓이었다** —
그 마커는 결함이 나왔을 때만 남으므로, 깨끗하게 감사한 모듈이 미감사로 보였다(`auth.ts`·`hook.ts`가
실제로 그랬다). v0.2.30부터 **결함 없음도 `AUDITED BY GROK <날짜>, no finding` + 던진 주장 + 판정으로
그 자리에 남긴다.**

### 실행 기록 — v0.2.27 (2026-09-22) · 은닉성·고아·불필요 감사

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`을 **내용으로** 8항목 확인 (env.ts 근거·키 삭제 유지·description 3건·상수 제거·가드·샘플 인용·한글 보존·버전) |
| 태그·릴리스 | 머지 직후 `v0.2.27`, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main` dist blob = **태그 blob** (양쪽) |
| 설치본 갱신 | 클론 먼저 → `0.2.26 → 0.2.27` |
| 캐시 번들 신원 | 캐시 = 태그 blob, 개행 정규화 sha256 **둘 다 일치** |
| 5a 헤드리스 | `accept-release` 캐시 **10/10** (번들이 `0.2.27` 보고) |
| 사용자 변경 도달 확인 | 캐시 번들에 새 고지 문구 **3건** (툴 description) |

**감사가 무엇을 봤고 무엇을 안 봤는지가 이 기록의 요점이다.** Grok에게 보여준 것은 `env.ts`와
`server.ts`뿐이었다. **`worktree.ts`(858줄, 되돌릴 수 없는 삭제)는 보지 않았고**, 바로 다음
후속작업이 거기서 결함을 찾았다(v0.2.28). 감사의 완결성은 "무엇을 봤는가"가 아니라
**"무엇을 아직 안 봤는가"** 로 판단한다.

⚠️ **하네스가 2번 틀렸다.** ① 문서 링크 검사기가 dangling **194건**을 냈는데 전부 오탐이었다 —
레포 루트 기준 경로를 문서 자신의 디렉터리 기준으로 풀었다. 고치니 5건, 그 5건도 이름이 바뀌기 전
파일을 "만들어라"라고 적은 과거 계획서라 **실제 dangling은 0건**. ② heredoc 역슬래시 함정을
**세 번 더** 밟았다.

### 실행 기록 — v0.2.26 (2026-09-22) · Grok 4.7 / grok CLI 1.0.30 대응

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`을 **내용으로** 확인 — 9개 항목(A28~A32·B1~B3·probe) 전부 존재, 버전 사이트 6곳 모두 `0.2.26` |
| 태그·릴리스 | 머지 직후 `v0.2.26` 태그 + 릴리스, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main`의 dist blob = **태그 v0.2.26의 blob** (`8f8592c…` / `6e48e66…`) |
| 설치본 갱신 | 클론 먼저 → `plugin update` **0.2.25 → 0.2.26** → `plugin list` 확인 |
| 캐시 번들 신원 | 캐시 = **태그 blob**, 개행 정규화 sha256 **둘 다 일치** |
| 5a 헤드리스 | `accept-release.mjs` 레포 **10/10** · 캐시 **10/10** (번들이 `0.2.26` 보고) |
| **A29 재현** | `["--minimal","cursor-worker","--help"]` — 수정 전 **spawn(exit 0)** → 지금 `blocked` |
| **A30 재현** | `["usage","<id>"]` — 수정 전 `blocked` → 지금 `ok`(exit 0), 실토큰·비용 반환 |
| **A28 재현** | `["-cp","Say ok and stop."]` — 수정 전 history **delta 0** → 지금 **delta 1** |
| **A32 재현** | 커밋을 요구한 같은 프롬프트 — 수정 전 HEAD 이동 + `filesChanged: []` → 지금 HEAD 불변, `committed: false`, `filesChanged: ["f.txt"]`, `model: grok-4.7-build` |
| **B1 재현** | 20초 타임아웃이 `sessionId` 반환 → **같은 id로 재개 성공**(grok이 맥락 유지) |

**남은 한 칸 — 새 세션의 `serverVersion`.** 이번에는 그 칸이 왜 남는지를 **직접 증거로** 남긴다:
`Win32_Process`로 본 이 세션의 MCP 프로세스(PID 24148)는 **2026-09-21 22:22:38**에 시작됐고
명령줄이 문자 그대로 `…/grok/0.2.25/…`를 가리킨다. 캐시 번들 mtime은 **2026-09-22 22:49:04**다.
그래서 이 세션의 `grok_build_status`는 `0.2.25`를 말한다 — **갱신 실패가 아니라 프로세스 고정이고,
명령줄의 버전 디렉터리가 자기보고 문자열보다 강한 증거다.** 다음 세션이 `grok_build_status`를 한 번
부르면 닫힌다.

**감사 방법:** 실측 프로브 9회 + 배포 번들 호출 8회, 코드·문서·테스트 **11축 병렬 감사**(에이전트
124개, 실패 0), 후보 112건 중 **101건이 적대적 검증 통과**(9건 기각·2건 보류), Grok 교차검증 6회.

⚠️ **Grok이 두 번 나를 교정했다.** ① `-cp`를 "인증 게이트도 통과"라고 보고했는데 `mayRunTurn`의
두 번째 경로가 `BOOLEAN_SHORTS`를 안 본다고 반증했다 — 배포된 `dist/hook.js`로 확인(빈 `GROK_HOME`
→ `deny`). 내 근거는 "인증된 상태에서 실행이 성공했다"였고 그건 게이트 미작동의 증거가 아니다.
② A32 접미사 초판이 `do NOT stage changes`까지 말해 스테이징만 요청한 작업을 거부했다 — 스테이징은
porcelain에 `M `로 보이고 HEAD도 안 움직여 검토 게이트를 우회하지 않는다. 좁혔다.

⚠️ **하네스가 3번 틀렸다.** ① 동시 실행 중인 감사 에이전트가 공용 스크래치패드에 쓴 파일이
`filesChanged`에 섞인 것을 결함으로 의심했다 — 래퍼는 정확했다. ② `--always-approve` 필요성
재측정은 사용자 `config.toml`의 `permission_mode = "always-approve"`가 오염시켜 **이 머신에서
측정 불가**다(계약 §6에 기록). ③ heredoc 역슬래시 함정을 **두 번 더** 밟았다 — A31이 고친 죽은
정규식과 같은 원인이다.

⚠️ **릴리스 체크리스트가 두 번 연속 실패했다.** `CONTRIBUTING`이 "테스트 없는 3곳, 이 목록이
잡는 유일한 수단"이라 적어둔 사이트들이 이미 낡아 있었다 — `package-lock.json` **0.2.24**(v0.2.25도
놓쳤다), `docs/03-plugin-spec.md` **0.2.23**. `handoff-version.test.ts`로 셋 다 묶었고, 나갔던
드리프트를 다시 주입해 **가드가 실제로 잡는 것**까지 확인했다.

### 실행 기록 — v0.2.25 (2026-09-13) · 감사가 연 결함 5건을 닫은 런

| 단계 | 결과 |
|---|---|
| 머지 내용 검증 | `origin/main`을 **내용으로** 두 방법(`git show` · `git grep`/`ls-tree`) 확인 — `realpathDeepest` 존재, 신규 3파일 존재, **낡은 문구 3개(F1·F2·F4 리터럴) 전부 사라짐** |
| 태그·릴리스 | 머지 직후 `v0.2.25` 태그 + 릴리스, `check-release-tag.mjs` **ok** |
| 산출물 동일성 | `origin/main`의 dist blob = **태그 v0.2.25의 blob** (`e52e9af…`) |
| 설치본 갱신 | 클론 먼저 → `plugin update` → `plugin list` **0.2.25** |
| 캐시 번들 신원 | 캐시 = 태그 blob, 개행 정규화 sha256 **둘 다 일치** |
| 5a 헤드리스 | `accept-release.mjs` 레포 **10/10** · 캐시 **10/10** (번들이 `0.2.25` 보고) |
| **F4 재현 (라이브)** | 같은 페이로드가 수정 전 **정확히 240초** 사망 → 수정 후 **606초에 `completed`**. 캐시 사본도 `930000ms`·"harness cap" 메시지 확인 |
| **F5 재현 (캐시 번들)** | 번들에 `realpathDeepest` 로직 존재, **옛 공동 catch 형태 없음**. 유닛 회귀 3건(심볼릭 링크·없는 leaf·win32 대소문자)은 CI의 ubuntu·windows 양쪽에서 통과 |

**감사 방법:** 네 항목군(릴리스 산출물 · 코드 · 문서의 실측 근거 · 고아/연결점)을 훑고, findings마다
**두 가지 독립 방법**으로 재도출한 뒤 **재검증 2회**(작업트리 / **새 클론**)를 돌렸다. F4는 3회
(소스 상수 · 실측 시간 · 상수를 1ms로 바꾼 대조). 적대적 리뷰가 F5를 찾았고(`GUARD_HAS_A_HOLE`),
수정본을 다시 물어 **`FIX_CLOSES_IT`** 을 받았다.

⚠️ **하네스가 5번 틀렸다 — 진짜 결함과 같은 수다.** 그중 둘은 새 함정이라 `CHANGELOG`에 남겼다:
**발췌를 리뷰시킬 때 끝 경계를 먼저 확인할 것**(`return` 직전에서 잘린 발췌가 "함수가 반환하지
않는다"는 오판을 만들었다 — Grok이 먼저 "잘린 것 같다"고 말해 잡혔다), **소스를 셸 문자열
이스케이프로 고치지 말 것**(`version.ts`를 깨뜨렸다 — `CLAUDE.md`가 이미 경고한 함정).

**남은 칸 하나:** 갱신 뒤 **새로 시작된 세션**의 `grok_build_status`가 `serverVersion: 0.2.25`를
말하는 것. 사람이 아니라 다음 세션이 닫는다 — 그리고 자기보고만으로는 부족하다는 §5b의 두 조건
(태그 blob 해시 · 세션 프로세스 시각)도 함께 본다.

---

## 6. 에이전트 규칙 (잔여 반복 방지)

1. **“다음 작업” 기본값 = 없음.** 사용자가 목표를 주기 전에는 polish PR을 열지 않는다.
2. 잔여를 말할 때 반드시 분류한다: **A 소비자 / B 수동 / C 보류 / D 제외 / E 새 기능(명시 요청 시)**.
3. A·B·C는 **이 레포 코드 PR로 닫지 않는다.** 문서 포인터만 갱신한다.
4. 새 기능은 `docs/00` 본질과 충돌하지 않을 때만, **done 정의를 먼저** 쓴 뒤 구현한다.
5. `CLAUDE.md` “다음 할 일”에는 **이 레포에서 당장 코딩할 항목만** 둔다. 없으면  
   `이 레포 범위 완료 — 외부/수동/보류는 docs/09` 한 줄.

---

## 7. 관련 링크

| 문서 | 역할 |
|---|---|
| `docs/06-roadmap.md` | Phase 체크리스트 |
| `docs/07-orchestrator-integration.md` | 소비자 기계 계약 |
| `examples/orchestrator-consumer.md` | 복사 의사코드 |
| `docs/08-getting-started-with-grok.md` | 사람 first-mile |
| `CONTRIBUTING.md` | tool 추가 시 dist/버전 규칙 |
