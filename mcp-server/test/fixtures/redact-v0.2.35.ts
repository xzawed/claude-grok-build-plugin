// FROZEN: the redactor v0.2.35 shipped (418c1e9, mcp-server/src/history.ts), copied verbatim — only the
// exported name differs. It is the oracle for redact-floor.test.ts: v0.2.36 must mask everything this masks.
// Never edit it to make a test pass. Three of its regexes are quadratic on long inputs (A43); the test
// feeds it short lines only.

function looksLikeSecretValue(v: string): boolean {
  if (v.length < 12 || /\s/.test(v)) return false;
  const mixed = /\d/.test(v) && /[A-Za-z]/.test(v);
  return mixed || v.length >= 32;
}

// Named assignments. The quote groups cover the shapes users actually paste — a JSON/.mcp.json
// env block, a quoted .env line, YAML — not just a bare `K=v`. The separator and quoting are
// preserved on replacement so a redacted JSON blob still reads as JSON.
const NAMED_KEYS =
  'XAI_API_KEY|GROK_CODE_XAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|ANTHROPIC_API_KEY'
  + '|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|SLACK_TOKEN'
  // A6: a connection string carries the password inline, so the KEY is the only warning. Named
  // rather than generic because `DATABASE_URL: string` must stay prose — NON_SECRET_WORDS covers
  // that, and a URL value is never one of those words.
  + '|DATABASE_URL|DB_URL|DATABASE_URI|CONNECTION_STRING|MONGO_URL|MONGODB_URI|REDIS_URL|POSTGRES_URL';
const GENERIC_KEYS =
  'password|passwd|pwd|secret|client_secret|access_token|refresh_token|auth_token|api[_-]?key|access[_-]?key|private[_-]?key';

const ASSIGNMENT = new RegExp(
  `(["']?)\\b(${NAMED_KEYS}|${GENERIC_KEYS})\\b\\1(\\s*[=:]\\s*)(["']?)([^\\s"',}]+)\\4`,
  'gi',
);
const IS_NAMED_KEY = new RegExp(`^(?:${NAMED_KEYS})$`, 'i');

// Words that follow a credential name in a SPEC rather than a secret: type annotations, schema
// notes, placeholders. `OPENAI_API_KEY: string belongs in the env schema` is documentation.
const NON_SECRET_WORDS = new Set([
  'string', 'number', 'boolean', 'int', 'bool', 'object', 'array', 'null', 'undefined',
  'true', 'false', 'none', 'empty', 'unset', 'required', 'optional', 'missing', 'present',
  'todo', 'tbd', 'placeholder', 'example', 'value', 'here', 'any', 'generated', 'unchanged',
]);

/**
 * A name from NAMED_KEYS is itself strong evidence — nobody assigns to `XAI_API_KEY` casually —
 * so the value only has to be plausible rather than opaque. Generic names like `password` need
 * the stricter test above, because they appear in prose constantly.
 */
function shouldRedactAssignment(name: string, value: string): boolean {
  if (!IS_NAMED_KEY.test(name)) return looksLikeSecretValue(value);
  if (!/[A-Za-z0-9]/.test(value)) return false;       // `${{`, punctuation fragments
  return !NON_SECRET_WORDS.has(value.toLowerCase());
}

// Prefix-shaped tokens that are self-identifying wherever they appear. Each still requires the
// opaque-value test, so `sk-learn-model-selection` and `xai-cli-wrapper` stay prose.
const TOKEN_SHAPES: RegExp[] = [
  /\bxai-[A-Za-z0-9_-]{20,}/gi,                                   // xAI, incl. pasted bare
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/gi,                           // OpenAI / Anthropic style
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,                                // GitHub classic PAT
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,                              // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{20,}/gi,                             // Slack
  /\bAKIA[0-9A-Z]{16}\b/g,                                        // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  // A6: Stripe and Google, both self-identifying by prefix.
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/g,                          // Stripe secret key
  /\bAIza[0-9A-Za-z_-]{20,}/g,                                     // Google API key
  // A22: npm automation / granular access tokens. The 30-char floor is what keeps this out of
  // prose — `npm_` is a common identifier prefix (npm_config_registry, npm_package_version,
  // npm_lifecycle_event), so a rule without a length bound would re-create exactly the
  // over-correction Grok caught in the A6 round. Real tokens carry 36 base62 characters.
  /\bnpm_[A-Za-z0-9]{30,}/g,                                       // npm token
];

/**
 * A6: credentials inside a URL — `postgres://app:pw@host/db`, `https://user:token@github.com`.
 *
 * Only the PASSWORD is replaced. Erasing the whole URL would take the host and path with it, and
 * a redaction that destroys the row is one someone eventually turns off — `postgres://app:
 * <redacted>@db.internal:5432/prod` still says which database the task was about.
 *
 * The scheme AND the `@` are what make this a credential rather than a ratio or a timestamp, so
 * a bare `postgres://` with no `user:pass@` does not match and `parse postgres:// urls` stays
 * prose.
 *
 * FOUND BY GROK: the user part is `*`, not `+`. `redis://:password@cache:6379` — no username at
 * all — is the STANDARD Redis URL form, and requiring a username let it through untouched.
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]*):([^\s@/]+)@/gi;

// `Bearer authentication-middleware` is a sentence, not a credential — hence the value test.
// A6: `Basic` too. Base64 of `user:password` is a credential in exactly the same way, and the
// length + opacity test keeps `uses Basic auth in staging` prose.
const AUTH_SCHEME = /\b((?:Bearer|Basic)\s+)([A-Za-z0-9._~+/-]{20,}={0,2})/gi;

// A pasted key block is multi-line; the preview collapses whitespace before this runs, so match
// the collapsed form too.
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

// A6: the block above requires a CLOSING marker, and a 200-char preview truncates mid-key as a
// matter of course — so the truncated paste, the common one, was the case that leaked. After an
// opening marker there is nothing left in a preview worth keeping, so everything after it goes.
const PRIVATE_KEY_OPENING = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g;

export function redactSecretsV0235(s: string): string {
  let out = s
    .replace(URL_CREDENTIALS, (_m, scheme: string, user: string) => `${scheme}${user}:<redacted>@`)
    .replace(PRIVATE_KEY_BLOCK, '<redacted>')
    .replace(PRIVATE_KEY_OPENING, '<redacted>')
    .replace(AUTH_SCHEME, (m, prefix: string, value: string) =>
      looksLikeSecretValue(value) ? `${prefix}<redacted>` : m)
    .replace(ASSIGNMENT, (m, q1: string, name: string, sep: string, q2: string, value: string) =>
      shouldRedactAssignment(name, value) ? `${q1}${name}${q1}${sep}${q2}<redacted>${q2}` : m);
  for (const re of TOKEN_SHAPES) {
    out = out.replace(re, (m: string) => (looksLikeSecretValue(m) ? '<redacted>' : m));
  }
  return out;
}
