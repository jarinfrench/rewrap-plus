import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchesEditorConfigGlob, resolveEditorConfigMaxLineLength } from './editorconfig.js';

// `import.meta.url` (not `__dirname`) — this package has `"type":
// "module"` (see `../engine-host.ts`'s own doc comment on why that's
// possible here but not for the VSCode extension), so there's no
// CommonJS-target restriction forcing a `__dirname` workaround the way
// `packages/vscode-extension`'s copy of this test needs one.
const fixturesDir = fileURLToPath(new URL('../../test/fixtures/editorconfig', import.meta.url));

describe('resolveEditorConfigMaxLineLength', () => {
  it('resolves a simple root [*] section', () => {
    expect(resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'basic/target.py'))).toBe(100);
  });

  it('lets a closer .editorconfig override a farther one', () => {
    const pyFile = path.join(fixturesDir, 'nested-override/sub/target.py');
    expect(resolveEditorConfigMaxLineLength(pyFile)).toBe(79);
  });

  it("doesn't apply a closer section to a file its pattern excludes", () => {
    const txtFile = path.join(fixturesDir, 'nested-override/sub/target.txt');
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
    expect(resolveEditorConfigMaxLineLength(path.join(fixturesDir, 'no-config/target.py'))).toBe(
      40,
    );
  });

  it('stops walking upward once a root = true file is found', () => {
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
