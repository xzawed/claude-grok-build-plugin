/**
 * `npm run probe:metered` prints what xAI's API sent back, and its output is meant to be pasted into tickets. SonarCloud
 * flagged its raw prints (jssecurity:S5145, analysis of 2026-09-23); on eae57ea, with fetch replaced, a response could
 * add a forged "--- NOT billed ---" line, clear the screen with raw escape sequences, print one of the probe's own
 * verdict lines from a raw body — and, through an `id` or `model` that cannot become a string (an object whose
 * toString is not a function), crash the probe AFTER a billed request into exit 1, which the probe's header defines as
 * "nothing was billed" (A70).
 *
 * End to end: the probe runs as `npm run probe:metered` runs it, under a `--import` preload that replaces fetch with
 * the response a case describes and makes every socket connect throw. The preload is source lines handed to node as a
 * data: URL, because src/ and test/ hold no JavaScript file (history.test.ts — a .js beside a .ts module is what vitest
 * and esbuild load). The response reaches it through a file named in MOCK_RESPONSE_FILE: base64 in an environment
 * variable, as before, the deepest rows came to 133 KB, past Linux's 128 KiB cap on one environment string
 * (MAX_ARG_STRLEN — the spawn fails with E2BIG; win32 took them; measured), and a file has no such cap. Without the
 * file the preload throws and node exits before the probe runs. XAI_API_KEY is a dummy. Special characters are built
 * from numbers on purpose — this repo's authoring tools decode escape sequences inside file content.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const probe = join(here, '..', 'scripts', 'probe-metered-billing.mjs');
const ch = (n: number) => String.fromCodePoint(n);
const BS = ch(92);
const NL = ch(10);

const BILLED = '--- billed: one metered request was accepted ---';
const NOT_BILLED = '--- NOT billed ---';
const UNKNOWN_NO_USAGE = '--- UNKNOWN: 2xx but no usage reported ---';

/** A response, as the preload builds it. `throws` makes fetch reject; `bodyError` makes reading the body fail. */
interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  throws?: string;
  bodyError?: string;
}

// Written as lines, as worker-marker-probe.mjs writes its probe server.
const PRELOAD = [
  "import net from 'node:net';",
  "import tls from 'node:tls';",
  "import { readFileSync } from 'node:fs';",
  "const blocked = () => { throw new Error('network blocked by the test preload'); };",
  'net.connect = blocked; net.createConnection = blocked; net.Socket.prototype.connect = blocked; tls.connect = blocked;',
  "const spec = JSON.parse(readFileSync(process.env.MOCK_RESPONSE_FILE, 'utf8'));",
  'globalThis.fetch = async () => {',
  '  if (spec.throws !== undefined) throw new Error(spec.throws);',
  '  const body = spec.bodyError !== undefined',
  '    ? new ReadableStream({ start(controller) { controller.error(new Error(spec.bodyError)); } })',
  '    : (spec.json !== undefined ? JSON.stringify(spec.json) : spec.text);',
  '  return new Response(body, {',
  '    status: spec.status,',
  '    statusText: spec.statusText,',
  "    headers: { 'content-type': spec.json !== undefined ? 'application/json' : 'text/plain', ...spec.headers },",
  '  });',
  '};',
].join(NL);
const preload = `data:text/javascript;base64,${Buffer.from(PRELOAD).toString('base64')}`;

function spawnProbe(env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, ['--import', preload, probe], {
    env, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { code: r.status, out, lines: out.split(NL) };
}
// Made in beforeAll, not at import, so that a run that skips every test here leaves no folder behind (round-9 review).
let scratch = '';
beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), 'probe-metered-output-')); });
afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
let responses = 0;
function runProbe(response: MockResponse) {
  const file = join(scratch, `response-${responses++}.json`);
  writeFileSync(file, JSON.stringify(response));
  const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, XAI_API_KEY: 'dummy-not-a-key' };
  delete env.XAI_PROBE_MODEL;
  return spawnProbe(env);
}

// What may not reach the operator's terminal raw: Unicode's control, format, line- and paragraph-separator characters
// (the probe's own line breaks aside).
const HIDDEN = new RegExp(`[${BS}p{Cc}${BS}p{Cf}${BS}p{Zl}${BS}p{Zp}]`, 'gu');
const hiddenIn = (s: string) => [...s.matchAll(HIDDEN)].map((m) => m[0].codePointAt(0)).filter((n) => n !== 10);
const count = (lines: string[], line: string) => lines.filter((l) => l === line).length;

