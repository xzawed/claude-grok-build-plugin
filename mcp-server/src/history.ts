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
// assignment operator plus a value that is not prose — long and opaque after a name prose also
// uses, merely plausible after a name that is evidence itself (an env-style or named key; see
// credentialOf). Over-masking costs a useless history, so `Fix the token parser` and `the api_key
// field is missing` must survive untouched — pinned by a test.

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
 * The assignment rule v0.2.35 shipped, kept VERBATIM, as the floor. The A37 rule below reads far more
 * names, but each refinement that left ordinary text alone was also a way to leave a secret: the first two
 * review rounds each found lines this rule masked and the rewrite wrote verbatim — a connection string after
 * a named key, `PassWord`, `password: ${X:-default}`, `ENC(…)`, a credential name inside another value.
 * Both rules read the same text and every mask either makes is kept (redactSecrets), so the rewrite only
 * masks MORE. The floor is the whole v0.2.35 pipeline, not this rule alone — redact-floor.test.ts holds it
 * against the frozen v0.2.35 redactor, which catches a change to a helper both share.
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
// after them is a setting: up to 7 digits after a COUNTING token (context sizes run to millions), up to 3
// after `pass` (pass counts). A longer one is a PIN or a key — `WIFI_PASS=4829103765`, proposed by Grok
// against the first version of this rule, which let any number through. The token has to say it counts:
// any word ending in `token` let `TWILIO_AUTHTOKEN=4821937`, `OTP_TOKEN=482193` and `PIN_TOKEN=1234`
// through (round 3). After `password` or `secret` any number is a password (`POSTGRES_PASSWORD=12345`).
const COUNTING_QUALIFIERS = new Set([
  'max', 'min', 'num', 'total', 'input', 'output', 'prompt', 'completion', 'context', 'sub',
]);
function settingDigits(word: string, qualifier: string): number {
  if (word === 'subtoken' || (word === 'token' && COUNTING_QUALIFIERS.has(qualifier))) return 7;
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
 * A dotted name is code as often as config (`self.DB_PASSWORD = password`), and the round-2 fix held
 * its unquoted value to the generic test — which let helm's `--set env.DB_PASSWORD=Winter2024!` and
 * "set env.DB_PASSWORD = opensesame" through (round 3). A leak costs more than a masked line of code, so
 * the leaf's tier stands: `process.env.API_KEY = apiKey` is masked, on purpose.
 */
type NameTier = 'named' | 'env' | 'generic';
interface Credential { tier: NameTier; settingDigits: number }
function credentialOf(name: string): Credential | undefined {
  if (name.length > MAX_NAME_LENGTH) return undefined;
  const bare = name.replace(/^-+/, '');
  const leaf = bare.slice(bare.lastIndexOf('.') + 1);
  if (IS_NAMED_KEY.test(leaf)) return { tier: 'named', settingDigits: 0 };
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
  if (!ENV_NAME.test(leaf) && !isShoutedWithPrefix(leaf, word)) return { tier: 'generic', settingDigits: 0 };
  return { tier: 'env', settingDigits: settingDigits(word, seg.at(-2) ?? '') };
}

// `PGPASSWORD`, `GITHUBTOKEN`: a shouted name with its prefix written into the word is an env name too.
// ENV_NAME wants an `_`, so libpq's own variable was held to the generic test, and in every version
// `PGPASSWORD=OpenSesamePlease` was written verbatim (Grok's round-3 pass). A bare `PASSWORD` or `TOKEN` has
// no prefix and stays generic — prose writes those.
const SHOUTED = /^[A-Z][A-Z0-9]*$/;
function isShoutedWithPrefix(leaf: string, word: string): boolean {
  return SHOUTED.test(leaf) && RUN_TOGETHER_WORDS.some((w) => word.length > w.length && word.endsWith(w));
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
 * `${X:?unset}` names X and holds only an error text. A `<redacted>` an earlier rule wrote reads as one too.
 */
const REFERENCES = [
  /^<([^<>]*)>$/,                       // <your_stripe_secret_key>
  /^\$\{([a-z_][\w.]*)(?::?\?(.*))?$/i, // ${DB_PASSWORD, ${var.db_password, ${X:?unset
  /^\$([a-z_]\w*)$/i,                   // $DB_PASSWORD
  /^%([a-z_]\w*)%$/i,                   // %API_KEY%
  /^your[-_]([\w-]*)$/i,                // your-api-key
];
function looksLikeName(n: string): boolean {
  if (n.length > MAX_NAME_LENGTH) return false;
  return ENV_NAME.test(n) || (n.length < 32 && /^[A-Za-z_.-]*$/.test(n));
}
function isPlaceholder(v: string, lookInside = true): boolean {
  for (const re of REFERENCES) {
    const m = re.exec(v);
    // `${X:?text}`: the text is an error message — unless it assigns a secret (round 4).
    if (m?.[1] !== undefined) return looksLikeName(m[1]) && !(lookInside && holdsMaskedAssignment(m[2] ?? ''));
  }
  return /^(?:x{3,}|\*{3,}|\.{3,}|changeme)$/i.test(v);
}

/**
 * Round 4: a call or a reference is kept WHOLE — from REREAD_BELOW characters, not read again (that is what
 * keeps the scan linear) — so an assignment inside one was never seen: four shapes the round-2 fix had masked,
 * and `DB_PASSWORD= getConfig(dbPassword:…)`, which v0.2.35 and the round-1 to round-3 fixes wrote verbatim.
 * A call or reference that holds one is judged as a value instead. Round 5: only an assignment whose value
 * is something to mask — `${API_KEY:?API_KEY:required}` and `createSession(password:$password)` name a
 * credential but hold nothing secret, and 10 of the review's 50 secret-free lines were masked. Inside
 * brackets the name is evidence, as an env-style name is (prose does not write `password:hunter2` there), so
 * the value only has to be plausible: judged by a bare name's opacity test, a first draft of this let
 * `getConfig(dbPassword:hunter2)` through. The inner value is read at most INNER_VALUE_MAX characters and
 * judged without looking inside it again, so each name costs the same; one that runs on past that is judged
 * masked. Own regexes: ASSIGNMENT_HEAD's lastIndex belongs to the scan this runs inside.
 */
const HEAD_INSIDE = /(["']?)(?<![\w.-])(-{0,2}[A-Za-z_][\w.-]*)\1(\s*[=:]\s*)/g;
const INNER_VALUE_MAX = 64;
const INNER_VALUE = /[^\s"',}]{1,64}/y;
function holdsMaskedAssignment(text: string): boolean {
  HEAD_INSIDE.lastIndex = 0;
  for (let m = HEAD_INSIDE.exec(text); m !== null; m = HEAD_INSIDE.exec(text)) {
    const credential = credentialOf(m[2]);
    if (credential === undefined) continue;
    INNER_VALUE.lastIndex = m.index + m[0].length;
    const raw = INNER_VALUE.exec(text)?.[0];
    if (raw === undefined) continue;
    if (raw.length === INNER_VALUE_MAX) return true;
    const span = readUnquoted(raw, m[3]);
    if (span === undefined || span.value === '') continue;
    const asEvidence: Credential = credential.tier === 'generic' ? { ...credential, tier: 'env' } : credential;
    if (judgeValue(asEvidence, span.value, raw, { quoted: false, cutAtQuote: false }, false) === 'mask') return true;
  }
  return false;
}

// A shell default carries a real value: `${PGPASS:-hunter2…}` is judged by what follows the operator
// (`:-` `-` `:=` `=` `:+` `+`). Read as a placeholder, it was a secret the old redactor had masked.
const SHELL_DEFAULT = /^\$\{[A-Za-z_]\w*:?[-=+]/;
// An unquoted value that CALLS something is code: `z.string().min(32)`, `generateToken(user1);`,
// `crypto.randomBytes(32)` — the whole value is the call, brackets balanced, a `;` at most after it — or
// a call cut at its quoted argument, `os.getenv(` from `os.getenv("X")`. Only a call that starts
// lowercase and holds no `=`: `Summer(2024)`, `ENC(…)` and `Pa55w0rd[12]` are values (re-review — each was
// written verbatim by the first code rule, which took any call). `Optional[str]` looks like them, so it is
// masked. Round 3 found two more ways a password passed for code: a value that only STARTS like a call
// (`k7(Xq2m…` — 1.5% of random 16-character passwords leaked through the rule that read only the start),
// and a whole call to a plain word — `hunter(1950);`, `staple[6452].`, `summer(2024)`. Code calls a path, a
// camelCase or snake_case name; a plain lowercase word called whole reads as a value (`getpass()` is masked
// with it).
const CODE_CALL_START = /^[a-z_$][\w$.]*[([]/;
const PLAIN_WORD_CALL = /^[a-z0-9]+[([]/;
function isCodeCall(raw: string, cutAtQuote: boolean): boolean {
  if (!CODE_CALL_START.test(raw) || raw.includes('=')) return false;
  const end = raw.endsWith(';') ? raw.length - 1 : raw.length;
  let parens = 0;
  let brackets = 0;
  for (let i = 0; i < end; i++) {
    const ch = raw[i];
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    if (parens < 0 || brackets < 0) return false;
  }
  const close = raw[end - 1];
  if (parens === 0 && brackets === 0) return (close === ')' || close === ']') && !PLAIN_WORD_CALL.test(raw);
  return cutAtQuote && parens + brackets === 1 && (close === '(' || close === '[');
}

/** Where a value sits: in quotes, or unquoted and cut at a quote. */
interface ValueSite { quoted: boolean; cutAtQuote: boolean }

/**
 * `value` is what may be masked (closers trimmed), `raw` the whole run it came from. The opaque test
 * reads `raw`: `Tr0ub4dor&3.` is 12 characters, `Tr0ub4dor&3` 11 (re-review), and `${X:-admin123}` is
 * judged whole, as the floor judges it, so a weak default after a code-style name is not waved through.
 * A `reference` is kept like a `keep`, but the names inside it are references too: `${DB_PASSWORD:?required}`
 * holds an error text, and short or long it is not read again for a name — only when it ends in the next
 * key (`your-db-token =…`, resumeAfterValue). A call or a reference that assigns a secret inside it is a
 * value, not code or a reference (holdsMaskedAssignment — `lookInside` is off for the value inside).
 */
type Verdict = 'mask' | 'keep' | 'reference';
function judgeValue(c: Credential, value: string, raw: string, site: ValueSite, lookInside = true): Verdict {
  const shellDefault = SHELL_DEFAULT.exec(value);
  const judged = shellDefault ? value.slice(shellDefault[0].length) : value;
  if (!judged || isPlaceholder(judged, lookInside)) return 'reference';
  if (!site.quoted && isCodeCall(raw, site.cutAtQuote) && !(lookInside && holdsMaskedAssignment(raw))) return 'keep';
  if (c.tier === 'generic') return looksLikeSecretValue(raw) ? 'mask' : 'keep';
  if (!/[A-Za-z0-9]/.test(judged)) return 'keep';                // `${{`, punctuation fragments
  // MAX_OUTPUT_TOKEN=128000: a setting.
  if (judged.length <= c.settingDigits && /^\d+$/.test(judged)) return 'keep';
  return NON_SECRET_WORDS.has(judged.toLowerCase()) ? 'keep' : 'mask';
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

// ASSIGNMENT_HEAD, anchored: is there a key right here?
const HEAD_AT = /(["']?)(?<![\w.-])(-{0,2}[A-Za-z_][\w.-]*)\1(\s*[=:]\s*)/y;
const NAME_CHAR = /[\w.-]/;
// A kept value shorter than this is read again for a name inside it. From this length the opacity test
// masks a generic name's value, so what stays unmasked is a call or a reference — looked inside when it was
// judged (holdsMaskedAssignment) — or a value its own name's test keeps: a flag, a short count, a shell
// default judged by what follows its operator (`MAX_TOKEN=${…:-4096}` is MAX_TOKEN's count).
const REREAD_BELOW = 32;

function keyAt(s: string, i: number): boolean {
  HEAD_AT.lastIndex = i;
  return HEAD_AT.test(s);
}

/** Where the name that ENDS `raw` starts — before a last `=`/`:` if it has one — or -1. */
function trailingNameStart(raw: string): number {
  let end = raw.length;
  if (raw[end - 1] === '=' || raw[end - 1] === ':') end--;
  let start = end;
  while (start > 0 && NAME_CHAR.test(raw[start - 1])) start--;
  return start < end ? start : -1;
}

/**
 * Where the scan resumes after a value: past it — a value is read once, masked or not, as the one-regex
 * rule consumed it. Resuming inside an unmasked value re-read `pwd=${pwd=${…` from every head: 64,000
 * chars took 268 ms and 512,000 took 17.4 s (pre-merge review). What a long kept call or reference holds
 * was looked at when it was judged (REREAD_BELOW). Three exceptions, each reading one short stretch again, so
 * the scan stays linear — round 3 measured each writing a secret verbatim:
 *  - a value kept (not a reference) under REREAD_BELOW characters may hold another name's assignment
 *    (`PassWd=MASTER_KEY=VshY`, `pwd=ab&X_TOKEN=cd`): at most 31 characters are read again.
 *  - the value ENDS in the next key — it is that key (`password: client-secret: …`, an empty YAML key
 *    before its child; `API_KEY: I_TOKEN =…`) or the key is glued to it (`PassWd=1;DATABASE_URL= …`,
 *    `PassWd=0&dbPassword =…`). The scan resumes on that key, whose value lies past this one. Only a key at
 *    the END: resuming on one at the start whose value runs on through the value — `pwd=X_TOKEN=pwd=…` —
 *    re-read the run from every head, 29 s at 512,000 chars (measured on this rule's first draft).
 */
function resumeAfterValue(s: string, at: number, raw: string, length: number, verdict: Verdict): number {
  if (verdict === 'keep' && raw.length < REREAD_BELOW) return at;
  const key = trailingNameStart(raw);
  if (key < 0) return at + length;
  // A quoted value is a key only whole, quotes and all (`"password": "api_key": …`).
  const quoted = s[at] === '"' || s[at] === "'";
  if (key === 0) return keyAt(s, at) ? at : at + length;
  return !quoted && keyAt(s, at + key) ? at + key : at + length;
}

/** A masked range of the text, `[from, to)`. */
type Span = [number, number];

/** What the A37 rule masks: the value of every credential name it reads. */
function assignmentSpans(s: string): Span[] {
  const spans: Span[] = [];
  ASSIGNMENT_HEAD.lastIndex = 0;
  for (let m = ASSIGNMENT_HEAD.exec(s); m !== null; m = ASSIGNMENT_HEAD.exec(s)) {
    const [head, , name, sep] = m;
    const credential = credentialOf(name);
    if (!credential) continue;
    const at = m.index + head.length;
    ASSIGNMENT_VALUE.lastIndex = at;
    const v = ASSIGNMENT_VALUE.exec(s);
    if (!v) continue;
    const [whole, q2, raw] = v;
    const span = q2 ? { value: raw, length: whole.length } : readUnquoted(raw, sep);
    if (!span) continue;
    const after = s[at + whole.length];
    const site = { quoted: q2 !== '', cutAtQuote: after === '"' || after === "'" };
    const verdict = span.value === '' ? 'keep' : judgeValue(credential, span.value, raw, site);
    if (verdict === 'mask') spans.push([at + q2.length, at + q2.length + span.value.length]);
    ASSIGNMENT_HEAD.lastIndex = resumeAfterValue(s, at, raw, span.length, verdict);
  }
  return spans;
}

/** What the v0.2.35 assignment rule masks, read the way its global replace read. */
function floorSpans(s: string): Span[] {
  const spans: Span[] = [];
  SHIPPED_ASSIGNMENT.lastIndex = 0;
  for (let m = SHIPPED_ASSIGNMENT.exec(s); m !== null; m = SHIPPED_ASSIGNMENT.exec(s)) {
    const [whole, , name, , q2, value] = m;
    if (!shippedRedacts(name, value)) continue;
    const end = m.index + whole.length - q2.length;
    spans.push([end - value.length, end]);
  }
  return spans;
}

/** `s` with every span replaced by `<redacted>`; spans that overlap or touch become one mask. */
function maskSpans(s: string, spans: Span[]): string {
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let maskedTo = -1;
  for (const [from, to] of spans) {
    if (from > maskedTo) {
      out += `${s.slice(Math.max(maskedTo, 0), from)}<redacted>`;
      maskedTo = to;
    } else if (to > maskedTo) {
      maskedTo = to;
    }
  }
  return out + s.slice(Math.max(maskedTo, 0));
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
 * A43: v0.2.35 matched the scheme — `\b[a-z][a-z0-9+.-]*://`, case-insensitive — from every word
 * boundary, and a scheme may contain `.`, `-` and `+`, so `a.a.a…` was re-read from each dot,
 * quadratically, on the full prompt of every delegation (64,000 chars: 1.08 s). This scanner finds each
 * `://` once and reads the scheme BACKWARDS over the run in front of it: the matches that regex made, in
 * one pass. They must stay exactly those — the assignment floor reads the text this leaves, and a first
 * rewrite that matched any `://` changed that text and left a user and host v0.2.35 had hidden (round 3).
 * The wider match is kept as ANY_URL_CREDENTIALS, read alongside the assignment rules.
 */
const URL_TAIL = /([^\s:/@]*):([^\s@/]+)@/y;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const LETTER = /[A-Za-z]/;
const WORD_CHAR = /\w/;

function redactUrlCredentials(s: string): string {
  let out = '';
  let copied = 0;
  // The regex's lastIndex: a match starts at or after the last one's end. The `@` that ends every match
  // stops the walk back below anyway, so this never changes a result — it says what the regex did.
  let resume = 0;
  for (let at = s.indexOf('://'); at >= 0; at = s.indexOf('://', at + 1)) {
    let run = at;
    while (run > resume && SCHEME_CHAR.test(s[run - 1])) run--;
    // `\b` then a letter: the earliest place in the run a scheme can start.
    let scheme = run;
    while (scheme < at && !(LETTER.test(s[scheme]) && (scheme === 0 || !WORD_CHAR.test(s[scheme - 1])))) scheme++;
    if (scheme === at) continue;
    URL_TAIL.lastIndex = at + 3;
    const tail = URL_TAIL.exec(s);
    if (tail === null) continue;
    const passwordEnd = URL_TAIL.lastIndex - 1;
    out += `${s.slice(copied, passwordEnd - tail[2].length)}<redacted>`;
    copied = passwordEnd;
    resume = URL_TAIL.lastIndex;
  }
  return out + s.slice(copied);
}

// A43's wider URL rule — any `://user:pass@`, a malformed scheme (`my_db://`) or none at all. It reads
// the same text as the two assignment rules and only adds masks: run before them, it changed the text the
// floor read; run after them, it no longer saw a URL whose `://` a mask had taken (round 3, both).
const ANY_URL_CREDENTIALS = /:\/\/([^\s:/@]*):([^\s@/]+)@/g;

function anyUrlSpans(s: string): Span[] {
  const spans: Span[] = [];
  ANY_URL_CREDENTIALS.lastIndex = 0;
  for (let m = ANY_URL_CREDENTIALS.exec(s); m !== null; m = ANY_URL_CREDENTIALS.exec(s)) {
    const passwordEnd = m.index + m[0].length - 1;
    spans.push([passwordEnd - m[2].length, passwordEnd]);
  }
  return spans;
}

// `Bearer authentication-middleware` is a sentence, not a credential — hence the value test.
// A6: `Basic` too. Base64 of `user:password` is a credential in exactly the same way, and the
// length + opacity test keeps `uses Basic auth in staging` prose.
const AUTH_SCHEME = /\b((?:Bearer|Basic)\s+)([A-Za-z0-9._~+/-]{20,}={0,2})/gi;

// A pasted key block is multi-line; the preview collapses whitespace before this runs, so match
// the collapsed form too. v0.2.35 matched it lazily — from a BEGIN to the first END after it — and from
// every BEGIN with no END after it the lazy scan ran to the end of the prompt (A43). The first BEGIN
// whose END search fails ends this scan instead: no later BEGIN has an END after it either. The blocks
// masked are v0.2.35's; a first rewrite that stopped at a nested BEGIN changed them, and the text the
// assignment floor read with them (round 3).
const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/g;

function redactKeyBlocks(s: string): string {
  let out = '';
  let copied = 0;
  KEY_BEGIN.lastIndex = 0;
  for (let begin = KEY_BEGIN.exec(s); begin !== null; begin = KEY_BEGIN.exec(s)) {
    KEY_END.lastIndex = KEY_BEGIN.lastIndex;
    if (KEY_END.exec(s) === null) break;
    out += `${s.slice(copied, begin.index)}<redacted>`;
    copied = KEY_END.lastIndex;
    KEY_BEGIN.lastIndex = copied;
  }
  return out + s.slice(copied);
}

// A6: the block above requires a CLOSING marker, and a 200-char preview truncates mid-key as a
// matter of course — so the truncated paste, the common one, was the case that leaked. After an
// opening marker there is nothing left in a preview worth keeping, so everything after it goes.
const PRIVATE_KEY_OPENING = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g;

/**
 * v0.2.35's pipeline, in its order and with its matches, with the new rules' masks added at the assignment
 * step: the v0.2.35 assignment rule, the A37 rule and the wider URL rule read the same text and every mask
 * any of them makes is kept. So whatever v0.2.35 masked stays masked (redact-floor.test.ts holds it against
 * the frozen v0.2.35 redactor). The A37 rule used to read the floor's OUTPUT, where the floor had masked the
 * next YAML key as a named key's value — `DATABASE_URL: POSTGRES_PASSWORD: …` — and that key's own value
 * was never read (round 3).
 */
export function redactSecrets(s: string): string {
  const text = redactKeyBlocks(redactUrlCredentials(s))
    .replace(PRIVATE_KEY_OPENING, '<redacted>')
    .replace(AUTH_SCHEME, (m, prefix: string, value: string) =>
      looksLikeSecretValue(value) ? `${prefix}<redacted>` : m);
  let out = maskSpans(text, [...floorSpans(text), ...assignmentSpans(text), ...anyUrlSpans(text)]);
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
