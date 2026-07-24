---
description: Backfill or expand tests with Grok (preset)
---

Preset: use Grok for **test backfill / expansion** — a strong Grok fit (low risk, repetitive).

1. Call `grok_auth_check`. If `ok: false`, show `message` and stop (guide `/grok:setup`).
2. Build an English `prompt` that includes:
   - What to test (paths, functions, or "cover untested code in …")
   - Constraints (framework, no flaky time/network, match existing style)
   - Done criteria (tests run or at least compile; no production behavior change unless asked)
3. Prefer `grok_build_verify` (self-check) with absolute `cwd`. If the user wants a plan only, use `grok_build_plan` first.
4. For large or risky suites touching many packages, set `worktree: true`.
5. Show `summary`, `filesChanged`, and **`billing`**. Review diffs; do not commit.
