import { describe, expect, it } from 'vitest';
import { markdownContinuationPrefix } from './continuation-prefix.js';

/**
 * Sec. 5.3's own table, verbatim -- every distinct container shape the block
 * grammar's marker chains can produce, each asserted directly rather
 * than only spot-checked.
 */
describe('markdownContinuationPrefix', () => {
  it.each([
    ['- ', '  '],
    ['1. ', '   '],
    ['- [ ] ', '      '],
    ['> ', '> '],
    ['>> ', '>> '],
    ['- > ', '  > '],
    ['> - ', '>   '],
  ])('turns %j into %j', (firstLinePrefix, expected) => {
    expect(markdownContinuationPrefix(firstLinePrefix)).toBe(expected);
  });

  it('returns an empty string for no prefix at all (an unindented paragraph)', () => {
    expect(markdownContinuationPrefix('')).toBe('');
  });

  it('keeps a tab unchanged, replacing everything else around it with spaces', () => {
    expect(markdownContinuationPrefix('-\t')).toBe(' \t');
  });

  it('keeps every ">" in a deeply nested quote chain, replacing only the separating spaces', () => {
    expect(markdownContinuationPrefix('>>> ')).toBe('>>> ');
  });

  it('produces a prefix whose length always equals the input length', () => {
    for (const input of ['- ', '1. ', '- [ ] ', '> ', '>> ', '- > ', '> - ', '   - ', '\t> ']) {
      expect(markdownContinuationPrefix(input)).toHaveLength(input.length);
    }
  });
});
