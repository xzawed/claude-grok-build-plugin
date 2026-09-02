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
  plan?: boolean;
  check?: boolean;
  /** From grok JSON when present — enables later `resume` without scanning Claude context. */
  sessionId?: string;
}

export interface HistoryMeta {
  ts: string;         // ISO timestamp, injected by the caller (index.ts)
  durationMs: number; // wall-clock around runDelegate
}

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

// Named assignments. The quote groups cover the shapes users actually paste — a JSON/.mcp.json
// env block, a quoted .env line, YAML — not just a bare `K=v`. The separator and quoting are
// preserved on replacement so a redacted JSON blob still reads as JSON.
const NAMED_KEYS =
  'XAI_API_KEY|GROK_CODE_XAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|SLACK_TOKEN';
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
];

// `Bearer authentication-middleware` is a sentence, not a credential — hence the value test.
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{20,}={0,2})/gi;

// A pasted key block is multi-line; the preview collapses whitespace before this runs, so match
// the collapsed form too.
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactSecrets(s: string): string {
  let out = s
    .replace(PRIVATE_KEY_BLOCK, '<redacted>')
    .replace(BEARER, (m, prefix: string, value: string) =>
      looksLikeSecretValue(value) ? `${prefix}<redacted>` : m)
    .replace(ASSIGNMENT, (m, q1: string, name: string, sep: string, q2: string, value: string) =>
      shouldRedactAssignment(name, value) ? `${q1}${name}${q1}${sep}${q2}<redacted>${q2}` : m);
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
