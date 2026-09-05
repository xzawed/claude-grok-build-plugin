# 07. 오케스트레이터 통합 계약

Phase 4 Slice A: 외부 멀티에이전트 오케스트레이터(또는 Claude 세션)가 Grok Build를
**저비용 병렬 워커**로 고를 때 쓰는 기계 계약이다.

정책 서사: `docs/05-routing-policy.md`  
구현: `mcp-server/src/routing.ts` (`routeTask`)  
MCP: `grok_build_route` (추천만 — spawn/과금 없음)

## 흐름

```
Task Manager
  → grok_build_route({ task?, signals?, metered_billing? })
  → RouteDecision + nextAction
  → switch nextAction.phase:
       handle_with_claude → Claude only (no Grok tools)
       call_mcp_tool → call nextAction.tool (+ flags)
         if requiresHumanGateBeforeDelegate: plan → approve → afterPlanGate → edit tool
  → observe billing on every Grok result
  → review diff (/grok:review); never auto-commit
```

구현 헬퍼 (순수 함수, spawn 없음):

| 함수 | 파일 | 용도 |
|---|---|---|
| `routeTask` | `routing.ts` | 위험도·워커 추천 |
| `planNextAction` | `orchestrator.ts` | 즉시 다음 스텝 |
| `afterPlanGate` | `orchestrator.ts` | plan 승인/거절 후 스텝 |
| `observeBilling` | `orchestrator.ts` | 결과 `billing` 관측 |

MCP `grok_build_route` 응답은 `routeTask` 결과에 **`nextAction: planNextAction(decision)`** 을
붙여 반환한다.

## RouteDecision (JSON)

| 필드 | 의미 |
|---|---|
| `risk` | `LOW` \| `MEDIUM` \| `HIGH` |
| `worker` | `claude` \| `grok` \| `plan_then_grok` |
| `reasons` | 한국어 근거 문자열 배열 |
| `suggestedTool` | 다음 MCP tool 이름 (claude면 없음) |
| `suggestedFlags` | `{ worktree?, check? }` |
| `safetyNotes` | 커밋/과금 주의 |
| `nextAction` | (`grok_build_route`만) 기계 실행 스텝 — 아래 |

## signals (권장)

오케스트레이터가 태스크를 분류할 때 boolean으로 넘긴다. 텍스트만 넘기면 키워드 힌트만
쓰이며 **모호하면 MEDIUM/HIGH 쪽으로 기운다** (fail closed toward Claude).

HIGH를 켜면 LOW 신호보다 항상 우선: `architecture`, `security`, `regulated`,
`monorepoWide`, `finalReview`.

## 하지 않는 것

- `grok_build_route`가 위임을 실행하지 않음
- 호출별 `authMode` 오버라이드 없음
- 자동 커밋/PR 없음

## nextAction (JSON)

| 필드 | 의미 |
|---|---|
| `phase` | `handle_with_claude` \| `call_mcp_tool` |
| `tool?` | `grok_build_plan` \| `grok_build_delegate` \| `grok_build_verify` |
| `worktree?` / `check?` | 다음 호출 플래그 힌트 |
| `requiresHumanGateBeforeDelegate?` | true면 plan 승인 전 편집 tool 금지 |
| `instruction` | 오케스트레이터/에이전트용 한 줄 지시 |

## 연동 체크리스트

1. 오케스트레이터 Task schema에 `signals` 필드 추가
2. 실행 전 `grok_build_route` 호출
3. **`nextAction.phase === "handle_with_claude"`** 이면 Grok tool 호출 금지  
   (또는 `worker === "claude"`)
4. `requiresHumanGateBeforeDelegate` 이면 plan → 승인 → (편집 tool)
5. 위임 후 **`billing` 필드 관측** (`observeBilling` 또는 동등 로직)
6. 결과 diff는 QA/사람 게이트 (`/grok:review` 권장) — **자동 커밋 없음**
7. 멀티턴 후속은 history `lastSession.sessionId` + `resume` (`/grok:resume`)

## 의사코드 (Task Manager)

**루프 본문은 [`examples/orchestrator-consumer.md`](../examples/orchestrator-consumer.md)
"Minimal loop"에 한 벌만 둔다.** 여기 사본을 두었을 때 같은 버그를 두 번 고쳤고
(`docs/releases/v0.2.14.md`), 그 뒤 두 사본이 **같은 스코프 버그**를 함께 갖고 있었다.

계약이 규정하는 것은 코드가 아니라 아래 두 규칙이다 — 소비자는 어떤 언어로 구현하든 이것을 지킨다.

- **plan 단계는 1회용이다.** 휴먼 게이트를 통과한 뒤 `step.tool`을 재사용하면
  `grok_build_plan`을 다시 부르고 **영원히 위임하지 않는다** — 그 분기에서 `step.tool`이 쥐고
  있던 값이 정확히 `"grok_build_plan"`이기 때문이다. 승인 후 호출할 tool은
  `suggestedTool`이 `grok_build_verify`면 그것, 아니면 `grok_build_delegate`다.
  (`afterPlanGate`가 in-plugin으로 같은 계산을 하지만 **어떤 MCP tool도 반환하지 않고**
  패키지는 `private`이라 외부 소비자는 이 두 줄을 직접 구현한다.)
- **호출별 `authMode`는 없다.** `billing`은 서버 설정에서 파생되므로 소비자는 기대값과
  대조만 하고(`result.billing === expectedBilling`), 자동 커밋하지 않는다.

## 픽스처 · 예제

| 자산 | 용도 |
|---|---|
| [`docs/specs/samples/route-decision-examples.json`](specs/samples/route-decision-examples.json) | `risk`/`worker`/**`nextAction`** 기대값 |
| `mcp-server/test/routing.test.ts` | 픽스처 기계 검증 |
| [`examples/orchestrator-consumer.md`](../examples/orchestrator-consumer.md) | 소비자 복사 의사코드 + 슬래시 경로 |

## 안전 불변식 (소비자도 지킬 것)

| 불변식 | 위반 시 |
|---|---|
| route 결과가 `claude`면 Grok tool 호출 금지 | 잘못된 위임·보안 사고 위험 |
| 자동 커밋/PR 금지 | 품질 게이트 우회 |
| 서버 `GROK_BUILD_AUTH_MODE`만으로 과금 | 호출별 모드 누수 |
| `billing` 필드를 기대 모드와 비교 (`observeBilling`) | 서버 `GROK_BUILD_AUTH_MODE`가 소비자 기대와 다른 불일치를 놓침. 태그 아래 누수(per-model `api_key`/`env_key`, `base_url` redirect)는 이 비교로 탐지되지 않는다 |
