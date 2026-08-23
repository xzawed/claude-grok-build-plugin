/**
 * Consumer-side helpers for orchestrators / Claude after `routeTask`.
 * Pure — no spawn, no credentials. Narrative: docs/07-orchestrator-integration.md.
 */
import type { RouteDecision } from './routing.js';

export type OrchestratorPhase = 'handle_with_claude' | 'call_mcp_tool';

/** Machine-readable next step for Task Managers (and Claude sessions). */
export interface NextAction {
  phase: OrchestratorPhase;
  /** MCP tool to call when phase === call_mcp_tool */
  tool?: 'grok_build_plan' | 'grok_build_delegate' | 'grok_build_verify';
  worktree?: boolean;
  check?: boolean;
  /**
   * When true, call plan first and require human/Claude approval before any
   * editing tool (delegate/verify).
   */
  requiresHumanGateBeforeDelegate?: boolean;
  /** Short instruction for the orchestrator agent (Korean/English mix OK). */
  instruction: string;
}

/**
 * Map a RouteDecision to the immediate next orchestrator step.
 * Does not execute tools — consumers must still enforce no auto-commit.
 */
export function planNextAction(decision: RouteDecision): NextAction {
  if (decision.worker === 'claude') {
    return {
      phase: 'handle_with_claude',
      instruction:
        'Grok tool을 호출하지 마세요. Claude가 처리합니다. ' +
        decision.reasons.join(' '),
    };
  }

  if (decision.worker === 'plan_then_grok') {
    return {
      phase: 'call_mcp_tool',
      tool: 'grok_build_plan',
      worktree: decision.suggestedFlags?.worktree,
      requiresHumanGateBeforeDelegate: true,
      instruction:
        '먼저 grok_build_plan을 호출하세요. 계획을 검토·승인한 뒤에만 ' +
        'delegate/verify를 호출하세요. 자동 커밋 금지. billing을 확인하세요.',
    };
  }

  // worker === 'grok'
  const tool =
    decision.suggestedTool === 'grok_build_verify'
      ? 'grok_build_verify'
      : decision.suggestedTool === 'grok_build_plan'
        ? 'grok_build_plan'
        : 'grok_build_delegate';

  return {
    phase: 'call_mcp_tool',
    tool,
    worktree: decision.suggestedFlags?.worktree,
    check: decision.suggestedFlags?.check ?? tool === 'grok_build_verify',
    instruction:
      `${tool}을 호출하세요` +
      (decision.suggestedFlags?.worktree ? ' (worktree 권장)' : '') +
      '. filesChanged를 검토한 뒤 커밋하세요. billing이 기대 모드인지 확인하세요.',
  };
}

/**
 * After a plan gate: either abort to Claude or proceed to an edit tool.
 * For plan_then_grok, suggestedTool is usually plan — after approval we delegate.
 */
export function afterPlanGate(
  approved: boolean,
  decision: RouteDecision,
): NextAction {
  if (!approved) {
    return {
      phase: 'handle_with_claude',
      instruction:
        'Plan이 거절/보류되었습니다. Grok 편집 tool을 호출하지 말고 Claude가 이어갑니다.',
    };
  }

  // Prefer verify when original decision already wanted it; else delegate.
  const tool =
    decision.suggestedTool === 'grok_build_verify'
      ? 'grok_build_verify'
      : 'grok_build_delegate';

  return {
    phase: 'call_mcp_tool',
    tool,
    worktree: decision.suggestedFlags?.worktree ?? true,
    check: tool === 'grok_build_verify' || !!decision.suggestedFlags?.check,
    instruction:
      `Plan 승인됨 — ${tool} 호출. worktree 플래그 유지 권장. 자동 커밋 금지. billing 확인.`,
  };
}

export type ExpectedBilling = 'subscription' | 'metered_api';

/**
 * Consumer invariant: after any Grok tool result, observe billing.
 * Returns ok:false when missing or mismatched (do not treat as throw).
 */
export function observeBilling(
  resultBilling: string | undefined,
  expected: ExpectedBilling,
): { ok: boolean; message: string } {
  if (resultBilling === undefined || resultBilling === '') {
    return {
      ok: false,
      message: 'billing 필드가 없습니다 — 응답 스키마/파서를 확인하세요.',
    };
  }
  if (resultBilling !== expected) {
    return {
      ok: false,
      message:
        `billing 불일치: expected "${expected}", got "${resultBilling}". ` +
        '서버의 GROK_BUILD_AUTH_MODE를 점검하세요 — 이 태그는 그 설정에서 파생됩니다. ' +
        '태그 아래 누수(모델별 api_key, base_url 리다이렉트)는 이 비교로 탐지되지 않습니다.',
    };
  }
  return {
    ok: true,
    message: `billing "${expected}" 확인됨.`,
  };
}
