# Operations surface (Claude ↔ Grok agreed) — v0.2.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this repo a maintainer-only ops surface under `.claude/`, fix three verified inconsistencies in the shipped plugin surface, add one drift guard test, and ship it all as v0.2.5.

**Architecture:** Two internal skills (`.claude/skills/`) act as checklists at the two moments this repo has actually failed — being asked "what's next" and claiming done. Two shipped files (`commands/delegate.md`, `skills/grok-routing/SKILL.md`) are brought in line with the contract that `agents/grok-worker.md` already enforces. A new `handoff-version.test.ts` ties the shipped version to its release notes and handoff docs; `plugin-surface.test.ts` grows assertions that pin the shipped/internal packaging boundary and the two contract texts, so all of this is regression-proof.

**Tech Stack:** TypeScript (ESM, NodeNext), Node 22, vitest 4, esbuild. Docs are Markdown; skills use YAML frontmatter (`name`, `description`).

**Spec:** `docs/specs/2026-07-28-ops-surface-claude-grok-design.md`
**Branch:** `chore/ops-surface-v0.2.5` (already created; `main` requires a PR)
**Baseline:** 18 test files / 197 tests green as of commit `67b5709`

## Global Constraints

- **Packaging boundary:** root `skills/`, `agents/`, `hooks/`, `commands/` **ship to end users**. Maintainer-only content goes in `.claude/` only. Never add maintainer guidance to shipped `skills/`.
- **No new hooks in this change** — neither shipped nor repo-local. The `git commit` PreToolUse hook was proposed and rejected (spec §"Rejected during negotiation"). dist freshness stays a CI responsibility.
- **`hooks/hooks.json` is not touched.** Its wrapped shape `{ "hooks": { "PreToolUse": [ … ] } }` is mandatory; a bare `{ "PreToolUse": … }` makes Claude Code report `Status: failed to load` and hides every `/grok:*` command.
- **Committed bundles:** if `mcp-server/src/**` changes, run `npm run build` and commit both `dist/index.js` and `dist/hook.js`. *(This plan does not change `src/`, so no rebuild is expected — verify rather than assume.)*
- **Version pair:** `.claude-plugin/plugin.json` and `mcp-server/package.json` versions move together (`plugin-surface.test.ts` locks this).
- **Never auto-commit Grok output; never commit directly to `main`.**
- All commands below run from the repo root unless the step says `cd mcp-server`.
- Tests run with `cd mcp-server && npm test` (vitest picks up `test/**/*.test.ts`).

---

## File Structure

**Create:**

| Path | Responsibility |
|---|---|
| `.claude/skills/repo-scope/SKILL.md` | Internal. Fires on "what's next"; forces `docs/09` A–E classification; default answer = no work |
| `.claude/skills/maintainer-preflight/SKILL.md` | Internal. Test/typecheck/build gates before a done claim or commit |
| `mcp-server/test/handoff-version.test.ts` | Guard: shipped version ⇒ release notes exist ⇒ `CLAUDE.md` and `docs/09` cite it |
| `docs/releases/v0.2.5.md` | End-user release notes |

**Modify:**

| Path | Change |
|---|---|
| `mcp-server/test/plugin-surface.test.ts` | +4 assertions: shipped-skills allowlist, internal skills present, delegate contract text, routing skill warnings |
| `commands/delegate.md` | Full collaboration contract (status/billingMismatch, route/nextAction, worktree, review gate) |
| `skills/grok-routing/SKILL.md` | +`grok_cli` bypass warning, +`billingMismatch` stop rule |
| `docs/06-roadmap.md:10` | Remove the `(v0.2.3)` pin (drift source) |
| `docs/00-product-vision.md:69` | Remove the `(v0.2.3)` pin |
| `CONTRIBUTING.md` | New "Packaging boundary" section |
| `.claude-plugin/plugin.json` | `0.2.4` → `0.2.5` |
| `mcp-server/package.json` | `0.2.4` → `0.2.5` |
| `CLAUDE.md` | 현재 상태 block → 0.2.5, new test count, note `.claude/` skills |
| `docs/09-scope-and-residuals.md` | Ship lines → 0.2.5 |
| `CHANGELOG.md` | New dated entry at top |

---

### Task 1: Release/handoff drift guard

Build the guard first, and prove it actually goes red — a guard that has never failed is not known to work.

**Files:**
- Create: `mcp-server/test/handoff-version.test.ts`
- Test: itself

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: the guard that Task 7 must satisfy. Reads `version` from `mcp-server/package.json` and requires `docs/releases/v${version}.md`, plus the literal `${version}` inside `CLAUDE.md` and `docs/09-scope-and-residuals.md`.

