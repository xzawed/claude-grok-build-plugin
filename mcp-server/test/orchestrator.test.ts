import { describe, it, expect } from 'vitest';
import { routeTask } from '../src/routing.js';
import {
  planNextAction, afterPlanGate, observeBilling,
} from '../src/orchestrator.js';

describe('planNextAction', () => {
  it('HIGH/claude → handle_with_claude, no tool', () => {
    const d = routeTask({ signals: { security: true } });
    const n = planNextAction(d);
    expect(n.phase).toBe('handle_with_claude');
    expect(n.tool).toBeUndefined();
    expect(n.instruction).toMatch(/Grok tool|호출하지/);
  });

  it('MEDIUM/plan_then_grok → plan tool + human gate', () => {
    const d = routeTask({ task: 'vague work' });
    const n = planNextAction(d);
    expect(n.phase).toBe('call_mcp_tool');
    expect(n.tool).toBe('grok_build_plan');
    expect(n.requiresHumanGateBeforeDelegate).toBe(true);
  });

  it('LOW/grok verify path → verify tool', () => {
    const d = routeTask({ signals: { bulk: true, lowRiskDomain: true } });
    const n = planNextAction(d);
    expect(n.tool).toBe('grok_build_verify');
    expect(n.check).toBe(true);
    expect(n.worktree).toBe(true);
  });

  it('LOW/grok delegate path → delegate', () => {
    const d = routeTask({ signals: { bulk: true } });
    const n = planNextAction(d);
    expect(n.tool).toBe('grok_build_delegate');
  });
});

describe('afterPlanGate', () => {
  it('rejected → Claude, no edit tool', () => {
    const d = routeTask({ task: 'vague' });
    const n = afterPlanGate(false, d);
    expect(n.phase).toBe('handle_with_claude');
    expect(n.tool).toBeUndefined();
  });

  it('approved after plan_then_grok → delegate (not plan again)', () => {
    const d = routeTask({ task: 'vague' });
    expect(d.worker).toBe('plan_then_grok');
    const n = afterPlanGate(true, d);
    expect(n.phase).toBe('call_mcp_tool');
    expect(n.tool).toBe('grok_build_delegate');
    expect(n.worktree).toBe(true);
  });

  it('approved when original wanted verify → verify', () => {
    const d = routeTask({ signals: { bulk: true, lowRiskDomain: true } });
    const n = afterPlanGate(true, d);
    expect(n.tool).toBe('grok_build_verify');
  });
});

describe('observeBilling', () => {
  it('ok when matches', () => {
    expect(observeBilling('subscription', 'subscription').ok).toBe(true);
    expect(observeBilling('metered_api', 'metered_api').ok).toBe(true);
  });
  it('fails when missing or mismatched', () => {
    expect(observeBilling(undefined, 'subscription').ok).toBe(false);
    expect(observeBilling('metered_api', 'subscription').ok).toBe(false);
    const msg = observeBilling('metered_api', 'subscription').message;
    expect(msg).toMatch(/불일치/);
    // The mismatch is derived from GROK_BUILD_AUTH_MODE. It must not be reported as a leaked
    // key, and it must say what this comparison cannot see.
    expect(msg).toMatch(/GROK_BUILD_AUTH_MODE/);
    expect(msg).not.toMatch(/키 우회/);
    expect(msg).toMatch(/탐지되지 않/);
  });
});
