# Design: Phase 3.5 slice — routing skill, presets, setup first-success

- Date: 2026-07-25
- Status: shipped — historical design record. Current behaviour: `mcp-server/src/` and `docs/specs/grok-cli-contract.md` (measured). *(Annotated 2026-09-05.)*
- Product: `docs/00-product-vision.md` (use Grok well · feel Grok · Claude↔Grok collab)

## Problem

Phase 1–3 delivered a safe bridge, but end users only hit Grok when they remember
`/grok:delegate`. Claude does not load `docs/05-routing-policy.md` at runtime for
installed plugins (repo `CLAUDE.md` is not shipped as end-user context).

## Goals (this slice)

1. **Routing skill** — install-time instructions so Claude proposes Grok on fit tasks.
2. **Preset commands** — three high-signal scenarios (tests, migrate, boilerplate).
3. **Setup first-success** — after auth OK, guide a sample delegate + next scenarios.

Non-goals: `best_of_n`/resume tool fields, worktree lifecycle tools, filesChanged
before/after, usage report rewrite (later Phase 3.5 items).

## Done when

- [x] `skills/grok-routing/SKILL.md` exists (auto-discovered plugin skill).
- [x] `commands/tests.md`, `migrate.md`, `boilerplate.md` call real MCP tools only.
- [x] `commands/setup.md` includes first-success + three next scenarios + billing callout.
- [x] Docs SSOT updated: `docs/03`, roadmap checkboxes, `CLAUDE.md` current status, CHANGELOG.
- [x] No MCP server code change (no rebuild required).

## Safety

- No auto-commit. Always show `billing`. Prefer `worktree: true` for risky bulk edits.
- Skill must **not** force Grok on architecture/security/regulatory work (`docs/05`).
