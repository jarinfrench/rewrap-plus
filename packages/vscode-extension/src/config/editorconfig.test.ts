import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearEditorConfigCache,
  EDITORCONFIG_CACHE_TTL_MS,
  handleEditorConfigSave,
  handleWindowStateChange,
  invalidateEditorConfigCacheDir,
  matchesEditorConfigGlob,
  resolveEditorConfigMaxLineLength,
} from './editorconfig.js';

// A plain `vi.spyOn(fs, 'existsSync')` can't redefine a named export of a
// real ESM module (Vitest's own limitation: "Module namespace is not
// configurable in ESM") -- `node:fs` needs to be replaced with a
// call-through mock *before* `editorconfig.ts` (transitively, via this
// file's own import above) ever imports it, so both this file's `fs.*`
// and `editorconfig.ts`'s internal `existsSync`/`readFileSync` resolve to
// the same mocked functions. `vi.mock` factories are hoisted above every
// import in the file specifically to make that ordering guarantee.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

// `__dirname` (not `import.meta.url`) deliberately: this file is
// compiled by `tsc` as CommonJS (see `../engine-host.ts`'s own doc
// comment on why the package has no `"type": "module"`), and `tsc`
// rejects `import.meta` in a CommonJS-target file outright (TS1343) --
// so this needs to stay usable under `tsc -p tsconfig.json --noEmit`
// (part of the CI gate), not just under `vitest run`.
const fixturesDir = path.join(__dirname, '../../test/fixtures/editorconfig');

// The directory cache (`editorconfig.ts`'s `dirCache`) is module-level
// state shared across every test in this file -- cleared before each one
// so no test's cache warmth leaks into another's expectations, whether
// that test cares about the cache at all or not.
beforeEach(() => {
  clearEditorConfigCache();
});

describe('resolveEditorConfigMaxLineLength', () => {
  it('resolves a simple root [*] section', () => {
    expect(resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'basic/target.py'))).toBe(100);
  });

  it('lets a closer .editorconfig override a farther one', () => {
    const pyFile = path.join(fixturesDir, 'nested-override/sub/target.py');
    // sub/.editorconfig's [*.py] (79) overrides nested-override/.editorconfig's [*] (100).
    expect(resolveEditorConfigMaxLineLength(pyFile)).toBe(79);
  });

  it("doesn't apply a closer section to a file its pattern excludes", () => {
    const txtFile = path.join(fixturesDir, 'nested-override/sub/target.txt');
    // sub/.editorconfig only has [*.py]; target.txt falls through to the
    // farther nested-override/.editorconfig's [*] (100).
    expect(resolveEditorConfigMaxLineLength(txtFile)).toBe(100);
  });

  it('treats max_line_length = off as "no limit", not "keep the previous match"', () => {
    const mdFile = path.join(fixturesDir, 'off-disables/target.md');
    expect(resolveEditorConfigMaxLineLength(mdFile)).toBeUndefined();
  });

  it("off on one file's extension doesn't affect a sibling extension", () => {
    const pyFile = path.join(fixturesDir, 'off-disables/target.py');
    expect(resolveEditorConfigMaxLineLength(pyFile)).toBe(100);
  });

  it('applies a later section over an earlier one in the same file', () => {
    // [*] sets 80, then [*.{py,pyi}] sets 79 -- both match target.py;
    // the later section (order in the file, not "more specific") wins.
    expect(
      resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'glob-specificity/target.py')),
    ).toBe(79);
    expect(
      resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'glob-specificity/target.pyi')),
    ).toBe(79);
  });

  it('an unmatched brace alternative falls through to the earlier section', () => {
    expect(
      resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'glob-specificity/target.txt')),
    ).toBe(80);
  });

  it('inherits from an ancestor root = true file when its own directory has none', () => {
    // no-config/ has no .editorconfig of its own; the walk continues up
    // to fixtures/editorconfig/.editorconfig (root = true, [*] 40).
    expect(resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'no-config/target.py'))).toBe(
      40,
    );
  });

  it('stops walking upward once a root = true file is found', () => {
    // root-stops-walk/.editorconfig itself declares root = true with
    // [*] 100 -- the outer fixtures/editorconfig/.editorconfig's [*] 40
    // must never be consulted.
    expect(
      resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'root-stops-walk/target.py')),
    ).toBe(100);
  });
});

