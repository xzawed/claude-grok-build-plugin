# Worktree isolation (wrapper-managed) + sandbox pass-through — design (Phase 3)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation plan
- **Scope:** Phase 3 item "`--worktree`/`--sandbox` opt-in 격리 필드". Resolves the two
  deferred hardening findings: **L8** (precise `filesChanged` attribution) and **L11**
  (isolate risky delegations / limit `--always-approve` blast radius).

## Measured constraint (why the design pivoted)

Empirically (grok 0.2.93, this machine): **grok's own `-w, --worktree` flag is a
no-op in headless `-p` mode** — it creates no worktree/branch (`grok worktree list`
→ "No worktrees found", no `.git/worktrees/`) and the edit lands directly in `--cwd`.
So we **cannot rely on grok's `--worktree`** for isolation. However, grok **does honor
`--cwd`** (the edit appears in whatever `--cwd` points at). Therefore the wrapper
creates the worktree itself and points grok's `--cwd` at it — robust, headless, and
platform-independent.

`--sandbox <PROFILE>` takes a profile string (env `GROK_SANDBOX`); valid profiles are
undocumented and an invalid one did not error on a no-tool task, so sandbox is treated
as an **unverified pass-through** the user opts into with a profile they know.

## Key decisions (settled during brainstorming)

1. **Wrapper-managed worktree**, not grok's `--worktree`.
2. **Sandbox is an opt-in pass-through** (`--sandbox <profile>`), documented as
   grok-native and profile-unverified.
3. Both fields are **opt-in, default off** — default-on `--worktree` would break the
   documented "review the diff in `cwd`" workflow.
4. On a worktree-creation failure the delegation **fails with a clear error** — it does
   NOT silently fall back to editing `cwd` (the user asked for isolation).

## New tool input fields (`grok_build_delegate`)

```typescript
{
  prompt: string;
  cwd: string;
  timeout_ms?: number;
  worktree?: boolean;   // opt-in: run grok in a fresh wrapper-created git worktree
  sandbox?: string;     // opt-in: pass --sandbox <profile> to grok (grok-native, unverified)
}
```

## Architecture

New module `mcp-server/src/worktree.ts` (keeps `delegate.ts` lean):

- `type GitRunner = (args: string[]) => Promise<void>` (throws on non-zero git exit).
- `createGrokWorktree(cwd: string, deps?: WorktreeDeps): Promise<string>` — creates a
  fresh worktree and returns its absolute path.
  - `WorktreeDeps { runGit?: GitRunner; baseDir?: string; name?: string }` (injectable
    for tests; `name`/`baseDir`/`runGit` default to real values).
  - Path: `~/.grok-build/worktrees/<name>`, `name` = `grok-<base36 time>-<rand>`.
  - Command: `git -C <cwd> worktree add <path> -b grok/<name> HEAD`
    (new branch `grok/<name>` at current HEAD, checked out in the new worktree).
  - `mkdirSync(baseDir, { recursive: true })` first. Any git failure propagates (throws).

`runDelegate` (in `delegate.ts`) gains one injectable dep and an isolation branch:

```typescript
// DelegateDeps additions: createWorktree?: (cwd: string) => Promise<string>
//   (default: (cwd) => createGrokWorktree(cwd))

let effectiveCwd = input.cwd;
let worktreePath: string | undefined;
if (input.worktree) {
  try {
    worktreePath = await createWorktree(input.cwd);
    effectiveCwd = worktreePath;
  } catch {
    return { status: 'grok_error', mode, billing,
      message: 'worktree 생성에 실패했습니다 — cwd가 커밋이 있는 git 저장소인지 확인하세요.' };
  }
}
const args = ['--no-auto-update', '--always-approve', '--cwd', effectiveCwd,
  '-p', input.prompt, '--output-format', 'json',
  ...(input.sandbox ? ['--sandbox', input.sandbox] : [])];
// ... spawn grok ...
const filesChanged = await gitChangedFiles(effectiveCwd); // worktree ⇒ all changes are grok's (L8 solved)
// ... every terminal branch carries worktreePath when set ...
```

- `effectiveCwd` (worktree when isolated) is used for **both** the grok `--cwd` and the
  `filesChanged` derivation, so attribution is precise in worktree mode.
- The existing cwd validation (absolute + `dirExists`) still runs on `input.cwd` first.
- `worktreePath` is attached to the result on all terminal branches when isolation is on.

## Semantics & lifecycle

- **Base = HEAD.** The worktree starts from the current commit, so grok does **not** see
  uncommitted changes in `cwd` (isolation implies a clean base). Documented.
- **Persists for review.** The wrapper never auto-removes the worktree (that would
  delete grok's output). The response reports `worktreePath`; a human/Claude reviews the
  diff there and merges branch `grok/<name>` if desired.
- **Cleanup** is manual: `git worktree remove <path>` (and `git branch -D grok/<name>`),
  or `grok worktree gc`. ⚠️ Accumulation of worktrees is a **known limitation** (a
  cleanup tool is out of scope this iteration).

## Types & history

- `DelegateResult` gains `worktreePath?: string`.
- `HistoryEntry` gains `worktreePath?: string` and `sandbox?: string` (provenance).
  `buildHistoryEntry` copies them from result/input when present.

## Testing plan (TDD)

`mcp-server/test/worktree.test.ts`:
- `createGrokWorktree` with an injected `runGit` (records args) + fixed `name`/`baseDir`:
  asserts the `git -C <cwd> worktree add <baseDir>/<name> -b grok/<name> HEAD` argv and
  the returned path; asserts a `runGit` rejection propagates (throws).

`mcp-server/test/delegate.test.ts` (extend):
- worktree mode: injected `createWorktree` returns `/wt`; capturing spawn asserts
  `--cwd /wt`; `gitChangedFiles` keyed on `/wt` returns `['a.ts']` ⇒ `filesChanged`
  `['a.ts']`; result `worktreePath === '/wt'`.
- worktree creation failure: injected `createWorktree` throws ⇒ `grok_error`, grok not
  spawned.
- sandbox pass-through: `sandbox: 'readonly'` ⇒ capturedArgs contains `--sandbox`,
  `'readonly'`; absent by default.
- non-worktree path unchanged (existing tests stay green; `worktreePath` undefined).

`mcp-server/test/history.test.ts` (extend): `worktreePath`/`sandbox` carried when present.

Docs (04/05/06 + CLAUDE.md) + rebuild the committed `dist/index.js` bundle.

## Out of scope (YAGNI)

grok's `--worktree` flag (headless no-op); named/custom worktree strings; a worktree
cleanup/GC tool; sandbox profile validation or a curated profile list; auto-merge of the
worktree branch back into `cwd`.
