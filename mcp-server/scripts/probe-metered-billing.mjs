#!/usr/bin/env node
/**
 * Optional live probe: does the xAI metered API console report usage AT ALL?
 *
 * WHY THIS EXISTS (docs/10 B3)
 * Every `billing` value this server reports is derived from the configured mode —
 * `billingFor(mode)` — never observed. The obvious check is "look at the metered console and
 * see zero", but a zero there proves nothing on its own: delayed ingestion, an unlisted SKU, or
 * spend on another key all produce the same quiet zero. Before a zero can mean anything, the
 * console has to be shown to report SOMETHING. This probe makes exactly one deliberate,
 * capped metered request so there is something for the console to find.
 *
 * WHAT IT CAN AND CANNOT ESTABLISH — read before recording a result
 *   CAN:    that the console reports a raw `POST /v1/responses` made with this key.
 *   CANNOT: that the console would report THIS PLUGIN's traffic. The plugin runs the grok CLI,
 *           a different call path that may bill under a different line item. So a later zero
 *           for the plugin's own runs still cannot separate "they were not metered" from
 *           "they were metered as traffic this view does not show".
 *           Record a zero as a FAILED ATTEMPT TO DISPROVE, never as a clean bill of health.
 *           (Adversarial review 2026-09-12 rejected the stronger wording; this is the narrowed
 *           claim that survived.)
 *
 * SAFETY
 * - Never touches ~/.grok, GROK_HOME, GROK_BUILD_AUTH_MODE, the MCP server, or the plugin.
 *   A raw HTTP call has no session concept, so the hazard `auth.ts` records — a dead key in api
 *   mode silently falling back to the subscription session, making a "metered" run not metered —
 *   cannot occur here. That is the whole reason this is HTTP and not a grok CLI run.
 * - Never prints, logs or writes the key. A key holding a control or invisible character — anything
 *   printable.mjs would render as an escape — is refused before the request is built (docs/10 A73): a
 *   control one could not even be a header value (fetch throws "... is an invalid header value" with
 *   the key quoted), nothing is sent, so that is exit 1, and the message names no key. And the key
 *   (raw, or as it reads inside a JSON string) is taken out of every value shown — a body, a header, a
 *   status text, an error message — so a response that echoes the key back cannot print it either.
 * - Prompts for the key with echo OFF. Do NOT type `$env:XAI_API_KEY = "..."` at a PowerShell
 *   prompt: PSReadLine saves console input to ConsoleHost_history.txt incrementally (MEASURED
 *   2026-09-12 on a Win11 box: SaveIncrementally, 316 lines already stored), so the key would
 *   survive in plaintext long after the variable is cleared.
 * - An empty or whitespace-only key is refused before anything is sent: the key is trimmed first, and if it is then
 *   empty the probe exits 1 with no request — so a blank entry never goes out as `Bearer ` with no token. A stdin
 *   that is not a terminal, where the hidden prompt cannot run, is reported as that, apart from an empty line entered
 *   at a real terminal (docs/10 A74).
 * - `set-cookie` is stripped from the printed headers: it is a Cloudflare bot-management token
 *   identifying the client to x.ai, and output from this probe tends to get pasted into tickets.
 * - Every value taken from the response or from an error goes through printable.mjs, so it can
 *   neither add a line nor drive the terminal (control and format characters are shown as escapes,
 *   long values are cut). An error body whose text fits the 1200-unit window and parses to a truthy
 *   JSON value is shown as JSON.stringify's lines, none of which can start with "---"; any other body
 *   the probe shows (an error body that does not, or a 2xx body that reports no usage) is shown line
 *   by line behind BODY_PREFIX. So no response prints one of this probe's verdict lines. A long value
 *   can still wrap in a narrow terminal — the exit code is the verdict.
 * - The response body is read only up to MAX_BODY units, then the stream is cancelled: a 2xx longer than that is
 *   UNKNOWN (usage cannot be read), another status keeps its verdict and shows only its raw lines, cut. So a body of
 *   millions of nested values — or a gzip bomb fetch inflates — cannot be read whole to exhaust memory and abort the
 *   probe with no verdict, past its 0/1/2 (docs/10 A72).
 * - A reader that closes the output early (| head -n 1, or a quit pager) cannot end the probe before its verdict:
 *   stdout and stderr take their own write errors, so a broken-pipe EPIPE no longer ends the probe with exit 1 — a
 *   false "nothing was billed" — whatever the real status. It runs to its verdict and exits on that code (docs/10 A75).
 *
 * Usage (from mcp-server/): npm run probe:metered
 * Exit 0 = usage reported, so something was billed.
 * Exit 1 = nothing was billed.
 * Exit 2 = UNKNOWN; it may or may not have been billed. Do NOT blindly re-run.
 *          (These codes are a contract, unlike most sibling probes' report-and-exit-0: the
 *          operator is spending real money and needs "do not retry" to be machine-checkable.)
 */

