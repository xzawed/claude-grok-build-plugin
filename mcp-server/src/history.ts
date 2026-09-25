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

/**
 * A37: which OTHER names carry a credential. This used to be a word list matched at `\b` — and `_` is
 * a word character, so the most common .env shape, a PREFIXED name (`DB_PASSWORD`, `JWT_SECRET`,
 * `TWILIO_AUTH_TOKEN`, `SENDGRID_API_KEY`), never matched: measured 9 of 9 written verbatim to
 * history.jsonl. A name is now read by its LAST segment, split on `_ . -` and camelCase, so the prefix
 * does not matter — `spring.datasource.password`, `--db-password`, `dbPassword` and `.npmrc`'s
 * `_authToken` end in a credential word too. `key` alone is not one (`sort_key`, `primary_key`); a
 * qualified key is.
 */
const CREDENTIAL_WORDS = new Set([
  'password', 'passwd', 'pwd', 'pass', 'passphrase', 'secret', 'token', 'apikey',
]);
// `account`: Azure's `AccountKey=` in a storage connection string. Found by Grok's adversarial pass
// on this rule, with `passphrase` above; both were measured leaking before the change.
const KEY_QUALIFIERS = new Set(['api', 'access', 'secret', 'private', 'encryption', 'signing', 'account']);

function nameSegments(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_.-]+/).filter(Boolean)
    .map((p) => p.toLowerCase());
}

/**
 * `strong`: the name alone is evidence — a NAMED_KEY, or an env-style UPPER_SNAKE name ending in a
 * credential word. Nobody writes `DB_PASSWORD=` casually, so the value only has to be plausible.
 * `generic`: a bare or code-style name (`password:`, `apiKey =`). Those appear in prose and schemas
 * constantly, so the value has to look opaque as well.
 */
type NameTier = 'strong' | 'generic';
function credentialTier(name: string): NameTier | undefined {
  if (IS_NAMED_KEY.test(name)) return 'strong';
  const seg = nameSegments(name);
  const last = seg[seg.length - 1];
  const credential = last !== undefined && (CREDENTIAL_WORDS.has(last)
    || (last === 'key' && seg.length > 1 && KEY_QUALIFIERS.has(seg[seg.length - 2])));
  if (!credential) return undefined;
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name) ? 'strong' : 'generic';
}

// Words that follow a credential name in a SPEC rather than a secret: type annotations, schema
// notes, placeholders. `OPENAI_API_KEY: string belongs in the env schema` is documentation.
const NON_SECRET_WORDS = new Set([
  'string', 'number', 'boolean', 'int', 'bool', 'object', 'array', 'null', 'undefined',
  'true', 'false', 'none', 'empty', 'unset', 'required', 'optional', 'missing', 'present',
  'todo', 'tbd', 'placeholder', 'example', 'value', 'here', 'any', 'generated', 'unchanged',
]);

// Values that STAND FOR a secret: a template slot, a variable reference, a mask, a sample. A sample
// .env or a shell/CI reference is documentation whatever the name says.
function isPlaceholder(v: string): boolean {
  return /^<[^<>]*>$/.test(v)                                 // <your_stripe_secret_key>
    || /^\$\{[^}]*\}?$/.test(v)                                // ${DB_PASSWORD} (the value stops before `}`)
    || /^\$[A-Za-z_]\w*$/.test(v)                              // $DB_PASSWORD
    || /^%[A-Za-z_]\w*%$/.test(v)                              // %API_KEY%
    || /^(?:x{3,}|\*{3,}|\.{3,}|changeme|your[-_][\w-]*)$/i.test(v);
}

function shouldRedactValue(tier: NameTier, value: string): boolean {
  if (isPlaceholder(value)) return false;
  if (tier === 'generic') return looksLikeSecretValue(value);
  if (!/[A-Za-z0-9]/.test(value)) return false;               // `${{`, punctuation fragments
  if (/^\d{1,5}$/.test(value)) return false;                   // MAX_TOKEN=4096, FIRST_PASS=1: settings
  return !NON_SECRET_WORDS.has(value.toLowerCase());
}

// Every `name =` / `name:` is a candidate and the NAME decides. The candidate ends at the separator —
// the value is read only for a credential name — so a non-credential name never consumes the text
// after it: in `$env:DB_PASSWORD=…` the `env:` head is passed over and the scan resumes on
// `DB_PASSWORD`. The quote groups cover what people paste — a JSON env block, a quoted .env line,
// YAML — and are carried into the replacement so a redacted JSON blob still reads as JSON.
// A43: the lookbehind starts a name only where a run of name characters starts, so each run is read
// once; a start at every `\b` re-read `a.b.c…` from each dot.
const ASSIGNMENT_HEAD = /(?<![A-Za-z0-9_.-])(["']?)(-{0,2}[A-Za-z_][A-Za-z0-9_.-]*)\1(\s*[=:]\s*)/g;
const ASSIGNMENT_VALUE = /(["']?)([^\s"',}]+)\1/y;

function redactAssignments(s: string): string {
  let out = '';
  let last = 0;
  ASSIGNMENT_HEAD.lastIndex = 0;
  for (let m = ASSIGNMENT_HEAD.exec(s); m !== null; m = ASSIGNMENT_HEAD.exec(s)) {
    const [head, q1, name, sep] = m;
    const tier = credentialTier(name);
    if (!tier) continue;
    ASSIGNMENT_VALUE.lastIndex = m.index + head.length;
    const v = ASSIGNMENT_VALUE.exec(s);
    if (!v || !shouldRedactValue(tier, v[2])) continue;
    out += `${s.slice(last, m.index)}${q1}${name}${q1}${sep}${v[1]}<redacted>${v[1]}`;
    last = ASSIGNMENT_VALUE.lastIndex;
    ASSIGNMENT_HEAD.lastIndex = last;
  }
  return out + s.slice(last);
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
  // JWT. A43: the lookbehind, not `\b`, starts it — after every `-` of `eyJ-eyJ-…` the old start
  // re-read the whole run looking for the dot (64,000 chars: 1.87 s, on every delegation's prompt).
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
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
      looksLikeSecretValue(value) ? `${prefix}<redacted>` : m));
  for (const re of TOKEN_SHAPES) {
    out = out.replace(re, (m: string) => (looksLikeSecretValue(m) ? '<redacted>' : m));
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
