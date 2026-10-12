---
description: Scaffold boilerplate with Grok (preset)
---

Preset: use Grok for **boilerplate / scaffolding** (CRUD, DTOs, handlers, thin modules).

1. Call `grok_auth_check` with the absolute `cwd` you will delegate into. If `ok: false`, show `message` and stop (guide `/grok:setup`).
2. Build an English `prompt` with:
   - What to create (names, paths, stack conventions in this repo)
   - Patterns to mirror (existing file as reference if any)
   - What not to invent (no extra features, no drive-by refactors)
3. Call `grok_build_delegate` with absolute `cwd`. Use `worktree: true` if the scaffold spans many new files in a shared package.
4. If `status` is not `completed` (`auth_error`, `timeout`, or `grok_error`), show the
   returned `message` and stop — do not report the run as done; `filesChanged` may still
   list partial edits. Otherwise show `summary`, `filesChanged`, **`billing`** (plus the
   `message` of `billingCaveat` when present — a warning; do not stop on it).
   A completed result can also carry a `message` — show it whenever there is one: besides a commit
   notice, it can say that the prompt, with any files it @-mentions or skill it invokes, was too long for grok (its
   request to the model left out part of the prompt or of what grok added to it), so the work may not
   reflect the whole prompt.
   If `committed` is `true`, grok made a git commit although this plugin never commits — show
   the returned `message`: it names the folder whose HEAD moved and the commit it moved from,
   with how to inspect and undo it there (never run those commands in another folder). Do not
   read an empty or short `filesChanged` as "nothing changed": committed files are no longer
   listed. If `committed` is absent, the run could not be checked — do not report "no commit".
   Review diffs; do not commit.