- [ ] **Step 1: Write the test**

Create `mcp-server/test/handoff-version.test.ts`:

```typescript
/**
 * Release/handoff drift guard: a shipped version must come with release notes, and the
 * live handoff docs must advertise that same version.
 *
 * Deliberately NOT asserted: version strings inside docs/06-roadmap.md and
 * docs/00-product-vision.md. Those are historical narrative — pinning them would force a
 * doc edit on every unrelated patch bump and the test would end up hated and disabled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function shippedVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'mcp-server/package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

describe('handoff version', () => {
  it('release notes exist for the shipped version', () => {
    const version = shippedVersion();
    const notes = join(repoRoot, `docs/releases/v${version}.md`);
    expect(existsSync(notes), `missing docs/releases/v${version}.md — write release notes before shipping`).toBe(true);
  });

  it('CLAUDE.md advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(text.includes(version), `CLAUDE.md 현재 상태 must cite ${version}`).toBe(true);
  });

  it('docs/09 advertises the shipped version', () => {
    const version = shippedVersion();
    const text = readFileSync(join(repoRoot, 'docs/09-scope-and-residuals.md'), 'utf8');
    expect(text.includes(version), `docs/09 ship line must cite ${version}`).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect PASS at the current version**

```bash
cd mcp-server && npx vitest run test/handoff-version.test.ts
```

Expected: 3 passed. (`docs/releases/v0.2.4.md` exists; `CLAUDE.md` and `docs/09` both contain `0.2.4`.) A guard that false-alarms on a correct repo is worthless — this proves it does not.

- [ ] **Step 3: Prove it goes red**

Temporarily set the version to a value with no release notes:

```bash
cd mcp-server && node -e "const f='package.json';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.version='0.2.5';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
npx vitest run test/handoff-version.test.ts
```

Expected: **3 failed** — missing `docs/releases/v0.2.5.md`, and neither `CLAUDE.md` nor `docs/09` cites `0.2.5`.

- [ ] **Step 4: Revert the version**

```bash
cd mcp-server && git checkout -- package.json
npx vitest run test/handoff-version.test.ts
```

Expected: 3 passed, and `git status` shows only the new test file.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/test/handoff-version.test.ts
git commit -m "test: guard release/handoff version drift

Shipping a version now requires docs/releases/v<version>.md plus that version
string in CLAUDE.md and docs/09. Verified red by bumping to 0.2.5 with no notes,
then green again after revert.

Does not pin docs/06 or docs/00 narrative versions on purpose — that would force
a doc edit on every unrelated patch bump."
```

---

### Task 2: Internal skill — repo scope gate

