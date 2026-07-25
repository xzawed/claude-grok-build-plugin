/**
 * Read-only status snapshot for humans and orchestrators.
 * Composes auth + usage — no spawn, no credentials written.
 */
import type { AuthCheckResult } from './types.js';
import type { LastSessionHint, UsageSummary } from './usage.js';

export interface StatusSnapshot {
  ready: boolean;
  mode: AuthCheckResult['mode'];
  billing: AuthCheckResult['billing'];
  serverVersion: string;
  authMessage: string;
  reason?: AuthCheckResult['reason'];
  /** From usage insights — null when no history. */
  usageHeadline: string;
  successRatePct: number | null;
  subscriptionBillingPct: number | null;
  totalDelegations: number;
  lastSession?: LastSessionHint;
  tips: string[];
  /** Suggested next slash/MCP path (Korean). */
  nextSteps: string[];
}

/** Pure: fold auth + usage into one dashboard payload. */
export function buildStatusSnapshot(
  auth: AuthCheckResult,
  usage: UsageSummary,
): StatusSnapshot {
  const nextSteps: string[] = [];
  if (!auth.ok) {
    nextSteps.push('`/grok:setup` 또는 auth 메시지대로 CLI 설치·`grok login`을 완료하세요.');
  } else if (usage.total <= 0) {
    nextSteps.push('`/grok:tour` 또는 작은 `/grok:delegate`로 첫 성공(billing 확인)을 만드세요.');
  } else {
    nextSteps.push('적합 작업은 `/grok:route`의 nextAction을 따르세요.');
    if (usage.lastSession?.sessionId) {
      nextSteps.push('`/grok:resume`으로 마지막 Grok 세션을 이어갈 수 있습니다.');
    }
    nextSteps.push('위임 후 `/grok:review`로 diff·billing을 검수하세요 (자동 커밋 없음).');
  }

  const snap: StatusSnapshot = {
    ready: auth.ok,
    mode: auth.mode,
    billing: auth.billing,
    serverVersion: auth.serverVersion,
    authMessage: auth.message,
    usageHeadline: usage.insights.headline,
    successRatePct: usage.insights.successRatePct,
    subscriptionBillingPct: usage.insights.subscriptionBillingPct,
    totalDelegations: usage.total,
    tips: usage.insights.tips.slice(0, 3),
    nextSteps: nextSteps.slice(0, 4),
  };
  if (auth.reason) snap.reason = auth.reason;
  if (usage.lastSession) snap.lastSession = usage.lastSession;
  return snap;
}
