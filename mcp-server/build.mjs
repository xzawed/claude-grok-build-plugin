// Bundles the MCP server into a single self-contained dist/index.js so the
// plugin ships a runnable entrypoint WITHOUT node_modules at the install site.
// See docs/03-plugin-spec.md (packaging) and .mcp.json (points at dist/index.js).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/index.js',
  // Some transitive deps may reference CommonJS `require` when bundled to ESM;
  // provide it via createRequire so the bundle is self-contained on Node ESM.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = globalThis.require ?? __createRequire(import.meta.url);",
  },
});

console.error('bundled -> dist/index.js');
