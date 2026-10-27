/**
 * `npm run probe:metered` prints what xAI's API sent back, and its output is meant to be pasted into tickets. SonarCloud
 * flagged its raw prints (jssecurity:S5145, analysis of 2026-09-23); on eae57ea, with fetch replaced, a response could
 * add a forged "--- NOT billed ---" line, clear the screen with raw escape sequences, print one of the probe's own
 * verdict lines from a raw body — and, through an `id` or `model` that cannot become a string (an object whose
 * toString is not a function), crash the probe AFTER a billed request into exit 1, which the probe's header defines as
 * "nothing was billed" (A70).
 *
 * End to end: the probe runs as `npm run probe:metered` runs it, under a `--import` preload that replaces fetch with
 * the response a case describes and makes every connect through net and tls throw; a worker started from source text
 * and a process started anew would run without the preload (a worker from a file and a forked child load it — round-6
 * review of #181), so starting a worker, a child process, a cluster fork or a UDP socket is refused too, and so are the
 * ways beneath those modules — process.binding, _linkedBinding, dlopen and execve — and the WebSocket and EventSource
 * globals (round-7 review of #181 found such a WebSocket passing; round 18 measured why: aimed at a port the Fetch
 * standard bars, it makes no connect at all, so nothing else writes it down). Each fetch call, connect and start is
 * written down.
 * The preload is source lines handed to node as a data: URL, because src/ and test/ hold no JavaScript file
 * (history.test.ts — a .js beside a .ts module is what vitest and esbuild load). The response reaches it through a file
 * named in MOCK_RESPONSE_FILE: base64 in an environment variable, as before, the deepest rows came to 133 KB, past
 * Linux's 128 KiB cap on one environment string (MAX_ARG_STRLEN — the spawn fails with E2BIG; win32 took them;
 * measured), and a file has no such cap. Without the file the preload throws and node exits before the probe runs.
 * XAI_API_KEY is a dummy, and every run that has a key is handed it that way: the key prompt, which needs a terminal,
 * is not driven here (docs/10 A74). Special characters are built from numbers on purpose — this repo's authoring tools decode escape
 * sequences inside file content.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FALLBACK, printable, printableJson, printableLines } from '../scripts/printable.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const probe = join(here, '..', 'scripts', 'probe-metered-billing.mjs');
const ch = (n: number) => String.fromCodePoint(n);
const BS = ch(92);
const NL = ch(10);

const BILLED = '--- billed: one metered request was accepted ---';
const NOT_BILLED = '--- NOT billed ---';
const UNKNOWN_NO_USAGE = '--- UNKNOWN: 2xx but no usage reported ---';
const UNKNOWN_SERVER = '--- UNKNOWN: the server failed, perhaps after doing the work ---';

// Every line the probe prints, as `expected` below assembles them: the round-1 review of #181 found sentences under a
// verdict that could change or move with every verdict line still right, and its round 2 found more (the re-run
// warnings, the closing paragraph, a line added under a 4xx), so the whole output is pinned, line for line.
const BODY_PREFIX = '  | '; // probe-metered-billing.mjs's
const HEADERS = '--- response headers (set-cookie omitted on purpose) ---';
const PREAMBLE = (at: string) => [
  'Using XAI_API_KEY from the environment.',
  'If you typed that assignment at a shell prompt, the key is now in your shell',
  'history file — clear that line afterwards, or rotate the key.',
  '',
  '--- B3 metered-billing positive control ---',
  'endpoint          https://api.x.ai/v1/responses',
  'model             grok-4.6',
  'max_output_tokens 64',
  `sent at (UTC)     ${at}   <-- match THIS against the console`,
  '',
];
const TRAILER = [
  'MEASURED 2026-09-12 with a deliberately bogus key: a bad key returns 400 with',
  '{"code":"invalid-argument","error":"Incorrect API key provided..."} — not 401.',
  '403 means revoked or no access, 404 means the endpoint moved, 429 rate limited.',
  'A status of 500 or more is different: the server may have completed the work',
  'before failing, so that is reported as UNKNOWN, not as "not billed".',
];
const NEXT = (at: string) => [
  'NEXT: wait for the vendor ingestion delay, then read the metered console for',
  `REQUEST COUNT around ${at} — not the dollar figure. One small request`,
  'rounds to $0.00 and looks like nothing happened.',
  '',
  "Then read the limit in this file's header before writing anything down: a later",
  "zero for the plugin's own runs is a failed attempt to disprove, not a clean bill.",
];
// Only the finish time (the clock's) has its rest checked for its shape and replaced by a placeholder, and a row's
// `loose` line, which that row's `hasOneOf` pins; every other line is compared whole. The round-3 review of #181 found
// that a rest checked only as a substring let "safe to re-run" be added to an error line, or the key be printed; its
// round 4 found the total, which the response decides, masked too.
const FINISHED = 'finished (UTC)    ';
/**
 * Output lines with the finish time replaced by a placeholder once it has the right shape — an ISO time at least 15 ms
 * after `at` (the preload answers 20 ms late, so a finish time read before the answer, or the sent time itself, fails)
 * and not in the future (a second of slack, since two processes' clocks can disagree by a few milliseconds on win32 —
 * round-4 review of #181) — and a row's `loose` starts, values printable.mjs cannot render the same way on every Node.
 */
function masked(lines: string[], at: string, loose: readonly string[] = []): string[] {
  return lines.map((line) => {
    if (line.startsWith(FINISHED)) {
      const t = line.slice(FINISHED.length);
      const iso = !Number.isNaN(Date.parse(t)) && new Date(t).toISOString() === t;
      const ok = iso && Date.parse(t) - Date.parse(at) >= 15 && Date.parse(t) <= Date.now() + 1000;
      return ok ? `${FINISHED}<time>` : line;
    }
    const start = loose.find((s) => line.startsWith(s));
    return start === undefined ? line : `${start}<...>`;
  });
}

/** A response, as the preload builds it. `throws` makes fetch reject; `bodyError` makes reading the body fail.
 * `stream` makes the body a ReadableStream that enqueues `chunk` `count` times — far more than the cap, to prove the
 * probe stops reading at the cap and cancels rather than draining the whole body (A72). `delayMs` holds the body back
 * that long after the headers (a ReadableStream that enqueues the json/text once the timer fires), so a reader that
 * closes the output early catches the probe mid-body (A75). */
interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  throws?: string;
  bodyError?: string;
  stream?: { chunk: string; count: number };
  delayMs?: number;
}