**Files:**
- Create: `.claude/skills/repo-scope/SKILL.md`
- Modify: `mcp-server/test/plugin-surface.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `.claude/skills/repo-scope/SKILL.md` with frontmatter `name: repo-scope`. Task 3 adds a sibling under the same `.claude/skills/` root; Task 6 links both from `CONTRIBUTING.md`.

- [ ] **Step 1: Write the failing test**

In `mcp-server/test/plugin-surface.test.ts`, add inside the existing `describe('plugin surface', …)` block, after the `'skills and agent definitions exist'` test:

```typescript
  it('internal maintainer skills live under .claude/ with valid frontmatter', () => {
    for (const name of ['repo-scope', 'maintainer-preflight']) {
      const p = join(repoRoot, '.claude/skills', name, 'SKILL.md');
      expect(existsSync(p), p).toBe(true);
      const fm = parseFrontmatter(readFileSync(p, 'utf8'));
      expect(fm.name, name).toBe(name);
      expect(fm.description, name).toBeTruthy();
      expect(fm.description.length, name).toBeGreaterThan(40);
    }
  });

  it('shipped skills/ holds only end-user skills — maintainer content belongs in .claude/', () => {
    const entries = readdirSync(join(repoRoot, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(entries).toEqual(['grok-first-mile', 'grok-routing']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: the `internal maintainer skills` test FAILS (`.claude/skills/repo-scope/SKILL.md` does not exist). The `shipped skills/` test passes already.

- [ ] **Step 3: Create the skill**

Create `.claude/skills/repo-scope/SKILL.md`:

```markdown
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
```

- [ ] **Step 4: Run the test to verify partial progress**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: still FAILS, now only on `maintainer-preflight` (created in Task 3). `repo-scope` assertions pass.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/repo-scope/SKILL.md mcp-server/test/plugin-surface.test.ts
git commit -m "feat(ops): internal repo-scope skill + packaging boundary tests

Fires on 'what's next' and forces the docs/09 A-E classification with a default
answer of no work — the one failure mode docs/09 says prose alone has not stopped.

Internal only: .claude/ never reaches plugin end users. The new shipped-skills
allowlist test fails if maintainer content is added to skills/ by mistake."
```

---

### Task 3: Internal skill — maintainer preflight

**Files:**
- Create: `.claude/skills/maintainer-preflight/SKILL.md`

**Interfaces:**
- Consumes: the `internal maintainer skills` test from Task 2, which already asserts this file
- Produces: `.claude/skills/maintainer-preflight/SKILL.md` with frontmatter `name: maintainer-preflight`

- [ ] **Step 1: Confirm the test is still red for this file**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: FAIL on `.claude/skills/maintainer-preflight/SKILL.md` missing.

- [ ] **Step 2: Create the skill**

Create `.claude/skills/maintainer-preflight/SKILL.md`:

```markdown
---
name: maintainer-preflight
description: Use before claiming work is done, before committing, and before opening a PR in this repo — runs the mcp-server test/typecheck/build gates and the committed-bundle rule. Trigger on "done", "ready to commit", "open a PR", or any completion claim.
---

# Maintainer preflight (claude-grok-build-plugin)

Run these before saying done. Evidence, not vibes.

## Always

```bash
cd mcp-server
npm ci          # only when node_modules is missing
npm test
npm run typecheck
```

Both must pass. Report the real counts from this session's run — never summarize a run you
did not execute.

## If you touched `mcp-server/src/**`

```bash
cd mcp-server
npm run build
git add dist/index.js dist/hook.js
```

End users execute the **committed** bundles without ever running `npm install`. A commit that
changes `src/` without both regenerated bundles ships a plugin whose behaviour does not match
its source. CI catches it on Linux by comparing content — but only after you push.

Staging `dist/` is not the same as rebuilding it. Run the build.

## If you touched `hooks/hooks.json`

The wrapped shape is mandatory:

```json
{ "hooks": { "PreToolUse": [ … ] } }
```

A bare `{ "PreToolUse": … }` makes Claude Code report **Status: failed to load**, and every
`/grok:*` command disappears. `hooks-contract.test.ts` guards this — do not skip it.

## If you bumped the version

`.claude-plugin/plugin.json` and `mcp-server/package.json` move together. `handoff-version.test.ts`
additionally requires `docs/releases/v<version>.md` and that version string in `CLAUDE.md` and
`docs/09-scope-and-residuals.md`.

## Never

- Commit directly to `main` — the ruleset requires a PR
- Auto-commit Grok's output — a human reviews the diff first
- Claim green from a run you did not execute in this session
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: PASS — all assertions including both internal skills.

- [ ] **Step 4: Run the full suite**

```bash
cd mcp-server && npm test
```

Expected: all green, 197 + 3 (Task 1) + 2 (Task 2) = **202 tests**.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/maintainer-preflight/SKILL.md
git commit -m "feat(ops): internal maintainer-preflight skill

Test/typecheck/build checklist at the moment a done claim is made, including the
committed-bundle rule (rebuild, not just stage) and the hooks.json wrapped-shape
reminder. Internal only — never ships to plugin users."
```

---

### Task 4: Shipped `/grok:delegate` states the full contract

**Files:**
- Modify: `commands/delegate.md` (whole body below the frontmatter)
- Modify: `mcp-server/test/plugin-surface.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `commands/delegate.md` containing the literal tokens `grok_build_status`, `billingMismatch`, `grok_build_route`, `nextAction`, `worktree`, `/grok:review` — pinned by the test added here.

- [ ] **Step 1: Write the failing test**

In `mcp-server/test/plugin-surface.test.ts`, add inside the same `describe` block:

```typescript
  it('/grok:delegate states the full collaboration contract', () => {
    const text = readFileSync(join(repoRoot, 'commands/delegate.md'), 'utf8');
    for (const token of [
      'grok_build_status', 'billingMismatch', 'grok_build_route',
      'nextAction', 'worktree', '/grok:review',
    ]) {
      expect(text, `commands/delegate.md must mention ${token}`).toContain(token);
    }
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: FAIL — the current 8-line `delegate.md` mentions none of those tokens.

- [ ] **Step 3: Rewrite the command**

Replace the entire contents of `commands/delegate.md` with:

```markdown
---
description: Delegate a coding task to Grok
---

Call `grok_build_status` first (or `grok_auth_check` when you only need auth). If `ready` is
false, stop and show the message. If it reports **`billingMismatch`**, stop and warn the user
about stray API keys / `GROK_BUILD_AUTH_MODE` before spending anything — that flag means work
would bill as metered API instead of their subscription.

If the task's fit for Grok is unclear, call `grok_build_route` and follow **`nextAction`**.
When it says `handle_with_claude`, do not force Grok. When
`nextAction.requiresHumanGateBeforeDelegate` is set, run `grok_build_plan` and wait for the
user's approval before any edit.

Otherwise call `grok_build_delegate` with the user's task as `prompt` and an absolute `cwd`.
For wide or risky edits pass `worktree: true`, so changes land in an isolated worktree instead
of the working tree.

Show the returned `summary`, `filesChanged`, and — importantly — the `billing` field, so the
user knows whether this ran on their subscription or metered API. If the result includes
**`sessionId`**, note that a follow-up can use `/grok:resume` (or `resume` on the next
delegate).

Finish at the review gate: run `/grok:review` on the diff. Do not commit — the user decides
accept, fix, or discard.
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: PASS (the `description` frontmatter assertion still holds — the frontmatter is unchanged).

- [ ] **Step 5: Commit**

```bash
git add commands/delegate.md mcp-server/test/plugin-surface.test.ts
git commit -m "fix(commands): /grok:delegate states the safety contract it always implied

The 8-line version ran auth_check -> delegate -> print, so the slash command users
actually type was weaker than skills/grok-routing and agents/grok-worker: no
billingMismatch stop, no route/nextAction, no worktree for risk, no closing review
gate. Test pins the tokens so it cannot silently regress."
```

---

### Task 5: Routing skill closes the `grok_cli` provenance gap

**Files:**
- Modify: `skills/grok-routing/SKILL.md` (two edits)
- Modify: `mcp-server/test/plugin-surface.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `skills/grok-routing/SKILL.md` containing the literals `grok_cli` and `billingMismatch`.

- [ ] **Step 1: Write the failing test**

In `mcp-server/test/plugin-surface.test.ts`, add inside the same `describe` block:

```typescript
  it('routing skill warns about the un-gated grok_cli bypass and billingMismatch', () => {
    const text = readFileSync(join(repoRoot, 'skills/grok-routing/SKILL.md'), 'utf8');
    expect(text, 'routing skill must warn about grok_cli edits').toContain('grok_cli');
    expect(text, 'routing skill must mention billingMismatch').toContain('billingMismatch');
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: FAIL — the skill currently contains neither token.

- [ ] **Step 3: Edit 1 — replace tool-list item 7**

In `skills/grok-routing/SKILL.md`, find:

```markdown
7. Auth / ready: `grok_auth_check` or `/grok:setup`
```

Replace with:

```markdown
7. Auth / ready: `grok_build_status` (or `grok_auth_check`) or `/grok:setup`. If status
   reports **`billingMismatch`**, stop and warn about stray API keys /
   `GROK_BUILD_AUTH_MODE` before delegating anything.
```

- [ ] **Step 4: Edit 2 — add the bypass warning**

In the same file, find:

```markdown
Always pass absolute `cwd`. Prefer English prompts for the `prompt` field.
```

Insert immediately after it (blank line between):

```markdown
**Do not make coding edits through `grok_cli` / `/grok:cli`.** Passthrough runs are **not**
gated by the pre-delegate auth hook and are **not** recorded in delegation history, so the
edit has no provenance. `/grok:cli` stays the escape hatch for non-editing subcommands
(`models`, `sessions`, `memory`, …); use `grok_build_delegate` / `grok_build_verify` for
anything that changes files.
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd mcp-server && npx vitest run test/plugin-surface.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd mcp-server && npm test
```

Expected: green, **204 tests** (197 + 3 + 2 + 1 + 1).

- [ ] **Step 7: Commit**

```bash
git add skills/grok-routing/SKILL.md mcp-server/test/plugin-surface.test.ts
git commit -m "fix(skills): routing skill warns about un-gated grok_cli edits

commands/cli.md already documented that passthrough runs are neither hook-gated
nor recorded in history, but the skill Claude actually loads mentioned grok_cli
zero times. Also surfaces billingMismatch, which agents/grok-worker enforced and
neither shipped skill mentioned."
```

---

### Task 6: Kill the version-pin drift source + document the packaging boundary

Fixing `(v0.2.3)` by writing `(v0.2.5)` would just re-arm the same trap. Remove the pin instead.

**Files:**
- Modify: `docs/06-roadmap.md:10`
- Modify: `docs/00-product-vision.md:69`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: the internal skill paths created in Tasks 2–3 (linked from CONTRIBUTING)
- Produces: no code interface

- [ ] **Step 1: Remove the roadmap pin**

In `docs/06-roadmap.md`, find line 10:

```markdown
**진행 현황 한눈에 (2026-07):** Phase 1~5 + 신뢰 게이트 ✅ · **이 레포 제품 범위 완료 (v0.2.3)**.  
```

Replace with:

```markdown
**진행 현황 한눈에 (2026-07):** Phase 1~5 + 신뢰 게이트 ✅ · **이 레포 제품 범위 완료**.  
최신 릴리스 버전은 `docs/releases/`와 루트 `CLAUDE.md` 현재 상태를 본다 (여기에 버전을 박지 않는다 — 드리프트 원인).  
```

- [ ] **Step 2: Remove the vision-table pin**

In `docs/00-product-vision.md`, find line 69:

```markdown
| 이 레포 범위 종료 선언 | “다음 할 일” 무한 polish 방지 | ✅ `docs/09-scope-and-residuals.md` (v0.2.3) |
```

Replace with:

```markdown
| 이 레포 범위 종료 선언 | “다음 할 일” 무한 polish 방지 | ✅ `docs/09-scope-and-residuals.md` |
```

- [ ] **Step 3: Document the packaging boundary**

In `CONTRIBUTING.md`, insert this section immediately before the final `## Docs SSOT` section:

```markdown
## Packaging boundary (what ships to users)

Everything under root `skills/`, `agents/`, `hooks/`, `commands/` is **shipped** to end users
when the plugin is installed. Maintainer-only guidance must never go there — it would land in
end-user context.

Maintainer-only content lives in `.claude/skills/`:

| Skill | Use it |
|---|---|
| `.claude/skills/repo-scope` | Before answering "what's next" or opening an unrequested PR — enforces the `docs/09` scope rule |
| `.claude/skills/maintainer-preflight` | Before claiming done or committing — test, typecheck, committed-bundle rule |

`plugin-surface.test.ts` pins the shipped `skills/` directory to the end-user set, so a
maintainer skill added in the wrong place fails CI.

```

- [ ] **Step 4: Verify nothing broke**

```bash
cd mcp-server && npm test
```

Expected: still **204** green. (`handoff-version.test.ts` deliberately ignores `docs/06` and `docs/00`, so removing those pins must not affect it — this run proves it.)

- [ ] **Step 5: Commit**

```bash
git add docs/06-roadmap.md docs/00-product-vision.md CONTRIBUTING.md
git commit -m "docs: remove version pins that drift; document packaging boundary

docs/06 and docs/00 advertised '(v0.2.3)' while shipped latest was v0.2.4. Rather
than re-pinning to a number that drifts again, point at docs/releases and CLAUDE.md.

CONTRIBUTING now states that root skills/agents/hooks/commands ship to users and
maintainer-only content belongs in .claude/, with pointers to both internal skills."
```

---

### Task 7: Ship v0.2.5

The guard from Task 1 must go red on the bump and green only once the release docs exist. Watch for that — it is the guard proving itself in production.

**Files:**
- Modify: `.claude-plugin/plugin.json`, `mcp-server/package.json`
- Create: `docs/releases/v0.2.5.md`
- Modify: `CLAUDE.md`, `docs/09-scope-and-residuals.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `handoff-version.test.ts` (Task 1) and every content change from Tasks 2–6
- Produces: version `0.2.5` across the pair, with release notes and handoff docs that cite it

- [ ] **Step 1: Bump both versions**

In `.claude-plugin/plugin.json` and `mcp-server/package.json`, change `"version": "0.2.4"` to `"version": "0.2.5"`. Both files, same value.

- [ ] **Step 2: Run the suite to watch the guard fire**

```bash
cd mcp-server && npm test
```

Expected: **3 failures** in `handoff-version.test.ts` — missing `docs/releases/v0.2.5.md`, `CLAUDE.md` and `docs/09` not citing `0.2.5`. `plugin-surface.test.ts` version-pair test still passes (both bumped together). If the guard does NOT fail here, it is broken — stop and fix Task 1.

- [ ] **Step 3: Write the release notes**

Create `docs/releases/v0.2.5.md`:

```markdown
# Grok plugin v0.2.5 — release notes

**Plugin version:** `0.2.5`  
**Previous release:** `v0.2.4`  
**Severity:** Consistency fix — no change to MCP server behaviour, auth, or billing

---

## Summary

`/grok:delegate` now states the same safety contract that the routing skill and the
`grok-worker` agent already enforced, and the routing skill closes a provenance gap around
`/grok:cli`. Nothing about how Grok runs, authenticates, or bills has changed.

---

## What changed

**`/grok:delegate` follows the full collaboration loop.** The old command was eight lines:
`grok_auth_check` → `grok_build_delegate` → print. It now:

- checks readiness with `grok_build_status` and **stops on `billingMismatch`** — a stray
  `XAI_API_KEY` in the environment would otherwise bill you as metered API instead of your
  subscription
- consults `grok_build_route` / `nextAction` when the fit is unclear, and honours the human
  gate before editing
- uses `worktree: true` for wide or risky edits
- ends at the `/grok:review` diff gate, and still never commits

**Routing skill closes a provenance gap.** It now says explicitly: do not make coding edits
through `/grok:cli`. Passthrough runs are not gated by the pre-delegate auth hook and are not
recorded in delegation history. Use `/grok:delegate` or `/grok:verify` for auditable edits —
`/grok:cli` remains the escape hatch for non-editing subcommands.

**Release/handoff guard.** A new test requires a shipped version to have release notes and to
be cited by the handoff docs, so an upgrade can no longer advertise a stale version.

---

## Install / update

```
/plugin marketplace add xzawed/claude-grok-build-plugin
/plugin install grok@grok-marketplace
/reload-plugins
```

Then verify:

1. In a terminal: `claude plugin list` → `grok@…` **Status: enabled**
2. In Claude Code: `/grok:status` → `serverVersion` **0.2.5**

---

## Full changelog

Root [`CHANGELOG.md`](../../CHANGELOG.md)
```

- [ ] **Step 4: Update the CLAUDE.md current-state block**

In `CLAUDE.md`, replace these three lines:

```markdown
- **이 레포 제품 범위 완료 · 최신 릴리스 `v0.2.4` (GitHub Latest).** Phase 1~5 + 신뢰 게이트.
  유닛 **197** (`npm test`). MCP 9 tools: auth, status, delegate, plan, verify, usage,
  worktree, route, cli. `main` tip: hooks 스키마 수정 포함 (`#43`).
```

with (use the **actual** test count printed by `npm test`, not a guessed number):

```markdown
- **이 레포 제품 범위 완료 · 최신 릴리스 `v0.2.5` (GitHub Latest).** Phase 1~5 + 신뢰 게이트.
  유닛 **204** (`npm test`). MCP 9 tools: auth, status, delegate, plan, verify, usage,
  worktree, route, cli. MCP 서버 코드는 v0.2.4와 동일 — v0.2.5는 표면 일관성 수정.
```

Then replace the 이용자 업데이트 line's version:

```markdown
  `claude plugin list` = **enabled** · `/grok:status` `serverVersion` **0.2.4**.
  (로컬에 0.2.3 캐시만 남아 있을 수 있음 — 재설치 권장.)
```

with:

```markdown
  `claude plugin list` = **enabled** · `/grok:status` `serverVersion` **0.2.5**.
```

And add one line to the same block, after the 표면 bullet:

```markdown
- **유지보수자 표면 (`.claude/`, 배포 안 됨):** `repo-scope`(다음 할 일 = 기본 없음),
  `maintainer-preflight`(done 선언 전 test/typecheck/build). 경계 규칙: `CONTRIBUTING.md`.
```

- [ ] **Step 5: Update the docs/09 ship lines**

In `docs/09-scope-and-residuals.md`, replace:

```markdown
**이 플러그인 레포의 의도된 제품 범위(다리 + 협업 표면 + first-mile + 소비자 계약/키트)는 완료다 (최신 릴리스 `v0.2.4`).**  
```

with:

```markdown
**이 플러그인 레포의 의도된 제품 범위(다리 + 협업 표면 + first-mile + 소비자 계약/키트)는 완료다 (최신 릴리스 `v0.2.5`).**  
```

and replace:

```markdown
**Ship 상태 (핸드오프):** GitHub Releases Latest = `v0.2.4` (critical: hooks schema load fix).  
이용자: marketplace 갱신 후 `claude plugin list` → enabled, `/grok:status` → `0.2.4`.
```

with:

```markdown
**Ship 상태 (핸드오프):** GitHub Releases Latest = `v0.2.5` (표면 일관성: delegate 계약, grok_cli 경고).  
이용자: marketplace 갱신 후 `claude plugin list` → enabled, `/grok:status` → `0.2.5`.
```

- [ ] **Step 6: Prepend the CHANGELOG entry**

In `CHANGELOG.md`, insert immediately after the `형식: 최신이 위. 날짜는 작업일 기준.` line and its blank line:

```markdown
## 2026-07-28

### Ops — maintainer surface + shipped consistency (v0.2.5)

- `.claude/skills/repo-scope`: "다음 할 일" 질문 시점에 `docs/09` A~E 분류를 강제하고 기본 답을 **없음**으로 고정 (배포 안 됨).
- `.claude/skills/maintainer-preflight`: done 선언·커밋 전 test/typecheck/build + 번들 커밋 규칙 (배포 안 됨).
- `commands/delegate.md`: status/`billingMismatch` 중단, route/`nextAction`, 위험 시 `worktree`, `/grok:review` 종료 — 에이전트·스킬이 이미 강제하던 계약과 정렬.
- `skills/grok-routing/SKILL.md`: `grok_cli` 편집 금지(훅 미적용·이력 미기록) + `billingMismatch` 중단 규칙.
- `handoff-version.test.ts`: 릴리스 노트 존재 + `CLAUDE.md`·`docs/09`의 버전 표기 일치를 강제. `docs/06`·`docs/00`은 의도적으로 미검사.
- `docs/06`·`docs/00`의 `(v0.2.3)` 고정 표기 제거 — 재드리프트 방지.
- `CONTRIBUTING.md`: 패키징 경계(배포 vs `.claude/`) 명문화.
- 협의 기록: Claude가 제안한 `git commit` PreToolUse dist 훅은 **기각**. 조건이 "dist 최신"을 보장하지 못하고 Claude 외부 커밋을 못 잡는다. dist 무결성은 CI 책임으로 유지. 상세: `docs/specs/2026-07-28-ops-surface-claude-grok-design.md`.

```

- [ ] **Step 7: Run the suite — the guard must go green**

```bash
cd mcp-server && npm test
```

Expected: all green, **204 tests**, including the three `handoff-version` assertions now satisfied by the new release notes and handoff lines. If the count differs, use the real number and correct `CLAUDE.md` from Step 4.

- [ ] **Step 8: Typecheck and confirm no bundle drift**

```bash
cd mcp-server && npm run typecheck && npm run build
cd .. && git status --porcelain -- mcp-server/dist
```

Expected: typecheck clean; `git status` prints **nothing** for `mcp-server/dist` — this change touches no `src/`, so the committed bundles must be byte-identical. If `dist` shows as modified, stop and investigate before committing.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin/plugin.json mcp-server/package.json docs/releases/v0.2.5.md CLAUDE.md docs/09-scope-and-residuals.md CHANGELOG.md
git commit -m "chore: release v0.2.5 — ops surface + shipped consistency

Version pair bumped together; release notes, CLAUDE.md current state and docs/09
ship lines updated. MCP server code is unchanged from v0.2.4, so dist/ bundles are
byte-identical and not re-committed.

The handoff-version guard added in this branch failed on the bump and passed only
after the release docs existed — working as designed."
```

---

### Task 8: PR, review, and release

**Files:** none — this task is delivery.

**Interfaces:**
- Consumes: every prior task
- Produces: merged `main` at v0.2.5 plus a published GitHub Release

- [ ] **Step 1: Final full verification from a clean state**

```bash
cd mcp-server && npm ci && npm test && npm run typecheck
```

Expected: green. Record the exact test count for the PR body.

- [ ] **Step 2: Review the whole diff**

```bash
cd .. && git diff main...HEAD --stat && git diff main...HEAD
```

Confirm: no `mcp-server/src/**` change, no `mcp-server/dist/**` change, no `hooks/hooks.json` change, nothing maintainer-only under shipped `skills/`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/ops-surface-v0.2.5
gh pr create --base main --title "chore: ops surface (Claude+Grok agreed) + shipped consistency (v0.2.5)" --body "$(cat <<'EOF'
Implements `docs/specs/2026-07-28-ops-surface-claude-grok-design.md`, agreed between Claude and Grok over two `grok_build_plan` rounds (read-only, subscription billing). Every factual claim Grok made was verified against the repo before it was accepted.

## Verified defects fixed

- `commands/delegate.md` was 8 lines (`auth_check` → `delegate` → print) — weaker than the contract `agents/grok-worker.md` and `skills/grok-routing` already enforce. No `billingMismatch` stop, no `route`/`nextAction`, no `worktree`, no `/grok:review` gate.
- `skills/grok-routing/SKILL.md` mentioned `grok_cli` **0 times**, so the un-gated, unrecorded bypass was undocumented in the skill Claude actually loads.
- `billingMismatch` appeared in the worker agent but in neither shipped skill.
- `docs/06-roadmap.md:10` and `docs/00-product-vision.md:69` still advertised `(v0.2.3)` while shipped latest was v0.2.4. The pins are removed rather than re-pinned.
- `.claude/` did not exist, so the one failure `docs/09` says prose cannot stop — polish-PR invention — had no surface that fires at the moment of violation.

## Added

- `.claude/skills/repo-scope` — internal; default answer to "what's next" is no work
- `.claude/skills/maintainer-preflight` — internal; test/typecheck/build before a done claim
- `mcp-server/test/handoff-version.test.ts` — shipped version ⇒ release notes ⇒ cited by `CLAUDE.md` and `docs/09`
- `plugin-surface.test.ts` — shipped-skills allowlist (packaging boundary) + contract-text pins

## Deliberately NOT done

Claude proposed a repo-local `PreToolUse` hook denying commits that stage `mcp-server/src` without `dist`. **Grok rejected it and Claude conceded:** the predicate is not "dist is fresh" (a stale staged dist passes), and the hook only fires when Claude runs the commit — native Windows terminal and GUI commits bypass it entirely. dist freshness stays a CI responsibility. Reasoning recorded in the spec so the idea is not re-proposed next session.

Also excluded: new shipped hooks, a second shipped agent, SessionStart/PostToolUse hooks, new MCP tools, `.github/dependabot.yml` policy (a real but separate goal).

## Verification

- `npm test` green, `npm run typecheck` clean
- `mcp-server/src/**` and `mcp-server/dist/**` untouched — bundles byte-identical to v0.2.4
- `hooks/hooks.json` untouched; `hooks-contract.test.ts` still green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Wait for CI**

```bash
gh pr checks --watch
```

Expected: both `mcp-server (ubuntu-latest)` and `mcp-server (windows-latest)` pass, including `Verify dist is up to date`.

- [ ] **Step 5: CHECKPOINT — get the owner's go before merging**

Merging and publishing a release are outward-facing. Report CI status and wait for explicit approval. Do not merge on your own initiative.

- [ ] **Step 6: Merge (after approval)**

```bash
gh pr merge --squash --delete-branch
```

(`deleteBranchOnMerge` is now enabled on the repo, so the branch is removed automatically; `--delete-branch` also cleans the local copy.)

- [ ] **Step 7: Tag and publish the release (after approval)**

```bash
git checkout main && git pull --ff-only
git tag v0.2.5 && git push origin v0.2.5
gh release create v0.2.5 --title "grok v0.2.5 — delegate states the safety contract" --notes-file docs/releases/v0.2.5.md --latest
```

- [ ] **Step 8: Manual acceptance (human, per `docs/09` §5)**

Ask the owner to run, in Claude Code:

1. marketplace update / reinstall → `/reload-plugins`
2. `claude plugin list` → `grok@…` **Status: enabled**
3. `/grok:status` → `serverVersion` **0.2.5**, expected `billing`
4. `/grok:delegate` on a throwaway directory → confirm it now surfaces billing and ends at the review gate, and that nothing was committed

Record the result as a CHANGELOG line or an issue comment. CI cannot substitute for this step.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| A. `.claude/skills/repo-scope` | Task 2 |
| A. `.claude/skills/maintainer-preflight` | Task 3 |
| B. `commands/delegate.md` | Task 4 |
| B. `skills/grok-routing/SKILL.md` | Task 5 |
| B. `commands/cli.md` unchanged | Honoured — no task touches it |
| C. `handoff-version.test.ts`, 3 assertions | Task 1 |
| C. `docs/06`/`docs/00` not asserted | Task 1 comment + Task 6 Step 4 proves it |
| D. Drift correction | Task 6 |
| D. CONTRIBUTING packaging boundary | Task 6 Step 3 |
| D. Version bump, release notes, CHANGELOG, handoff | Task 7 |
| D. Tag + GitHub Release | Task 8 |
| Packaging boundary enforced mechanically | Task 2 shipped-skills allowlist |
| Rejected hook stays rejected | Global Constraints + PR body + spec |
| Verification (`npm test`, typecheck, build, hooks-contract) | Tasks 3, 5, 6, 7 Step 8, 8 Step 1 |
| Manual GUI acceptance (`docs/09` §5) | Task 8 Step 8 |

No spec requirement is unassigned.

**Placeholder scan:** No TBD/TODO. Every file's full content is written out; every edit gives exact find/replace text; every command is runnable as written.

**Type consistency:** `parseFrontmatter`, `repoRoot`, `readdirSync`, `readFileSync`, `existsSync`, and `join` are all already defined or imported in `plugin-surface.test.ts` — the four added tests introduce no new imports. `handoff-version.test.ts` is self-contained with its own imports. Skill frontmatter `name:` values (`repo-scope`, `maintainer-preflight`) match the directory names the test asserts. The test-count arithmetic is consistent across Tasks 3, 5, 6, and 7 (197 → 202 → 204), with instructions to use the real printed number if it differs.
