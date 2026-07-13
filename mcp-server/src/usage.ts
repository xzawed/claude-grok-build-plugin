import type { HistoryEntry } from './history.js';

export interface RecentEntry {
  ts: string;
  status: string;
  mode: string;
  billing: string;
  cwd: string;
  promptPreview: string;
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
}

// Pure aggregation of delegation history. `cwd` filters to one project; `limit` bounds
// the `recent` list. Never throws — malformed-but-parseable entries just fall through
// the guards (an unexpected mode/status is simply not counted).
export function summarizeHistory(
  entries: HistoryEntry[],
  opts: { cwd?: string; limit?: number } = {},
): UsageSummary {
  const filtered = opts.cwd ? entries.filter((e) => e.cwd === opts.cwd) : entries;
  const limit = opts.limit ?? 10;

  const summary: UsageSummary = {
    total: filtered.length,
    byMode: { subscription: 0, api: 0 },
    byBilling: { subscription: 0, metered_api: 0 },
    byStatus: { completed: 0, auth_error: 0, timeout: 0, grok_error: 0 },
    counts: { plan: 0, check: 0, worktree: 0 },
    totalFilesChanged: 0,
    recent: [],
  };

  for (const e of filtered) {
    if (e.mode === 'subscription' || e.mode === 'api') summary.byMode[e.mode] += 1;
    if (e.billing === 'subscription' || e.billing === 'metered_api') summary.byBilling[e.billing] += 1;
    if (e.status === 'completed' || e.status === 'auth_error' || e.status === 'timeout' || e.status === 'grok_error') {
      summary.byStatus[e.status] += 1;
    }
    if (e.plan) summary.counts.plan += 1;
    if (e.check) summary.counts.check += 1;
    if (e.worktreePath) summary.counts.worktree += 1;
    summary.totalFilesChanged += e.filesCount ?? 0;
  }

  if (filtered.length > 0) {
    const times = filtered.map((e) => e.ts).filter(Boolean).sort();
    summary.firstTs = times[0];
    summary.lastTs = times[times.length - 1];
  }

  summary.recent = filtered.slice(-limit).reverse().map((e) => ({
    ts: e.ts, status: e.status, mode: e.mode, billing: e.billing, cwd: e.cwd, promptPreview: e.promptPreview,
  }));

  return summary;
}
