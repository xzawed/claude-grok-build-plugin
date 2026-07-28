# Contributing

## Branch & PR

- Default branch: `main` (ruleset: PR required; no force-push).
- Branch prefixes used in this repo: `feat/`, `fix/`, `docs/`, `chore/`, `audit/`.
- Prefer **squash merge**.

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

**When adding an MCP tool:** register it in `src/index.ts`, document in `docs/04`, add the
name to `test/tool-surface.test.ts` (`EXPECTED_MCP_TOOLS`), rebuild `dist/`, and bump
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

## Dependabot

Lockfile-only PRs fail **Verify dist is up to date**, because esbuild inlines runtime
dependencies into the committed bundle — a dependency bump changes `dist/index.js` without
touching a single source file (observed in PR #27, `fast-uri` 3.1.3 → 3.1.4).

**Ownership: a human never runs the rebuild. The agent landing the PR does.** On the PR
branch:

```bash
cd mcp-server && npm ci && npm test && npm run typecheck && npm run build
git add dist/index.js dist/hook.js
git commit -m "chore(deps): rebuild dist after <dep> bump"
```

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
