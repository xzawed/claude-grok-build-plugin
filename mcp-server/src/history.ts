import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DelegateInput, DelegateResult } from './types.js';

export interface HistoryEntry {
  ts: string;
  mode: DelegateResult['mode'];
  billing: DelegateResult['billing'];
  status: DelegateResult['status'];
  cwd: string;
  promptPreview: string;
  summaryPreview?: string;
  filesChanged: string[];
  filesTruncated: boolean;
  filesCount: number;
  durationMs: number;
  worktreePath?: string;
  sandbox?: string;
  /** Set only for rows the grok_cli passthrough wrote (A2); absent = delegate/plan/verify. */
  via?: HistorySource;
  plan?: boolean;
  check?: boolean;
  /** From grok JSON when present — enables later `resume` without scanning Claude context. */
  sessionId?: string;
  /** B3: the model the run RECORDED (`grok-4.7-build`), not the catalog default. 1.0.30+. */
  model?: string;
  /** B3: grok's own `usage.total_tokens`. Never a sum this repo computed. 1.0.30+. */
  totalTokens?: number;
  /** A32: set only when git HEAD moved during the run — i.e. the diff-review gate was bypassed. */
  committed?: boolean;
}

export interface HistoryMeta {
  ts: string;         // ISO timestamp, injected by the caller (index.ts)
  durationMs: number; // wall-clock around runDelegate
  /**
   * Which tool produced the row. Absent means grok_build_delegate/plan/verify — the shape every
   * row had before A2 — so old history stays readable without a migration.
   */
  via?: HistorySource;
}

/** A2: grok_cli passthroughs are delegations too, but a reader must be able to tell them apart. */
export type HistorySource = 'grok_cli';

const MAX_PREVIEW = 200;
const MAX_FILES = 100;

// Redaction used to cover only the two xAI BILLING keys, because the original threat model was
// "don't let a pasted key change who gets charged". Measured 2026-09-03: that left a Bearer JWT,
// an AWS secret, a GitHub PAT and a bare `password:` line written verbatim into
// ~/.grok-build/history.jsonl and replayed to Claude through grok_build_usage.recent[] and
// grok_build_status.lastSession — while CLAUDE.md principle #4 and the logging design spec both
// promise "no credentials, ever". The nets below close that gap.
//
// Every pattern is deliberately conservative: a secret needs a recognisable prefix, or an
// assignment operator plus a value long enough not to be prose. Over-masking costs a useless
// history, so `Fix the token parser` and `the api_key field is missing` must survive untouched —
// pinned by a test.

/**
 * The value test that keeps this useful. An assignment alone is not evidence — engineers write
 * `api_key: required`, `DATABASE_URL: string`, `password: unchanged` and
 * `private_key: /etc/ssl/app.pem` in ordinary task descriptions, and redacting those destroys the
 * history for no safety gain. Measured 2026-09-03 over 45 realistic prompts: matching on the name
 * plus any 8+ character value mangled 19 of them.
 *
 * A credential is opaque: long, unbroken, and mixed. Plain words, type names and paths are not.
 */
function looksLikeSecretValue(v: string): boolean {
  if (v.length < 12 || /\s/.test(v)) return false;
  const mixed = /\d/.test(v) && /[A-Za-z]/.test(v);
  return mixed || v.length >= 32;
}

// Names that carry a credential whatever they end in. A6: a connection string carries the password
// inline, so the KEY is the only warning — `DATABASE_URL: string` stays prose through
// NON_SECRET_WORDS, and a URL value is never one of those words.
const NAMED_KEYS =
  'XAI_API_KEY|GROK_CODE_XAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|ANTHROPIC_API_KEY'
  + '|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|SLACK_TOKEN'
  + '|DATABASE_URL|DB_URL|DATABASE_URI|CONNECTION_STRING|MONGO_URL|MONGODB_URI|REDIS_URL|POSTGRES_URL';
const IS_NAMED_KEY = new RegExp(`^(?:${NAMED_KEYS})$`, 'i');

