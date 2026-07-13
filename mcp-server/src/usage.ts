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

// Counts one entry into the running summary. Guards make malformed-but-parseable
// entries (unexpected mode/status) simply not counted, never throwing.
function accumulate(summary: UsageSummary, e: HistoryEntry): void {
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

// Pure aggregation of delegation history. `cwd` filters to one project; `limit` bounds
// the `recent` list. Never throws.
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

  let firstTs: string | undefined;
  let lastTs: string | undefined;
  for (const e of filtered) {
    accumulate(summary, e);
    if (e.ts) { // ISO timestamps compare correctly with < / >
      if (firstTs === undefined || e.ts < firstTs) firstTs = e.ts;
      if (lastTs === undefined || e.ts > lastTs) lastTs = e.ts;
    }
  }
  if (firstTs !== undefined) { summary.firstTs = firstTs; summary.lastTs = lastTs; }

  summary.recent = filtered.slice(-limit).reverse().map((e) => ({
    ts: e.ts, status: e.status, mode: e.mode, billing: e.billing, cwd: e.cwd, promptPreview: e.promptPreview,
  }));

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
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      /* skip malformed line */
    }
  }
  return entries;
}