// Written as lines, as worker-marker-probe.mjs writes its probe server.
const PRELOAD = [
  "import net from 'node:net';",
  "import tls from 'node:tls';",
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "import cp from 'node:child_process';",
  "import wt from 'node:worker_threads';",
  "import dgram from 'node:dgram';",
  "import cluster from 'node:cluster';",
  "import { syncBuiltinESMExports } from 'node:module';",
  // the platform's own, taken before the probe runs, so that a probe that replaces one of these globals cannot change
  // what the preload does with it (round-10 review of #181: a probe that swapped Request for a subclass of its own sent
  // one more header, which a record built with that subclass did not show). The platform's Request still takes headers
  // in through Object.keys, and headers given as pairs through Reflect.get too, as they are at that moment, so a probe
  // that replaced one would change the record as it changes the request fetch builds — and fetch, sending, goes further
  // (round-11 adversarial review of #181: with Object.keys replaced it sent none of the request's own headers, where
  // the record showed one, and framed the body as chunked); the source check below bans the names plainly written code
  // would reach those with, or their prototypes
  "const { Request: PlatformRequest, Proxy: PlatformProxy, Set: PlatformSet, TextDecoder: PlatformTextDecoder } = globalThis;",
  'const getOf = Reflect.get; const keysOf = Object.keys; const stringify = JSON.stringify;',
  'const recordFile = process.env.MOCK_RECORD_FILE; const LF = String.fromCharCode(10);',
  'const record = (call) => appendFileSync(recordFile, stringify(call) + LF);',
  // a connect is written down before it throws, so that a request made some other way is seen (round-5 review of
  // #181) — each under its own name: net.connect and tls.connect go on to a socket's connect, so one shared record let
  // any of them be dropped unseen by the test that tries every start (Grok's falsification of #181's round 7)
  "const blocked = (what) => function () { record({ socket: what }); throw new Error('network blocked by the test preload'); };",
  "net.connect = blocked('net.connect'); net.createConnection = blocked('net.createConnection');",
  "net.Socket.prototype.connect = blocked('net.Socket.connect'); tls.connect = blocked('tls.connect');",
  // a worker started from source text, or a process started anew, runs without this preload, so its fetch is real
  // (round-6 review of #181: a mutant's reached api.x.ai, with no key): starting one, a child process, a cluster fork
  // or a UDP socket is written down and refused instead
  "const refused = (what) => function () { record({ started: what }); throw new Error(what + ' blocked by the test preload'); };",
  "for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = refused('child_process.' + name);",
  "cp.ChildProcess.prototype.spawn = refused('child_process.ChildProcess.spawn'); wt.Worker = refused('worker_threads.Worker');",
  "dgram.createSocket = refused('dgram.createSocket'); dgram.Socket = refused('dgram.Socket'); cluster.fork = refused('cluster.fork');",
  // and the ways beneath those modules: a raw binding, a native addon, and a process replaced by another that has no
  // preload (round-7 review of #181 measured spawn_sync, tcp_wrap and execve getting past; dlopen and _linkedBinding
  // are refused alongside them)
  "for (const name of ['binding', '_linkedBinding', 'dlopen', 'execve']) process[name] = refused('process.' + name);",
  // and the globals that open a connection of their own, refused besides: a WebSocket reaches net.connect or
  // tls.connect during its constructor, which the refusals above write down, but aimed at a port the Fetch standard
  // bars it makes no connect at all, so nothing is written down — a probe change that opened one at port 9 passed
  // (round-7 review of #181; measured on Node 22.18 and 22.23 in round 18)
  "globalThis.WebSocket = refused('WebSocket'); globalThis.EventSource = refused('EventSource');",
  // and the modules' named exports brought in line with the changes above, as an import by name reads those (the row
  // that reaches a start through them says what leaving this out let through)
  'syncBuiltinESMExports();',
  "const spec = JSON.parse(readFileSync(process.env.MOCK_RESPONSE_FILE, 'utf8'));",
  'let calls = 0;',
  'globalThis.fetch = async (url, init) => {',
  // every call is written down, so that the one request the probe pays for is checked too (round-4 review of #181) —
  // the moment it is made, before anything that waits, and again once it is built (Grok's falsification of #181's
  // round-10 changes: a call the probe made just before it exited never reached the record, built only after its
  // body was read — fetch sent nothing then, measured, but such a call is still one too many); one it cannot build
  // is written down as unbuilt (round-10 review of #181: a call that threw there left no record, while fetch would
  // have sent it). The first argument is written down by its type, read from nothing: a Request passed there brings
  // options of its own that no init shows (a 1 ms timeout signal on one passed every row)
  '  const id = ++calls;',
  '  record({ id, input: typeof url, called: true });',
  '  let call = { id, input: typeof url, unbuilt: true };',
  '  try {',
  // the init as fetch takes it, null for an empty one, read only by the Request fetch would build from it, through a
  // Proxy that notes each member it reads and leaves the init the getters' this, so that a getter answers it as it
  // would answer fetch (Grok's falsification of #181's round-9 changes: the preload read each member once more first,
  // so a getter could hand fetch one value and the record another) — a Request that converts each value as fetch
  // does, not as JSON.stringify writes it (round-9 review of #181: a header added behind a toJSON, or a body whose
  // toString lifts the cap, was written down as the expected request)
  '    const given = init ?? {};',
  '    const read = new PlatformSet();',
  "    const noted = (target, key) => { const value = getOf(target, key); if (typeof key === 'string' && value !== undefined) read.add(key); return value; };",
  '    const sent = new PlatformRequest(url, new PlatformProxy(given, { get: noted }));',
  // the names of all its options, since one more (a signal, say) could make a request that was paid for fail (round-5
  // review of #181): its own enumerable keys, and every member the Request read as set, inherited or not enumerable,
  // since fetch reads them as properties (round-8 review of #181)
  '    const options = [...new PlatformSet([...keysOf(given), ...read])].sort();',
  // the body from its bytes, a byte-order mark kept (round-10 review of #181: text() drops one, which fetch sends)
  "    const body = new PlatformTextDecoder('utf-8', { ignoreBOM: true }).decode(await sent.arrayBuffer());",
  '    call = { id, input: typeof url, url: sent.url, options, method: sent.method, headers: [...sent.headers], body };',
  '  } finally {',
  '    record(call);',
  '  }',
  // a little later than the sent time, as a real answer is, so that a finish line that prints the sent time is seen
  '  await new Promise((resolve) => setTimeout(resolve, 20));',
  '  if (spec.throws !== undefined) throw new Error(spec.throws);',
  '  const body = spec.bodyError !== undefined',
  '    ? new ReadableStream({ start(controller) { controller.error(new Error(spec.bodyError)); } })',
  '    : spec.stream !== undefined',
  '    ? (() => { const c = new TextEncoder().encode(spec.stream.chunk); let n = 0; return new ReadableStream({ pull(controller) { if (n++ < spec.stream.count) controller.enqueue(c); else controller.close(); } }); })()',
  '    : spec.delayMs !== undefined',
  '    ? (() => { const t = new TextEncoder().encode(spec.json !== undefined ? JSON.stringify(spec.json) : spec.text); return new ReadableStream({ start(controller) { setTimeout(() => { controller.enqueue(t); controller.close(); }, spec.delayMs); } }); })()',
  '    : (spec.json !== undefined ? JSON.stringify(spec.json) : spec.text);',
  '  const res = new Response(body, {',
  '    status: spec.status >= 600 ? 599 : spec.status,',
  '    statusText: spec.statusText,',
  "    headers: { 'content-type': spec.json !== undefined ? 'application/json' : 'text/plain', ...spec.headers },",
  '  });',
  // fetch hands back a status of 600 or more as it is (measured), which new Response refuses, so it is laid over
  '  if (spec.status >= 600) Object.defineProperties(res, { status: { value: spec.status }, ok: { value: false } });',
  '  return res;',
  '};',
].join(NL);
const preload = `data:text/javascript;base64,${Buffer.from(PRELOAD).toString('base64')}`;

function spawnProbe(env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, ['--import', preload, probe], {
    env, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const linesOf = (s: string) => (s === '' ? [] : (s.endsWith(NL) ? s.slice(0, -1) : s).split(NL));
  return { code: r.status, out, lines: out.split(NL), stdout: linesOf(r.stdout ?? ''), stderr: linesOf(r.stderr ?? '') };
}
const KEY = 'dummy-not-a-key';
// A73: the probe refuses a key holding a character printable.mjs would escape, and takes the key (raw, or as it reads
// inside a JSON string) out of everything it prints. redact/show/showJson/showLines mirror the probe exactly so
// `expected` matches it; not.toContain(KEY) on every row asserts the key reaches the output nowhere.
const REDACTED = '(api key redacted)';
const redact = (s: string) => {
  let out = s.split(KEY).join(REDACTED);
  const asJsonString = JSON.stringify(KEY).slice(1, -1);
  if (asJsonString !== KEY) out = out.split(asJsonString).join(REDACTED);
  return out;
};
function show(value: unknown, max?: number): string {
  if (typeof value === 'string') return printable(redact(value), max);
  try { return printable(redact(JSON.stringify(value)), max); }
  catch { return redact(printable(value, max)); }
}
function showJson(value: unknown, max?: number): string {
  try { return printableLines(redact(JSON.stringify(value, null, 1)), max).join(NL); }
  catch { return redact(printableJson(value, max)); }
}
const showLines = (text: string, max?: number) => printableLines(redact(text), max);
// Made in beforeAll, not at import, so that a run that skips every test here leaves no folder behind (round-9 review).
let scratch = '';
beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), 'probe-metered-output-')); });
afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
let responses = 0;
/**
 * The fetch calls, connects and starts the preload wrote down for a run, in order — none when the probe made none.
 * A fetch call is written down when it is made and again once it is built; the two lines are one call, and a call the
 * process ended before it was built stays as one that never finished.
 */
function callsIn(record: string): unknown[] {
  if (!existsSync(record)) return [];
  const entries = readFileSync(record, 'utf8').split(NL).filter(Boolean).map((line) => JSON.parse(line));
  const out: unknown[] = [];
  const made = new Map<number, number>();
  for (const { id, called, ...entry } of entries) {
    if (called === true) { made.set(id, out.length); out.push({ input: entry.input, unfinished: true }); }
    else if (id !== undefined && made.has(id)) out[made.get(id)!] = entry;
    else out.push(id === undefined ? entry : { id, ...entry });
  }
  return out;
}
function runProbe(response: MockResponse, model?: string) {
  const file = join(scratch, `response-${responses}.json`);
  const record = join(scratch, `calls-${responses++}.jsonl`);
  writeFileSync(file, JSON.stringify(response));
  const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: KEY };
  delete env.XAI_PROBE_MODEL;
  if (model !== undefined) env.XAI_PROBE_MODEL = model;
  return { ...spawnProbe(env), calls: callsIn(record) };
}
/**
 * Spawns the probe, takes one chunk of its stdout, then closes the read end — a reader that quits early, as `| head -n 1`
 * or a quit `less` does. With the body held back past the headers (delayMs), the probe is still running when the output
 * closes, so a write to the closed pipe is what would end it unless the probe handles that error (A75). Resolves with the
 * exit code and stderr once the probe exits. (spawnSync cannot do this — it drains stdout to the end, never closing it.)
 */
