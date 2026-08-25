import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchesEditorConfigGlob, resolveEditorConfigMaxLineLength } from './editorconfig.js';

// `__dirname` (not `import.meta.url`) deliberately: this file is
// compiled by `tsc` as CommonJS (see `../engine-host.ts`'s own doc
// comment on why the package has no `"type": "module"`), and `tsc`
// rejects `import.meta` in a CommonJS-target file outright (TS1343) —
// so this needs to stay usable under `tsc -p tsconfig.json --noEmit`
// (part of the CI gate), not just under `vitest run`.
const fixturesDir = path.join(__dirname, '../../test/fixtures/editorconfig');

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
    // [*] sets 80, then [*.{py,pyi}] sets 79 — both match target.py;
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
    // [*] 100 — the outer fixtures/editorconfig/.editorconfig's [*] 40
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
});
