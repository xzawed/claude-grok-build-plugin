---
description: Apply a mechanical migration pattern with Grok (preset)
---

Preset: use Grok for **mechanical migrations** (same transform across many files).

1. Call `grok_auth_check`. If `ok: false`, show `message` and stop (guide `/grok:setup`).
2. Build an English `prompt` with:
   - Exact before → after pattern (or linked examples)
   - Scope (globs/dirs) and **out of scope**
   - Must not change behavior beyond the migration
3. For broad tree rewrites, prefer `worktree: true` on `grok_build_delegate` (or plan first with `grok_build_plan`).
4. Optional: `grok_build_verify` if there is a clear check (typecheck/tests).
5. Show `summary`, `filesChanged`, **`billing`**. Review diffs; do not commit. Merge from `worktreePath` only after review if used.