function spawnProbeEarlyClose(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', preload, probe], {
      env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { stderr += d; });
    child.on('error', () => {});
    child.stdout.on('error', () => {});
    child.stdout.once('data', () => child.stdout.destroy());
    const kill = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', (code) => { clearTimeout(kill); resolve({ code, stderr }); });
  });
}
async function runProbeEarlyClose(response: MockResponse) {
  const file = join(scratch, `response-${responses}.json`);
  const record = join(scratch, `calls-${responses++}.jsonl`);
  writeFileSync(file, JSON.stringify(response));
  const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: KEY };
  delete env.XAI_PROBE_MODEL;
  return { ...(await spawnProbeEarlyClose(env)), calls: callsIn(record) };
}
// A74: runProbe always hands a real key through XAI_API_KEY; this hands whatever a case needs — notably an
// all-whitespace value, which the probe trims to '' and (before the fix) sent as `Bearer ` with no token.
function runProbeWithKey(apiKey: string, response: MockResponse) {
  const file = join(scratch, `response-${responses}.json`);
  const record = join(scratch, `calls-${responses++}.jsonl`);
  writeFileSync(file, JSON.stringify(response));
  const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: apiKey };
  delete env.XAI_PROBE_MODEL;
  return { ...spawnProbe(env), calls: callsIn(record) };
}
// A74: the hidden key prompt only runs at a real terminal, which spawnSync/spawn never give. A Linux run drives it
// under script(1) (util-linux), which allocates a pty; the input is written only AFTER the prompt has shown — the probe
// turns raw mode on before it prints the prompt, so by then the terminal's line discipline can no longer echo the input
// or turn Ctrl-C into SIGINT (docs/10 A74; A78: the prompt used to come first, and input sent in that gap could be echoed
// or become SIGINT). There is no timed fallback send: one sent before the prompt showed would meet the same cooked
// terminal. A prompt that never shows fails every test that uses this, since each checks for what its input should
// produce — the run ends at the 20 s kill if the probe waits, or as soon as it exits (A78 review).
// The preload and probe paths are passed through the environment so sh's
// "$VAR" expansion keeps them intact whatever they hold (preload is a long data: URL). Linux only: the -q/-e/-c
// spelling is this build's, and the Windows runner has no script(1).
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version'], { windowsHide: true }).status === 0;
function runProbePrompt(
  apiKey: string | null,
  sendAfterPrompt: string,
  response: MockResponse,
): Promise<{ code: number | null; out: string; calls: unknown[] }> {
  const file = join(scratch, `response-${responses}.json`);
  const record = join(scratch, `calls-${responses++}.jsonl`);
  writeFileSync(file, JSON.stringify(response));
  const env: NodeJS.ProcessEnv = {
    ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, PROBE_PRELOAD: preload, PROBE_PATH: probe,
  };
  delete env.XAI_PROBE_MODEL;
  if (apiKey === null) delete env.XAI_API_KEY;
  else env.XAI_API_KEY = apiKey;
  return new Promise((resolve) => {
    const child = spawn('script', ['-qec', 'node --import "$PROBE_PRELOAD" "$PROBE_PATH"', '/dev/null'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let sent = false;
    const sendInput = () => {
      if (sent) return;
      sent = true;
      try { child.stdin.write(sendAfterPrompt); } catch { /* the probe may have already exited */ }
    };
    const onData = (d: string) => {
      out += d;
      // Send only once the prompt label is up — the probe sets raw mode before it prints the label (A78), so the input
      // is not echoed and a Ctrl-C reaches the probe rather than the terminal's SIGINT.
      if (out.includes('input hidden, not echoed')) sendInput();
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', onData);
    child.on('error', () => {});
    const kill = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', (code) => { clearTimeout(kill); resolve({ code, out, calls: callsIn(record) }); });
  });
}
const itPrompt = hasScript ? it : it.skip;
/**
 * The one request the probe makes, as fetch would send it: its endpoint, passed as a string, its options, the key in
 * the authorization header and nowhere else (headers as a Headers object lists them: lower-case, in order), the capped
 * body.
 */
const request = (model = 'grok-4.6') => ({
  input: 'string',
  url: 'https://api.x.ai/v1/responses',
  options: ['body', 'headers', 'method'],
  method: 'POST',
  headers: [['authorization', `Bearer ${KEY}`], ['content-type', 'application/json']],
  body: JSON.stringify({ model, input: 'Reply with exactly one word: ok', max_output_tokens: 64 }),
});

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

type Verdicts = { billed: number; notBilled: number; unknown: number; server: number };
const BILLED_ONLY: Verdicts = { billed: 1, notBilled: 0, unknown: 0, server: 0 };
const NOT_BILLED_ONLY: Verdicts = { billed: 0, notBilled: 1, unknown: 0, server: 0 };
const UNKNOWN_ONLY: Verdicts = { billed: 0, notBilled: 0, unknown: 1, server: 0 };
const SERVER_ONLY: Verdicts = { billed: 0, notBilled: 0, unknown: 0, server: 1 };
const NO_VERDICT: Verdicts = { billed: 0, notBilled: 0, unknown: 0, server: 0 };

interface Case {
  name: string; code: number; verdicts: Verdicts; response: MockResponse;
  has?: string[]; hasNot?: string[]; hasOneOf?: string[];
  /** Line starts whose rest `masked` replaces for this row alone — a value printable cannot render the same everywhere. */
  loose?: string[];
  /**
   * The total a billed row prints: 5 unless the row's usage adds up to another (round-4 review of #181: it was masked).
   */
  total?: number;
}
const CASES: Case[] = [
  { name: 'normal-billed', code: 0, verdicts: BILLED_ONLY, response: normalBilled },
  // fields the probe does not read, of the kinds a /v1/responses body carries (the shape of OpenAI's Responses API, not
  // measured against xAI here) — its output a message, not empty —
  // change neither verdict nor exit (round-8 review of #181: no row had any, so a change keyed on one passed; Grok's
  // falsification of #181's round 8: an empty output let a change keyed on a real one pass)
  {
    name: 'billed-with-more-fields', code: 0, verdicts: BILLED_ONLY,
    response: billed({
      object: 'response', created_at: 1760000000, system_fingerprint: 'fp_abc123',
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
    }),
  },
  {
    name: 'no-usage-with-more-fields', code: 2, verdicts: UNKNOWN_ONLY,
    response: {
      status: 200,
      json: {
        object: 'response', id: 'resp_ok', created_at: 1760000000, system_fingerprint: 'fp_abc123',
        output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
      },
    },
  },
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
    hasOneOf: deepShown('usage         ', `{"total_tokens":5,"note":${deeperJson}}`), loose: ['usage         '],
  },
  {
    name: 'deep-id-billed', code: 0, verdicts: BILLED_ONLY,
    response: { status: 200, text: `{"usage":{"total_tokens":5},"id":${deeperJson}}` },
    hasOneOf: deepShown('response id   ', deeperJson, '   <-- may appear in the console'), loose: ['response id   '],
  },
  // a field that is there but falsy prints no line, as before (round-3 review of #181)
  { name: 'falsy-id-status-model', code: 0, verdicts: BILLED_ONLY, response: billed({ id: null, status: '', model: 0 }) },
  // a header value as long as printable cuts, so that a shorter cut is seen (round-3 review of #181)
  { name: 'long-header', code: 0, verdicts: BILLED_ONLY, response: { ...normalBilled, headers: { 'x-long': 'v'.repeat(5000) } } },
  // a 3xx whose body reads stays NOT billed, as #180 left it — Grok's design review of #181's A71 change kept it
  // outside A71 — usage or not (round-3 review of #181: no row pinned that edge)
  { name: 'readable-3xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 300, text: 'choices' } },
  { name: 'usage-3xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 300, json: { usage: { total_tokens: 5 } } } },
  // statuses fetch hands back that no row reached (round-4 reviews of #181): any 2xx is ok, an empty one reports no
  // usage, and 600 to 999 come back as they are
  { name: 'created-201', code: 0, verdicts: BILLED_ONLY, response: { status: 201, json: { usage: { total_tokens: 5 } } } },
  { name: 'no-content-204', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 204 } },
  { name: 'status-600', code: 2, verdicts: SERVER_ONLY, response: { status: 600, text: 'odd' } },
  { name: 'status-999', code: 2, verdicts: SERVER_ONLY, response: { status: 999, json: { error: 'odd' } } },
  // a usage and an id as long as printable cuts, so that a shorter cut is seen (round-4 review of #181)
  { name: 'long-usage-billed', code: 0, verdicts: BILLED_ONLY, response: billed({ usage: { total_tokens: 5, note: 'u'.repeat(5000) } }) },
  { name: 'long-id-billed', code: 0, verdicts: BILLED_ONLY, response: billed({ id: 'i'.repeat(5000) }) },
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
  { name: 'body-is-server-unknown-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: UNKNOWN_SERVER } },
  { name: 'body-is-billed-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: BILLED } },
  // a 5xx exits 2, and says UNKNOWN from its verdict line on: the server may have done the work before failing (A71)
  { name: 'body-is-billed-5xx', code: 2, verdicts: SERVER_ONLY, response: { status: 503, text: BILLED } },
  // and, as after any status that is not 2xx, no sentence says the request was accepted or taken (Grok's falsification
  // of #181's A71 change)
  {
    name: 'json-5xx', code: 2, verdicts: SERVER_ONLY, response: { status: 503, json: { error: 'upstream timeout' } },
    hasNot: ['accepted', 'taken', 'no metered usage', 'rejected'],
  },
  { name: 'json-500', code: 2, verdicts: SERVER_ONLY, response: { status: 500, json: { error: 'internal' } }, hasNot: ['accepted', 'taken'] },
  // the other side of that edge: a status below 500 that is not ok exits 1 once its body is read (round-9 review)
  { name: 'status-499', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 499, text: 'client closed request' } },
  // JSON nested 5,000 deep, past the 1,200-unit window: shown as raw lines. eae57ea re-indented it, and the 503 crashed
  // into exit 1 on Node 22 (not on Node 26 in node:26-slim, Linux; win32 not measured — round-10 review).
  { name: 'deep-json-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: deepJson }, has: ['  | [[[['] },
  { name: 'deep-json-5xx', code: 2, verdicts: SERVER_ONLY, response: { status: 503, text: deepJson }, has: ['  | [[[['] },
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
  { name: 'normal-4xx', code: 1, verdicts: NOT_BILLED_ONLY, response: normal4xx, hasNot: ['accepted', 'taken'] },
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
    has: [
      '--- UNKNOWN: HTTP 200, but the body failed to read ---', `  error: stream broke${BS}u001b[2J`,
      'xAI had already taken the request, so it may have been billed. Do NOT re-run.',
    ],
  },
  // a 2xx other than 200 says the request was taken too (round-5 review of #181: no row had one; a 204 has no body to
  // fail)
  {
    name: 'body-error-201', code: 2, verdicts: NO_VERDICT, response: { status: 201, bodyError: 'stream broke' },
    has: [
      '--- UNKNOWN: HTTP 201, but the body failed to read ---',
      'xAI had already taken the request, so it may have been billed. Do NOT re-run.',
    ],
  },
  // after any other status the lines do not say the request was accepted, and the exit stays 2 (A71) — a 3xx as well
  // as a 4xx or 5xx (fetch follows a 301, 302, 303, 307 or 308 that has a Location header — measured on Node 22.18 —
  // so any other 3xx, or one of those without a Location, reaches the probe)
  {
    name: 'body-error-3xx', code: 2, verdicts: NO_VERDICT, response: { status: 302, bodyError: 'stream broke' },
    has: ['--- UNKNOWN: HTTP 302, but the body failed to read ---'], hasNot: ['accepted', 'taken the request'],
  },
  {
    name: 'body-error-4xx', code: 2, verdicts: NO_VERDICT, response: { status: 400, bodyError: 'stream broke' },
    has: ['--- UNKNOWN: HTTP 400, but the body failed to read ---'], hasNot: ['accepted', 'taken the request'],
  },
  {
    name: 'body-error-5xx', code: 2, verdicts: NO_VERDICT, response: { status: 503, bodyError: 'stream broke' },
    has: ['--- UNKNOWN: HTTP 503, but the body failed to read ---'], hasNot: ['accepted', 'taken the request'],
  },
  // usage: a present total decides (as before), only finite numbers count — anything else is UNKNOWN, never a crash
  { name: 'parts-only', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 2, output_tokens: 3 }), has: ['total tokens  5'] },
  // a part that is absent is left out, as before: one part alone decides
  { name: 'one-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 2 }), has: ['total tokens  2'], total: 2 },
  // a total that is present decides over parts that add up to something else (round-4 review of #181: no row had both)
  { name: 'total-and-parts', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ total_tokens: 7, input_tokens: 2, output_tokens: 3 }), total: 7 },
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
  { name: 'null-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 1, output_tokens: null }), has: ['total tokens  1'], total: 1 },
  // a part of zero is a number like any other; a usage with no count, or only counts under other names, is UNKNOWN —
  // and not a crash (round-10 review)
  { name: 'zero-part', code: 0, verdicts: BILLED_ONLY, response: usage2xx({ input_tokens: 12, output_tokens: 0 }), has: ['total tokens  12'], total: 12 },
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
  // A73: a key a response echoes back — in an error body, a 2xx body, a billed field, a header, the status text — is
  // taken out before it is printed. The not.toContain(KEY) check below holds for every row; these make it bite, and
  // the exact output above (expected) pins where the placeholder lands. Each is the key verbatim, as a response can
  // only echo the key the probe sent, which holds no control character (that path is refused — see the its below).
  { name: 'key-in-error-body', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: { code: 'invalid-argument', error: `Incorrect API key provided: ${KEY}` } }, has: [REDACTED] },
  { name: 'key-in-raw-body-2xx', code: 2, verdicts: UNKNOWN_ONLY, response: { status: 200, text: `no usage here, key=${KEY} end` }, has: [`  | no usage here, key=${REDACTED} end`] },
  { name: 'key-in-usage', code: 0, verdicts: BILLED_ONLY, response: { status: 200, json: { usage: { total_tokens: 5, note: KEY }, id: 'resp_ok' } }, has: [`usage         {"total_tokens":5,"note":"${REDACTED}"}`] },
  { name: 'key-in-billed-id', code: 0, verdicts: BILLED_ONLY, response: billed({ id: `resp_${KEY}_x` }), has: [`response id   resp_${REDACTED}_x   <-- may appear in the console`] },
  { name: 'key-in-billed-model', code: 0, verdicts: BILLED_ONLY, response: billed({ model: KEY }), has: [`model served  ${REDACTED}`] },
  { name: 'key-in-header', code: 0, verdicts: BILLED_ONLY, response: { ...normalBilled, headers: { 'x-echo': `Bearer ${KEY}` } }, has: [`  x-echo: Bearer ${REDACTED}`] },
  { name: 'key-in-status-text', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, statusText: `Bad ${KEY}`, text: 'nope' }, has: [`http status       400 Bad ${REDACTED}`] },
  // A73, finding 1 of Grok's adversarial review: a key written with JSON escapes (here d for the "d") is restored
  // by JSON.parse and would reprint from the re-serialized body. The probe redacts printableJson's OUTPUT (where the
  // key reads decoded), not the source text, so it is taken out. `${BS}u0064ummy-not-a-key` is the source text, which
  // JSON.parse decodes to KEY.
  { name: 'key-json-escaped-body', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, text: `{"error":"${BS}u0064ummy-not-a-key"}` }, has: [REDACTED] },
  // A73, Grok round-2 finding 1: a key straddling printable's length cut. redact runs on the whole text BEFORE the cut,
  // so no prefix of the key survives — the earlier redact-after-cut left one. The key sits across the 4096-unit cut of a
  // header value; hasNot catches a surviving "dummy..." prefix (not.toContain(KEY) alone would not — only a prefix leaks).
  { name: 'key-straddles-the-cut', code: 0, verdicts: BILLED_ONLY, response: { ...normalBilled, headers: { 'x-big': `${'x'.repeat(4090)}${KEY}${'y'.repeat(40)}` } }, hasNot: ['dummy'] },
  // A73, Grok round-3: the key as a JSON property NAME (not a value). show/showJson redact the serialized text, where a
  // name reads just like a value, so it is taken out too — the earlier replacer skipped names.
  { name: 'key-as-property-name', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: { [KEY]: 'echoed' } }, has: [REDACTED] },
  // and a property name straddling the cut: redacting the serialized text before the cut leaves no prefix of the name.
  { name: 'key-name-straddles-cut', code: 1, verdicts: NOT_BILLED_ONLY, response: { status: 400, json: { pad: 'x'.repeat(1168), [KEY]: 1 } }, hasNot: ['dummy'] },
];

/**
 * What the probe prints for a row, stdout and stderr, line for line as `masked` leaves them. A body is shown as the
 * probe shows it — an error body re-indented when its text fits the 1,200-unit window and parses to a truthy JSON value,
 * any other shown body as raw lines behind the prefix (800 units after a 2xx that reports no usage) — and every value
 * from the response goes through printable.mjs's own functions: what those print is pinned by printable.test.ts, and
 * here which of them the probe uses, on what, in what window, and in which line.
 */
function expected(c: Case, at: string): { stdout: string[]; stderr: string[] } {
  const r = c.response;
  const value = (start: string, rest: string) => (c.loose?.includes(start) ? `${start}<...>` : `${start}${rest}`);
  const stdout = PREAMBLE(at);
  if (r.throws !== undefined) {
    return {
      stdout,
      stderr: [
        '', '--- UNKNOWN: the request failed before a response came back ---', `  error: ${show(r.throws)}`,
        'The request may or may not have reached xAI. Do NOT simply re-run.', `Check the console for activity around ${at} first.`,
      ],
    };
  }
  // the headers the preload's Response carries, as the probe walks them, set-cookie left out
  const preloadHeaders = { 'content-type': r.json === undefined ? 'text/plain' : 'application/json', ...r.headers };
  const shown = [...new Response(null, { headers: preloadHeaders }).headers].filter(([k]) => k.toLowerCase() !== 'set-cookie');
  const status = r.status ?? 200;
  stdout.push(
    `http status       ${show(status)} ${show(r.statusText ?? '')}`, `${FINISHED}<time>`, '', HEADERS,
    ...shown.map(([k, v]) => `  ${show(k)}: ${show(v)}`),
  );
  if (r.bodyError !== undefined) {
    const after = status >= 200 && status < 300
      ? ['xAI had already taken the request, so it may have been billed. Do NOT re-run.']
      : ['This probe makes no claim about billing when a body fails to read. Do NOT simply re-run:',
        `check the console for activity around ${at} first.`];
    return {
      stdout,
      stderr: ['', `--- UNKNOWN: HTTP ${show(status)}, but the body failed to read ---`, `  error: ${show(r.bodyError)}`, ...after],
    };
  }
  const text = r.json === undefined ? (r.text ?? '') : JSON.stringify(r.json);
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* shown raw */ }
  const raw = (max: number) => showLines(text, max).map((line: string) => BODY_PREFIX + line);
  if (c.verdicts === NOT_BILLED_ONLY || c.verdicts === SERVER_ONLY) {
    const block = json && text.length <= 1200 ? showJson(json, 1200) : FALLBACK;
    const [verdict, why] = c.verdicts === SERVER_ONLY
      ? [UNKNOWN_SERVER, 'A status of 500 or more can come after the work was done, so it may or may not have been billed.']
      : [NOT_BILLED, 'The API rejected the request, so no metered usage was created.'];
    stdout.push('', verdict, why, ...(block === FALLBACK ? raw(1200) : block.split(NL)), '', ...TRAILER);
  } else if (c.verdicts === UNKNOWN_ONLY) {
    stdout.push('', UNKNOWN_NO_USAGE, 'Cannot claim a billable request was made. Body follows:', ...raw(800));
  } else {
    stdout.push('', BILLED, value('usage         ', show(json?.usage)), `total tokens  ${c.total ?? 5}`);
    if (json?.id) stdout.push(value('response id   ', `${show(json?.id)}   <-- may appear in the console`));
    if (json?.status) stdout.push(value('status        ', show(json?.status)));
    if (json?.model) stdout.push(value('model served  ', show(json?.model)));
    stdout.push('', ...NEXT(at));
  }
  return { stdout, stderr: [] };
}

describe('probe:metered — a response cannot forge its verdict, drive the terminal, or crash it', () => {
  it.each(CASES)('$name exits $code, prints only its own verdict lines, and nothing raw', (c) => {
    const { code, verdicts, response, has = [], hasNot = [], hasOneOf } = c;
    const before = Date.now();
    const r = runProbe(response);
    const after = Date.now();
    expect(r.code).toBe(code);
    expect(hiddenIn(r.out)).toEqual([]);
    expect(count(r.lines, BILLED)).toBe(verdicts.billed);
    expect(count(r.lines, NOT_BILLED)).toBe(verdicts.notBilled);
    expect(count(r.lines, UNKNOWN_NO_USAGE)).toBe(verdicts.unknown);
    expect(count(r.lines, UNKNOWN_SERVER)).toBe(verdicts.server);
    const at = (r.stdout.find((l) => l.startsWith('sent at (UTC)     ')) ?? '').slice(18).split(' ')[0];
    // the time the operator matches against the console: an ISO time from within this run (Grok's falsifications of
    // #181's round-2 and round-3 changes — a time shifted the same way in every line it appears in passed a looser
    // window)
    expect(new Date(at).toISOString()).toBe(at);
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(at)).toBeLessThanOrEqual(after);
    const want = expected(c, at);
    expect(masked(r.stdout, at, c.loose)).toEqual(want.stdout);
    expect(masked(r.stderr, at, c.loose)).toEqual(want.stderr);
    // the key appears nowhere of the probe's own making: a key a response echoes back is taken out before printable.mjs
    // sees it, and a key that could not be a header value is refused before it can reach a fetch error (docs/10 A73 —
    // the key-echo rows above make this bite; the control-character rows are their own its below)
    expect(r.out).not.toContain(KEY);
    expect(r.calls).toEqual([request()]);
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
    const env: NodeJS.ProcessEnv = { ...process.env, XAI_API_KEY: KEY };
    delete env.MOCK_RESPONSE_FILE;
    const r = spawnProbe(env);
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('--- B3 metered-billing positive control ---');
  }, 30_000);

  // without a key and with no terminal to ask on, nothing is sent: exit 1 is the header's "nothing was billed" (round-3
  // review of #181 — no row reached this branch)
  it('says nothing was sent, and exits 1, with no key and no terminal', () => {
    const file = join(scratch, `response-${responses}.json`);
    const record = join(scratch, `calls-${responses++}.jsonl`);
    writeFileSync(file, JSON.stringify(normalBilled));
    const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record };
    delete env.XAI_API_KEY;
    delete env.XAI_PROBE_MODEL;
    const r = spawnProbe(env);
    expect(r.code).toBe(1);
    expect(r.stdout).toEqual([]);
    expect(r.stderr).toEqual(['No key supplied and stdin is not a terminal.', 'Nothing was sent, so nothing was billed.']);
    expect(callsIn(record)).toEqual([]);
  }, 30_000);

  // A73: the probe refuses a key holding any character printable.mjs would escape — control (Cc), format (Cf), line or
  // paragraph separator (Zl, Zp) — before it builds the request, so nothing is sent (exit 1, the header's "nothing was
  // billed") and no line names the key. A control one could not be a header value anyway: fetch (undici, Node 22.18)
  // throws "Headers.append: ... is an invalid header value" with the key quoted (MEASURED 2026-10-23: NUL, LF, CR
  // throw; the key's front and back read through the escapes). These five are characters a spawnSync env var carries
  // intact (NUL it refuses, DEL it drops — MEASURED 2026-10-23); they cover the Cc, Cf and Zl classes the refusal uses.
  it.each([
    ['an LF', ch(10)], ['a CR', ch(13)], ['an ESC', ch(27)], ['a zero-width space', ch(0x200b)], ['a line separator', ch(0x2028)],
  ] as [string, string][])('sends nothing, and names no key, for a key holding %s', (_what, bad) => {
    const file = join(scratch, `response-${responses}.json`);
    const record = join(scratch, `calls-${responses++}.jsonl`);
    writeFileSync(file, JSON.stringify(normalBilled));
    const badKey = `xai-leakfront${bad}leakback`;
    const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: badKey };
    delete env.XAI_PROBE_MODEL;
    const r = spawnProbe(env);
    expect(r.code).toBe(1);
    expect(callsIn(record)).toEqual([]); // nothing was sent
    expect(r.out).not.toContain(badKey);
    expect(r.out).not.toContain('leakfront'); // nor either readable side of it
    expect(r.out).not.toContain('leakback');
    expect(r.out).not.toContain('invalid header value');
    expect(r.out).not.toContain('--- B3 metered-billing positive control ---');
    expect(r.stderr).toContain('The API key contains a control or invisible character, so nothing was sent.');
  }, 30_000);

  // A73, finding 1's other half: a key with a quote or a backslash is a valid header value, so it is sent, and a
  // response can echo it in a JSON body — where it reads JSON-escaped. redact takes out that form too (the key as it
  // reads inside a JSON string), so printableJson's re-serialized output carries no fragment of it.
  it('takes out a key that JSON-escapes when a response echoes it in a body', () => {
    const file = join(scratch, `response-${responses}.json`);
    const record = join(scratch, `calls-${responses++}.jsonl`);
    const quoteKey = `xai-QFRONT${ch(34)}MID${ch(92)}QBACK`; // a quote and a backslash, both of which JSON-escape
    writeFileSync(file, JSON.stringify({ status: 400, json: { error: `bad key ${quoteKey}` } }));
    const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: quoteKey };
    delete env.XAI_PROBE_MODEL;
    const r = spawnProbe(env);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(quoteKey);
    expect(r.out).not.toContain('QFRONT'); // nor either readable side of it
    expect(r.out).not.toContain('QBACK');
    expect(r.out).toContain(REDACTED);
    expect(callsIn(record).length).toBe(1); // a quote/backslash is sendable, so it was sent
  }, 30_000);

  // A73, finding 2 of Grok's review: the first fix re-parsed the redacted body text, so a key that is a substring of
  // the body's JSON structure (a bare number here) broke the parse, left the parsed value null, and the billed branch
  // threw on it. The probe no longer re-parses; a verdict still prints, exit and all.
  it('does not crash when the key collides with the body JSON structure', () => {
    const file = join(scratch, `response-${responses}.json`);
    const record = join(scratch, `calls-${responses++}.jsonl`);
    writeFileSync(file, JSON.stringify(billed({})));
    const env: NodeJS.ProcessEnv = { ...process.env, MOCK_RESPONSE_FILE: file, MOCK_RECORD_FILE: record, XAI_API_KEY: '5' };
    delete env.XAI_PROBE_MODEL;
    const r = spawnProbe(env);
    expect(r.code).toBe(0); // a clean billed verdict, not a crash
    expect(r.lines).toContain(BILLED);
    expect(r.out).not.toContain('TypeError');
  }, 30_000);

  // A74: the probe trims the key AFTER its only empty check, so an all-whitespace key slipped past that check and
  // went out as `Bearer ` with no token — a send that could never bill and had no reason to go. Reproduced here
  // through XAI_API_KEY (no terminal needed); the prompt path, which needs one, is driven under script(1) below.
  // Now a key that is empty once trimmed is refused before anything is sent.
  it('a whitespace-only XAI_API_KEY sends nothing and exits 1, not a "Bearer " request with an empty key (A74)', () => {
    const r = runProbeWithKey('   ', { status: 401, json: { error: 'rejected' } });
    expect(r.calls).toEqual([]); // nothing was sent
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('No key supplied: the input was empty or only whitespace.');
  }, 30_000);

  // A78: raw mode is on BEFORE the prompt shows. The script(1) tests below send their input as soon as they see the
  // prompt; with the prompt first, input landing in the gap met a terminal that still echoed it and turned Ctrl-C into
  // SIGINT (the Ctrl-C control failed 3 of 25 runs under CPU load, and a forced gap failed both controls). Read from the
  // source because no run can make that gap on demand, so this one runs on every platform. Each call is matched from
  // the start of a line, so a `//` comment quoting it does not count (a line inside a `/* */` block would; the probe
  // has none there).
  it('turns raw mode on before it prints the prompt (A78)', () => {
    const src = readFileSync(probe, 'utf8');
    const body = src.slice(src.indexOf('async function promptHidden('), src.indexOf('for await (const chunk of process.stdin)'));
    const raw = body.search(/^[ \t]*process\.stdin\.setRawMode\(true\);/m);
    const label = body.search(/^[ \t]*process\.stdout\.write\(label\);/m);
    expect(raw).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(-1);
    expect(raw).toBeLessThan(label);
  });

  // A74: the empty/blank-key cases at the real terminal the hidden prompt needs. Before the fix, an empty line
  // was blamed on stdin not being a terminal though it was, and a blank key went out as `Bearer `. Driven under
  // script(1) (Linux only — see runProbePrompt). The typed-key and Ctrl-C cases are controls that must not change:
  // the key is never echoed, a real key typed at the prompt is still sent, and Ctrl-C still aborts with exit 2.
  describe('the hidden key prompt at a real terminal, driven under script(1) (A74)', () => {
    itPrompt('an empty line names the empty input, not "not a terminal", and sends nothing (exit 1)', async () => {
      const r = await runProbePrompt(null, CR, normalBilled);
      expect(r.out).toContain('No key supplied: the input was empty or only whitespace.');
      expect(r.out).not.toContain('stdin is not a terminal'); // it IS a terminal here
      expect(r.calls).toEqual([]);
      expect(r.code).toBe(1);
    }, 30_000);

    itPrompt('a whitespace-only entry sends nothing and exits 1 (no `Bearer ` with an empty key)', async () => {
      const r = await runProbePrompt(null, `   ${CR}`, normalBilled);
      // The probe's own line, so a probe that exits 1 before its prompt cannot pass this (A78 review).
      expect(r.out).toContain('No key supplied: the input was empty or only whitespace.');
      expect(r.calls).toEqual([]);
      expect(r.code).toBe(1);
    }, 30_000);

    itPrompt('a real key typed at the prompt is never echoed and is still sent (control)', async () => {
      const r = await runProbePrompt(null, `${KEY}${CR}`, normalBilled);
      expect(r.out).not.toContain(KEY); // echo OFF
      expect(r.calls).toEqual([request()]);
      expect(r.code).toBe(0);
    }, 30_000);

    itPrompt('Ctrl-C at the prompt aborts with exit 2 and sends nothing (control)', async () => {
      const r = await runProbePrompt(null, ch(3), normalBilled);
      expect(r.out).toContain('aborted');
      expect(r.calls).toEqual([]);
      expect(r.code).toBe(2);
    }, 30_000);
  });

  it('sends and prints the model XAI_PROBE_MODEL names (round-4 review of #181: no row set it)', () => {
    const r = runProbe(normalBilled, 'grok-probe-test');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('model             grok-probe-test');
    expect(r.calls).toEqual([request('grok-probe-test')]);
  }, 30_000);

  // A72: the probe reads a response body only up to MAX_BODY units, then cancels the stream — read whole, a body of
  // millions of nested values aborts Node at JSON.parse with no verdict (exit 134, outside the 0/1/2 contract), and a
  // gzip body fetch inflates can exhaust memory while being read. These rows sit just over and just under a cap small
  // enough to run (1 MiB) and pin the behavior the abort measurement stands behind (docs/10 A72): over the cap a 2xx is
  // UNKNOWN and no value of the body is read; at the cap a real billed body still bills. The abort — and that a 5 GB
  // body streams in bounded — is measured against the shipped script, not here.
  const MAX_BODY = 1024 * 1024; // mirrors the probe

  it('a 2xx body over the cap is UNKNOWN (exit 2), read only up to the cap, so no value of it reaches the billed branch (A72)', () => {
    // it WOULD bill if read whole (usage.total_tokens > 0) and carries a large id the billed branch would hand to
    // JSON.stringify — one of the places the probe aborted. Over the cap the body is truncated and reported UNKNOWN.
    const response: MockResponse = { status: 200, json: { usage: { total_tokens: 5 }, id: 'x'.repeat(MAX_BODY) } };
    expect(JSON.stringify(response.json).length).toBeGreaterThan(MAX_BODY);
    const r = runProbe(response);
    expect(r.code).toBe(2);
    expect(r.out).toContain('--- UNKNOWN: 2xx, but the body is too large to read safely ---');
    expect(r.lines).not.toContain(BILLED);
    expect(r.lines).not.toContain(UNKNOWN_NO_USAGE); // the honest message, not "no usage reported"
    expect(hiddenIn(r.out)).toEqual([]);
    expect(r.out).not.toContain(KEY);
    expect(r.calls).toEqual([request()]); // the one request was still sent
  }, 30_000);

  it('a 2xx billed body just under the cap still parses and bills (exit 0) — the cap does not break a legitimate body (A72)', () => {
    const response = billed({ pad: 'y'.repeat(MAX_BODY - 4096) });
    expect(JSON.stringify(response.json).length).toBeLessThanOrEqual(MAX_BODY);
    const r = runProbe(response);
    expect(r.code).toBe(0);
    expect(r.lines).toContain(BILLED);
    expect(r.lines).toContain('usage         {"total_tokens":5}');
    expect(r.lines).toContain('total tokens  5');
  }, 30_000);

  it('a non-2xx body over the cap stays NOT billed (exit 1) from its raw cut lines, read only up to the cap (A72)', () => {
    const response: MockResponse = { status: 400, text: `{"error":"${'z'.repeat(MAX_BODY)}"}` };
    expect(response.text!.length).toBeGreaterThan(MAX_BODY);
    const r = runProbe(response);
    expect(r.code).toBe(1);
    expect(r.lines).toContain(NOT_BILLED);
    expect(r.out).toContain(`${BODY_PREFIX}{"error":"zzz`); // its raw first line, behind the prefix
    expect(r.out).toContain('...(+'); // and cut, not shown whole
    expect(hiddenIn(r.out)).toEqual([]);
  }, 30_000);

  it('stops reading a huge 2xx body at the cap and reports UNKNOWN, instead of draining it whole (A72)', () => {
    // the body offers far more than the cap (4 GiB in 1 MiB chunks, enqueued only as the reader pulls). Reading it whole
    // — as the res.text() this replaced did — would exhaust memory and abort (exit 134, not 0/1/2); the capped stream
    // reads one cap's worth, cancels, and reports UNKNOWN. This is the row that would fail a revert to a read-it-whole.
    const r = runProbe({ status: 200, stream: { chunk: 'x'.repeat(1024 * 1024), count: 4096 } });
    expect(r.code).toBe(2);
    expect(r.out).toContain('--- UNKNOWN: 2xx, but the body is too large to read safely ---');
    expect(r.lines).not.toContain(BILLED);
    expect(r.calls).toEqual([request()]);
  }, 30_000);

  it('a billed 2xx still exits 0, not a false "not billed" (exit 1), when the reader closes the output early mid-body (A75)', async () => {
    // The reader takes the first line and quits (| head -n 1), closing the probe's stdout while the body is still on its
    // way (delayMs). A write to the now-closed pipe then fails; the shipped probe let that EPIPE end it with exit 1 —
    // read as "nothing was billed" whatever the real status, so a billed request looks unbilled and invites a paid
    // re-run (docs/10 A75). A billed response must still exit on its own verdict's code, 0. (A 5xx or a usage-less 2xx
    // that reaches process.exit before the write error is not reproduced by this in-memory mock — the faithful
    // all-status case is measured against the shipped script over a loopback; this pins the billed branch, which ends
    // without process.exit and so dies on the write error on every platform.)
    const r = await runProbeEarlyClose({ status: 200, json: { usage: { total_tokens: 5 }, id: 'ok' }, delayMs: 300 });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([request()]); // the one paid request was still made
  }, 30_000);

  // what the preload refuses at run time, the source must not reach for at all: the word `import` appears once in the
  // probe, on its import of printable.mjs, and never in printable.mjs — so no import of any form, side-effect, quoted
  // either way or dynamic, can come in unseen (Grok's falsification of #181's round 6) — and neither names another way
  // to start a thread or a process or to load a module (round-6 adversarial review of #181), or to run built text
  // (Grok's second run), eval named at all among them, since `const run = eval` needs no `eval(` (round-12 adversarial
  // review of #181) — and neither holds a backslash followed by u, the one escape an identifier can hold, which would
  // write any of these names as an identifier this check does not see (Grok's falsification of #181's round-12 changes,
  // and its second run). That is what plainly written code shows: code that builds a name or what it loads — a name
  // split across strings, or written in one with an escape other than a backslash followed by u (a hex one, say) — is
  // past this check, which matches the text as written; the refusals above still hold there, for connects through net
  // and tls (http, https and http2 go through them), for starts through child_process, worker_threads, cluster and
  // dgram, for process.binding, _linkedBinding, dlopen and execve beneath them, and for the WebSocket and EventSource
  // globals; what such code can still do — write a file, listen on a socket, look a name up — is not refused, and could
  // carry the key off this machine (round-12 adversarial review of #181: the e2e passed a probe that looked up a name
  // carrying it, through dns imported inside eval). Nor does either name the global object, Request or Proxy, a way to
  // reach or redefine a prototype — reflection over an object's own properties included — or the built-ins Object,
  // Array, Buffer, Symbol, Promise and Math, none of which either uses (round-10 and round-11 reviews of #181: a probe
  // that swapped Request for a subclass, or changed a prototype the record is built with, reached through its
  // constructor's descriptors, changed what was written down; and with Object.keys replaced, fetch sent none of the
  // request's own headers where the record showed one — fetch uses the built-ins while it sends, where a record made
  // without sending cannot follow). The preload holds its own of all it builds the record with, taken before the probe
  // runs, so naming the rest of them (Set, Headers, TextDecoder) changes nothing the preload uses unless it reaches
  // their prototypes, which only a banned name does. A built-in changed under fetch some other way — through JSON,
  // Number, String or Date, which the two files use, through one this list does not name, or by code built from text —
  // is past this check: a probe that changes the platform fetch sends with is outside this test. The words are matched
  // anywhere in the two files, comments included, so a comment that holds one — "requires", say — fails this too, and
  // is to be reworded (round-13 adversarial review of #181).
  it('imports only printable.mjs, and names neither a way to start a worker or a process or to reach a prototype, nor a built-in on its list', () => {
    const printableFile = join(here, '..', 'scripts', 'printable.mjs');
    const importing = (file: string) => readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => /\bimport\b/.test(line));
    expect(importing(probe)).toEqual(["import { FALLBACK, printable, printableJson, printableLines } from './printable.mjs';"]);
    expect(importing(printableFile)).toEqual([]);
    const words = [
      'worker_threads', 'child_process', 'cluster', 'dgram', 'getBuiltinModule', 'createRequire', 'require', 'binding', 'Binding',
      'dlopen', 'execve', 'eval', 'Function', 'WebSocket', 'EventSource',
      'global', 'prototype', '__proto__', 'PrototypeOf', 'defineProperty', 'getOwnProperty', 'constructor', 'Reflect',
      'Proxy', 'Request', 'Object', 'Array', 'Buffer', 'Symbol', 'Promise', 'Math', `${BS}u`,
    ];
    for (const file of [probe, printableFile]) expect(words.filter((w) => readFileSync(file, 'utf8').includes(w))).toEqual([]);
  });

  // The preload's fetch reads an init only as new Request reads it — each member as often, in the same order, and with
  // the init as a getter's this — as getters that note each call to them, however they are called, a Proxy that notes
  // each read of a member not set, and a getter that checks its this, see (Grok's falsification of #181's round-9
  // changes: the preload read each member once more first, so a getter could hand fetch one value and the record
  // another; round-10 review of #181: a getter called through its descriptor went unseen by the Proxy alone).
  it('reads a fetch init only as new Request reads it', () => {
    const response = join(scratch, 'reads-response.json');
    const record = join(scratch, 'reads.jsonl');
    const script = join(scratch, 'reads.mjs');
    writeFileSync(response, JSON.stringify({ status: 200, json: {} }));
    writeFileSync(script, [
      'const noted = (reads) => {',
      '  const init = {};',
      "  for (const [key, value] of [['method', 'POST'], ['headers', {}], ['body', '']]) {",
      '    Object.defineProperty(init, key, { enumerable: true, get: () => { reads.push(key); return value; } });',
      '  }',
      '  return new Proxy(init, {',
      "    get: (target, key) => { if (typeof key === 'string' && !Object.hasOwn(target, key)) reads.push(key); return Reflect.get(target, key); },",
      '  });',
      '};',
      "const byRequest = []; new Request('https://example.invalid/', noted(byRequest));",
      "const byFetch = []; await fetch('https://example.invalid/', noted(byFetch));",
      "const init = { method: 'POST', headers: {}, get body() { return this === init ? 'the init as this' : 'another this'; } };",
      "const bodyByRequest = await new Request('https://example.invalid/', init).text();",
      "await fetch('https://example.invalid/', init);",
      'console.log(JSON.stringify({ byRequest, byFetch, bodyByRequest }));',
      'process.exit(0);',
    ].join(NL));
    const run = spawnSync(process.execPath, ['--import', preload, script], {
      env: { ...process.env, MOCK_RESPONSE_FILE: response, MOCK_RECORD_FILE: record }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    const { byRequest, byFetch, bodyByRequest } = JSON.parse(run.stdout) as { byRequest: string[]; byFetch: string[]; bodyByRequest: string };
    expect(byRequest.length).toBeGreaterThan(10);
    expect(byFetch).toEqual(byRequest);
    expect(bodyByRequest).toBe('the init as this');
    expect((callsIn(record) as { body: string }[]).map((c) => c.body)).toEqual(['', bodyByRequest]);
  }, 30_000);

  // Every call is written down — as the platform would make it, or as unbuilt, or as never finished — whatever the
  // caller passes, with each global the preload builds its record with replaced by the caller first (round-10 review
  // of #181, each measured: a byte-order mark that text() dropped and fetch sends; a null init, which fetch takes for
  // an empty one, and an init whose keys cannot be listed, both sent by fetch and neither written down; and globals
  // swapped under the preload; Grok's falsification of #181's round-10 changes: a line break taken at call time went
  // unseen with no call after the swap, and a call made as the process ended was never written down; round-11 review
  // of #181: no call had a first argument that is not a string).
  it('writes down every call, as the platform would make it where it can, whatever it is given and whichever global the record is built with is replaced', () => {
    const response = join(scratch, 'platform-response.json');
    const record = join(scratch, 'platform.jsonl');
    const script = join(scratch, 'platform.mjs');
    const url = 'https://example.invalid/';
    writeFileSync(response, JSON.stringify({ status: 200, json: {} }));
    writeFileSync(script, [
      `const url = '${url}';`,
      "await fetch(url, { method: 'POST', body: String.fromCharCode(0xfeff) + '{}' });",
      'await fetch(url, null);',
      "try { await fetch(url, new Proxy({}, { ownKeys() { throw new Error('no keys'); } })); } catch {}",
      'await fetch(new URL(url), null);',
      'const Platform = Request;',
      'globalThis.Request = class extends Platform { constructor(input) { super(input); } };',
      'globalThis.Proxy = function (target) { return target; };',
      'globalThis.Set = class { add() {} *[Symbol.iterator]() {} };',
      "globalThis.TextDecoder = class { decode() { return 'forged'; } };",
      "Reflect.get = () => undefined; Object.keys = () => []; JSON.stringify = () => '{}'; String.fromCharCode = () => '';",
      "process.env.MOCK_RECORD_FILE += '.elsewhere';",
      // no headers: the platform takes them in through Object.keys, and pairs through Reflect.get too, as they are at
      // that moment, so a probe that replaced one would change the record and the request fetch builds alike (measured
      // — and fetch, sending, further still: with Object.keys replaced it sent none of the request's own headers)
      "const init = Object.assign(Object.create({ signal: AbortSignal.abort() }), { method: 'POST', body: 'sent', agent: 'own' });",
      'await fetch(url, init);',
      // one more after it, so that each is seen on a line of its own, and one made as the process ends
      'await fetch(url, null);',
      'fetch(url, null);',
      'process.exit(0);',
    ].join(NL));
    spawnSync(process.execPath, ['--import', preload, script], {
      env: { ...process.env, MOCK_RESPONSE_FILE: response, MOCK_RECORD_FILE: record }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    const built = (options: string[], method: string, headers: string[][], body: string) => ({ input: 'string', url, options, method, headers, body });
    const text = ['content-type', 'text/plain;charset=UTF-8'];
    expect(callsIn(record)).toEqual([
      built(['body', 'method'], 'POST', [text], `${ch(0xfeff)}{}`),
      built([], 'GET', [], ''),
      { input: 'string', unbuilt: true },
      { ...built([], 'GET', [], ''), input: 'object' },
      built(['agent', 'body', 'method', 'signal'], 'POST', [text], 'sent'),
      built([], 'GET', [], ''),
      { input: 'string', unfinished: true },
    ]);
  }, 30_000);

  // An option fetch would read though Object.keys does not show it, inherited or not enumerable, is written down too
  // (round-8 review of #181: a signal passed that way could stop a paid request with every row still passing) — and
  // one set to null or false, which fetch reads as set: a dispatcher of either makes it refuse the call (round-11
  // review of #181, measured; no option passed here was falsy, so reading only truthy ones went unseen).
  it('writes down every option fetch would read, inherited or not enumerable, null or false', () => {
    const response = join(scratch, 'options-response.json');
    const record = join(scratch, 'options.jsonl');
    const script = join(scratch, 'options.mjs');
    writeFileSync(response, JSON.stringify({ status: 200, json: {} }));
    writeFileSync(script, [
      "const base = { method: 'POST', headers: {}, body: '' };",
      'const inherited = Object.assign(Object.create({ signal: AbortSignal.abort() }), base);',
      'const hidden = { ...base };',
      "Object.defineProperty(hidden, 'signal', { value: AbortSignal.abort(), enumerable: false });",
      'const inheritedNull = Object.assign(Object.create({ dispatcher: null }), base);',
      'const hiddenFalse = { ...base };',
      "Object.defineProperty(hiddenFalse, 'dispatcher', { value: false, enumerable: false });",
      "for (const init of [inherited, hidden, inheritedNull, hiddenFalse]) await fetch('https://example.invalid/', init);",
      'process.exit(0);',
    ].join(NL));
    spawnSync(process.execPath, ['--import', preload, script], {
      env: { ...process.env, MOCK_RESPONSE_FILE: response, MOCK_RECORD_FILE: record }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    expect((callsIn(record) as { options: string[] }[]).map((c) => c.options)).toEqual([
      ['body', 'headers', 'method', 'signal'], ['body', 'headers', 'method', 'signal'],
      ['body', 'dispatcher', 'headers', 'method'], ['body', 'dispatcher', 'headers', 'method'],
    ]);
  }, 30_000);

  // The preload's refusals themselves, all tried once in one process of their own: every start and connect it names is
  // written down and refused — a try counts as refused only when the preload's own refusal throws, since a try's own
  // target can throw too (round-16 review of #181: a refusal that wrote execSync down and then ran it passed). The
  // WebSocket and EventSource tries aim at a port the Fetch standard allows: at 9, which it bars, a WebSocket makes no
  // connect at all (round-18 review of #181); ChildProcess's own spawn gets an argument list, as an empty one made it
  // throw ENOMEM on win32 (round-19 review). Each target is local or does not exist, so a refusal that failed would
  // reach nothing outside — and so a refusal that ran its target and then threw all the same passes where nothing
  // beneath it is refused and its target throws nothing: seven of the 22 do (the Worker, spawnSync, ChildProcess's own
  // spawn, both dgram ones, process.binding and a socket's connect), five more if they first swallow their target's own
  // error, and the other ten fail, nine reaching a refusal beneath them that writes itself down (ChildProcess's own
  // spawn, execFile, a socket's connect, net.connect for the WebSocket) and execve replacing the process — on Linux; on
  // Windows execve throws instead, so it joins the five (measured for each, offline on Linux and on win32 — rounds 17
  // to 19 of #181).
  it('refuses, and writes down, every start and connect it names', () => {
    const response = join(scratch, 'starts-response.json');
    const record = join(scratch, 'starts.jsonl');
    const script = join(scratch, 'starts.mjs');
    writeFileSync(response, JSON.stringify({ status: 200, json: {} }));
    writeFileSync(script, [
      "import cp from 'node:child_process';", "import wt from 'node:worker_threads';", "import dgram from 'node:dgram';",
      "import cluster from 'node:cluster';", "import net from 'node:net';", "import tls from 'node:tls';",
      "const none = 'nothing-to-run';",
      'const tries = [',
      '  () => cp.spawn(none), () => cp.spawnSync(none), () => cp.exec(none), () => cp.execSync(none),',
      '  () => cp.execFile(none), () => cp.execFileSync(none), () => cp.fork(none),',
      '  () => new cp.ChildProcess().spawn({ file: none, args: [none] }), () => new wt.Worker("", { eval: true }),',
      "  () => dgram.createSocket('udp4'), () => new dgram.Socket('udp4'), () => cluster.fork(),",
      "  () => process.binding('spawn_sync'), () => process._linkedBinding('none'), () => process.dlopen({ exports: {} }, none),",
      "  () => process.execve(process.execPath, [process.execPath, '-e', 'process.exit(7)']),",
      "  () => new WebSocket('ws://127.0.0.1:12345'), () => new EventSource('http://127.0.0.1:12345'),",
      "  () => net.connect(9, '127.0.0.1'), () => net.createConnection(9, '127.0.0.1'),",
      "  () => new net.Socket().connect(9, '127.0.0.1'), () => tls.connect(9, '127.0.0.1'),",
      '];',
      'let refused = 0;',
      "for (const t of tries) { try { t(); } catch (e) { if (String(e && e.message).endsWith('blocked by the test preload')) refused++; } }",
      'console.log(`refused ${refused} of ${tries.length}`);',
      'process.exit(0);',
    ].join(NL));
    const r = spawnSync(process.execPath, ['--import', preload, script], {
      env: { ...process.env, MOCK_RESPONSE_FILE: response, MOCK_RECORD_FILE: record }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    expect(r.stdout.trim()).toBe('refused 22 of 22');
    const started = (what: string) => ({ started: what });
    expect(callsIn(record)).toEqual([
      ...['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].map((n) => started(`child_process.${n}`)),
      started('child_process.ChildProcess.spawn'), started('worker_threads.Worker'), started('dgram.createSocket'),
      started('dgram.Socket'), started('cluster.fork'),
      ...['binding', '_linkedBinding', 'dlopen', 'execve'].map((n) => started(`process.${n}`)),
      started('WebSocket'), started('EventSource'),
      ...['net.connect', 'net.createConnection', 'net.Socket.connect', 'tls.connect'].map((socket) => ({ socket })),
    ]);
  }, 30_000);

  // and reached through a module's named exports, as an import by name or a dynamic import's namespace reads them,
  // which the preload brings in line with the modules it changes (round-31 adversarial review of #181: with that left
  // out, every row passed, and a start reached that way ran)
  it('refuses, and writes down, a start or connect reached through a module\'s named exports', () => {
    const response = join(scratch, 'named-response.json');
    const record = join(scratch, 'named.jsonl');
    const script = join(scratch, 'named.mjs');
    writeFileSync(response, JSON.stringify({ status: 200, json: {} }));
    writeFileSync(script, [
      "import { spawnSync } from 'node:child_process';", "import { Worker } from 'node:worker_threads';",
      "import { createSocket } from 'node:dgram';", "import { fork } from 'node:cluster';",
      "import { connect } from 'node:net';", "import { connect as connectTls } from 'node:tls';",
      "const cp = await import('node:child_process');",
      "const none = 'nothing-to-run';",
      'const tries = [',
      "  () => spawnSync(none), () => new Worker('', { eval: true }), () => createSocket('udp4'), () => fork(),",
      "  () => connect(9, '127.0.0.1'), () => connectTls(9, '127.0.0.1'), () => cp.execFileSync(none),",
      '];',
      'let refused = 0;',
      "for (const t of tries) { try { t(); } catch (e) { if (String(e && e.message).endsWith('blocked by the test preload')) refused++; } }",
      'console.log(`refused ${refused} of ${tries.length}`);',
      'process.exit(0);',
    ].join(NL));
    const r = spawnSync(process.execPath, ['--import', preload, script], {
      env: { ...process.env, MOCK_RESPONSE_FILE: response, MOCK_RECORD_FILE: record }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
    });
    expect(r.stdout.trim()).toBe('refused 7 of 7');
    expect(callsIn(record)).toEqual([
      { started: 'child_process.spawnSync' }, { started: 'worker_threads.Worker' }, { started: 'dgram.createSocket' },
      { started: 'cluster.fork' }, { socket: 'net.connect' }, { socket: 'tls.connect' }, { started: 'child_process.execFileSync' },
    ]);
  }, 30_000);
});

// The finish-time check itself, on lines built to fail it — the real probe's lines only ever pass it (round-4 review of
// #181, the rule sonarcloud-config.test.ts follows: checks that only see real output can weaken unseen).
describe('masked', () => {
  // a whole second a minute ago, read from the clock as masked() reads it: every time below but the last is then in the
  // past, and a second later stays a second later when toUTCString drops the milliseconds (round-5 review of #181 — a
  // fixed date failed on a clock set before it)
  const at = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString();
  const later = (ms: number) => new Date(Date.parse(at) + ms).toISOString();

  it('replaces a finish time at least 15 ms after the sent time, and not in the future', () => {
    expect(masked([`${FINISHED}${later(15)}`, `${FINISHED}${later(20)}`], at)).toEqual([`${FINISHED}<time>`, `${FINISHED}<time>`]);
  });

  // each time is made when its row runs: one made with the table would no longer be in the future once the rows above
  // in this file had taken a minute (Grok's falsification of #181's round 5)
  it.each([
    ['the sent time itself', () => at], ['14 ms after it', () => later(14)], ['before it', () => later(-1)],
    ['not a time', () => 'soon'],
    // a second later and in the past, so that only its form is wrong
    ['a time that is not ISO', () => new Date(Date.parse(at) + 1000).toUTCString()],
    ['a time in the future', () => new Date(Date.now() + 60_000).toISOString()],
  ] as [string, () => string][])('leaves %s as it is', (_what, time) => {
    const t = time();
    expect(masked([`${FINISHED}${t}`], at)).toEqual([`${FINISHED}${t}`]);
  });

  it('replaces a row\'s loose line, and only that one', () => {
    expect(masked(['usage         x', 'status        y'], at, ['usage         '])).toEqual(['usage         <...>', 'status        y']);
  });
});