import { FALLBACK, printable, printableJson, printableLines } from './printable.mjs';

// A75: take the write errors on stdout and stderr so a reader that closes the output early (| head -n 1, or a quit
// less) cannot end the probe before its verdict. Without this, the first write to the closed pipe fails with EPIPE
// and, unhandled, ends the process with exit 1 — the code the header defines as "nothing was billed" — whatever the
// real status, so a billed 2xx or a 5xx reads as not billed and invites a paid re-run (docs/10 A75). With it the probe
// runs to its verdict and exits on that verdict's code; the cut-off output is harmless, since the exit code, not the
// text, is the contract. MEASURED over a loopback: output closed early, a 200 / usage-less 2xx / 400 / 503 end 0/2/1/2.
for (const s of [process.stdout, process.stderr]) s.on('error', () => {});

// Every line of a raw response body is printed behind this, so a body that is exactly one of the
// verdict lines below still cannot print that line.
const BODY_PREFIX = '  | ';

const ENDPOINT = 'https://api.x.ai/v1/responses';
// AUDITED 2026-09-23. The default is a HARDCODED model id in a probe that spends real money, which is
// the coupling class `npm run probe:contract` exists to catch — the catalog moves on its own
// (grok-4.6 was the default when this was written; grok models now answers grok-4.7). Left as is
// on purpose: changing it means spending money to verify, and any valid model serves this probe's
// question. If xAI retires this id, the failure will look like an API error rather than "nothing
// was billed" — override with XAI_PROBE_MODEL rather than guessing from the exit code.
const MODEL = process.env.XAI_PROBE_MODEL || 'grok-4.6';
// Caps output AND reasoning tokens per xAI's parameter reference. Without it a reasoning model
// can bill far more than "reply with one word" suggests.
const MAX_OUTPUT_TOKENS = 64;
// A72: the probe reads at most this many UTF-16 units of the response body, then stops and cancels the stream. Read
// whole, a body of millions of nested values exhausts the heap at JSON.parse and Node aborts with no verdict (exit 134,
// outside this probe's 0/1/2 contract — a platform code, not one the probe picks), and a gzip body fetch inflates can
// do the same while still being read. Capping the read bounds it all at once — what JSON.parse builds, what the billed
// branch's JSON.stringify re-expands, and what redact copies — since none can exceed the units actually read. A real
// /v1/responses body for one capped word is far under 1 MiB; a larger one is truncated and reported UNKNOWN, not
// guessed at. MEASURED 2026-10-24: offered a 5 GB body, the read stops at 1 MiB with RSS ~56 MB — docs/10 A72.
const MAX_BODY = 1024 * 1024;

/** Read a line from the TTY without echoing it, so it never reaches shell history. */
async function promptHidden(label) {
  if (!process.stdin.isTTY) return null;
  // Raw mode first, then the label: input typed once the label shows must not reach a terminal that still echoes it and
  // turns Ctrl-C into SIGINT instead of "aborted" (docs/10 A78: the label used to come first. MEASURED 2026-10-27 in a
  // Linux container, with the label first: the test's Ctrl-C control failed 3 of 25 runs under CPU load, and a forced
  // gap between the two lines failed both prompt controls).
  process.stdin.setRawMode(true);
  process.stdout.write(label);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let out = '';
  for await (const chunk of process.stdin) {
    for (const ch of chunk) {
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        return out;
      }
      if (ch === '') { // Ctrl-C
        process.stdin.setRawMode(false);
        process.stdout.write('\naborted\n');
        process.exit(2);
      }
      if (ch === '' || ch === '\b') { out = out.slice(0, -1); continue; }
      out += ch;
    }
  }
  process.stdin.setRawMode(false);
  return out;
}