// Words that follow a credential name in a SPEC rather than a secret: type annotations, schema
// notes, placeholders. `OPENAI_API_KEY: string belongs in the env schema` is documentation.
const SHIPPED_NON_SECRET_WORDS = [
  'string', 'number', 'boolean', 'int', 'bool', 'object', 'array', 'null', 'undefined',
  'true', 'false', 'none', 'empty', 'unset', 'required', 'optional', 'missing', 'present',
  'todo', 'tbd', 'placeholder', 'example', 'value', 'here', 'any', 'generated', 'unchanged',
];

/**
 * The assignment rule v0.2.35 shipped, kept VERBATIM and run FIRST, as a floor. The A37 rule below
 * reads far more names, but each refinement that left ordinary text alone was also a way to leave a
 * secret: three review rounds each found lines this rule masked and the rewrite wrote verbatim — a
 * connection string after a named key, `PassWord`, `password: ${X:-default}`, `ENC(…)`, a credential
 * name inside another value. With this rule first nothing it masks can come back: the rewrite only
 * masks MORE, and it reads the `<redacted>` written here as a placeholder.
 */
const SHIPPED_GENERIC_KEYS =
  'password|passwd|pwd|secret|client_secret|access_token|refresh_token|auth_token|api[_-]?key|access[_-]?key|private[_-]?key';
const SHIPPED_ASSIGNMENT = new RegExp(
  String.raw`(["']?)\b(${NAMED_KEYS}|${SHIPPED_GENERIC_KEYS})\b\1(\s*[=:]\s*)(["']?)([^\s"',}]+)\4`,
  'gi',
);
const SHIPPED_NON_SECRET = new Set(SHIPPED_NON_SECRET_WORDS);

function shippedRedacts(name: string, value: string): boolean {
  if (!IS_NAMED_KEY.test(name)) return looksLikeSecretValue(value);
  if (!/[A-Za-z0-9]/.test(value)) return false;       // `${{`, punctuation fragments
  return !SHIPPED_NON_SECRET.has(value.toLowerCase());
}

/**
 * A37: which OTHER names carry a credential. This used to be a word list matched at `\b` — and `_` is
 * a word character, so the most common .env shape, a PREFIXED name (`DB_PASSWORD`, `JWT_SECRET`,
 * `TWILIO_AUTH_TOKEN`, `SENDGRID_API_KEY`), never matched: measured 9 of 9 written verbatim to
 * history.jsonl. A name is now read by its LAST segment, split on `_ . -` and camelCase, so the prefix
 * does not matter — `spring.datasource.password`, `--db-password`, `dbPassword` and `.npmrc`'s
 * `_authToken` end in a credential word too. `key` alone is not one (`sort_key`, `primary_key`); a
 * qualified key is.
 *
 * The pre-merge review measured what that reading lost against the old word list: run-together keys
 * (`accesskey`, `privatekey`) are ONE segment, which `access[_-]?key` had matched. They are words here.
 */
const CREDENTIAL_WORDS = new Set([
  'password', 'passwd', 'pwd', 'pass', 'passphrase', 'secret', 'token',
  'apikey', 'accesskey', 'privatekey', 'secretkey',
]);
// A prefix written INTO the word is one segment too — `PGPASSWORD`, `DBPassword`, `csrftoken` — so a
// last segment that ENDS in one of the longer words counts. Not `pass` or `pwd`: `bypass`, `oldpwd`.
const RUN_TOGETHER_WORDS = ['password', 'passwd', 'passphrase', 'secret', 'token', 'apikey'];
// `account`: Azure's `AccountKey=` in a storage connection string. Found by Grok's adversarial pass
// on this rule, with `passphrase` above; both were measured leaking before the change. `master` and
// `hmac` (`RAILS_MASTER_KEY`, `HMAC_KEY`): measured leaking by the pre-merge review.
const KEY_QUALIFIERS = new Set([
  'api', 'access', 'secret', 'private', 'encryption', 'signing', 'account', 'master', 'hmac',
]);
// `token` and `pass` also COUNT things — `MAX_OUTPUT_TOKEN=128000`, `FIRST_PASS=1` — so a SHORT number
// after them is a setting: up to 7 digits after `token` (context sizes run to millions; `MAX_SUBTOKEN`
// too), up to 3 after `pass` (pass counts). A longer one is a PIN or a key — `WIFI_PASS=4829103765`,
// proposed by Grok against the first version of this rule, which let any number through. After
// `password` or `secret` any number is a password (`POSTGRES_PASSWORD=12345`).
function settingDigits(word: string): number {
  if (word.endsWith('token')) return 7;
  return word === 'pass' ? 3 : 0;
}
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
// No credential name — and no name a placeholder refers to — is longer. The env-name test overflowed
// V8's regex stack on a 7M-character `A_A_…` name, and the history row was lost with it (re-review).
const MAX_NAME_LENGTH = 256;

