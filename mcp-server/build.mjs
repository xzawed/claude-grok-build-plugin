// Bundles the plugin's Node entrypoints into self-contained dist/*.js files so the
// plugin ships runnable code WITHOUT node_modules at the install site:
//   - src/index.ts      -> dist/index.js  (the MCP server; see .mcp.json)
//   - src/hook-entry.ts -> dist/hook.js   (the PreToolUse auth hook; see hooks/hooks.json)
// See docs/03-plugin-spec.md (packaging).
import { build } from 'esbuild';

await build({
  // Object entryPoints map source -> output basename: hook-entry.ts -> dist/hook.js.
  entryPoints: [
    { in: 'src/index.ts', out: 'index' },
    { in: 'src/hook-entry.ts', out: 'hook' },
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  // The product's runtime FLOOR lives here, because end users receive these built files and run
  // them on whatever node they already have — they never install dependencies, so nothing checks
  // a manifest for them. AUDITED BY GROK 2026-09-23: the floor was stated ONLY here, and the
  // manifest had no `engines` field at all, which is where the repo's own rule says a minimum
  // runtime belongs. It now does, and `plugin-surface.test.ts` fails if the two drift apart.
  // Move both together, or neither.
  target: 'node18',
  outdir: 'dist',
  // Some transitive deps may reference CommonJS `require` when bundled to ESM;
  // provide it via createRequire so the bundle is self-contained on Node ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);",
  },
});

console.error('bundled -> dist/index.js, dist/hook.js');
