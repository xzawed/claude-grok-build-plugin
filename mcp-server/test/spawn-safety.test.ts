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

  // The file's own docstring says "grok and git must be argv arrays, never a shell string",
  // but the shell:true ban was asserted for delegate.ts alone. Measured: adding shell:true to
  // worktree.ts's execFileAsync left the suite green. Now every source file is checked.
  it('no source file ever passes shell: true', () => {
    for (const f of srcFiles()) {
      expect(readSrc(f), f).not.toMatch(/shell:s*true/);
      expect(readSrc(f), f).not.toMatch(/shell:s*process.platform/);
    }
  });

  it('defaultSpawn calls spawn with a fixed command and argv array', () => {
    const text = readSrc('delegate.ts');
    expect(text).toMatch(/spawn\('grok',\s*args,/);
    expect(text).not.toMatch(/shell:\s*true/);
  });

  // This wrapper is headless-only: every prompt reaches grok as -p/--prompt-file argv, never
  // stdin. Leaving stdin as a live pipe means any grok confirmation prompt (`memory clear`'s
  // "Are you sure? [y/N]", `plugin install`'s trust prompt, `doctor fix`) blocks until the
  // timeout kills it — measured 1.0.5: 20s of nothing, then a timeout, and the command had
  // done nothing. With stdin on /dev/null the prompt hits EOF and grok fails fast instead.
  it('defaultSpawn gives grok no stdin, so a confirmation prompt cannot hang the call', () => {
    expect(readSrc('delegate.ts')).toMatch(/stdio:\s*\['ignore',\s*'pipe',\s*'pipe'\]/);
  });

  // The grok-installed probe was the only unbounded spawn in src/, and it runs before every
  // gated call. `where.exe` walks all of PATH even after a match, so one unreachable UNC or
  // mapped-drive entry stalled it ~21s each time.
  it('bounds the grok-installed probe with a timeout and a maxBuffer', () => {
    const auth = readSrc('auth.ts');
    expect(auth).toMatch(/PROBE_TIMEOUT_MS/);
    expect(auth).toMatch(/timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER/);
    // both platform branches must carry the bounds
    expect(auth.match(/probeBounds/g)?.length).toBeGreaterThanOrEqual(3);
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
