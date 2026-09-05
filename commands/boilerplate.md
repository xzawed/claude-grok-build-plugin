---
description: Scaffold boilerplate with Grok (preset)
---

Preset: use Grok for **boilerplate / scaffolding** (CRUD, DTOs, handlers, thin modules).

1. Call `grok_auth_check`. If `ok: false`, show `message` and stop (guide `/grok:setup`).
2. Build an English `prompt` with:
   - What to create (names, paths, stack conventions in this repo)
   - Patterns to mirror (existing file as reference if any)
   - What not to invent (no extra features, no drive-by refactors)
3. Call `grok_build_delegate` with absolute `cwd`. Use `worktree: true` if the scaffold spans many new files in a shared package.
4. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
   returned `message` and stop — do not report the run as done; `filesChanged` may still
   list partial edits. Otherwise show `summary`, `filesChanged`, **`billing`**. Review
   diffs; do not commit.
