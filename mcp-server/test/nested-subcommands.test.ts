/**
 * Contract for the nested-subcommand drift (`scripts/nested-subcommands.mjs`).
 *
 * WHY THIS EXISTS — MEASURED 2026-09-30. grok 1.0.44 added `grok worktree create` under the existing
 * `worktree`. probe:contract compared only the top-level `--help` and reported the surface unchanged; a
 * hand-run diff of every subcommand's help found it. grok_cli classifies by the top-level subcommand, so a
 * nested addition inherits its parent's class without anyone deciding.
 */
import { describe, it, expect } from 'vitest';
import { flattenNested, nestedDiff } from '../scripts/nested-subcommands.mjs';

// `grok worktree --help` Commands, 1.0.41 and 1.0.44 (win32 help dumps, 2026-09-30).
const WORKTREE_1041 = ['clean-artifacts', 'db', 'detach', 'gc', 'list', 'redirect', 'rm', 'salvage', 'show'];
const WORKTREE_1044 = ['clean-artifacts', 'create', 'db', 'detach', 'gc', 'list', 'redirect', 'rm', 'salvage', 'show'];

describe('flattenNested', () => {
  it('turns the map into sorted "parent child" entries', () => {
    expect(flattenNested({ worktree: ['rm', 'create'], mcp: ['list'] })).toEqual(['mcp list', 'worktree create', 'worktree rm']);
  });
  it('treats a missing map or a parent without children as nothing', () => {
    expect(flattenNested(undefined)).toEqual([]);
    expect(flattenNested({ worktree: [] })).toEqual([]);
  });
});

describe('nestedDiff', () => {
  it('reports the measured 1.0.41 -> 1.0.44 addition', () => {
    expect(nestedDiff({ worktree: WORKTREE_1041 }, { worktree: WORKTREE_1044 })).toEqual({ added: ['worktree create'], removed: [] });
  });
  it('reports nothing when the lists match', () => {
    expect(nestedDiff({ worktree: WORKTREE_1044 }, { worktree: WORKTREE_1044 })).toEqual({ added: [], removed: [] });
  });
  it('reports a removal, and children of a parent that is new', () => {
    expect(nestedDiff({ worktree: WORKTREE_1044 }, { worktree: WORKTREE_1041, cloud: ['run'] }))
      .toEqual({ added: ['cloud run'], removed: ['worktree create'] });
  });
  it('says "not compared" (null), not "unchanged", when the snapshot predates the nested map', () => {
    expect(nestedDiff(undefined, { worktree: WORKTREE_1044 })).toBeNull();
    expect(nestedDiff(null, { worktree: WORKTREE_1044 })).toBeNull();
  });
  it('never reports a parent whose help could not be read as having lost its children', () => {
    expect(nestedDiff({ worktree: WORKTREE_1044, mcp: ['list'] }, { mcp: ['list'] }, ['worktree']))
      .toEqual({ added: [], removed: [] });
  });
  it('never reports the children of a parent the snapshot could not read as new', () => {
    // What --update writes after a failed `worktree --help`: no entry, and the parent named as unreadable.
    expect(nestedDiff({ mcp: ['list'] }, { mcp: ['list'], worktree: WORKTREE_1044 }, [], ['worktree']))
      .toEqual({ added: [], removed: [] });
  });
  it('reports a removed parent as each of its children too', () => {
    expect(nestedDiff({ worktree: WORKTREE_1044, mcp: ['list'] }, { mcp: ['list'] }))
      .toEqual({ added: [], removed: WORKTREE_1044.map((c) => `worktree ${c}`) });
  });
});