// A73. The operator pastes this probe's output into tickets, so the key must land in none of it. One helper refuses a
// key that could not be shown or sent cleanly; three show the key-free form of what printable.mjs would print.
const REDACTED = '(api key redacted)';
const BACKSLASH = String.fromCodePoint(92);
// The characters printable.mjs renders as escapes: control (Cc, which covers NUL, LF and CR), format (Cf), and the line
// and paragraph separators (Zl, Zp). A key holding one is refused before anything is sent — a control character cannot
// even be a header value (fetch throws "... is an invalid header value" with the key quoted in the message, MEASURED
// 2026-10-23 on Node 22.18), and any of them would print as an escape, which would break the whole-key match the
// redaction below relies on. A real key holds none of these.
const HIDDEN_IN_KEY = new RegExp('[' + BACKSLASH + 'p{Cc}' + BACKSLASH + 'p{Cf}' + BACKSLASH + 'p{Zl}' + BACKSLASH + 'p{Zp}]', 'u');
function keyHasHiddenChar(s) {
  return HIDDEN_IN_KEY.test(s);
}
// Take the key out of a string: both raw, and — because show/showJson redact serialized JSON, where a key with a quote
// or a backslash reads escaped — as it reads inside a JSON string (JSON.stringify(key) without the quotes). split/join,
// so a regex metacharacter in the key stays literal. For a real key (no quote, no backslash) the two forms are equal and
// only the raw replace runs; the second can over-redact a key-free body that happens to hold that spelling, accepted on
// purpose — over-redacting a pathological key's spelling is safe, printing the key is not.
function redact(s) {
  if (typeof s !== 'string' || key === '') return s;
  let out = s.split(key).join(REDACTED);
  const asJsonString = JSON.stringify(key).slice(1, -1);
  if (asJsonString !== key) out = out.split(asJsonString).join(REDACTED);
  return out;
}
const NEWLINE = String.fromCodePoint(10);
// printable.mjs's three exports with the key taken out of what they print, redacting the WHOLE text BEFORE printable
// cuts it — so no window edge keeps a prefix of the key, wherever it sits: a string value, a property name, or a number.
// A value is serialized here and redacted as text, then handed to printable: printable of a string is cut-then-escape,
// and of a value it is stringify-then-cut-then-escape, so for a value with no key the two agree. If serializing throws
// (a value too deep), printable answers FALLBACK, which holds no key; showJson keeps the stringify newlines via
// printableLines (printable would escape them).
function show(value, max) {
  if (typeof value === 'string') return printable(redact(value), max);
  try { return printable(redact(JSON.stringify(value)), max); }
  catch { return redact(printable(value, max)); }
}
function showJson(value, max) {
  try { return printableLines(redact(JSON.stringify(value, null, 1)), max).join(NEWLINE); }
  catch { return redact(printableJson(value, max)); }
}
const showLines = (text, max) => printableLines(redact(text), max);

let key = process.env.XAI_API_KEY;
if (key) {
  console.log('Using XAI_API_KEY from the environment.');
  console.log('If you typed that assignment at a shell prompt, the key is now in your shell');
  console.log('history file — clear that line afterwards, or rotate the key.');
  console.log('');
} else {
  key = await promptHidden('Paste the xAI API key (input hidden, not echoed): ');
  // A74: promptHidden returns null ONLY when stdin is not a terminal, where the hidden prompt cannot run at all,
  // and '' when Enter is pressed at a real terminal. The old `if (!key)` took both for "not a terminal", so an
  // empty line typed at a real prompt was blamed, wrongly, on stdin not being one. Only null is that case; the
  // trimmed-empty check below names an empty entry for what it is (docs/10 A74).
  if (key === null) {
    console.error('No key supplied and stdin is not a terminal.');
    console.error('Nothing was sent, so nothing was billed.');
    process.exit(1);
  }
}
// Trim both paths (the prompt always did, the environment did not): a key read from a file or a shell
// may carry a trailing newline, which fetch strips before sending anyway.
key = key.trim();
// A74: refuse a key that is empty once trimmed — a blank line at the prompt, or an all-whitespace XAI_API_KEY —
// before anything is built. The trim used to run after the only empty check, so an all-blank key slipped through
// and went out as `Bearer ` with no token: a send that cannot bill and has no reason to go. Nothing is sent, so
// this is exit 1, and the message names no key.
if (key === '') {
  console.error('No key supplied: the input was empty or only whitespace.');
  console.error('Nothing was sent, so nothing was billed.');
  process.exit(1);
}
// A73: refuse a key that holds a character printable.mjs would escape (keyHasHiddenChar explains why). Nothing is
// sent, so this is exit 1, and the message names no key. A trailing newline is not this case — the trim removed it.
if (keyHasHiddenChar(key)) {
  console.error('The API key contains a control or invisible character, so nothing was sent.');
  console.error('Nothing was sent, so nothing was billed.');
  process.exit(1);
}

