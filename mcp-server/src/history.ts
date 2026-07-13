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
}

export interface HistoryMeta {
  ts: string;         // ISO timestamp, injected by the caller (index.ts)
  durationMs: number; // wall-clock around runDelegate
}

const MAX_PREVIEW = 200;
const MAX_FILES = 100;

function preview(s: string | undefined): string {
  if (!s) return '';
  const collapsed = s.replace(/\s+/g, ' ').trim();
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
  return entry;
}

export function defaultHistoryPath(): string {
  return join(homedir(), '.grok-build', 'history.jsonl');
}

export interface AppendDeps {
  path?: string;
  write?: (path: string, line: string) => void;
}

const defaultWrite = (path: string, line: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, line, 'utf8');
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
