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
 *
 * Usage (from mcp-server/): npm run probe:metered
 * Exit 0 = usage reported, so something was billed.
 * Exit 1 = nothing was billed.
 * Exit 2 = UNKNOWN; it may or may not have been billed. Do NOT blindly re-run.
 *          (The sibling probes always exit 0. This one does not, because the operator is
 *          spending real money and needs "do not retry" to be machine-checkable.)
 */

const ENDPOINT = 'https://api.x.ai/v1/responses';
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
  console.error('--- UNKNOWN: ' + err.message + ' ---');
  console.error('The request may or may not have reached xAI. Do NOT simply re-run.');
  console.error('Check the console for activity around ' + sentAt + ' first.');
  process.exit(2);
}

console.log('http status       ' + res.status + ' ' + res.statusText);
console.log('finished (UTC)    ' + new Date().toISOString());
console.log('');
console.log('--- response headers (set-cookie omitted on purpose) ---');
for (const [k, v] of res.headers) {
  if (k.toLowerCase() === 'set-cookie') continue;
  console.log('  ' + k + ': ' + v);
}

let text;
try {
  text = await res.text();
} catch (err) {
  console.error('');
  console.error('--- UNKNOWN: ' + res.status + ' accepted but the body failed to read: '
    + err.message + ' ---');
  console.error('xAI had already taken the request, so it may have been billed. Do NOT re-run.');
  process.exit(2);
}

let json = null;
try { json = JSON.parse(text); } catch { /* raw text is printed below */ }

console.log('');
if (!res.ok) {
  console.log('--- NOT billed ---');
  console.log('The API rejected the request, so no metered usage was created.');
  console.log((json ? JSON.stringify(json, null, 1) : text).slice(0, 1200));
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
const totalTokens = usage
  ? (usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)))
  : 0;

if (!usage || !(totalTokens > 0)) {
  console.log('--- UNKNOWN: 2xx but no usage reported ---');
  console.log('Cannot claim a billable request was made. Body follows:');
  console.log(text.slice(0, 800));
  process.exit(2);
}

console.log('--- billed: one metered request was accepted ---');
console.log('usage         ' + JSON.stringify(usage));
console.log('total tokens  ' + totalTokens);
if (json.id) console.log('response id   ' + json.id + '   <-- may appear in the console');
if (json.status) console.log('status        ' + json.status);
if (json.model) console.log('model served  ' + json.model);

console.log('');
console.log('NEXT: wait for the vendor ingestion delay, then read the metered console for');
console.log('REQUEST COUNT around ' + sentAt + ' — not the dollar figure. One small request');
console.log('rounds to $0.00 and looks like nothing happened.');
console.log('');
console.log('Then read the limit in this file\'s header before writing anything down: a later');
console.log('zero for the plugin\'s own runs is a failed attempt to disprove, not a clean bill.');
