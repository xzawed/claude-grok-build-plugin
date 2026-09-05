# Contributing

## Branch & PR

- Default branch: `main`. The `PRIMARY` ruleset requires a PR, blocks force-push and branch
  deletion, and requires **both CI jobs green** (`mcp-server (ubuntu-latest)` and
  `mcp-server (windows-latest)`).
- `bypass_actors` is empty, so **admins cannot merge past a red CI either**. If you are blocked,
  fix the build — editing the ruleset is a deliberate act, not a workaround.
- Branch prefixes used in this repo: `feat/`, `fix/`, `docs/`, `chore/`, `audit/`.
- **Squash merge only.** Merge commits and rebase merges are disabled on the repository, and the
  ruleset permits `squash` alone. Merged branches auto-delete.

## MCP server (`mcp-server/`)

```bash
cd mcp-server
npm ci
npm test
npm run typecheck
npm run build   # regenerates dist/index.js + dist/hook.js — commit both
```

**Committed bundles:** end users run `dist/` without installing deps. After any change to
`src/` **or** dependency versions that esbuild inlines, run `npm run build` and commit
`dist/`. CI fails if dist is stale.

**When adding an MCP tool:** register it in `src/server.ts`, document in `docs/04`, add the
name to `test/tool-surface.test.ts` (`EXPECTED_MCP_TOOLS`, and bump the
`EXPECTED_MCP_TOOLS.length` count assertion beside it), rebuild `dist/`, and bump
`.claude-plugin/plugin.json` + `mcp-server/package.json` versions together (lock tested
in `plugin-surface.test.ts`).

### Critical: `hooks/hooks.json` schema (do not regress)

Claude Code plugin load **fails entirely** if `hooks/hooks.json` uses the bare event shape:

```json
{ "PreToolUse": [ ... ] }   // ❌ invalid for plugins → Status: failed to load → no /grok:* commands
```

Required (same as official plugins such as railway / security-guidance):

```json
{
  "description": "…",
  "hooks": {
    "PreToolUse": [ ... ]
  }
}
```

After any `hooks/` change, run `npm test` (see `hooks-contract.test.ts`) and, if `claude` CLI is available:

```bash
claude plugin validate ./   # or path to install cache
claude plugin list          # grok@… must show Status: enabled
```

## Release

**Tag and cut the GitHub release immediately after the squash-merge — not "later".** The
marketplace source is `./` and the plugin cache is keyed by version
(`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`), so in the window between the merge
and the tag, anyone installing caches a bundle under a version number that has no release. Not
hypothetical: `v0.2.12` was declared on `main`, never tagged, and had to be abandoned rather than
reused — `docs/releases/v0.2.13.md` and root `CLAUDE.md`.

**1. Move the version everywhere it is declared.** Derived from the tests that fail on drift:

| File | Guarded by |
|---|---|
| `mcp-server/package.json` | source of truth — every other check reads its `version` |
| `.claude-plugin/plugin.json` | `plugin-surface.test.ts` "plugin.json version matches mcp-server/package.json" |
| `mcp-server/src/version.ts` | `handoff-version.test.ts` — the `return '<version>';` fallback literal |
| `docs/releases/v<version>.md` | `handoff-version.test.ts` — the file must exist |
| `CLAUDE.md` | `handoff-version.test.ts` — must contain the version string |
| `docs/09-scope-and-residuals.md` | `handoff-version.test.ts` — must contain the version string |

Three more sites carry it with **no test behind them**, so this list is the only thing that
catches them: `mcp-server/package-lock.json` (twice — root `version` and `packages[""].version`),
`docs/03-plugin-spec.md` (it embeds the `plugin.json` example including its `version` — both the
v0.2.17 and v0.2.18 release commits moved that literal by hand), and the `CHANGELOG.md` entry.

⚠️ **`src/version.ts` lives under `src/`, so a version bump is a source change.** Run
`npm run build` and commit **both** `dist/index.js` and `dist/hook.js` — esbuild inlines the
fallback literal into each, so CI's dist check fails without a rebuild and the last-resort
fallback would still report the old number.

