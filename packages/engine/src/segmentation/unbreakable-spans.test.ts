import { describe, expect, it } from 'vitest';
import { findUnbreakableSpans } from './unbreakable-spans.js';

function spanTexts(line: string): string[] {
  return findUnbreakableSpans(line).map((s) => line.slice(s.start, s.end));
}

describe('findUnbreakableSpans', () => {
  it('finds no spans in plain prose', () => {
    expect(findUnbreakableSpans('just some ordinary words here')).toEqual([]);
  });

  it('finds a brace placeholder with no internal whitespace', () => {
    expect(spanTexts('Total: {count} items')).toEqual(['{count}']);
  });

  it('finds an f-string interpolation containing internal whitespace', () => {
    expect(spanTexts('Result: {a + b} done')).toEqual(['{a + b}']);
  });

  it('finds a format-spec placeholder with nested braces', () => {
    expect(spanTexts('Value: {value:{width}} end')).toEqual(['{value:{width}}']);
  });

  it('finds a rich format placeholder with conversion and spec', () => {
    expect(spanTexts('Name: {name!r:>10}.')).toEqual(['{name!r:>10}']);
  });

  it('finds percent-style placeholders', () => {
    expect(spanTexts('%s failed with code %(code)d')).toEqual(['%s', '%(code)d']);
  });

  it('finds escape sequences', () => {
    expect(spanTexts('line one\\nline two')).toEqual(['\\n']);
    expect(spanTexts('tab\\there')).toEqual(['\\t']);
    expect(spanTexts('hex \\x41 unicode \\u1234 wide \\U0001F600')).toEqual([
      '\\x41',
      '\\u1234',
      '\\U0001F600',
    ]);
    expect(spanTexts('named \\N{BULLET}')).toEqual(['\\N{BULLET}']);
  });

  it('finds an inline code span containing internal whitespace', () => {
    expect(spanTexts('run `git commit -m msg` first')).toEqual(['`git commit -m msg`']);
  });

  it('finds a reST role whole, including its leading colon prefix', () => {
    expect(spanTexts('see :func:`do the thing` for details')).toEqual([':func:`do the thing`']);
  });

  it('finds a bare URL with no internal whitespace', () => {
    expect(spanTexts('see https://example.com/a/b for more')).toEqual(['https://example.com/a/b']);
  });

  it('finds multiple non-overlapping spans in one line', () => {
    expect(spanTexts('{greeting}, %s! see `here` now')).toEqual(['{greeting}', '%s', '`here`']);
  });
});
