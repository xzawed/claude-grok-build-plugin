# Delegation history logging — design (Phase 2)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **Scope:** Phase 2 item "위임 이력 로컬 로깅" + roadmap done-definition "4대 실패모드 명확한 메시지" verification. The PreToolUse auth hook is explicitly **out of scope this iteration** (redundant with the MCP server's in-tool `checkAuth` pre-check).

## Goal & rationale

Record every Grok Build delegation to a local append-only log so it is later
possible to answer **"was this change made by Claude or by Grok Build?"**
(provenance). This upholds the project's "AI executes, human owns quality gates"
principle (`docs/05-routing-policy.md`) and the lesson from a past
secret-hardcoding incident: delegated work must be auditable.

## Key decisions (settled during brainstorming)

1. **Mechanism: MCP-server-internal**, not a PostToolUse hook. The server already
   holds the structured `DelegateResult`; a hook would have to parse the MCP
   response envelope (`content[0].text` JSON string), depends on hook stdin schema
   stability, needs `jq`/node, and silently misses entries when hooks are disabled.
   → This supersedes the earlier `docs/05` note "위임 이력은 hook을 통해 로컬 로그에
   남긴다"; that doc is updated to say the server records it internally.
2. **Location: user-global `~/.grok-build/history.jsonl`** (JSONL, one delegation
   per line). Writing inside the delegated `cwd` would pollute `git status`
   (violating the existing "never write into cwd — it pollutes filesChanged"
   invariant, `docs/specs/grok-cli-contract.md` §3) and could be committed by
   accident. Per-project attribution is captured by logging `cwd` as a field.
3. **Logging must never break a delegation.** All log I/O is wrapped so a failure
   to write is swallowed (the delegation result is returned regardless).
4. **No credentials, ever.** Entries never include API keys, env, or
   `rawStderrTail` (which can carry sensitive process output). Upholds absolute
   principle #4.

## Architecture

New module `mcp-server/src/history.ts`, kept separate so the just-hardened
`delegate.ts` is not touched:

- `buildHistoryEntry(input, result, meta): HistoryEntry` — **pure**. Selects and
  truncates fields; excludes credentials. Unit-tested.
- `appendHistory(entry, deps?): void` — appends one JSON line + `\n` to the log
  file, creating `~/.grok-build/` if missing. Path/writer injectable for tests.
- `recordDelegation(input, result, meta, deps?): void` — composes the two. This is
  the **never-throw boundary**: the whole body (build + append) is wrapped in
  try/catch so neither a formatting error nor a write error can break a delegation.

**Wiring:** `index.ts`'s `grok_build_delegate` handler measures wall-clock around
`runDelegate`, then calls `recordDelegation(...)` once with the input + result
before returning. `delegate.ts` is unchanged. Only actual `runDelegate` outcomes
are logged (a pre-check auth failure that never runs grok is surfaced by the tool
message / `check-auth` and is not a delegation to attribute).

```
grok_build_delegate handler (index.ts)
  ├─ checkAuth pre-check … (unchanged; not logged)
  ├─ const t0 = Date.now()
  ├─ const result = await runDelegate(mode, input)
  ├─ recordDelegation(input, result, { durationMs: Date.now() - t0 })   // never throws
  └─ return { content:[text: JSON(result)], isError }
```

## Data model — `HistoryEntry` (one JSONL line)

```jsonc
{
  "ts": "2026-07-13T01:23:45.678Z",   // ISO 8601 UTC
  "mode": "subscription",              // "subscription" | "api"  (actual run mode)
  "billing": "subscription",           // "subscription" | "metered_api"
  "status": "completed",               // "completed" | "timeout" | "auth_error" | "grok_error"
  "cwd": "/abs/project",               // delegated dir → per-project provenance
  "promptPreview": "add a hello test", // input.prompt, single-line, ≤200 chars, ellipsis if cut
  "summaryPreview": "Created hi.ts …", // result.summary, ≤200 chars — omitted if absent
  "filesChanged": ["src/a.ts"],        // result.filesChanged (may be []); capped at 100
  "filesTruncated": false,             // true if filesChanged had >100 entries
  "filesCount": 1,                     // full count (even when the list is capped)
  "durationMs": 4213                   // wall-clock around runDelegate
}
```

**Truncation/privacy rules (in `buildHistoryEntry`, all unit-tested):**
- `promptPreview` / `summaryPreview`: collapse whitespace to single spaces, slice to
  200 chars, append `…` when truncated.
- `filesChanged`: cap at 100 entries; `filesCount` keeps the true length;
  `filesTruncated` flags the cap.
- Never emit any key/env/stderr-tail field.

## Failure-mode verification (roadmap done-definition)

Add tests that pin the **message text** (not just status/reason) for each failure
mode below (the roadmap's four modes — auth-failure splits into subscription/api
sub-cases), and record their verification status:

| Failure mode | Path | Message source | Status |
|---|---|---|---|
| CLI 미설치/PATH | `checkAuth` → `grok_not_installed` | auth.ts | 실측 가능 |
| 인증 미완 (구독) | `checkAuth` → `not_logged_in` | auth.ts | 실측 가능 |
| 인증 없음 (API) | `checkAuth` → `no_api_key` | auth.ts | 실측 가능 |
| 인증 만료 (위임 중) | `runDelegate` → `auth_error` via signal | delegate.ts | best-effort (실제 만료 문구 미확보) |
| 타임아웃 | `runDelegate` → `timeout` | delegate.ts | 실측 가능 |

The expiry row stays best-effort until real grok auth wording is captured
(`grok-cli-contract.md` §7); the test asserts the current message and this
limitation is documented, not hidden.

## Testing plan (TDD)

`mcp-server/test/history.test.ts`:
- `buildHistoryEntry`: field selection; prompt/summary truncation + ellipsis;
  whitespace collapse; `summaryPreview` omitted when no summary; `filesChanged`
  cap + `filesTruncated`/`filesCount`; **no credential fields ever present**;
  status/mode/billing/cwd carried through.
- `appendHistory`: writes one valid JSON line + newline to an injected temp path;
  creates the directory if missing; multiple calls append (2 lines); a write
  error is swallowed (does not throw).

Plus message-text tests for the four failure modes (extend `auth.test.ts` /
`delegate.test.ts`). Expected ≈ +8–10 unit tests.

## Docs to update

- `docs/05-routing-policy.md` — logging is server-internal, not hook-based.
- `docs/04-mcp-server-spec.md` — add the history-logging section + `HistoryEntry`.
- `docs/06-roadmap.md` — check off "위임 이력 로컬 로깅"; note hook still deferred.
- `CLAUDE.md` — component map (`history.ts`), test count, gotcha (log location).
- Rebuild the committed `dist/index.js` bundle (server code changed).

## Out of scope (YAGNI / later)

Log rotation/size cap; a usage dashboard (Phase 3); the PreToolUse auth hook;
PATH-prepend and `--worktree` isolation (already deferred); querying/reporting
over the log.
