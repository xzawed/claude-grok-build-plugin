# Design: operations surface (Claude ↔ Grok agreed) — v0.2.5

- Date: 2026-07-28
- Status: implement
- Scope SSOT: `docs/09-scope-and-residuals.md`
- Routing SSOT: `docs/05-routing-policy.md`
- Origin: joint Claude ↔ Grok review requested by the repo owner; two negotiation rounds
  run through `grok_build_plan` (read-only, `billing: subscription`, sessions
  `019fa91e-8a1e-7ba2-b101-cb49acc82338`, `019fa924-a950-70d0-aa20-8fccb9e614ae`)

## Problem

The product scope of this repo is complete (`docs/09`). What is **not** solved is how the
repo is **operated** from here: which surface governs maintainers/agents, and which shipped
files are internally inconsistent. Two classes of defect were found and verified.

### Verified defects (evidence, not opinion)

| # | Defect | Evidence |
|---|---|---|
| D1 | Shipped `/grok:delegate` is weaker than the collaboration contract it is supposed to express | `commands/delegate.md` is 8 lines: `grok_auth_check` → `grok_build_delegate` → print. No `grok_build_status` / `billingMismatch`, no `grok_build_route` / `nextAction`, no `worktree: true` for wide risk, no closing `/grok:review` gate — all of which `agents/grok-worker.md` and `skills/grok-routing/SKILL.md` do require |
| D2 | Routing skill never warns about the un-gated bypass | `skills/grok-routing/SKILL.md` (79 lines) contains `grok_cli` **0 times**. `commands/cli.md` already documents that `grok_cli` is neither PreToolUse-gated nor recorded in history — but the skill Claude actually loads does not |
| D3 | `billingMismatch` is first-class in the agent, absent from both skills | `agents/grok-worker.md` rule 5 stops on it; `skills/grok-routing/SKILL.md` and `skills/grok-first-mile/SKILL.md` mention it **0 times** |
| D4 | Version narrative drift | `docs/06-roadmap.md:10` says `이 레포 제품 범위 완료 (v0.2.3)`; `docs/00-product-vision.md:69` says `(v0.2.3)`. Shipped latest is **v0.2.4** |
| D5 | No internal ops surface exists | `.claude/` does not exist. Maintainer discipline lives only in root `CLAUDE.md` + `CONTRIBUTING.md` + `docs/09` prose — and the failure `docs/09` §6 describes (agents inventing a polish PR every session) is the one failure prose has repeatedly failed to stop |

## Goals

1. Give maintainers/agents a **repo-local** ops surface that makes the `docs/09` scope rule
   fire at the moment it is violated, instead of hoping prose is read.
2. Fix D1–D3 in the shipped surface so the slash command users type, the skill Claude loads,
   and the worker agent all state the same contract.
3. Add exactly one cheap mechanical guard against release/handoff drift (D4 class).
4. Ship it as **v0.2.5** so end users can confirm what they are running.

## Non-goals / explicitly excluded

Agreed by both Claude and Grok. Each was considered and rejected for a stated reason.

| Rejected | Reason |
|---|---|
| New **shipped** hook, or widening the PreToolUse matcher to `grok_cli` | No measured abuse; high false-deny cost on TUI subcommands |
| Second **shipped** agent (`grok-reviewer` etc.) | Claude is the gate by design (`docs/00`, `docs/05`); a shipped reviewer dilutes ownership |
| `SessionStart` hook running status/checklists | Per-session tax that does not prevent the polish-PR failure |
| `PostToolUse` "force review" hook | Wrong layer; `/grok:review` + routing skill already define the gate |
| Maintainer content placed in shipped `skills/` | Pollutes end-user context (see Packaging boundary) |
| New MCP tools / more presets "for completeness" | Product scope is closed; no owner-written done criteria |
| Bot that rewrites `CLAUDE.md` each session | Creates handoff churn; SSOT is a short current state, not a diary |
| `.github/dependabot.yml` policy work | Real issue (lockfile PRs fail the dist gate) but a **separate goal**, deliberately not bundled here |

### Rejected during negotiation — recorded because the reasoning matters

Claude proposed a repo-local `PreToolUse` hook on Bash `git commit` that would deny the
commit when `mcp-server/src/**` is staged without `mcp-server/dist/**`.

**Grok rejected it and Claude conceded.** The reasoning, which stands:

1. **Wrong invariant.** `src staged ∧ dist not staged` is not "dist is fresh". Staging a
   *stale* `dist/` passes the check. The real invariant is CI's: rebuild, then compare
   content of `dist/index.js` and `dist/hook.js`.
2. **Wrong surface.** A Claude Code `PreToolUse` hook fires only when *Claude* runs the
   commit. The owner develops on native Windows; terminal, Git GUI, amend/rebase all bypass
   it. That is a false sense of safety, not a packaging gate.
3. **Already gated.** `.github/workflows/ci.yml` verifies dist by content on Linux.

Conclusion: dist freshness stays a CI responsibility. If earlier feedback is ever wanted, the
correct mechanism is a **tool-agnostic git-level pre-commit hook running CI's exact
predicate** — not a Claude-only path correlation. Not in this change.

## Design

### Packaging boundary (governs every file placement below)

Root `skills/`, `agents/`, `hooks/`, `commands/` **ship to end users** when the plugin is
installed. Maintainer-only content MUST live under `.claude/` (loaded as project config only
when someone works *in* this repo) or in `docs/` + CI. This rule is why the two new skills
are internal and why nothing maintainer-facing is added to `skills/`.

### A. Internal ops surface — `.claude/skills/` (new)