const body = {
  model: MODEL,
  input: 'Reply with exactly one word: ok',
  max_output_tokens: MAX_OUTPUT_TOKENS,
};

const sentAt = new Date().toISOString();
console.log('--- B3 metered-billing positive control ---');
console.log('endpoint          ' + ENDPOINT);
console.log('model             ' + MODEL);
console.log('max_output_tokens ' + MAX_OUTPUT_TOKENS);
console.log('sent at (UTC)     ' + sentAt + '   <-- match THIS against the console');
console.log('');

let res;
try {
  res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
} catch (err) {
  // The request may have reached xAI before this threw — a reset or TLS error on the way back
  // is indistinguishable here from never having left. Claiming "nothing was billed" would be a
  // guess, and a wrong guess invites a re-run that pays twice.
  console.error('');
  console.error('--- UNKNOWN: the request failed before a response came back ---');
  console.error('  error: ' + show(err instanceof Error ? err.message : err));
  console.error('The request may or may not have reached xAI. Do NOT simply re-run.');
  console.error('Check the console for activity around ' + sentAt + ' first.');
  process.exit(2);
}

console.log('http status       ' + show(res.status) + ' ' + show(res.statusText));
console.log('finished (UTC)    ' + new Date().toISOString());
console.log('');
console.log('--- response headers (set-cookie omitted on purpose) ---');
for (const [k, v] of res.headers) {
  if (k.toLowerCase() === 'set-cookie') continue;
  console.log('  ' + show(k) + ': ' + show(v));
}

