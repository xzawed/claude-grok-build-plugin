/**
 * A27 (docs/10, MEASURED 2026-09-12 against the shipped bundle).
 *
 * `summarizeHistory` counted every parsed row in `total`, but `accumulate` incremented a bucket
 * only when `mode`/`billing`/`status` matched a known value. A row that parses as a JSON object
 * with an unrecognised value therefore landed in `total` and in no bucket, so the breakdowns no
 * longer summed to `total`.
 *
 * That matters because both headline percentages divide by `total`
 * (`successRatePct = byStatus.completed / total`, `subscriptionBillingPct = byBilling.subscription / total`),
 * so an unrecognised row silently understated the reported success rate whenever `completed > 0`.
 * Measured before the fix, through `.claude/tools/mcpcall.mjs` against `dist/index.js`:
 *
 *   history = one good row + {"ts":"...","mode":"nonsense","status":"nonsense","cwd":"/b"}
 *   -> total 2, sum(byMode) 1, sum(byStatus) 1, successRatePct 50   (truth among known rows: 100)
 *   history = one good row + {"status":null}   -> total 2, sum(byStatus) 1
 *   history = one good row + {}                -> total 2, sum(byStatus) 1
 *
 * Non-object lines (`[1,2,3]`, `null`, `"hello"`, `42`, `NOT JSON {{{`) were already skipped by
 * `readHistory` and never reached `total` — those stay skipped.
 *
 * Latent, not live: the owner's real 326-row file reconciled exactly (independent recount
 * agreed). The reachable trigger is version skew — the history file is append-only and outlives
 * any installed version, so a row written by a build that knows a status this one does not is
 * the realistic source.
 *
 * The fix keeps the original intent ("never throw on a malformed row") and adds the missing
 * half: an unrecognised value is counted as `unknown` rather than silently dropped, so the
 * invariant below is true for every possible input.
 */
import { describe, it, expect } from 'vitest';
import { summarizeHistory } from '../src/usage.js';
import type { HistoryEntry } from '../src/history.js';

const mk = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  ts: '2026-09-12T00:00:00.000Z', mode: 'subscription', billing: 'subscription',
  status: 'completed', cwd: '/p', promptPreview: 'good',
  filesChanged: [], filesTruncated: false, filesCount: 0, durationMs: 1, ...over,
});

/** Cast helper: these values are exactly what a foreign/older/newer writer can leave behind. */
const foreign = <T>(v: unknown) => v as T;

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('summarizeHistory reconciles total with every breakdown (A27)', () => {
  it('counts an unrecognised status as unknown instead of dropping it', () => {
    const s = summarizeHistory([
      mk(),
      mk({ ts: '2026-09-12T00:00:01.000Z', status: foreign<HistoryEntry['status']>('nonsense') }),
    ]);
    expect(s.total).toBe(2);
    expect(s.byStatus.unknown).toBe(1);
    expect(sum(s.byStatus)).toBe(s.total);
  });

  it('counts an unrecognised mode and billing as unknown', () => {
    const s = summarizeHistory([
      mk(),
      mk({
        ts: '2026-09-12T00:00:01.000Z',
        mode: foreign<HistoryEntry['mode']>('nonsense'),
        billing: foreign<HistoryEntry['billing']>(12345),
      }),
    ]);
    expect(s.byMode.unknown).toBe(1);
    expect(s.byBilling.unknown).toBe(1);
    expect(sum(s.byMode)).toBe(s.total);
    expect(sum(s.byBilling)).toBe(s.total);
  });

  it('reconciles a row that is missing mode, billing and status entirely', () => {
    const bare = foreign<HistoryEntry>({ ts: '2026-09-12T00:00:01.000Z', cwd: '/b' });
    const s = summarizeHistory([mk(), bare]);
    expect(s.total).toBe(2);
    expect(sum(s.byMode)).toBe(s.total);
    expect(sum(s.byBilling)).toBe(s.total);
    expect(sum(s.byStatus)).toBe(s.total);
  });

  it('reconciles an entirely empty object row', () => {
    const s = summarizeHistory([mk(), foreign<HistoryEntry>({})]);
    expect(s.total).toBe(2);
    expect(sum(s.byStatus)).toBe(s.total);
  });

  it('holds the invariant across a mixed file, and leaves known rows unchanged', () => {
    const s = summarizeHistory([
      mk(),
      mk({ ts: '2026-09-12T00:00:01.000Z', status: 'timeout' }),
      mk({ ts: '2026-09-12T00:00:02.000Z', mode: 'api', billing: 'metered_api', status: 'grok_error' }),
      mk({ ts: '2026-09-12T00:00:03.000Z', status: foreign<HistoryEntry['status']>('cancelled') }),
      foreign<HistoryEntry>({ ts: '2026-09-12T00:00:04.000Z' }),
    ]);
    expect(s.total).toBe(5);
    expect(sum(s.byMode)).toBe(5);
    expect(sum(s.byBilling)).toBe(5);
    expect(sum(s.byStatus)).toBe(5);
    // Known rows keep their exact counts — the fix must not reclassify anything recognised.
    expect(s.byStatus.completed).toBe(1);
    expect(s.byStatus.timeout).toBe(1);
    expect(s.byStatus.grok_error).toBe(1);
    expect(s.byStatus.unknown).toBe(2);
    expect(s.byMode.subscription).toBe(3);
    expect(s.byMode.api).toBe(1);
    expect(s.byMode.unknown).toBe(1);
  });

  it('reports unknown as 0 when every row is well formed', () => {
    const s = summarizeHistory([mk(), mk({ ts: '2026-09-12T00:00:01.000Z', status: 'timeout' })]);
    expect(s.byStatus.unknown).toBe(0);
    expect(s.byMode.unknown).toBe(0);
    expect(s.byBilling.unknown).toBe(0);
    expect(sum(s.byStatus)).toBe(s.total);
  });
});
