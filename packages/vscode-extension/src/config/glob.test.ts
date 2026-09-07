import { describe, expect, it } from 'vitest';
import { matchesGlob } from './glob.js';

describe('matchesGlob', () => {
  it('matches everything under the default globstar pattern', () => {
    expect(matchesGlob('**', 'a.py')).toBe(true);
    expect(matchesGlob('**', 'src/nested/deep/a.py')).toBe(true);
  });

  it('matches a bare-extension pattern at any depth, including depth 0', () => {
    expect(matchesGlob('*.py', 'a.py')).toBe(true);
    expect(matchesGlob('*.py', 'nested/deep/a.py')).toBe(true);
    expect(matchesGlob('*.py', 'a.txt')).toBe(false);
  });

  it('anchors a pattern containing a path separator to the match root', () => {
    expect(matchesGlob('src/*.py', 'src/a.py')).toBe(true);
    expect(matchesGlob('src/*.py', 'other/a.py')).toBe(false);
    expect(matchesGlob('src/*.py', 'src/nested/a.py')).toBe(false);
  });

  it('strips a leading / as an explicit anchor rather than matching it literally', () => {
    expect(matchesGlob('/src/*.py', 'src/a.py')).toBe(true);
  });

  it('matches ** across path separators', () => {
    expect(matchesGlob('src/**/*.py', 'src/a/b/c.py')).toBe(true);
    expect(matchesGlob('src/**', 'src/a/b/c.py')).toBe(true);
    expect(matchesGlob('src/**', 'other/a.py')).toBe(false);
  });

  it('* does not cross a path separator', () => {
    expect(matchesGlob('src/*.py', 'src/a/b.py')).toBe(false);
  });

  it('matches brace alternation', () => {
    expect(matchesGlob('*.{py,pyi}', 'a.pyi')).toBe(true);
    expect(matchesGlob('*.{py,pyi}', 'a.pyc')).toBe(false);
  });

  it('matches a negated character class', () => {
    expect(matchesGlob('[!_]*.py', 'a.py')).toBe(true);
    expect(matchesGlob('[!_]*.py', '_a.py')).toBe(false);
  });

  it('treats a run of 3+ stars the same as **, not as adjacent quantifiers', () => {
    // Regression for the catastrophic-backtracking hang fixed in the
    // .editorconfig matcher this module was extracted from (see
    // globToRegExpSource's own doc comment) -- confirming the fix carried
    // over intact, not just that the function still exists.
    expect(matchesGlob('***.py', 'a/b/c.py')).toBe(true);

    const manyStars = '*'.repeat(200) + '.py';
    const start = Date.now();
    expect(matchesGlob(manyStars, 'a/b/c.txt')).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
