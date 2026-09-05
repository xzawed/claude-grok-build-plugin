# grok install-path `PATH` prepend — design (Phase 2)

- **Date:** 2026-07-13
- **Status:** approved (brainstorming) → ready for implementation
- **[갱신 2026-09-05] 구현·배포 완료** — 현재 배포본은 `mcp-server/src/env.ts`의
  `grokBinDir`/`prependGrokBin`이다. 위 상태 줄은 작성 시점 기록으로 보존한다
  (현재 상태의 원천은 `CLAUDE.md`·`docs/06-roadmap.md`).
- **Scope:** Phase 2 roadmap item "grok 설치 경로 PATH prepend". When Claude Code is launched
  from a GUI/Dock (minimal `PATH` that omits the grok install dir), both the MCP server's
  `spawn('grok', …)` and the auth/hook `command -v grok` probe fail with a false
  `grok_not_installed`. Fix by prepending grok's install dir to `PATH` for both.

## Ground truth (x.ai/cli/install.sh, fetched 2026-07-13)

- grok installs to **`$HOME/.grok/bin`** (overridable via `GROK_BIN_DIR`):
  `BIN_DIR="${GROK_BIN_DIR:-$HOME/.grok/bin}"`.
- Shell profiles get `export PATH="$HOME/.grok/bin:$PATH"` (bash/zsh) / `fish_add_path`.
- Optional symlinks into `$HOME/.local/bin` / `/usr/local/bin` are created **only when that dir
  is already on PATH** — so they are not a reliable discovery path and are broader surface.
- ⇒ the single dir to prepend is **`$GROK_BIN_DIR` || `~/.grok/bin`**.

The problem is GUI/Dock launch: the login-shell profile that adds `~/.grok/bin` is not sourced,
so a Dock-launched Claude Code (and thus its MCP server + hook subprocesses) never sees it.

## Key decisions (settled during brainstorming)

1. **Prepend only `~/.grok/bin`** (or `$GROK_BIN_DIR`) — the canonical install target. Not the
   symlink fallbacks (`~/.local/bin`, `/usr/local/bin`): those only exist on PATH already and carry
   unrelated binaries (unnecessary surface).
2. **Apply in two places**, both fed by one helper:
   - the **spawn env** (`buildGrokEnv`, which builds the env passed to `spawn` in `delegate.ts`), and
   - the **grok-installed probe** (`defaultAuthDeps.grokInstalled`), which the server auth check AND
     the reused PreToolUse hook both rely on.
3. **Idempotent, no exists-check.** Skip if the dir is already a PATH entry (don't grow PATH on
   repeat calls). No filesystem stat — prepending the user's own fixed dir is harmless and keeps the
   function pure/deterministic (if grok isn't installed there, the entry simply matches nothing).
4. **Cross-platform-safe though POSIX-targeted.** Use `path.delimiter` + `homedir()`/`join` so the
   prepend is correct on win32 too (dev box), even though real deployment is Linux/macOS.

## Component

### `mcp-server/src/env.ts` — new pure helper
```ts
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';

export function grokBinDir(env: NodeJS.ProcessEnv): string {
  return env.GROK_BIN_DIR && env.GROK_BIN_DIR.length > 0
    ? env.GROK_BIN_DIR
    : join(homedir(), '.grok', 'bin');
}

export function prependGrokBin(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = grokBinDir(env);
  const current = env.PATH ?? '';
  const parts = current.split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return { ...env };          // idempotent
  return { ...env, PATH: current ? `${dir}${delimiter}${current}` : dir };
}
```

### `buildGrokEnv(mode, env)` — apply prepend
After stripping API keys (subscription mode), return `prependGrokBin(copy)`. This is the single
place the spawn env is built (`delegate.ts:212`), so the delegated `grok` is found.

### `auth.ts` — `defaultAuthDeps.grokInstalled` runs the probe with the prepended PATH
Pass `{ env: prependGrokBin(env) }` to the `spawnSync` probe (`command -v grok` on POSIX,
`where grok` on win32) so the auth check — and the hook, which reuses `defaultAuthDeps` — find grok
under a GUI/Dock PATH.

## Error handling
None new — pure string manipulation. A missing/empty `PATH` yields just the grok dir.

## Testing (vitest, DI — same pattern as existing env/auth tests)
- `grokBinDir`: default `~/.grok/bin`; respects a non-empty `GROK_BIN_DIR`; empty `GROK_BIN_DIR`
  falls back to default.
- `prependGrokBin`: prepends the dir to an existing PATH; idempotent when already present; handles
  undefined/empty PATH; does not mutate input.
- `buildGrokEnv`: PATH now begins with the grok bin dir (both modes); key-stripping unchanged
  (update the existing `PATH === '/usr/bin'` assertions to expect the prepended value).
- Expected +~6 tests.

## Out of scope
Installing grok; Windows-native support; the symlink fallback dirs; changing how `grok login` /
auth files work (only discovery of the `grok` executable changes).

> **[정정 2026-07-18]** "Windows-native support"는 이 문서 작성 시점의 스코프 외 항목이었으나, 이후
> 네이티브 Windows에서 핵심 경로(auth·delegate·worktree)가 실측 동작함을 확인했다 —
> `docs/06-roadmap.md` "플랫폼 지원 (실측)" 참고. (이 문서는 그 시점의 설계 기록으로 보존.)

## Docs to update after implementation
`docs/06-roadmap.md` (check the PATH item), `docs/02-auth-strategy.md` (grok discovery note if
present), `CLAUDE.md` (env.ts/auth.ts descriptions; drop PATH-prepend from "다음 할 일"),
`README.md`/`README.ko.md` (status banner: remaining Phase 2 = auth-expiry only).