function nameSegments(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_.-]+/).filter(Boolean)
    .map((p) => p.toLowerCase());
}

/**
 * How much the NAME already says. `named` (a NAMED_KEY) and `env` (an UPPER_SNAKE name ending in a
 * credential word) are evidence on their own — nobody writes `DB_PASSWORD=` casually — so the value
 * only has to be plausible; an `env` name ending in a counting word (`MAX_TOKEN`) also leaves a short
 * number (`settingDigits`). `generic` is a bare or code-style name (`password:`, `apiKey =`): those appear
 * in prose and schemas constantly, so the value has to look opaque as well.
 *
 * The LEAF decides `named` and `env` — the part after the last `.`, without leading dashes — so
 * `process.env.GITHUB_TOKEN`, `--GITHUB_TOKEN` and `cfg.CONNECTION_STRING` are the keys they name.
 * The whole name used to be compared, and they fell to `generic` (pre-merge review, measured leaking).
 * A dotted name is code as often as config, though (`self.DB_PASSWORD = password`), so its value is held
 * to the generic test unless it is quoted (`dotted`, applied in shouldRedactValue).
 */
type NameTier = 'named' | 'env' | 'generic';
interface Credential { tier: NameTier; settingDigits: number; dotted: boolean }
function credentialOf(name: string): Credential | undefined {
  if (name.length > MAX_NAME_LENGTH) return undefined;
  const bare = name.replace(/^-+/, '');
  const leaf = bare.slice(bare.lastIndexOf('.') + 1);
  const dotted = leaf !== bare;
  if (IS_NAMED_KEY.test(leaf)) return { tier: 'named', settingDigits: 0, dotted };
  const seg = nameSegments(name);
  while (seg.length > 1 && /^\d+$/.test(seg.at(-1) ?? '')) seg.pop(); // DB_PASSWORD_2
  let last = seg.at(-1);
  if (last === undefined) return undefined;
  // camelCase splits a word written with a capital inside it: `PassWord`, `passWd` (re-review).
  const joined = (seg.at(-2) ?? '') + last;
  if (CREDENTIAL_WORDS.has(joined)) last = joined;
  const word = last;
  const credential = CREDENTIAL_WORDS.has(word)
    || RUN_TOGETHER_WORDS.some((w) => word.endsWith(w))
    || (word === 'key' && KEY_QUALIFIERS.has(seg.at(-2) ?? ''));
  if (!credential) return undefined;
  if (!ENV_NAME.test(leaf)) return { tier: 'generic', settingDigits: 0, dotted };
  return { tier: 'env', settingDigits: settingDigits(word), dotted };
}

// The words above, plus flags and types an env-style name is set to: `HAS_PASSWORD=yes`,
// `USE_TOKEN=bearer`, pydantic's `DB_PASSWORD: SecretStr`.
const NON_SECRET_WORDS = new Set([
  ...SHIPPED_NON_SECRET_WORDS,
  'yes', 'no', 'on', 'off', 'enabled', 'disabled', 'bearer', 'basic', 'str', 'secretstr',
]);

