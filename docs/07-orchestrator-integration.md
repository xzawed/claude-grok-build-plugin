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
