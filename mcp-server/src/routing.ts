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
  /** Irreversible operation: drop/truncate/purge/delete-all */
  destructive?: boolean;
  /** Targets production / live systems */
  production?: boolean;
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
  // MEASURED 2026-09-05: this was the ONLY one of the nine rules with no Korean alternates, in a
  // product whose every user-facing string is Korean. "운영 서버의 인증 토큰 발급 로직을 바꿔라"
  // scored MEDIUM while its English twin scored HIGH, and adding a bulk word to the Korean
  // sentence dropped it to LOW / unattended delegate. The highest-risk signal was the one that
  // did not speak the user's language.
  if (/(auth|oauth|jwt|crypto|encrypt|permission|rbac|secret|password|credential|인증|권한|암호|비밀번호|토큰|자격\s*증명|보안|세션 키|키 발급)/i.test(t)) {
    s.security = true;
  }
  // Irreversible operations. Kept separate from `security` because the pairing is what matters:
  // "drop the old columns" is routine in a migration branch and catastrophic against production.
  // Every term here must name an OBJECT that cannot be restored, never a bare verb. Grok's review
  // of the first draft found both failure directions in one pass:
  //   too wide  — `드롭` fired inside `드롭다운`(dropdown), `초기화` inside "폼 상태 초기화"
  //               (reset form state), bare `purge` inside "purge unused CSS". Korean has no word
  //               boundaries, so a short Korean stem is a substring trap by construction.
  //   too narrow — `terraform destroy`, `kubectl delete namespace`, `aws s3 rb`, `dropdb` are the
  //               shapes real infrastructure damage actually takes, and none of them matched.
  // The keyword net will never be complete; it is here to catch the common shapes, and the
  // MEDIUM floor below covers the rest.
  if (
    // Verb + the thing it destroys. `delete all` alone is out: "delete all unused imports" is
    // ordinary cleanup, so the object must be data, not code.
    /(drop\s+(?:\w+\s+){0,3}(?:tables?|columns?|databases?|schemas?|indexe?s?)|dropdb|db:drop|truncate\s+(?:\w+\s+){0,2}(?:table|db|database)|(?:terraform|pulumi)\s+destroy|kubectl\s+delete|\bs3\s+(?:rb\b|rm\b[^\n]*--recursive)|rm\s+-[rf]{2,}|delete\s+(?:the\s+)?(?:namespace|bucket|database|table|records?|rows?))/i.test(t)
    // Korean: object first, then the verb. Restricted to data objects, and 초기화(reset) only for
    // a database — "폼 상태 초기화"/"zod 스키마 초기화" are everyday work, not destruction.
    || /(테이블|디비|\bDB\b|데이터베이스|버킷|인덱스)\s*(?:를|을|은|는|도)?\s*(?:삭제|드롭(?!다운))/i.test(t)
    || /(디비|\bDB\b|데이터베이스)\s*(?:를|을|은|는|도)?\s*초기화/i.test(t)
    || /(데이터|레코드|계정|사용자)\s*(?:를|을)?\s*(?:전부|모두)\s*삭제/i.test(t)
    || /되돌릴 수 없/i.test(t)
  ) {
    s.destructive = true;
  }
  // Require the word to point at a live SYSTEM, not just appear. Bare `production` also matches
  // "fix the production build config", which is ordinary work and should stay delegable; allowing
  // a couple of words in between keeps "production customer database".
  // Also matched as identifiers, not just prose: `prod-customer-backups` and `customer_live` are
  // how live resources are actually named, and Grok's review routed both LOW while they named
  // real production data.
  // Negation matters here: "non-production" and "비프로덕션" CONTAIN the word and mean the
  // opposite. `go-live` is a launch checklist, not a live system, so hyphenated words are out —
  // only the `prod-` resource prefix and `_live`/`_prod` identifier suffixes count.
  if (
    /(?<!non-)(?<!non )\b(production|prod|live)\s+(?:\w+\s+){0,2}(server|database|db|environment|env|system|cluster|instance|data|traffic|users?|workspace|bucket|namespace|account)/i.test(t)
    || /\bprod-[a-z0-9-]+|\b\w+_(?:live|prod)\b/i.test(t)
    || /(?<!비)프로덕션|실서버|운영\s*(서버|환경|디비|\bDB\b|데이터베이스|계정)/i.test(t)
  ) {
    s.production = true;
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

/**
 * Explicit signals win — EXCEPT that a caller cannot switch OFF a danger the text plainly states.
 * A struct serializer that fills every field (Go without omitempty, Python asdict) would otherwise
 * ship `security:false` on every call and disable the keyword net for a whole session.
 *
 * MEASURED 2026-09-05 (docs/10 A1): v0.2.19 protected only `destructive`/`production`, so
 * `{task: "rotate the OAuth client secret …", signals:{security:false}}` fell HIGH → MEDIUM, and a
 * fully-populated struct fell to LOW / unattended delegate. The list is now every risk-raising key.
 * It stays one-directional: an explicit `true` may still ARM a danger the text does not state, and
 * LOW keys stay fully overridable — demoting your own low-risk claim is legitimate, disarming a
 * danger the text states is not.
 */
const RISK_RAISING: (keyof RouteSignals)[] = [...HIGH_KEYS, 'destructive', 'production'];
function mergeSignals(explicit?: RouteSignals, fromTask?: RouteSignals): RouteSignals {
  const merged: RouteSignals = { ...fromTask, ...explicit };
  for (const k of RISK_RAISING) {
    if (fromTask?.[k]) merged[k] = true;
  }
  return merged;
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

  // MEASURED 2026-09-05: "migrate the production customer database … and drop the old columns"
  // routed LOW / grok_build_delegate with no human gate — `migrate` set `bulk`, and a bulk signal
  // skips the weak-LOW demotion further down, so one word carried an irreversible production
  // operation past every check. Neither `production` nor `drop` existed as a signal at all.
  // Together they are the one combination this router must never hand to an unattended worker;
  // `worktree: true` would not have helped, because a dropped column is not a file edit.
  if (s.destructive && s.production) {
    return {
      risk: 'HIGH',
      worker: 'claude',
      reasons: [
        '운영 환경에 대한 되돌릴 수 없는 작업입니다 — Claude/사람이 직접 수행하세요.',
        'worktree 격리는 파일 편집만 되돌립니다. 삭제된 데이터는 복구되지 않습니다.',
      ],
      safetyNotes,
    };
  }

  const highHits = HIGH_KEYS.filter((k) => s[k]);
  if (highHits.length > 0) {
    return {
      risk: 'HIGH',
      worker: 'claude',
      reasons: highHits.map((k) => highReason(k)),
      safetyNotes,
    };
  }

  // Either danger alone is not automatically HIGH — "drop the old columns" on a feature branch is
  // ordinary work, and "fix the production build config" touches nothing live. But neither may
  // fall through to LOW / unattended delegate, which is exactly what a bulk word used to do.
  if (s.destructive || s.production) {
    return {
      risk: 'MEDIUM',
      worker: 'plan_then_grok',
      reasons: [
        s.destructive
          ? '되돌릴 수 없는 작업(삭제/드롭/초기화)이 포함돼 있습니다 — plan으로 범위를 먼저 확인하세요.'
          : '운영/실서버 대상으로 읽힙니다 — plan으로 범위를 먼저 확인하세요.',
        '대량 작업 신호가 있어도 이 분류는 낮아지지 않습니다.',
      ],
      suggestedTool: 'grok_build_plan',
      suggestedFlags: { worktree: true },
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