/**
 * Values that STAND FOR a secret: a template slot, a variable reference, a mask, a sample. A sample
 * .env or a shell/CI reference is documentation whatever the name says — but only when what it refers
 * to is a NAME: UPPER_SNAKE (`$DB_PASSWORD`, `$S3_BUCKET_2`) or letters without digits (`$dbPassword`,
 * `${var.db_password}`, `<your_api_key>`), under 32 characters. `$uperS3cretPassw0rd`, `<hU7x…>`,
 * `$SUMMER2024X` and `$Password123` are secrets in a placeholder's shape (two review rounds measured
 * them written verbatim). The value stops before `}`, so `${DB_PASSWORD}` arrives as `${DB_PASSWORD`;
 * `${X:?unset}` names X and holds only an error text. The floor's own `<redacted>` reads as one too.
 */
const REFERENCES = [
  /^<([^<>]*)>$/,                     // <your_stripe_secret_key>
  /^\$\{([a-z_][\w.]*)(?::?\?.*)?$/i, // ${DB_PASSWORD, ${var.db_password, ${X:?unset
  /^\$([a-z_]\w*)$/i,                 // $DB_PASSWORD
  /^%([a-z_]\w*)%$/i,                 // %API_KEY%
  /^your[-_]([\w-]*)$/i,              // your-api-key
];
function looksLikeName(n: string): boolean {
  if (n.length > MAX_NAME_LENGTH) return false;
  return ENV_NAME.test(n) || (n.length < 32 && /^[A-Za-z_.-]*$/.test(n));
}
function isPlaceholder(v: string): boolean {
  for (const re of REFERENCES) {
    const name = re.exec(v)?.[1];
    if (name !== undefined) return looksLikeName(name);
  }
  return /^(?:x{3,}|\*{3,}|\.{3,}|changeme)$/i.test(v);
}

// A shell default carries a real value: `${PGPASS:-hunter2…}` is judged by what follows the operator
// (`:-` `-` `:=` `=` `:+` `+`). Read as a placeholder, it was a secret the old redactor had masked.
const SHELL_DEFAULT = /^\$\{[A-Za-z_]\w*:?[-=+]/;
// An unquoted value that CALLS something is code: `z.string().min(32)`, `generateToken(user1);`,
// `crypto.randomBytes(32)`, `os.getenv(`. Only a call that starts lowercase and holds no `=`:
// `Summer(2024)`, `ENC(…)` and `Pa55w0rd[12]` are values (re-review — each was written verbatim by the
// first code rule, which took any call). `Optional[str]` looks like them, so it is masked.
const CODE_CALL = /^[a-z_$][\w$.]*[([]/;

/**
 * `value` is what may be masked (closers trimmed), `raw` the whole run it came from. The opaque test
 * reads `raw`: `Tr0ub4dor&3.` is 12 characters, `Tr0ub4dor&3` 11 (re-review), and `${X:-admin123}` is
 * judged whole, as the floor judges it, so a weak default after a code-style name is not waved through.
 */
function shouldRedactValue(c: Credential, value: string, raw: string, quoted: boolean): boolean {
  const shellDefault = SHELL_DEFAULT.exec(value);
  const judged = shellDefault ? value.slice(shellDefault[0].length) : value;
  if (!judged || isPlaceholder(judged)) return false;
  if (!quoted && CODE_CALL.test(raw) && !raw.includes('=')) return false;
  // `self.DB_PASSWORD = password`, `process.env.API_KEY = apiKey`: code. Quoted, it is a value.
  const tier = c.dotted && !quoted ? 'generic' : c.tier;
  if (tier === 'generic') return looksLikeSecretValue(raw);
  if (!/[A-Za-z0-9]/.test(judged)) return false;                 // `${{`, punctuation fragments
  // MAX_OUTPUT_TOKEN=128000: a setting.
  if (judged.length <= c.settingDigits && /^\d+$/.test(judged)) return false;
  return !NON_SECRET_WORDS.has(judged.toLowerCase());
}

// Every `name =` / `name:` is a candidate and the NAME decides. The candidate ends at the separator —
// the value is read only for a credential name — so a non-credential name never consumes the text
// after it: in `$env:DB_PASSWORD=…` the `env:` head is passed over and the scan resumes on
// `DB_PASSWORD`. The quote groups cover what people paste — a JSON env block, a quoted .env line,
// YAML — and are carried into the replacement so a redacted JSON blob still reads as JSON.
// A43: the lookbehind starts a name only where a run of name characters starts, so each run is read
// once; a start at every `\b` re-read `a.b.c…` from each dot. It sits AFTER the optional quote, on the
// name itself: before the quote it also refused `x"password": …`, which `\b` had allowed.
const ASSIGNMENT_HEAD = /(["']?)(?<![\w.-])(-{0,2}[A-Za-z_][\w.-]*)\1(\s*[=:]\s*)/g;
const ASSIGNMENT_VALUE = /(["']?)([^\s"',}]+)\1/y;
/**
 * Once the preview collapses whitespace, an EMPTY value is followed by the next line's assignment —
 * `DB_PASSWORD=` then `DB_HOST=localhost`, `NEXT_EMPTY=` or YAML's `DB_HOST:` — and that is not this
 * name's value. Only an env-style name counts: after `CONNECTION_STRING: ` a value like
 * `Server=db;…;Pwd=…` IS the value (re-review: read as the next assignment, the password was written
 * verbatim). A base64 value ends in `=` too, hence `=` then a non-`=`, or `=` alone at the end.
 */
function isNextAssignment(raw: string): boolean {
  const op = raw.search(/[=:]/);
  if (op < 1 || op > MAX_NAME_LENGTH || !ENV_NAME.test(raw.slice(0, op))) return false;
  return raw[op] === '=' ? raw[op + 1] !== '=' : op === raw.length - 1;
}
// What closes AROUND an unquoted value — a bracket, a code span, the sentence, a shell `;` — stays in
// the text, not in the mask (pre-merge review: `(DB_PASSWORD=hunter2)` lost its `)`).
const CLOSERS = '.)];`';

/** How much of an unquoted value is this name's: `undefined` when it is the next line's assignment. */
function readUnquoted(raw: string, sep: string): { value: string; length: number } | undefined {
  if (/\s$/.test(sep) && isNextAssignment(raw)) return undefined;
  let n = raw.length;
  while (n > 0 && CLOSERS.includes(raw[n - 1])) n--;
  return { value: raw.slice(0, n), length: n };
}

function redactAssignments(s: string): string {
  let out = '';
  let last = 0;
  ASSIGNMENT_HEAD.lastIndex = 0;
  for (let m = ASSIGNMENT_HEAD.exec(s); m !== null; m = ASSIGNMENT_HEAD.exec(s)) {
    const [head, q1, name, sep] = m;
    const credential = credentialOf(name);
    if (!credential) continue;
    const at = m.index + head.length;
    ASSIGNMENT_VALUE.lastIndex = at;
    const v = ASSIGNMENT_VALUE.exec(s);
    if (!v) continue;
    const [whole, q2, raw] = v;
    const span = q2 ? { value: raw, length: whole.length } : readUnquoted(raw, sep);
    if (!span) continue;
    const end = at + span.length;
    if (span.value && shouldRedactValue(credential, span.value, raw, q2 !== '')) {
      out += `${s.slice(last, m.index)}${q1}${name}${q1}${sep}${q2}<redacted>${q2}`;
      last = end;
    }
    // A value is read once, masked or not — as the one-regex rule consumed it. Resuming inside an
    // unmasked value re-read `pwd=${pwd=${…` from every head: 64,000 chars took 268 ms and 512,000
    // took 17.4 s (pre-merge review).
    ASSIGNMENT_HEAD.lastIndex = end;
  }
  return out + s.slice(last);
}

/**
 * JWT: `eyJ` + three dot-separated base64url segments (8+ each), masked when opaque.
 *
 * A43: read run by run, not by one regex. The regex started at every `\b` — a run's start, or right
 * after a `-` inside it — and in `eyJ-eyJ-…` re-read the rest of the run from each `-` looking for the
 * dot (64,000 chars: 1.87 s, on every delegation's prompt). A first fix started only at a run's start,
 * and so stopped masking a JWT written right after a `-` (`cookie=session-eyJ…`) — found by the
 * pre-merge review. This keeps every `\b` start and reads each run once: all starts in one run share its
 * end and what follows it, so the earliest start with 8+ characters after `eyJ` decides for all of
 * them. After a match the scan resumes past the token, masked or not, as the global replace did.
 */
const B64URL_RUN = /[A-Za-z0-9_-]+/g;
const JWT_REST = /\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/y;

function redactJwts(s: string): string {
  let out = '';
  let last = 0;
  B64URL_RUN.lastIndex = 0;
  for (let m = B64URL_RUN.exec(s); m !== null; m = B64URL_RUN.exec(s)) {
    const run = m[0];
    let start = -1;
    for (let i = run.indexOf('eyJ'); i >= 0 && run.length - i - 3 >= 8; i = run.indexOf('eyJ', i + 1)) {
      if (i === 0 || run[i - 1] === '-') { start = i; break; }
    }
    if (start < 0) continue;
    JWT_REST.lastIndex = m.index + run.length;
    if (JWT_REST.exec(s) === null) continue;
    const from = m.index + start;
    if (looksLikeSecretValue(s.slice(from, JWT_REST.lastIndex))) {
      out += `${s.slice(last, from)}<redacted>`;
      last = JWT_REST.lastIndex;
    }
    B64URL_RUN.lastIndex = JWT_REST.lastIndex;
  }
  return out + s.slice(last);
}

// Prefix-shaped tokens that are self-identifying wherever they appear. Each still requires the
// opaque-value test, so `sk-learn-model-selection` and `xai-cli-wrapper` stay prose. Applied in this
// order; the JWT step is a scanner (redactJwts), not a regex.
const TOKEN_SHAPES: (RegExp | ((s: string) => string))[] = [
  /\bxai-[A-Za-z0-9_-]{20,}/gi,                                   // xAI, incl. pasted bare
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/gi,                           // OpenAI / Anthropic style
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,                                // GitHub classic PAT
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,                              // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{20,}/gi,                             // Slack
  /\bAKIA[0-9A-Z]{16}\b/g,                                        // AWS access key id
  redactJwts,                                                     // JWT
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
 *
 * A43: anchored on `://` itself. The scheme used to be matched from every word boundary, and a
 * scheme may contain `.`, `-` and `+` — so `a.a.a…` was re-read from each dot, quadratically, on the
 * full prompt of every delegation (64,000 chars: 1.08 s). The scheme was never replaced, so it does
 * not need matching; any `://user:pass@` now masks, which is only wider.
 */
const URL_CREDENTIALS = /:\/\/([^\s:/@]*):([^\s@/]+)@/g;

// `Bearer authentication-middleware` is a sentence, not a credential — hence the value test.
// A6: `Basic` too. Base64 of `user:password` is a credential in exactly the same way, and the
// length + opacity test keeps `uses Basic auth in staging` prose.
const AUTH_SCHEME = /\b((?:Bearer|Basic)\s+)([A-Za-z0-9._~+/-]{20,}={0,2})/gi;

// A pasted key block is multi-line; the preview collapses whitespace before this runs, so match
// the collapsed form too. A43: the lazy scan stops at the next BEGIN — from every BEGIN with no END
// it used to run to the end of the prompt. A block that holds another BEGIN is left to the opening
// rule below, which masks from the first marker on: wider, never narrower.
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?!-----BEGIN )[\s\S])*?-----END [A-Z ]*PRIVATE KEY-----/g;

// A6: the block above requires a CLOSING marker, and a 200-char preview truncates mid-key as a
// matter of course — so the truncated paste, the common one, was the case that leaked. After an
// opening marker there is nothing left in a preview worth keeping, so everything after it goes.
const PRIVATE_KEY_OPENING = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g;

export function redactSecrets(s: string): string {
  let out = redactAssignments(s
    .replace(URL_CREDENTIALS, (_m, user: string) => `://${user}:<redacted>@`)
    .replace(PRIVATE_KEY_BLOCK, '<redacted>')
    .replace(PRIVATE_KEY_OPENING, '<redacted>')
    .replace(AUTH_SCHEME, (m, prefix: string, value: string) =>
      looksLikeSecretValue(value) ? `${prefix}<redacted>` : m)
    .replace(SHIPPED_ASSIGNMENT, (m, q1: string, name: string, sep: string, q2: string, value: string) =>
      shippedRedacts(name, value) ? `${q1}${name}${q1}${sep}${q2}<redacted>${q2}` : m));
  for (const shape of TOKEN_SHAPES) {
    out = typeof shape === 'function'
      ? shape(out)
      : out.replace(shape, (m: string) => (looksLikeSecretValue(m) ? '<redacted>' : m));
  }
  return out;
}

function preview(s: string | undefined): string {
  if (!s) return '';
  const collapsed = redactSecrets(s.replace(/\s+/g, ' ').trim());
  return collapsed.length > MAX_PREVIEW ? collapsed.slice(0, MAX_PREVIEW) + '…' : collapsed;
}

export function buildHistoryEntry(
  input: DelegateInput,
  result: DelegateResult,
  meta: HistoryMeta,
): HistoryEntry {
  const files = result.filesChanged ?? [];
  const entry: HistoryEntry = {
    ts: meta.ts,
    mode: result.mode,
    billing: result.billing,
    status: result.status,
    cwd: input.cwd,
    promptPreview: preview(input.prompt),
    filesChanged: files.slice(0, MAX_FILES),
    filesTruncated: files.length > MAX_FILES,
    filesCount: files.length,
    durationMs: meta.durationMs,
  };
  if (result.summary) entry.summaryPreview = preview(result.summary);
  if (result.worktreePath) entry.worktreePath = result.worktreePath;
  if (input.sandbox) entry.sandbox = input.sandbox;
  if (input.plan) entry.plan = true;
  if (input.check) entry.check = true;
  if (result.sessionId) entry.sessionId = result.sessionId;
  if (meta.via) entry.via = meta.via;
  // B3: which model ran, and how much it spent. Before this, delegations were model-anonymous —
  // the CLI default moved grok-4.6 -> grok-4.7 on 2026-09-21 under every existing row and no
  // surface in this repo could say which one any of them used. `totalTokens` is grok's own
  // figure; the components are deliberately not re-summed here (input and cacheRead are disjoint
  // halves of one total, reasoning is a subset of output — see GrokTokenUsage).
  if (result.model) entry.model = result.model;
  if (result.tokens?.total !== undefined) entry.totalTokens = result.tokens.total;
  if (result.committed === true) entry.committed = true;
  return entry;
}

export function defaultHistoryPath(): string {
  return join(homedir(), '.grok-build', 'history.jsonl');
}

export interface AppendDeps {
  path?: string;
  write?: (path: string, line: string) => void;
}

/**
 * The history file holds 200-char prompt previews and absolute cwd paths — the user's project
 * text. The Node defaults land it at 0644 inside a 0755 directory, readable by every local
 * account on a shared POSIX host, while the apply patch in worktree.ts is already written 0600.
 * Match that. (`mode` applies at creation; a file that already exists keeps its current mode.)
 */
export const HISTORY_DIR_MODE = 0o700;
export const HISTORY_FILE_MODE = 0o600;

const defaultWrite = (path: string, line: string): void => {
  mkdirSync(dirname(path), { recursive: true, mode: HISTORY_DIR_MODE });
  appendFileSync(path, line, { encoding: 'utf8', mode: HISTORY_FILE_MODE });
};

export function appendHistory(entry: HistoryEntry, deps: AppendDeps = {}): void {
  const path = deps.path ?? defaultHistoryPath();
  const write = deps.write ?? defaultWrite;
  write(path, JSON.stringify(entry) + '\n');
}

// Never-throw boundary: neither a formatting error nor a write error can break a
// delegation. Logging is best-effort provenance, not a critical path.
export function recordDelegation(
  input: DelegateInput,
  result: DelegateResult,
  meta: HistoryMeta,
  deps: AppendDeps = {},
): void {
  try {
    appendHistory(buildHistoryEntry(input, result, meta), deps);
  } catch {
    /* logging must never break a delegation */
  }
}