| Path | Purpose | Failure prevented |
|---|---|---|
| `.claude/skills/repo-scope/SKILL.md` | Fires on "what's next / anything left / next task". Forces the `docs/09` classification (A external / B manual / C deferred / D excluded / E new feature with owner-written done criteria). **Default answer: no work.** | Agents reinventing polish PRs after scope closure (D5) |
| `.claude/skills/maintainer-preflight/SKILL.md` | Before claiming done or committing: `npm test`, `npm run typecheck`, and `npm run build` + commit both bundles when `mcp-server/src/**` changed | Green-sounding "done" with stale `dist/` or failing tests; late red-CI round trips |

The `description:` frontmatter of `repo-scope` must trigger on the *question*, not on a
filename — the failure happens at the moment someone asks what to work on.

These are checklists, not gates. That is the accepted limitation: the polish-PR failure is a
judgment failure and cannot be made mechanical without false positives.

### B. Shipped surface fixes

**`commands/delegate.md`** — align with `agents/grok-worker.md` and `skills/grok-routing`:

1. Readiness via `grok_build_status` (or `grok_auth_check`); on `billingMismatch`, stop and
   warn about API keys / `GROK_BUILD_AUTH_MODE`.
2. If fit is unclear, `grok_build_route` first and follow `nextAction`; honour
   `requiresHumanGateBeforeDelegate` by running plan and waiting.
3. Wide or risky edits: `worktree: true`.
4. Report `summary`, `filesChanged`, `billing`, `sessionId`.
5. End at the `/grok:review` gate. Never commit.

Length target: still a short command file — this adds the missing contract, not prose bulk.

**`skills/grok-routing/SKILL.md`** — two additions only:

- Do not perform coding edits through `grok_cli` / `/grok:cli`: those runs are **not**
  PreToolUse-gated and **not** recorded in delegation history. Use
  `grok_build_delegate`/`verify` for auditable edits. (`/grok:cli` remains a valid escape
  hatch for non-editing subcommands.)
- If `grok_build_status` reports `billingMismatch`, stop and warn before delegating.

**`commands/cli.md` is not modified** — it already carries both warnings correctly.

### C. Mechanical guard — `mcp-server/test/handoff-version.test.ts` (new)

Exactly three assertions, against `mcp-server/package.json` `version` as SSOT:

1. `docs/releases/v${version}.md` exists.
2. Root `CLAUDE.md` contains the literal `${version}`.
3. `docs/09-scope-and-residuals.md` contains the literal `${version}`.

**Deliberately not asserted:** version strings inside `docs/06-roadmap.md` and
`docs/00-product-vision.md`. Those are historical narrative; pinning them would force a doc
edit on every unrelated patch bump and make the test hated. The existing
`plugin.json == package.json` lock in `plugin-surface.test.ts` stays as-is.

Property: green today (all three hold for `0.2.4`), and fails loudly the next time a version
is bumped without release notes or handoff update.

### D. Drift correction, CONTRIBUTING, release

- Fix D4 once, editorially: `docs/06-roadmap.md:10` and `docs/00-product-vision.md:69`.
- `CONTRIBUTING.md`: state the packaging boundary explicitly (root `skills/`/`agents/`/
  `hooks/`/`commands/` ship to users; maintainer-only content goes in `.claude/`), and point
  to the two internal skills so a human contributor finds them without an agent.
- Bump `.claude-plugin/plugin.json` and `mcp-server/package.json` to **0.2.5** together.
- Add `docs/releases/v0.2.5.md`; prepend a CHANGELOG entry.
- Update the `CLAUDE.md` current-state block and `docs/09` ship line to 0.2.5.
- `npm run build` and commit both `dist/index.js` and `dist/hook.js`.
- Tag and publish the GitHub Release after merge.

## Division of labour (ongoing operation of this repo)

```
Human   — goals, release go/no-go, manual GUI acceptance, final commit/PR call
Claude  — judgment: scope gate, auth/billing/hooks policy, design, adversarial diff review, done calls
Grok    — volume: mechanical work after a change is approved
CI      — unforgeable packaging invariants (load schema, dist content, tool surface, versions)
```

Route to Grok: unit-test expansion for already-designed pure functions, mechanical
renames/boilerplate across many files, Dependabot rebuild chores. Always absolute `cwd`,
`worktree: true` on a dirty tree, Claude reviews, never auto-commit, prefer
`grok_build_delegate` over `grok_cli -p`.

Keep with Claude: interpreting `docs/09`, anything touching auth/env stripping, hooks schema,
billing, routing policy, product vision, release narrative, and "is it done?" claims.

Never delegated to Grok: "what should we build next?", and the final commit/merge.

## Verification

- `cd mcp-server && npm test` — includes the new `handoff-version` test; must be green
  before and after the version bump (after the bump it only passes once release notes and
  handoff lines exist, which is the point).
- `npm run typecheck`.
- `npm run build`, then confirm `dist/index.js` and `dist/hook.js` are staged.
- `hooks-contract.test.ts` unchanged and green — `hooks/hooks.json` is not touched by this
  change, and must keep its wrapped `{ "hooks": { "PreToolUse": … } }` shape.
- Manual, post-release, per `docs/09` §5: `claude plugin list` shows `enabled`, and
  `/grok:status` reports `serverVersion` `0.2.5`.

## Risks

| Risk | Mitigation |
|---|---|
| `.claude/` inside the plugin repo is misread as shipped content | Plugin surface is defined by the manifest and root `skills/`…; `.claude/` is project config loaded only when working in this repo. Documented in CONTRIBUTING as part of this change |
| The two internal skills are checklists, not gates — an agent can ignore them | Accepted and stated. The alternative (a hook) was rejected above for being unsound. CI remains the only unforgeable layer |
| `handoff-version` test blocks a release until docs are written | Intended behaviour, not a defect |
| Editing shipped skill/command text changes end-user behaviour | Shipped as v0.2.5 with release notes so users can see what changed |
