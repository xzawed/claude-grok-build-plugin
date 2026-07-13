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
  target: 'node18',
  outdir: 'dist',
  // Some transitive deps may reference CommonJS `require` when bundled to ESM;
  // provide it via createRequire so the bundle is self-contained on Node ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);",
  },
});

console.error('bundled -> dist/index.js, dist/hook.js');
