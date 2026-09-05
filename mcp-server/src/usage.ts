import { readFileSync } from 'node:fs';
import type { HistoryEntry } from './history.js';
import { defaultHistoryPath } from './history.js';

export interface RecentEntry {
  ts: string;
  status: string;
  mode: string;
  billing: string;
  cwd: string;
  promptPreview: string;
  /** Present when the run returned a grok sessionId (use with resume). */
  sessionId?: string;
}

/** Most recent history row that still has a grok sessionId (for --resume). */
export interface LastSessionHint {
  sessionId: string;
  ts: string;
  cwd: string;
  status: string;
  promptPreview: string;
}

export interface UsageInsights {
  /** completed / total * 100, null if total === 0 */
  successRatePct: number | null;
  /** subscription billing count / total * 100, null if total === 0 */
  subscriptionBillingPct: number | null;
  /** One-line human summary for Claude/user (Korean). */
  headline: string;
  /** Short actionable tips (0–3). */
  tips: string[];
}

export interface UsageSummary {
  total: number;
  byMode: { subscription: number; api: number };
  byBilling: { subscription: number; metered_api: number };
  byStatus: { completed: number; auth_error: number; timeout: number; grok_error: number };
  counts: { plan: number; check: number; worktree: number };
  totalFilesChanged: number;
  firstTs?: string;
  lastTs?: string;
  recent: RecentEntry[];
  insights: UsageInsights;
  /** Newest entry with sessionId in the filtered set (cwd filter applies). */
  lastSession?: LastSessionHint;
}

/**
 * Pure: scan history newest-first for a row that has sessionId.
 * Prefer completed runs when choosing among the same recency? No — newest with any
 * sessionId wins (partial runs may still be resumable on grok's side).
 */
/**
 * One directory is one directory, however it was spelled when the row was written.
 *
 * MEASURED 2026-09-05 on a real 1779-row history: exact string equality hid 386 rows (21.7%).
 * A single project had four spellings (`f:\…\Mathless`, `F:\…`, `f:/…`, `F:/…`) because different
 * sessions pass the cwd differently, so `/grok:status` in that project reported 205 delegations or
 * 37 or 28 depending on which spelling the caller happened to use — and a 72.7% success rate next
 * to a 36.7% one for the same work.
 *
 * Separator and trailing slash never carry meaning. Case does on POSIX, so it is folded only on
 * win32 — lowercasing everywhere would merge `/srv/A` and `/srv/a`, which are two real directories.
 */
export function normalizeCwd(cwd: string, platform: string = process.platform): string {
  const unified = cwd.split('\\').join('/').replace(/\/+$/, '');
  return platform === 'win32' ? unified.toLowerCase() : unified;
}

const sameCwd = (a: string | undefined, b: string): boolean =>
  a !== undefined && normalizeCwd(a) === normalizeCwd(b);

export function latestResumableSession(
  entries: HistoryEntry[],
  opts: { cwd?: string } = {},
): LastSessionHint | undefined {
  const filtered = opts.cwd ? entries.filter((e) => sameCwd(e.cwd, opts.cwd!)) : entries;
  for (let i = filtered.length - 1; i >= 0; i--) {
    const e = filtered[i];
    if (typeof e.sessionId === 'string' && e.sessionId.length > 0) {
      return {
        sessionId: e.sessionId,
        ts: e.ts,
        cwd: e.cwd,
        status: e.status,
        promptPreview: e.promptPreview,
      };
    }
  }
  return undefined;
}

/** Pure: build persuasion-oriented insights from already-aggregated counts. */
export function buildUsageInsights(s: Omit<UsageSummary, 'insights' | 'recent' | 'firstTs' | 'lastTs'> & {
  firstTs?: string;
  lastTs?: string;
}): UsageInsights {
  if (s.total <= 0) {
    return {
      successRatePct: null,
      subscriptionBillingPct: null,
      headline: '아직 위임 이력이 없습니다. `/grok:setup` 후 샘플 위임으로 첫 성공을 만들어 보세요.',
      tips: [
        '저리스크 작업(테스트 백필·보일러플레이트)에 `/grok:tests` 또는 `/grok:boilerplate`를 써 보세요.',
        '구독 모드면 응답 `billing: "subscription"`을 확인하세요.',
      ],
    };
  }
  const completed = s.byStatus.completed;
  const successRatePct = Math.round((completed / s.total) * 1000) / 10;
  const subscriptionBillingPct = Math.round((s.byBilling.subscription / s.total) * 1000) / 10;
  const tips: string[] = [];
  if (s.byBilling.metered_api > 0 && s.byBilling.subscription === 0) {
    tips.push('모든 위임이 종량제(metered_api)입니다. 구독을 쓰려면 서버의 `GROK_BUILD_AUTH_MODE`가 api가 아닌지 확인하세요 — 이 태그는 그 설정만 따릅니다.');
  } else if (s.byBilling.metered_api > 0) {
    tips.push(`종량제 위임 ${s.byBilling.metered_api}건이 있습니다. 가능하면 구독 모드로 통일해 과금을 단순화하세요.`);
  }
  if (successRatePct < 70) {
    tips.push('성공률이 낮습니다. 범위를 줄이거나 `/grok:plan` 후 위임, 위험 작업은 worktree:true를 권장합니다.');
  }
  if (s.counts.worktree === 0 && s.total >= 3) {
    tips.push('아직 worktree 격리를 쓰지 않았습니다. 큰 변경은 worktree로 버리기 쉽게 맡기세요.');
  }
  if (tips.length === 0) {
    tips.push(
      '구독 워커를 잘 쓰고 있습니다. 이어서 작업할 때 recent.sessionId로 `resume`하면 멀티턴 맥락을 이어갈 수 있습니다.',
    );
  }
  const headline =
    `위임 ${s.total}건 · 성공률 ${successRatePct}% · 구독 과금 ${subscriptionBillingPct}%` +
    (s.byBilling.metered_api > 0 ? ` · 종량제 ${s.byBilling.metered_api}건` : '');
  return {
    successRatePct,
    subscriptionBillingPct,
    headline,
    tips: tips.slice(0, 3),
  };
}