let text = '';
let truncated = false;
try {
  if (res.body) {
    // A72: read at most MAX_BODY units, then stop and cancel the stream (MAX_BODY explains why). fetch has already
    // decompressed, and the reader pulls one chunk at a time with back-pressure, so cancelling after the cap frees the
    // rest — a body too big to hold, a gzip bomb among them, cannot be read whole and exhaust memory. `truncated` = the
    // body was longer and the rest was dropped.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
        if (text.length > MAX_BODY) { text = text.slice(0, MAX_BODY); truncated = true; break; }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
} catch (err) {
  // Only a 2xx says the request was accepted (A71: it said "accepted" after a 4xx too). Every status still exits 2
  // here, as before — Grok's design review kept that, since a non-2xx moved to exit 1 could invite a re-run that pays
  // twice — so after a non-2xx the lines claim nothing about billing.
  console.error('');
  console.error('--- UNKNOWN: HTTP ' + show(res.status) + ', but the body failed to read ---');
  console.error('  error: ' + show(err instanceof Error ? err.message : err));
  if (res.ok) {
    console.error('xAI had already taken the request, so it may have been billed. Do NOT re-run.');
  } else {
    console.error('This probe makes no claim about billing when a body fails to read. Do NOT simply re-run:');
    console.error('check the console for activity around ' + sentAt + ' first.');
  }
  process.exit(2);
}

let json = null;
// The capped body is always small enough to parse safely (MAX_BODY). A truncated body rarely parses (its JSON was cut
// off), but even if its prefix happens to, `truncated` makes a 2xx UNKNOWN below — a partial parse is never read as billed.
try { json = JSON.parse(text); } catch { /* raw text is printed below */ }

console.log('');
if (!res.ok) {
  // A status of 500 or more is UNKNOWN from its verdict line on, as its exit code says (A71: a 5xx printed "NOT
  // billed" and exited 2). fetch hands back 600 to 999 as they are (measured, Node 22.18), so the sentence names no
  // class.
  if (res.status >= 500) {
    console.log('--- UNKNOWN: the server failed, perhaps after doing the work ---');
    console.log('A status of 500 or more can come after the work was done, so it may or may not have been billed.');
  } else {
    console.log('--- NOT billed ---');
    console.log('The API rejected the request, so no metered usage was created.');
  }
  // A body is re-indented only when its text fits the window and parses to a truthy JSON value; any
  // other body is shown as its raw lines. JSON.stringify builds the whole re-indented text before it
  // is cut, and the indentation grows with nesting: a 457 KB nested body took about a second and
  // 962 MB (measured 2026-10-17), and past roughly 1,700 to 4,200 levels it throws while JSON.parse goes
  // much deeper (the call stack decides — on Node 22 about 1,700 levels of objects and 2,200 of arrays
  // on win32, 4,200 on Linux) — on eae57ea that killed the probe with exit 1, a 5xx included.
  const block = json && text.length <= 1200 ? showJson(json, 1200) : FALLBACK;
  if (block !== FALLBACK) console.log(block);
  else for (const line of showLines(text, 1200)) console.log(BODY_PREFIX + line);
  console.log('');
  console.log('MEASURED 2026-09-12 with a deliberately bogus key: a bad key returns 400 with');
  console.log('{"code":"invalid-argument","error":"Incorrect API key provided..."} — not 401.');
  console.log('403 means revoked or no access, 404 means the endpoint moved, 429 rate limited.');
  console.log('A status of 500 or more is different: the server may have completed the work');
  console.log('before failing, so that is reported as UNKNOWN, not as "not billed".');
  process.exit(res.status >= 500 ? 2 : 1);
}

// A72: a 2xx body longer than the cap was read only up to it, so usage is unknown. Say that plainly and stop at UNKNOWN
// (exit 2), rather than fall into "no usage reported" below, which would imply the whole body was read and had none. A
// 2xx may have been billed, so this never reads as "not billed".
if (truncated) {
  console.log('--- UNKNOWN: 2xx, but the body is too large to read safely ---');
  console.log('The body is over the ' + MAX_BODY + '-unit cap; only that much was read, so usage cannot be read.');
  console.log('It may or may not have been billed. Do NOT simply re-run: check the console for activity around');
  console.log(sentAt + ' first.');
  process.exit(2);
}

// A 2xx alone is not proof of billing. Cloudflare fronts this endpoint, and an interstitial or
// an error body can arrive as 200. Usage is what is being claimed, so usage is what must exist.
const usage = json?.usage ?? null;
// A total that is present (not null) decides, as it always did; the parts count only without one,
// and then every part that is present must be a number too. Only a finite number counts — anything
// else makes the count 0. Before this, a usage field that could not become a primitive crashed
// `> 0` or `+` into exit 1 after a billed request; a numeric string, a boolean or an array was
// counted ("5", true or [5] as a total was billed, and the parts [2] and 3 made 23); and two huge
// parts could add up to Infinity. All of these take the UNKNOWN branch below (exit 2).
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
let totalTokens = 0;
if (usage) {
  const parts = [usage.input_tokens, usage.output_tokens].filter((v) => v != null);
  if (usage.total_tokens != null) totalTokens = finite(usage.total_tokens) ?? 0;
  else if (parts.every((v) => finite(v) !== undefined)) totalTokens = parts.reduce((sum, v) => sum + v, 0);
}

if (!usage || !(Number.isFinite(totalTokens) && totalTokens > 0)) {
  console.log('--- UNKNOWN: 2xx but no usage reported ---');
  console.log('Cannot claim a billable request was made. Body follows:');
  for (const line of showLines(text, 800)) console.log(BODY_PREFIX + line);
  process.exit(2);
}

console.log('--- billed: one metered request was accepted ---');
console.log('usage         ' + show(usage));
console.log('total tokens  ' + show(totalTokens));
if (json.id) console.log('response id   ' + show(json.id) + '   <-- may appear in the console');
if (json.status) console.log('status        ' + show(json.status));
if (json.model) console.log('model served  ' + show(json.model));

console.log('');
console.log('NEXT: wait for the vendor ingestion delay, then read the metered console for');
console.log('REQUEST COUNT around ' + sentAt + ' — not the dollar figure. One small request');
console.log('rounds to $0.00 and looks like nothing happened.');
console.log('');
console.log('Then read the limit in this file\'s header before writing anything down: a later');
console.log('zero for the plugin\'s own runs is a failed attempt to disprove, not a clean bill.');
