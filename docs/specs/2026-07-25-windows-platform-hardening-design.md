# Design: Windows platform hardening

- Date: 2026-07-25
- Status: shipped — historical design record. Current behaviour: `mcp-server/src/` and `docs/specs/grok-cli-contract.md` (measured). *(Annotated 2026-09-05.)*
- Context: Core auth/delegate/worktree already measured on Win32NT (2026-07-18). Remaining
  gaps were PreToolUse hook e2e, install messaging (POSIX-only curl), and CI coverage.

## Goals

1. **Robust Windows grok discovery** — `where.exe` + direct `~/.grok/bin/grok.exe` (etc.) check
   after PATH prepend (GUI/minimal PATH still finds grok).
2. **Platform-aware not-installed message** — Windows → `install.ps1`, POSIX → `install.sh`.
3. **CI on windows-latest** — unit tests + typecheck (dist freshness stays Ubuntu-only; CRLF).
4. **Record hook smoke** — native Windows: `echo '{}' | node dist/hook.js` exit 0 (2026-07-25).

## Non-goals

- Full live Claude Code UI e2e for PreToolUse (depends on harness install).
- Verifying grok `--sandbox` profile names (still grok-native unknown).
- Auth expiry live e2e without keyring isolation (still environment-limited).

## Done when

- [x] `probeGrokInstalled` / message helpers tested
- [x] Windows CI job green path defined
- [x] docs/roadmap platform section updated
- [x] dist rebuild if auth.ts changes
