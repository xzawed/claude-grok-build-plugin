import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * MCP-advertised server version. SSOT is `mcp-server/package.json`.
 *
 * Works from:
 * - source (`src/version.ts` -> `../package.json`) under vitest/typecheck
 * - the esbuild bundle (`dist/index.js` -> `../package.json`) at install time
 */
export function getServerVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  try {
    const v = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }).version;
    if (typeof v === 'string' && v.length > 0) return v;
  } catch {
    // fall through
  }
  // Last resort only - keep in sync with package.json when packaging omits it.
  return '0.2.17';
}
