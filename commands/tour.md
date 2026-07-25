---
description: 15-minute guided tour — prove Grok works in this Claude session
---

You are running the **Grok starting-point tour** for this Claude Code plugin.
Goal: the user finishes with (1) auth ready, (2) one successful subscription-billed
delegation if they allow it, (3) a clear sense of when to use Grok next.

Do **not** skip safety: no auto-commit, no destructive bulk work, no forcing API billing.

## Step 1 — Ready?

Prefer **`grok_build_status`** (or `grok_auth_check` if status is unavailable).

- If `ready: false` / `ok: false`: show the message and stop with exact fix steps. Offer `/grok:setup`.
  Do not invent install paths beyond the message.
- If ready: report `mode`, expected **`billing`**, **`serverVersion`**, and continue.

## Step 2 — Explain the deal (short)

In 3–5 bullets, tell the user:

- Claude stays the orchestrator; Grok is the worker for bulk/low-risk/narrow work.
- Every run reports **`billing`** — they should want `subscription` if on SuperGrok / Premium+.
- Grok edits files but **never auto-commits**; they review diffs.
- Full human map: point to repo doc `docs/08-getting-started-with-grok.md` if present,
  or summarize `/grok:tests`, `/grok:migrate`, `/grok:boilerplate`, `/grok:route`.

## Step 3 — Route demo (no edits)

Call `grok_build_route` with a sample task, e.g.  
`task: "backfill unit tests for the parser module"`  
Show `risk`, `worker`, `reasons`, `suggestedTool`, and **`nextAction`**.  
Explain: this tool never bills or edits.

## Step 4 — First win (ask permission)

Ask whether to run a **tiny** sample in a **throwaway** absolute `cwd` they approve
(or their current project only if they explicitly accept).

If yes:

1. `grok_build_delegate` with English prompt:  
   `Create a file grok-tour-hello.txt containing exactly: ok`
2. Show `summary`, `filesChanged`, and **`billing` in bold**.
3. If `billing` is `metered_api` and they expected subscription, warn about API keys in env.
4. Remind: review then delete the sample file or commit themselves — you do not commit.

If no: skip without pressure; still finish Step 5.

## Step 5 — What to try this week

Recommend **one** preset that fits their repo (from conversation context):

| If they need… | Suggest |
|---|---|
| Tests | `/grok:tests` |
| Mechanical renames | `/grok:migrate` |
| Scaffolding | `/grok:boilerplate` |
| Unsure approach | `/grok:plan` then delegate |
| Continue same Grok thread | `/grok:resume` (needs prior `sessionId`) |
| Review after edits | `/grok:review` |
| Dashboard anytime | `/grok:status` |
| Risky bulk | delegate with `worktree: true` |

End with: Claude will also **propose** Grok on fit tasks via the `grok-routing` skill —
they can just describe work in natural language.
