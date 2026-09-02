/**
 * Static spawn/exec contract: grok and git must be argv arrays, never a shell string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../src');

function srcFiles(): string[] {
  return readdirSync(srcDir).filter((f) => f.endsWith('.ts')).sort();
}

function readSrc(name: string): string {
  return readFileSync(join(srcDir, name), 'utf8');
}

describe('spawn safety', () => {
  it('source never imports exec or execSync (shell-string injection surface)', () => {
    for (const f of srcFiles()) {
      const text = readSrc(f);
      expect(text, f).not.toMatch(/\bexecSync\b/);
      expect(text, f).not.toMatch(/from 'node:child_process'.*\bexec\b/);
      const named = /import\s*\{([^}]+)\}\s*from\s*'node:child_process'/.exec(text);
      if (named) {
        const names = named[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]);
        expect(names, f).not.toContain('exec');
        expect(names, f).not.toContain('execSync');
      }
    }
  });

  it('defaultSpawn calls spawn with a fixed command and argv array', () => {
    const text = readSrc('delegate.ts');
    expect(text).toMatch(/spawn\('grok',\s*args,/);
    expect(text).not.toMatch(/shell:\s*true/);
  });

  it('git helpers use execFile with an argv array, not a shell string', () => {
    expect(readSrc('delegate.ts')).toMatch(/execFileAsync\(\s*'git',\s*\[/);
    expect(readSrc('worktree.ts')).toMatch(/execFileAsync\('git',\s*args/);
  });

  it('auth.json is existence-checked only — contents are never read', () => {
    const auth = readSrc('auth.ts');
    // The path comes from authFilePath (GROK_HOME-aware); the credential itself is only
    // ever probed for existence — never opened, logged, or parsed.
    expect(auth).toMatch(/existsSync\(authFilePath\(env\)\)/);
    expect(auth).toMatch(/join\(grokHome\(env\), 'auth\.json'\)/);
    expect(auth).not.toMatch(/readFileSync\([^)]*auth\.json/);
    expect(auth).not.toMatch(/readFile\([^)]*auth\.json/);
  });
});
