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

Lockfile-only PRs will fail **Verify dist is up to date** until someone rebuilds `dist/`
on that branch (`npm ci && npm run build` in `mcp-server/`).

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
