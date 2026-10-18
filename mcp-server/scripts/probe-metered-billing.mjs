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
 * - Never prints, logs or writes the key.
 * - Prompts for the key with echo OFF. Do NOT type `$env:XAI_API_KEY = "..."` at a PowerShell
 *   prompt: PSReadLine saves console input to ConsoleHost_history.txt incrementally (MEASURED
 *   2026-09-12 on a Win11 box: SaveIncrementally, 316 lines already stored), so the key would
 *   survive in plaintext long after the variable is cleared.
 * - `set-cookie` is stripped from the printed headers: it is a Cloudflare bot-management token
 *   identifying the client to x.ai, and output from this probe tends to get pasted into tickets.
 * - Every value taken from the response or from an error goes through printable.mjs, so it can
 *   neither add a line nor drive the terminal (control and format characters are shown as escapes,
 *   long values are cut). An error body whose text fits the 1200-unit window and parses to a truthy
 *   JSON value is shown as JSON.stringify's lines, none of which can start with "---"; any other body
 *   the probe shows (an error body that does not, or a 2xx body that reports no usage) is shown line
 *   by line behind BODY_PREFIX. So no response prints one of this probe's verdict lines. A long value
 *   can still wrap in a narrow terminal — the exit code is the verdict.
 *
 * Usage (from mcp-server/): npm run probe:metered
 * Exit 0 = usage reported, so something was billed.
 * Exit 1 = nothing was billed.
 * Exit 2 = UNKNOWN; it may or may not have been billed. Do NOT blindly re-run.
 *          (These codes are a contract, unlike most sibling probes' report-and-exit-0: the
 *          operator is spending real money and needs "do not retry" to be machine-checkable.)
 */

import { FALLBACK, printable, printableJson, printableLines } from './printable.mjs';

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

/** Read a line from the TTY without echoing it, so it never reaches shell history. */
async function promptHidden(label) {
  if (!process.stdin.isTTY) return null;
  process.stdout.write(label);
  process.stdin.setRawMode(true);
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

let key = process.env.XAI_API_KEY;
if (key) {
  console.log('Using XAI_API_KEY from the environment.');
  console.log('If you typed that assignment at a shell prompt, the key is now in your shell');
  console.log('history file — clear that line afterwards, or rotate the key.');
  console.log('');
} else {
  key = await promptHidden('Paste the xAI API key (input hidden, not echoed): ');
  if (!key) {
    console.error('No key supplied and stdin is not a terminal.');
    console.error('Nothing was sent, so nothing was billed.');
    process.exit(1);
  }
  key = key.trim();
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
  console.error('  error: ' + printable(err instanceof Error ? err.message : err));
  console.error('The request may or may not have reached xAI. Do NOT simply re-run.');
  console.error('Check the console for activity around ' + sentAt + ' first.');
  process.exit(2);
}

console.log('http status       ' + printable(res.status) + ' ' + printable(res.statusText));
console.log('finished (UTC)    ' + new Date().toISOString());
console.log('');
console.log('--- response headers (set-cookie omitted on purpose) ---');
for (const [k, v] of res.headers) {
  if (k.toLowerCase() === 'set-cookie') continue;
  console.log('  ' + printable(k) + ': ' + printable(v));
}

let text;
try {
  text = await res.text();
} catch (err) {
  console.error('');
  console.error('--- UNKNOWN: ' + printable(res.status) + ' accepted but the body failed to read ---');
  console.error('  error: ' + printable(err instanceof Error ? err.message : err));
  console.error('xAI had already taken the request, so it may have been billed. Do NOT re-run.');
  process.exit(2);
}

let json = null;
try { json = JSON.parse(text); } catch { /* raw text is printed below */ }

console.log('');
if (!res.ok) {
  console.log('--- NOT billed ---');
  console.log('The API rejected the request, so no metered usage was created.');
  // A body is re-indented only when its text fits the window and parses to a truthy JSON value; any
  // other body is shown as its raw lines. JSON.stringify builds the whole re-indented text before it
  // is cut, and the indentation grows with nesting: a 457 KB nested body took about a second and
  // 962 MB (measured 2026-10-17), and past roughly 1,700 to 4,200 levels it throws while JSON.parse goes
  // much deeper (the call stack decides — on Node 22 about 1,700 levels of objects and 2,200 of arrays
  // on win32, 4,200 on Linux) — on eae57ea that killed the probe with exit 1, a 5xx included.
  const block = json && text.length <= 1200 ? printableJson(json, 1200) : FALLBACK;
  if (block !== FALLBACK) console.log(block);
  else for (const line of printableLines(text, 1200)) console.log(BODY_PREFIX + line);
  console.log('');
  console.log('MEASURED 2026-09-12 with a deliberately bogus key: a bad key returns 400 with');
  console.log('{"code":"invalid-argument","error":"Incorrect API key provided..."} — not 401.');
  console.log('403 means revoked or no access, 404 means the endpoint moved, 429 rate limited.');
  console.log('A 5xx is different: the server may have completed the work before failing, so');
  console.log('that is reported as UNKNOWN, not as "not billed".');
  process.exit(res.status >= 500 ? 2 : 1);
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
  for (const line of printableLines(text, 800)) console.log(BODY_PREFIX + line);
  process.exit(2);
}

console.log('--- billed: one metered request was accepted ---');
console.log('usage         ' + printable(usage));
console.log('total tokens  ' + printable(totalTokens));
if (json.id) console.log('response id   ' + printable(json.id) + '   <-- may appear in the console');
if (json.status) console.log('status        ' + printable(json.status));
if (json.model) console.log('model served  ' + printable(json.model));

console.log('');
console.log('NEXT: wait for the vendor ingestion delay, then read the metered console for');
console.log('REQUEST COUNT around ' + sentAt + ' — not the dollar figure. One small request');
console.log('rounds to $0.00 and looks like nothing happened.');
console.log('');
console.log('Then read the limit in this file\'s header before writing anything down: a later');
console.log('zero for the plugin\'s own runs is a failed attempt to disprove, not a clean bill.');
