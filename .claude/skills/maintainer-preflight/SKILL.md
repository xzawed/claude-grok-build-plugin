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
