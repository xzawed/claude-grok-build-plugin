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

```ts
// Pseudocode — consumer repo
// Pure helpers also exist in-plugin: planNextAction / afterPlanGate / observeBilling
const decision = await mcp.call("grok_build_route", {
  task: task.title,
  signals: task.signals,          // prefer structured
  metered_billing: authMode === "api",
});

const step = decision.nextAction; // or planNextAction(decision)

if (step.phase === "handle_with_claude") {
  return runClaudeAgent(task);
}

if (step.requiresHumanGateBeforeDelegate) {
  const plan = await mcp.call("grok_build_plan", { prompt, cwd });
  const approved = await humanOrClaudeApproves(plan);
  // afterPlanGate(approved, decision) in-plugin
  if (!approved) return runClaudeAgent(task);
}

const tool = step.tool ?? decision.suggestedTool ?? "grok_build_delegate";
const result = await mcp.call(tool, {
  prompt,
  cwd,
  worktree: step.worktree ?? decision.suggestedFlags?.worktree,
  // never pass per-call authMode
});

// observeBilling(result.billing, expectedBilling)
assert(result.billing === expectedBilling);
await reviewDiff(result.filesChanged); // never auto-commit — /grok:review
```

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
| `billing` 필드 관측 | 조용한 종량제 샌드 미탐지 |
