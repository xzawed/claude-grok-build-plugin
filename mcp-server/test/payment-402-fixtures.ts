// What grok prints when xAI refuses the model turn for payment (HTTP 402) — MEASURED 2026-11-29 on grok 1.0.92, win32,
// quota 0. The setup: a synthetic session in a throwaway home, and grok's two API base URLs (GROK_CLI_CHAT_PROXY_BASE_URL,
// GROK_XAI_API_BASE_URL) on a loopback. The loopback answered 404 to every request except the model turn
// (POST /v1/responses), which got HTTP 402 with the body {"error":"Grok Build usage balance exhausted"}.
//
// With the delegate's argv (`--always-approve --cwd <dir> --single=… --output-format json`) grok exited 1, with
// ENVELOPE_402 on stdout and STDERR_402 on stderr. With `-p` and no output format, stdout was empty and stderr the same.
// That body reproduces, word for word, the line xAI itself produced on 2026-11-04 for four subscription delegations
// (grok 1.0.70, through the v0.2.51 bundle — docs/09 §4 J).
export const PAYMENT_LINE = 'Internal error: {\n  "message": "API error (status 402 Payment Required): Grok Build usage balance exhausted",\n  "http_status": 402\n}';
export const ENVELOPE_402 = `${JSON.stringify({ type: 'error', message: PAYMENT_LINE, cwd: '/tmp/proj' })}\n`;
export const STDERR_402 = `Error: ${PAYMENT_LINE}\n`;

// Three more bodies measured the same day:
// - a `code` beside `error` ({"code":"Payment Required","error":…}) puts its value before the words;
// - a nested `type` ({"error":{"message":…,"type":"insufficient_quota","code":"usage_exhausted"}}) does the same, and the
//   nested `code` does not reach the line;
// - a body that is not JSON leaves grok's own words instead of the server's.
export const PAYMENT_LINE_CODE = 'Internal error: {\n  "message": "API error (status 402 Payment Required): Payment Required: Grok Build usage balance exhausted",\n  "http_status": 402\n}';
export const PAYMENT_LINE_TYPE = 'Internal error: {\n  "message": "API error (status 402 Payment Required): insufficient_quota: Grok Build usage balance exhausted",\n  "http_status": 402\n}';
export const PAYMENT_LINE_PLAIN = 'Internal error: {\n  "message": "API error (status 402 Payment Required): Request failed (HTTP 402).",\n  "http_status": 402\n}';

// The control, from the same harness the same day: every request answered 404.
export const LINE_404 = 'Internal error: {\n  "message": "API error (status 404 Not Found): not found",\n  "http_status": 404\n}';