const ESC = ch(27);
const CR = ch(13);
const BEL = ch(7);
const CSI8 = ch(0x9b); // the one-byte C1 form of ESC [
const LS = ch(0x2028);
const RLO = ch(0x202e);
const ZWSP = ch(0x200b);
const BOM = ch(0xfeff);
const TAG_A = ch(0xe0041);
const forgedNotBilled = `${NL}${NOT_BILLED}${NL}The API rejected the request, so no metered usage was created.${NL}`;
const forgedBilled = `${NL}${BILLED}${NL}`;
const billed = (fields: Record<string, unknown>): MockResponse => ({
  status: 200,
  json: { usage: { total_tokens: 5 }, id: 'resp_ok', status: 'completed', model: 'grok-4.6', ...fields },
});
const normalBilled = billed({});
const normal4xx: MockResponse = { status: 400, json: { code: 'invalid-argument', error: 'Incorrect API key provided' } };
const usage2xx = (usage: unknown): MockResponse => ({ status: 200, json: { usage } });
const deepJson = `${'['.repeat(5000)}${']'.repeat(5000)}`;
// JSON.parse takes this on any stack (it does not recurse). On Node 22, CI's, JSON.stringify fails at it on every stack
// this probe could get — by default about 2,200 levels on win32 and 4,200 on Linux, and NODE_OPTIONS may not set
// --stack-size (node refuses it there); even --stack-size=4000 on the command line reaches only about 9,100 on win32
// and 17,000 on Linux (round-8 and round-9 review, measured). Node 26 (V8 14.6) builds it when JSON.stringify is given
// the value alone, though not with the arguments printable.mjs passes (round-10 review, measured) — so the rows that
// use it take either what printable shows for a value it cannot build, or that value cut.
const deeperJson = `${'['.repeat(50_000)}${']'.repeat(50_000)}`;
const MAX_UNITS = 4096; // printable.mjs's
/**
 * The two ways printable can show a value this deep: the fixed sentence where JSON.stringify cannot build it (Node 22,
 * and Node 26 with printable's arguments), or the JSON cut where it can.
 */
const deepShown = (before: string, json: string, after = '') => [
  `${before}(a value that could not be printed)${after}`,
  `${before}${json.slice(0, MAX_UNITS)}...(+${json.length - MAX_UNITS})${after}`,
];
const nestedJson = `${'['.repeat(1000)}${']'.repeat(1000)}`;
const longJson = { error: 'y'.repeat(5000) };
const longJsonText = JSON.stringify(longJson); // what the preload sends
const fitsWindow = { error: 'y'.repeat(1188) }; // its raw text is 1,200 units, the error window
const overWindow = { error: 'y'.repeat(1189) };

type Verdicts = { billed: number; notBilled: number; unknown: number };
const BILLED_ONLY: Verdicts = { billed: 1, notBilled: 0, unknown: 0 };
const NOT_BILLED_ONLY: Verdicts = { billed: 0, notBilled: 1, unknown: 0 };
const UNKNOWN_ONLY: Verdicts = { billed: 0, notBilled: 0, unknown: 1 };
const NO_VERDICT: Verdicts = { billed: 0, notBilled: 0, unknown: 0 };

