---
name: repo-scope
description: Use when anyone asks what to work on next in this repo — "what's next", "anything left", "is there remaining work", "next task" — or before opening any PR the owner did not explicitly request. Enforces the docs/09 scope rule, whose default answer is: no work.
---

# Repo scope gate (claude-grok-build-plugin)

This repo's product scope is **closed**. `docs/09-scope-and-residuals.md` is the SSOT.

## The rule

**The default answer to "what's next?" is: nothing.**

Do not open a PR the owner did not ask for. Unrequested "polish" is the failure this repo has
already suffered repeatedly — a session looking for work invents it.

## Before answering "what's next"

1. Read the `현재 상태` block in root `CLAUDE.md`, then `docs/09-scope-and-residuals.md`.
2. Classify every residual before mentioning it. Never present an unclassified list:

| Class | Meaning | May you open a PR? |
|---|---|---|
| A — external | Consumer / orchestrator repo work | **No.** Doc pointer only |
| B — manual | Human + Claude Code GUI acceptance (`docs/09` §5) | **No.** It is a release ritual |
| C — deferred | ACP, pending a stated re-check trigger | **No.** Deferred ≠ next |
| D — excluded | Auto-commit, per-call authMode override | **No.** Out of scope by design |
| E — new feature | Only once the owner states a goal | **Yes — after** done criteria are written |

3. With no owner goal, the answer is: `이 레포 범위 완료 — 외부/수동/보류는 docs/09`.

## Red flags — you are inventing work

- "I noticed X could be improved" when nobody asked
- "Let me also tidy…" bolted onto an unrelated request
- Reading a class A/B/C roadmap checkbox as a TODO
- Adding a tool, preset, or skill "for completeness"
- Proposing a hook to enforce something CI already enforces

## When the owner does give a goal

Write the done criteria first. Check them against `docs/00-product-vision.md`. Then plan.
Scope stays at what was asked — no adjacent cleanup rides along.
