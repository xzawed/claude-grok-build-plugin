# 09. 범위 · 잔여 · “다음 할 일”이 반복되는 이유

이 문서는 **이 저장소(claude-grok-build-plugin) 안에서 무엇이 끝났는지**,  
**왜 체크리스트에 항목이 계속 남아 보이는지**,  
**에이전트가 다음에 무엇을 하면 안 되는지**의 SSOT다.

진행 Phase 체크: `docs/06-roadmap.md`  
제품 왜: `docs/00-product-vision.md`  
세션 즉시 컨텍스트: 루트 `CLAUDE.md`

---

## 1. 한 줄 결론

**이 플러그인 레포의 의도된 제품 범위(다리 + 협업 표면 + first-mile + 소비자 계약/키트)는 완료다 (최신 릴리스 `v0.2.24`).**  
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
