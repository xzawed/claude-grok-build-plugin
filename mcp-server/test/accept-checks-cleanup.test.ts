/**
 * The grader cleans up after a check whose session fails to open (review of PR #231). Since MCP 2.0 plan Task 2.4
 * a session opens asynchronously and can fail — not served, an exited server, a timeout — and the checks that open a
 * session of their own (caveat, A51, A35, A36, A56) must still close what they opened and remove the temp folder they
 * made. Driven through `gradeEra` with a stub opener: no server starts, nothing spawns. The temp folders land in a
 * folder of this test's own (os.tmpdir() follows TEMP/TMP/TMPDIR; vitest runs this file in a forked worker), so a
 * grader running in another test file cannot make the count wrong.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeEra } from '../../.claude/tools/accept-checks.mjs';

type Env = Record<string, string | undefined>;
type Row = { id: string; pass: boolean; evidence: string };

const home = (env: Env) => env.GROK_HOME ?? '';
// The session each cell opens, told apart by the GROK_HOME it is given. A36 opens two on win32 (`<dir> ` and
// `<dir>.`): failing the second leaves the first open, which is what must still be closed.
const CELLS: Array<[string, (env: Env) => boolean]> = [
  ['caveat', (env) => home(env).includes('accept-caveat-')],
  ['A51', (env) => home(env).includes('accept-a51-')],
  ['A35', (env) => home(env).startsWith('accept-a35-home-')],
  ['A36', (env) => home(env).includes('accept-a36-') && (process.platform !== 'win32' || home(env).endsWith('.'))],
  ['A56', (env) => home(env).includes('accept-a56-')],
];

const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('gradeEra cleans up after a session that fails to open', () => {
  it.each(CELLS)('%s: every session it opened is closed, and no temp folder is left', async (cell, fails) => {
    const base = mkdtempSync(join(tmpdir(), 'accept-cleanup-'));
    const ownTmp = join(base, 'tmp');
    const work = join(base, 'work');
    mkdirSync(ownTmp);
    mkdirSync(work);
    let opened = 0;
    let closed = 0;
    const open = async (_server: string, env: Env) => {
      if (fails(env)) throw new Error(`stub: the ${cell} session does not open`);
      opened++;
      let done = false;
      return {
        async call() { return { isError: false, text: '{}', raw: {} }; },
        async listTools() { return []; },
        async close() { if (!done) { done = true; closed++; } },
      };
    };
    try {
      process.env.TEMP = ownTmp;
      process.env.TMP = ownTmp;
      process.env.TMPDIR = ownTmp;
      expect(tmpdir()).toBe(ownTmp);
      const graded = await gradeEra({
        era: 'legacy', server: 'unused', hook: 'unused', iso: { work, baseEnv: {} }, expected: '0', open, includeEraFree: false,
      }) as { rows: Row[] };
      // the failure is reported, not swallowed
      expect(graded.rows.find((r) => r.id === 'harness')?.evidence).toContain(`the ${cell} session does not open`);
      expect(closed).toBe(opened);
      expect(readdirSync(ownTmp)).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(base, { recursive: true, force: true });
    }
  });
});