**2. Gates, before opening the PR:**

```bash
cd mcp-server && npm ci && npm test && npm run typecheck && npm run build
```

**3. Tag and release, immediately after the squash-merge:**

```bash
git checkout main && git pull
git tag -a v<version> -m "v<version> — <headline>"   # annotated, like every tag since v0.2.9
git push origin v<version>
gh release create v<version> --title "v<version> — <headline>" \
  --notes-file docs/releases/v<version>.md
```

Both halves are required: `check-release-tag.mjs` reports a problem for a tag with no published
release, because a tag alone is invisible on the Releases page that `docs/09` sends people to.

**4. Verify:**

```bash
node mcp-server/scripts/check-release-tag.mjs
# ok: 0.2.18 is tagged and released as v0.2.18
```

This is **not** part of `npm test`. `.github/workflows/release-tag-check.yml` runs it on a daily
schedule and on `workflow_dispatch` only — never on push/PR, because the commit declaring the
version legitimately lands before the tag, so a PR-time check would redden every release PR.

**5. Manual acceptance.** Run the GUI checklist in `docs/09-scope-and-residuals.md` §5 and record
the result there. For a routine release the short form is its step 2: `/grok:status` →
`serverVersion` must equal `mcp-server/package.json`. If it does not, the marketplace clone is
stale (`autoUpdate: false` — update the clone first) or the session is holding the old process,
which needs a Claude Code restart.

## Dependabot

Lockfile-only PRs **can** fail **Verify dist is up to date**, because esbuild inlines runtime
dependencies into the committed bundle — a dependency bump changes `dist/index.js` without
touching a single source file (observed in PR #27, `fast-uri` 3.1.3 → 3.1.4, and again in
PR #49, 3.1.4 → 3.1.5). But **it is per package**: only deps that actually reach the bundle
matter. Check before rebuilding:

```bash
grep -c "node_modules/<pkg>" mcp-server/dist/index.js   # 0 → not inlined, merge as-is
```

Measured 2026-08-08: `fast-uri` (via `ajv`) is inlined; `ip-address` is not — PR #48 passed the
dist check with a lockfile-only diff.

**Ownership: when a rebuild is needed, a human never runs it. The agent landing the PR does.**
On the PR branch:

```bash
cd mcp-server && npm ci && npm test && npm run typecheck && npm run build
git add dist/index.js dist/hook.js
git commit -m "chore(deps): rebuild dist after <dep> bump"
```

**On Windows, `git status` lies about `dist/` after a build.** `core.autocrlf=true` rewrites the
checkout to CRLF while esbuild writes LF, so a rebuild that changed nothing still shows
`M mcp-server/dist/index.js`. **`git diff` is the authority** — empty output means there is
nothing to commit. (Same reason CI's dist check is Linux-only.)

The human reviews and merges. See `.claude/skills/maintainer-preflight`.

Scheduled **version** updates are deliberately off — there is no `.github/dependabot.yml`,
so only security updates arrive. Turning them on would produce a standing stream of PRs
carrying ~805KB bundle diffs for someone to review.

### Why this is not automated in CI

Considered and rejected (2026-07-29). A workflow that rebuilds and pushes to the Dependabot
PR branch needs a write-capable token on a **public** repo, and
[a push made with `GITHUB_TOKEN` does not trigger new workflow runs][gh-trigger] — so the
final tree would go unverified unless a GitHub App or PAT is added on top. That is a standing
security surface bought to eliminate a chore that has occurred once in six months. Assigning
the rebuild to agents costs nothing and satisfies the same goal. Revisit only if dependency
PR volume rises materially.

[gh-trigger]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow

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

## Docs SSOT

| Topic | Source |
|---|---|
| Now / next | root `CLAUDE.md` |
| Product why | `docs/00-product-vision.md` |
| Phases | `docs/06-roadmap.md` |
| History | `CHANGELOG.md` |