interface Case {
  name: string; code: number; verdicts: Verdicts; response: MockResponse;
  has?: string[]; hasNot?: string[]; hasOneOf?: string[];
}
const CASES: Case[] = [
  { name: 'normal-billed', code: 0, verdicts: BILLED_ONLY, response: normalBilled },
  // the 2026-10-17 reproduction on eae57ea
  { name: 'forged-id', code: 0, verdicts: BILLED_ONLY, response: billed({ id: `resp_1${forgedNotBilled}` }) },
  { name: 'esc-id', code: 0, verdicts: BILLED_ONLY, response: billed({ id: `${ESC}[2J${ESC}[H${CR}${NOT_BILLED}` }) },
  { name: 'crash-id', code: 0, verdicts: BILLED_ONLY, response: billed({ id: { toString: 1 } }) },
  { name: 'crash-status', code: 0, verdicts: BILLED_ONLY, response: billed({ status: { toString: 1 } }) },
  { name: 'crash-model', code: 0, verdicts: BILLED_ONLY, response: billed({ model: { toString: 1 } }) },
  // a value nested too deep to become a string crashed eae57ea the same way after "billed" (round-7 review) — both rows
  // on Node 22; on Node 26 eae57ea printed the deep usage whole, a 100 KB line, and crashed on the id only (round-10
  // review, measured). Built as text, since on Node 22 JSON.stringify could build them neither in runProbe, which
  // writes the response file, nor in the preload.
  {
    name: 'deep-usage-billed', code: 0, verdicts: BILLED_ONLY,
    response: { status: 200, text: `{"usage":{"total_tokens":5,"note":${deeperJson}}}` },
    hasOneOf: deepShown('usage         ', `{"total_tokens":5,"note":${deeperJson}}`),
  },
  {
    name: 'deep-id-billed', code: 0, verdicts: BILLED_ONLY,
    response: { status: 200, text: `{"usage":{"total_tokens":5},"id":${deeperJson}}` },
    hasOneOf: deepShown('response id   ', deeperJson, '   <-- may appear in the console'),
  },
  {
    name: 'raw-2xx', code: 2, verdicts: UNKNOWN_ONLY,
    response: { status: 200, text: `<html>interstitial${forgedNotBilled}${forgedBilled}</html>` },
    has: ['  | <html>interstitial', `  | ${NOT_BILLED}`, `  | ${BILLED}`],
  },
  { name: 'raw-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: `bad request${forgedBilled}` }, has: [`  | ${BILLED}`] },
  // a raw body that IS one of the verdict lines (round-1 review): printed, behind the prefix
  { name: 'body-is-billed-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: BILLED }, has: [`  | ${BILLED}`] },
  { name: 'body-is-not-billed-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: NOT_BILLED } },
  { name: 'body-is-unknown-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: UNKNOWN_NO_USAGE } },
  { name: 'body-is-billed-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: BILLED } },
  // a 5xx exits 2 (UNKNOWN) — its headline still says "NOT billed", which A71 records
  { name: 'body-is-billed-5xx', code: 2, verdicts: NOT_BILLED_ONLY, response: { status: 503, text: BILLED } },
  { name: 'json-5xx', code: 2, verdicts: NOT_BILLED_ONLY, response: { status: 503, json: { error: 'upstream timeout' } } },
  { name: 'json-500', code: 2, verdicts: NOT_BILLED_ONLY, response: { status: 500, json: { error: 'internal' } } },
  // the other side of that edge: a status below 500 that is not ok exits 1 once its body is read (round-9 review)
  { name: 'status-499', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 499, text: 'client closed request' } },
  // JSON nested 5,000 deep, past the 1,200-unit window: shown as raw lines. eae57ea re-indented it, and the 503 crashed
  // into exit 1 on Node 22 (not on Node 26 in node:26-slim, Linux; win32 not measured — round-10 review).
  { name: 'deep-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: deepJson }, has: ['  | [[[['] },
  { name: 'deep-json-5xx', code: 2, verdicts: NOT_BILLED_ONLY, response: { status: 503, text: deepJson }, has: ['  | [[[['] },
  // a JSON error body is re-indented only when its raw text fits the window: re-indenting a nested one costs far more
  { name: 'nested-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: nestedJson }, has: ['  | [[[['] },
  {
    name: 'json-fits-window', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: fitsWindow },
    // re-indented it is 1,204 units, so the cut still applies
    has: [`${'y'.repeat(1187)}...(+4)`], hasNot: ['  | {"error"'],
  },
  { name: 'json-over-window', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: overWindow }, has: ['  | {"error":"yyyy'] },
  // only a truthy JSON value is re-indented: a falsy one prints as raw text, a string as its JSON line (round-7 review)
  { name: 'falsy-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: '0' }, has: [`${NL}  | 0${NL}`] },
  {
    name: 'string-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: '"x"' },
    has: [`${NL}"x"${NL}`], hasNot: ['  | "x"'],
  },
  // what JSON.stringify leaves raw, the status text, headers, errors
  {
    name: 'status-and-model-hidden', code: 0, verdicts: BILLED_ONLY,
    response: billed({ status: `ok${ESC}[2J`, model: `m${CSI8}x${ZWSP}` }),
    has: [`status        ok${BS}u001b[2J`, `model served  m${BS}u009bx${BS}u200b`],
  },
  {
    name: 'invisible-id', code: 0, verdicts: BILLED_ONLY,
    response: billed({ id: `a${ZWSP}b${BOM}c${TAG_A}` }),
    has: [`response id   a${BS}u200bb${BS}ufeffc${BS}u{e0041}   <-- may appear in the console`],
  },
  {
    name: 'usage-separators', code: 0, verdicts: BILLED_ONLY,
    response: { status: 200, json: { usage: { total_tokens: 5, note: `a${LS}b${CSI8}c${RLO}d` }, id: 'resp_u' } },
  },
  { name: 'normal-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: normal4xx },
  { name: 'json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: { code: 'invalid-argument', error: `Incorrect API key${LS}${CSI8}[2J${RLO}dellib` } } },
  {
    name: 'status-text', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, statusText: `Bad${CSI8}[2J Request`, text: 'nope' },
    has: [`http status       400 Bad${BS}u009b[2J Request`],
  },
  {
    name: 'esc-header', code: 0, verdicts: BILLED_ONLY,
    response: { ...normalBilled, headers: { 'x-probe': `a${ESC}[2J${ESC}]0;title${BEL}b${CSI8}c` } },
    has: [`  x-probe: a${BS}u001b[2J${BS}u001b]0;title${BS}u0007b${BS}u009bc`],
  },
  {
    name: 'set-cookie', code: 0, verdicts: BILLED_ONLY,
    response: { ...normalBilled, headers: { 'set-cookie': 'cf_bm=COOKIE-SECRET-VALUE' } }, hasNot: ['COOKIE-SECRET-VALUE'],
  },
  {
    name: 'fetch-throws', code: 2, verdicts: NO_VERDICT, response: { throws: `socket hang up${ESC}[2J${forgedBilled}` },
    has: ['--- UNKNOWN: the request failed before a response came back ---', `  error: socket hang up${BS}u001b[2J${BS}u000a---`],
  },
  // an error message that eae57ea's `--- UNKNOWN: <message> ---` turned into a verdict line stays on its own indented
  // line (round-16 review)
  {
    name: 'fetch-throws-verdict', code: 2, verdicts: NO_VERDICT, response: { throws: '2xx but no usage reported' },
    has: ['  error: 2xx but no usage reported'],
  },
  {
    name: 'body-error', code: 2, verdicts: NO_VERDICT, response: { status: 200, bodyError: `stream broke${ESC}[2J${forgedBilled}` },
    has: ['--- UNKNOWN: 200 accepted but the body failed to read ---', `  error: stream broke${BS}u001b[2J`],
  },
  // the same lines after a 4xx, "accepted" included — A71 records it
  {
    name: 'body-error-4xx', code: 2, verdicts: NO_VERDICT, response: { status: 400, bodyError: 'stream broke' },
    has: ['--- UNKNOWN: 400 accepted but the body failed to read ---'],
  },
  // usage: a present total decides (as before), only finite numbers count — anything else is UNKNOWN, never a crash
  { name: 'parts-only', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 2, output_tokens: 3 }), has: ['total tokens  5'] },
  // a part that is absent is left out, as before: one part alone decides
  { name: 'one-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 2 }), has: ['total tokens  2'] },
  // a null total is absent, as before: the parts decide
  { name: 'null-total', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ total_tokens: null, input_tokens: 2, output_tokens: 3 }), has: ['total tokens  5'] },
  { name: 'crash-usage', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: { toString: 1 } }) },
  { name: 'crash-usage-sum', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: { toString: 1 } }) },
  // a numeric STRING, a boolean or an array counted as billed before this change ([2] and 3 made 23). A 2xx body that
  // reports no usage — here a total that is not a number — is shown as its raw lines, JSON or not (round-10 review).
  {
    name: 'string-usage', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: '5' }),
    has: [`${NL}  | {"usage":{"total_tokens":"5"}}${NL}`],
  },
  { name: 'string-total-and-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: '5', input_tokens: 1 }) },
  { name: 'array-total', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: [5] }) },
  { name: 'array-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: [2], output_tokens: 3 }) },
  { name: 'zero-total', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: 0, input_tokens: 2, output_tokens: 2 }) },
  { name: 'string-zero-total', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: '0', input_tokens: 2, output_tokens: 2 }) },
  { name: 'object-total', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: { toString: 1 }, input_tokens: 3 }) },
  // only a count above zero is billed: a negative total too is UNKNOWN, and it still decides over the parts
  // (round-4 review)
  { name: 'negative-total', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: -5 }) },
  { name: 'negative-total-and-parts', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ total_tokens: -1, input_tokens: 2, output_tokens: 3 }) },
  // without a total, every part that is present must be a number (round-3 Grok falsification); null is absent, as before
  { name: 'string-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: 2, output_tokens: '3' }) },
  { name: 'boolean-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: 1, output_tokens: true }) },
  // a falsy part that is not a number is present too, not absent (round-11 review)
  { name: 'false-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: 2, output_tokens: false }) },
  { name: 'empty-string-part', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ input_tokens: 2, output_tokens: '' }) },
  { name: 'null-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 1, output_tokens: null }), has: ['total tokens  1'] },
  // a part of zero is a number like any other; a usage with no count, or only counts under other names, is UNKNOWN —
  // and not a crash (round-10 review)
  { name: 'zero-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 12, output_tokens: 0 }), has: ['total tokens  12'] },
  { name: 'empty-usage', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({}) },
  { name: 'other-names-usage', code: 2, verdicts: UNKNOWN_ONLY, response: usage2xx({ prompt_tokens: 5, completion_tokens: 3 }) },
  { name: 'infinite-total', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: '{"usage":{"total_tokens":1e999}}' } },
  { name: 'overflowing-parts', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: '{"usage":{"input_tokens":1e308,"output_tokens":1e308}}' } },
  // the windows a body is shown in: 800 units after a 2xx without usage, 1200 after an error status
  {
    name: 'long-body-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: 'x'.repeat(5000) },
    has: [`  | ${'x'.repeat(800)}...(+4200)`],
  },
  {
    name: 'long-body-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: 'x'.repeat(5000) },
    has: [`  | ${'x'.repeat(1200)}...(+3800)`],
  },
  {
    name: 'long-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: longJson },
    has: [`  | ${longJsonText.slice(0, 1200)}...(+${longJsonText.length - 1200})`],
  },
];