type UsageAccumulator = Pick<
  UsageSummary,
  'byMode' | 'byBilling' | 'byStatus' | 'counts' | 'totalFilesChanged'
>;

// Counts one entry into the running summary. Guards make malformed-but-parseable
// entries (unexpected mode/status) simply not counted, never throwing.
function accumulate(summary: UsageAccumulator, e: HistoryEntry): void {
  if (e.mode === 'subscription' || e.mode === 'api') summary.byMode[e.mode] += 1;
  if (e.billing === 'subscription' || e.billing === 'metered_api') summary.byBilling[e.billing] += 1;
  if (e.status === 'completed' || e.status === 'auth_error' || e.status === 'timeout' || e.status === 'grok_error') {
    summary.byStatus[e.status] += 1;
  }
  if (e.plan) summary.counts.plan += 1;
  if (e.check) summary.counts.check += 1;
  if (e.worktreePath) summary.counts.worktree += 1;
  // Coerce to a finite number: a corrupted/hand-edited entry with a string filesCount would
  // otherwise trigger string concatenation and corrupt the running total (`??` only guards null).
  summary.totalFilesChanged += typeof e.filesCount === 'number' && Number.isFinite(e.filesCount) ? e.filesCount : 0;
}

// Pure aggregation of delegation history. `cwd` filters to one project; `limit` bounds
// the `recent` list. Never throws.
export function summarizeHistory(
  entries: HistoryEntry[],
  opts: { cwd?: string; limit?: number } = {},
): UsageSummary {
  const filtered = opts.cwd ? entries.filter((e) => sameCwd(e.cwd, opts.cwd!)) : entries;
  const limit = opts.limit ?? 10;

  const base = {
    total: filtered.length,
    byMode: { subscription: 0, api: 0 },
    byBilling: { subscription: 0, metered_api: 0 },
    byStatus: { completed: 0, auth_error: 0, timeout: 0, grok_error: 0 },
    counts: { plan: 0, check: 0, worktree: 0 },
    totalFilesChanged: 0,
  };

  let firstTs: string | undefined;
  let lastTs: string | undefined;
  for (const e of filtered) {
    accumulate(base, e);
    if (e.ts) { // ISO timestamps compare correctly with < / >
      if (firstTs === undefined || e.ts < firstTs) firstTs = e.ts;
      if (lastTs === undefined || e.ts > lastTs) lastTs = e.ts;
    }
  }

  // limit <= 0 ⇒ no recent (guard against slice(-0) returning the whole array).
  const recent = (limit > 0 ? filtered.slice(-limit) : []).reverse().map((e): RecentEntry => {
    const row: RecentEntry = {
      ts: e.ts, status: e.status, mode: e.mode, billing: e.billing, cwd: e.cwd, promptPreview: e.promptPreview,
    };
    if (e.sessionId) row.sessionId = e.sessionId;
    return row;
  });

  const summary: UsageSummary = {
    ...base,
    recent,
    insights: buildUsageInsights({ ...base, firstTs, lastTs }),
  };
  if (firstTs !== undefined) { summary.firstTs = firstTs; summary.lastTs = lastTs; }
  const lastSession = latestResumableSession(filtered);
  if (lastSession) summary.lastSession = lastSession;

  return summary;
}

// Reads the JSONL history log, tolerantly: missing/unreadable file → [], malformed
// lines are skipped. Never throws.
export function readHistory(path: string = defaultHistoryPath()): HistoryEntry[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return []; // missing / unreadable file
  }
  const entries: HistoryEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      // Only accept plain objects; a valid-JSON null/scalar/array line is treated as
      // malformed and skipped, so the summary pipeline never dereferences a non-entry.
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        entries.push(v as HistoryEntry);
      }
    } catch {
      /* skip malformed line */
    }
  }
  return entries;
}
