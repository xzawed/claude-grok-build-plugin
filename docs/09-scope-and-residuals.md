# 09. 범위 · 잔여 · “다음 할 일”이 반복되는 이유

이 문서는 **이 저장소(claude-grok-build-plugin) 안에서 무엇이 끝났는지**,  
**왜 체크리스트에 항목이 계속 남아 보이는지**,  
**에이전트가 다음에 무엇을 하면 안 되는지**의 SSOT다.

진행 Phase 체크: `docs/06-roadmap.md`  
제품 왜: `docs/00-product-vision.md`  
세션 즉시 컨텍스트: 루트 `CLAUDE.md`

---

## 1. 한 줄 결론

**이 플러그인 레포의 의도된 제품 범위(다리 + 협업 표면 + first-mile + 소비자 계약/키트)는 완료다 (최신 릴리스 `v0.2.12`).**  
남아 있는 문구는 “미구현 기능 백로그”가 아니라 **다른 레포 / 사람 손 / 의도적 보류**다.

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

## 5. Claude Code GUI — 수동 수락 체크리스트 (1회)

릴리즈 또는 의심될 때 **사람**이 실행. 결과를 CHANGELOG 한 줄 또는 이슈 코멘트로 남기면 “GUI e2e 잔여”는 **운영 절차로 전환**된 것이다.

1. Claude Code에서 마켓플레이스 설치: `grok@grok-marketplace` → `/reload-plugins`
2. `/grok:status` — `ready`, `billing`, `serverVersion` 확인
3. `/grok:setup` 또는 status가 가리키는 로그인 안내 (필요 시 터미널 `grok login`)
4. `/grok:route` — `nextAction` 표시
5. throwaway cwd에서 작은 `/grok:delegate` — `billing` 기대값, `filesChanged`, **커밋 없음**
6. `/grok:review` 흐름으로 diff 검토
7. (선택) worktree 위임 → list/diff/apply 또는 discard
8. PreToolUse: 로그아웃/미설치 시나리오는 가능하면 재현; 불가 시 `npm test`의 `hook-e2e`로 대체 인정

**이 레포 CI가 이미 대신하는 것:** 유닛·typecheck·dist 동기·hook 서브프로세스 e2e·tool 이름 surface.

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