describe('matchesEditorConfigGlob', () => {
  const dir = 'C:/project';

  it('matches a bare-extension pattern at any depth below the section dir', () => {
    expect(matchesEditorConfigGlob('*.py', dir, 'C:/project/a.py')).toBe(true);
    expect(matchesEditorConfigGlob('*.py', dir, 'C:/project/nested/deep/a.py')).toBe(true);
    expect(matchesEditorConfigGlob('*.py', dir, 'C:/project/a.txt')).toBe(false);
  });

  it('anchors a pattern containing a path separator to the section dir', () => {
    expect(matchesEditorConfigGlob('/src/*.py', dir, 'C:/project/src/a.py')).toBe(true);
    expect(matchesEditorConfigGlob('/src/*.py', dir, 'C:/project/other/a.py')).toBe(false);
    expect(matchesEditorConfigGlob('/src/*.py', dir, 'C:/project/src/nested/a.py')).toBe(false);
  });

  it('matches ** across path separators', () => {
    expect(matchesEditorConfigGlob('src/**/*.py', dir, 'C:/project/src/a/b/c.py')).toBe(true);
  });

  it('* does not cross a path separator', () => {
    expect(matchesEditorConfigGlob('src/*.py', dir, 'C:/project/src/a/b.py')).toBe(false);
    expect(matchesEditorConfigGlob('src/*.py', dir, 'C:/project/src/b.py')).toBe(true);
  });

  it('matches brace alternation', () => {
    expect(matchesEditorConfigGlob('*.{py,pyi}', dir, 'C:/project/a.pyi')).toBe(true);
    expect(matchesEditorConfigGlob('*.{py,pyi}', dir, 'C:/project/a.pyc')).toBe(false);
  });

  it('matches a negated character class', () => {
    expect(matchesEditorConfigGlob('[!_]*.py', dir, 'C:/project/a.py')).toBe(true);
    expect(matchesEditorConfigGlob('[!_]*.py', dir, 'C:/project/_a.py')).toBe(false);
  });

  it('treats a run of 3+ stars the same as **, not as adjacent quantifiers', () => {
    // Regression for a confirmed catastrophic-backtracking hang: before
    // `globToRegExpSource` collapsed a whole run of `*` into one
    // quantifier, `***`/`****`/... compiled to several adjacent
    // `[^/]*`/`.*` fragments back to back, and a pattern with ~25
    // consecutive stars took over two minutes to fail one match against a
    // non-matching path (timed directly while diagnosing this). A run of
    // 3+ stars is semantically just "any depth" the same as `**`, so this
    // also checks the collapsed form still matches correctly, not only
    // that it's fast.
    expect(matchesEditorConfigGlob('***.py', dir, 'C:/project/a/b/c.py')).toBe(true);

    const manyStars = '*'.repeat(200) + '.py';
    const start = Date.now();
    expect(matchesEditorConfigGlob(manyStars, dir, 'C:/project/a/b/c.txt')).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('editorconfig directory cache', () => {
  // `basic/` and `off-disables/` are both single-directory walks (each
  // declares `root = true` in its own `.editorconfig`), so a cold
  // resolution against either costs exactly one `existsSync` +
  // `readFileSync` pair -- the minimal shape needed to assert "no new fs
  // calls happened" precisely, without also having to account for however
  // many ancestor levels a deeper fixture would walk through.
  const basicTarget = path.join(fixturesDir, 'basic/target.py');
  const basicEditorConfig = path.join(fixturesDir, 'basic/.editorconfig');
  const offDisablesTarget = path.join(fixturesDir, 'off-disables/target.py');

  // The module-level `vi.mock('node:fs', ...)` above already made these
  // call-through mocks for the whole file -- `editorconfig.ts`'s own
  // `existsSync`/`readFileSync` calls land on these same functions, so
  // clearing call history here (not the mock implementation) is all each
  // test needs.
  const existsSyncSpy = vi.mocked(fs.existsSync);
  const readFileSyncSpy = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();
  });

  it('a cache hit skips the fs calls a cold resolution needed', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).toHaveBeenCalledTimes(1);
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);

    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    expect(resolveEditorConfigMaxLineLength(basicTarget)).toBe(100);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it('saving a .editorconfig invalidates only its own directory, not the whole cache', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    resolveEditorConfigMaxLineLength(offDisablesTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    handleEditorConfigSave({ scheme: 'file', fsPath: basicEditorConfig });

    expect(resolveEditorConfigMaxLineLength(basicTarget)).toBe(100);
    expect(existsSyncSpy).toHaveBeenCalledTimes(1);
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);

    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    // off-disables/ was never saved -- its cache entry should still be warm.
    expect(resolveEditorConfigMaxLineLength(offDisablesTarget)).toBe(100);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it('ignores a save of a document that is not a .editorconfig, or not a file-scheme document', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    handleEditorConfigSave({ scheme: 'file', fsPath: basicTarget }); // target.py, not .editorconfig
    handleEditorConfigSave({ scheme: 'untitled', fsPath: basicEditorConfig }); // right name, wrong scheme

    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it('invalidateEditorConfigCacheDir clears exactly the directory it names', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    invalidateEditorConfigCacheDir(path.dirname(basicTarget));

    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).toHaveBeenCalledTimes(1);
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('the window regaining focus clears every cached directory', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    resolveEditorConfigMaxLineLength(offDisablesTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    handleWindowStateChange({ focused: true });

    resolveEditorConfigMaxLineLength(basicTarget);
    resolveEditorConfigMaxLineLength(offDisablesTarget);
    expect(existsSyncSpy).toHaveBeenCalledTimes(2);
    expect(readFileSyncSpy).toHaveBeenCalledTimes(2);
  });

  it('the window losing focus (blur) does not clear the cache -- only regaining it does', () => {
    resolveEditorConfigMaxLineLength(basicTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    handleWindowStateChange({ focused: false });

    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it('a stale entry past EDITORCONFIG_CACHE_TTL_MS re-reads disk even with no invalidation trigger fired', () => {
    let now = 1_700_000_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    resolveEditorConfigMaxLineLength(basicTarget);
    existsSyncSpy.mockClear();
    readFileSyncSpy.mockClear();

    // Still within the TTL window -- stays a cache hit.
    now += EDITORCONFIG_CACHE_TTL_MS - 1;
    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();

    // Past the TTL now, with neither invalidation trigger ever firing --
    // the entry expires on its own.
    now += 2;
    resolveEditorConfigMaxLineLength(basicTarget);
    expect(existsSyncSpy).toHaveBeenCalledTimes(1);
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);

    dateNowSpy.mockRestore();
  });
});
