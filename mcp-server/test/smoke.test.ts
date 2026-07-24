import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { getServerVersion } from '../src/version.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgVersion = (
  JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { version: string }
).version;

describe('smoke', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });

  it('MCP server version matches package.json (SSOT)', () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(getServerVersion()).toBe(pkgVersion);
  });
});
