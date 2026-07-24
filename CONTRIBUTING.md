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

## Dependabot

Lockfile-only PRs will fail **Verify dist is up to date** until someone rebuilds `dist/`
on that branch (`npm ci && npm run build` in `mcp-server/`).

## Docs SSOT

| Topic | Source |
|---|---|
| Now / next | root `CLAUDE.md` |
| Product why | `docs/00-product-vision.md` |
| Phases | `docs/06-roadmap.md` |
| History | `CHANGELOG.md` |
