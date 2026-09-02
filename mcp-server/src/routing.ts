/**
 * Codeified routing policy for Claude (orchestrator) vs Grok (worker).
 * Policy narrative: docs/05-routing-policy.md — this module is the machine SSOT.
 * Recommendation only: never spawns grok or touches credentials.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type WorkerChoice = 'claude' | 'grok' | 'plan_then_grok';

/** Optional structured signals from an orchestrator Task Manager. */
export interface RouteSignals {
  /** Same pattern across many files / mechanical transform */
  bulk?: boolean;
  /** Tests, docs, boilerplate, low blast radius */
  lowRiskDomain?: boolean;
  /** Single module / clear acceptance, limited context */
  narrowScope?: boolean;
  /** Prototype / try multiple approaches */
  exploratory?: boolean;
  /** Architecture or design decisions */
  architecture?: boolean;
  /** Auth, crypto, permissions, secrets */
  security?: boolean;
  /** Medical, finance, compliance */
  regulated?: boolean;
  /** Needs monorepo-wide or huge context */
  monorepoWide?: boolean;
  /** Final review / quality gate */
  finalReview?: boolean;
}

export interface RouteInput {
  /** Free-text task (used only for light keyword hints if signals sparse). */
  task?: string;
  signals?: RouteSignals;
  /** When true (API/metered billing context), require stronger LOW signals for grok. */
  meteredBilling?: boolean;
}

export interface RouteDecision {
  risk: RiskLevel;
  worker: WorkerChoice;
  /** Human/orchestrator-facing reasons (Korean). */
  reasons: string[];
  /** Suggested MCP tool name when worker involves Grok; omit for claude-only. */
  suggestedTool?: 'grok_build_delegate' | 'grok_build_plan' | 'grok_build_verify';
  /** Suggested flags for the next tool call. */
  suggestedFlags?: {
    worktree?: boolean;
    check?: boolean;
  };
  /** Always remind: review before commit; no auto-commit. */
  safetyNotes: string[];
}

const HIGH_KEYS: (keyof RouteSignals)[] = [
  'architecture', 'security', 'regulated', 'monorepoWide', 'finalReview',
];
const LOW_KEYS: (keyof RouteSignals)[] = [
  'bulk', 'lowRiskDomain', 'narrowScope', 'exploratory',
];

/** Light keyword heuristics when orchestrator only sends free text. Fail closed toward Claude. */
export function inferSignalsFromTask(task: string): RouteSignals {
  const t = task.toLowerCase();
  const s: RouteSignals = {};
  if (/(auth|oauth|jwt|crypto|encrypt|permission|rbac|secret|password|credential)/i.test(t)) {
    s.security = true;
  }
  if (/(hipaa|pci|gdpr|medical|금융|의료|규제|compliance)/i.test(t)) {
    s.regulated = true;
  }
  if (/(architect|design decision|api shape|아키텍처|설계 결정)/i.test(t)) {
    s.architecture = true;
  }
  if (/(monorepo|across all packages|전체 저장소|repo-wide)/i.test(t)) {
    s.monorepoWide = true;
  }
  if (/(code review|품질 게이트|final review|merge approval)/i.test(t)) {
    s.finalReview = true;
  }
  // `n files` was written as a stand-in for "N files" but read as an unanchored substring, so
  // it fired inside "i·n files", "o·n files", "broke·n files"; `every ` fired on "on every
  // request". A bulk signal skips the weak-LOW downgrade below, so one accidental match sent an
  // ordinary debugging task straight to LOW / grok / unattended delegate — the inverse of this
  // module's stated fail-closed lean. Now: a real digit count, and `every` only before a noun
  // that means work, not time. Measured: this also starts matching "update 40 files", which the
  // old pattern missed entirely.
  if (/(all files|\d+\s*files?\b|every\s+(file|module|package|component|test|directory|repo)|migrate|rename|일괄|마이그레이션|bulk)/i.test(t)) {
    s.bulk = true;
  }
  if (/(unit test|backfill test|테스트 백필|boilerplate|scaffold|dto|crud|docs only|문서만)/i.test(t)) {
    s.lowRiskDomain = true;
  }
  if (/(single file|one module|단일 파일|한 모듈)/i.test(t)) {
    s.narrowScope = true;
  }
  if (/(prototype|spike|explor|프로토타입|실험)/i.test(t)) {
    s.exploratory = true;
  }
  return s;
}

