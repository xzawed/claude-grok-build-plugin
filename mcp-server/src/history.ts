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

// Known billing-key assignments. The optional quote group covers the shapes users actually
// paste — a JSON/.mcp.json env block, a quoted .env line, YAML — not just a bare `K=v`.
const KEY_ASSIGNMENT =
  /(["']?)\b(XAI_API_KEY|GROK_CODE_XAI_API_KEY)\b\1\s*[=:]\s*["']?[^\s"',}]+["']?/gi;

// Second net: a key pasted with no variable name attached. Bounded at 20+ value chars so
// ordinary prose (`xai-cli`) is left alone.
const BARE_KEY_TOKEN = /\bxai-[A-Za-z0-9_-]{20,}/gi;

export function redactSecrets(s: string): string {
  return s.replace(KEY_ASSIGNMENT, '$2=<redacted>').replace(BARE_KEY_TOKEN, '<redacted>');
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
