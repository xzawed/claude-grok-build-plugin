/**
 * Readers for `git status --porcelain -z` — always run with `-c core.quotepath=false`. `-z` is
 * NUL-separated and does NOT C-quote, so spaces and unicode survive. Pure, so they are unit-tested
 * without git.
 *
 * A leaf module: delegate.ts and worktree.ts both parse this output, and they used to carry two
 * byte-identical copies (worktree.ts could not import delegate.ts without a cycle). A45 had to be
 * fixed in both — the reason there is now one.
 */

/**
 * Entry fields: two status columns (X = index, Y = work tree), a space, the path. A rename or copy
 * is followed by ONE more field holding the original path, which is not an entry of its own.
 *
 * A45 (MEASURED 2026-09-25, git 2.45.1): the R/C can sit in EITHER column. A rename in the work tree
 * — an intent-to-add path (`mv a.txt b.txt && git add -N b.txt`) — is reported ` R b.txt\0a.txt\0`,
 * and checking X alone read `a.txt` as an entry: `.slice(3)` made it a phantom `xt` in filesChanged.
 */
function* entries(zOutput: string): Generator<{ xy: string; path: string }> {
  const fields = zOutput.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const xy = field.slice(0, 2);
    yield { xy, path: field.slice(3) };
    if (/[RC]/.test(xy)) i += 1; // skip the original-path field
  }
}

/** Every changed path, the NEW one for a rename or copy. */
export function parsePorcelain(zOutput: string): string[] {
  const paths: string[] = [];
  for (const { path } of entries(zOutput)) if (path) paths.push(path);
  return paths;
}

/** Paths git reports as untracked (`??`). */
export function untrackedPaths(zOutput: string): string[] {
  const paths: string[] = [];
  for (const { xy, path } of entries(zOutput)) if (xy === '??' && path) paths.push(path);
  return paths;
}
