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
  → RouteDecision { risk, worker, reasons, suggestedTool?, suggestedFlags?, safetyNotes }
  → if worker === "claude": Claude handles
  → if plan_then_grok: grok_build_plan → human/Claude gate → grok_build_delegate|verify
  → if grok: grok_build_delegate|verify (prefer suggestedFlags.worktree)
  → always: review diff; never auto-commit
```

## RouteDecision (JSON)

| 필드 | 의미 |
|---|---|
| `risk` | `LOW` \| `MEDIUM` \| `HIGH` |
| `worker` | `claude` \| `grok` \| `plan_then_grok` |
| `reasons` | 한국어 근거 문자열 배열 |
| `suggestedTool` | 다음 MCP tool 이름 (claude면 없음) |
| `suggestedFlags` | `{ worktree?, check? }` |
| `safetyNotes` | 커밋/과금 주의 |

## signals (권장)

오케스트레이터가 태스크를 분류할 때 boolean으로 넘긴다. 텍스트만 넘기면 키워드 힌트만
쓰이며 **모호하면 MEDIUM/HIGH 쪽으로 기운다** (fail closed toward Claude).

HIGH를 켜면 LOW 신호보다 항상 우선: `architecture`, `security`, `regulated`,
`monorepoWide`, `finalReview`.

## 하지 않는 것

- `grok_build_route`가 위임을 실행하지 않음
- 호출별 `authMode` 오버라이드 없음
- 자동 커밋/PR 없음

## 연동 체크리스트

1. 오케스트레이터 Task schema에 `signals` 필드 추가
2. 실행 전 `grok_build_route` 호출
3. `worker === "claude"`이면 Grok tool 호출 금지
4. 위임 후 `billing` 필드 로깅 (subscription vs metered_api)
5. 결과 diff는 QA/사람 게이트

## 의사코드 (Task Manager)

```ts
// Pseudocode — consumer repo
const decision = await mcp.call("grok_build_route", {
  task: task.title,
  signals: task.signals,          // prefer structured
  metered_billing: authMode === "api",
});

if (decision.worker === "claude") {
  return runClaudeAgent(task);
}

if (decision.worker === "plan_then_grok") {
  const plan = await mcp.call("grok_build_plan", { prompt, cwd });
  if (!await humanOrClaudeApproves(plan)) return;
}

const tool = decision.suggestedTool ?? "grok_build_delegate";
const result = await mcp.call(tool, {
  prompt,
  cwd,
  worktree: decision.suggestedFlags?.worktree,
  // never pass per-call authMode
});

assert(result.billing === expectedBilling);
await reviewDiff(result.filesChanged); // never auto-commit
```

## 픽스처

기계 검증용 입출력 예: [`docs/specs/samples/route-decision-examples.json`](specs/samples/route-decision-examples.json)  
단위 테스트는 `mcp-server/test/routing.test.ts`가 동일 규칙을 고정한다.

## 안전 불변식 (소비자도 지킬 것)

| 불변식 | 위반 시 |
|---|---|
| route 결과가 `claude`면 Grok tool 호출 금지 | 잘못된 위임·보안 사고 위험 |
| 자동 커밋/PR 금지 | 품질 게이트 우회 |
| 서버 `GROK_BUILD_AUTH_MODE`만으로 과금 | 호출별 모드 누수 |
| `billing` 필드 관측 | 조용한 종량제 샌드 미탐지 |