describe('probe:metered — a response cannot forge its verdict, drive the terminal, or crash it', () => {
  it.each(CASES)('$name exits $code, prints only its own verdict lines, and nothing raw', ({ code, verdicts, response, has = [], hasNot = [], hasOneOf }) => {
    const r = runProbe(response);
    expect(r.code).toBe(code);
    expect(hiddenIn(r.out)).toEqual([]);
    expect(count(r.lines, BILLED)).toBe(verdicts.billed);
    expect(count(r.lines, NOT_BILLED)).toBe(verdicts.notBilled);
    expect(count(r.lines, UNKNOWN_NO_USAGE)).toBe(verdicts.unknown);
    for (const s of has) expect(r.out).toContain(s);
    for (const s of hasNot) expect(r.out).not.toContain(s);
    if (hasOneOf) expect(hasOneOf.filter((s) => r.lines.includes(s))).toHaveLength(1);
  }, 30_000);

  it('prints an ordinary billed response exactly as before', () => {
    const r = runProbe(normalBilled);
    expect(r.lines).toContain('usage         {"total_tokens":5}');
    expect(r.lines).toContain('total tokens  5');
    expect(r.lines).toContain('response id   resp_ok   <-- may appear in the console');
    expect(r.lines).toContain('status        completed');
    expect(r.lines).toContain('model served  grok-4.6');
  }, 30_000);

  it('keeps the line breaks of a JSON error body, which JSON.stringify writes itself', () => {
    const r = runProbe(normal4xx);
    expect(r.lines).toContain(' "code": "invalid-argument",');
    expect(r.lines).toContain(' "error": "Incorrect API key provided"');
  }, 30_000);

  it('does not run the probe at all without a response to give it', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, XAI_API_KEY: 'dummy-not-a-key' };
    delete env.MOCK_RESPONSE_FILE;
    const r = spawnProbe(env);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('--- B3 metered-billing positive control ---');
  }, 30_000);
});
