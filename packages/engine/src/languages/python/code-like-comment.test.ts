import { describe, expect, it } from 'vitest';
import { looksLikeCommentedOutCode } from './code-like-comment.js';

describe('looksLikeCommentedOutCode', () => {
  it('is false for an empty run', () => {
    expect(looksLikeCommentedOutCode([])).toBe(false);
  });

  it('is false for ordinary prose', () => {
    expect(
      looksLikeCommentedOutCode(['This function computes the running total for the batch.']),
    ).toBe(false);
  });

  it('is true for a disabled function definition', () => {
    expect(
      looksLikeCommentedOutCode([
        'def old_function(argument_one, argument_two):',
        '    return argument_one + argument_two',
      ]),
    ).toBe(true);
  });

  it('is true for a single disabled statement with high punctuation density', () => {
    expect(looksLikeCommentedOutCode(['x = f(a, b, c=1, d=2)'])).toBe(true);
  });

  it('is true for a disabled import', () => {
    expect(looksLikeCommentedOutCode(['import numpy as np'])).toBe(true);
  });

  it('is true for a disabled decorator plus definition', () => {
    expect(looksLikeCommentedOutCode(['@deprecated', 'def legacy():', '    pass'])).toBe(true);
  });

  it('is false for a prose sentence that merely contains a colon', () => {
    expect(looksLikeCommentedOutCode(['Note: this behavior changed in the last release.'])).toBe(
      false,
    );
  });

  it('is false for a prose sentence with several commas', () => {
    expect(
      looksLikeCommentedOutCode(['Handles apples, oranges, pears, and other common fruit.']),
    ).toBe(false);
  });

  it('ignores blank lines when computing the majority vote', () => {
    expect(looksLikeCommentedOutCode(['def f():', '', '    return 1', ''])).toBe(true);
  });

  it('does not flip on a single stray prose line inside disabled code', () => {
    expect(
      looksLikeCommentedOutCode([
        '# TODO: remove this once the API is fixed',
        'def f(x, y):',
        '    return x + y',
      ]),
    ).toBe(true);
  });

  it('does not flip on a single stray code-like aside inside prose', () => {
    expect(
      looksLikeCommentedOutCode([
        'This paragraph is prose from start to finish.',
        "It just happens to mention don't set x = 0 here as an aside.",
        'The rest of it continues on as ordinary sentences.',
      ]),
    ).toBe(false);
  });
});