function mergeSignals(explicit?: RouteSignals, fromTask?: RouteSignals): RouteSignals {
  return { ...fromTask, ...explicit };
}

function countTrue(s: RouteSignals, keys: (keyof RouteSignals)[]): number {
  return keys.reduce((n, k) => n + (s[k] ? 1 : 0), 0);
}

/**
 * Pure routing decision. Security/regulated/architecture/final review always beat LOW signals.
 */
export function routeTask(input: RouteInput): RouteDecision {
  const fromTask = input.task?.trim() ? inferSignalsFromTask(input.task) : {};
  const s = mergeSignals(input.signals, fromTask);
  const safetyNotes = [
    'Grok 결과는 항상 Claude/사람이 diff 검토 후 커밋 (자동 커밋 없음).',
    '구독 모드에서는 응답 billing이 subscription인지 확인하세요.',
  ];

  const highHits = HIGH_KEYS.filter((k) => s[k]);
  if (highHits.length > 0) {
    return {
      risk: 'HIGH',
      worker: 'claude',
      reasons: highHits.map((k) => highReason(k)),
      safetyNotes,
    };
  }

  const lowCount = countTrue(s, LOW_KEYS);
  const metered = !!input.meteredBilling;

  // MEDIUM: mixed or weak LOW, or metered with only one weak low signal
  if (lowCount === 0) {
    return {
      risk: 'MEDIUM',
      worker: 'plan_then_grok',
      reasons: [
        '명확한 저위험/대량 신호가 없어 중간 위험으로 분류했습니다.',
        '먼저 plan으로 접근을 본 뒤, 적합할 때만 위임하세요.',
      ],
      suggestedTool: 'grok_build_plan',
      suggestedFlags: { worktree: true },
      safetyNotes,
    };
  }

  if (metered && lowCount < 2) {
    return {
      risk: 'MEDIUM',
      worker: 'plan_then_grok',
      reasons: [
        '종량제(API) 과금 컨텍스트에서는 위임 기준을 더 엄격히 적용합니다.',
        'LOW 신호가 충분하지 않아 plan 후 판단이 안전합니다.',
      ],
      suggestedTool: 'grok_build_plan',
      suggestedFlags: { worktree: true },
      safetyNotes,
    };
  }

  if (lowCount === 1 && !s.bulk && !s.lowRiskDomain) {
    // Single exploratory or narrow only → medium
    return {
      risk: 'MEDIUM',
      worker: 'plan_then_grok',
      reasons: [
        'LOW 신호가 약합니다 (탐색/좁은 범위만). plan 후 위임을 권장합니다.',
      ],
      suggestedTool: 'grok_build_plan',
      suggestedFlags: { worktree: true },
      safetyNotes,
    };
  }

  // LOW: clear bulk/low-risk/narrow combo
  const reasons = LOW_KEYS.filter((k) => s[k]).map((k) => lowReason(k));
  const useVerify = !!s.lowRiskDomain && !!s.bulk;
  return {
    risk: 'LOW',
    worker: 'grok',
    reasons,
    suggestedTool: useVerify ? 'grok_build_verify' : 'grok_build_delegate',
    suggestedFlags: {
      worktree: !!(s.bulk || s.exploratory),
      check: useVerify,
    },
    safetyNotes,
  };
}

function highReason(k: keyof RouteSignals): string {
  switch (k) {
    case 'architecture': return '아키텍처/설계 판단이 포함됩니다 — Claude 유지.';
    case 'security': return '보안 관련 변경입니다 — Claude 유지.';
    case 'regulated': return '규제 도메인입니다 — Claude/사람 최종 판단.';
    case 'monorepoWide': return '모노레포 광역 맥락이 필요합니다 — Claude 유지.';
    case 'finalReview': return '최종 리뷰/품질 게이트는 Claude/사람 소유입니다.';
    default: return String(k);
  }
}

function lowReason(k: keyof RouteSignals): string {
  switch (k) {
    case 'bulk': return '대량/반복 패턴 — Grok 병렬 워커에 적합.';
    case 'lowRiskDomain': return '저위험 영역(테스트·문서·보일러플레이트 등).';
    case 'narrowScope': return '좁은 독립 범위.';
    case 'exploratory': return '탐색/프로토타입 — Grok 실험에 적합.';
    default: return String(k);
  }
}
