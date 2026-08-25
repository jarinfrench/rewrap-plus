import { describe, expect, it } from 'vitest';
import { looksLikeCommentedOutCode } from './looks-like-code.js';

// Same pattern `pythonDescriptor.comments.codeLikeKeywords` declares —
// duplicated here (rather than imported) so this test suite exercises
// the generic function against a realistic keyword pattern without
// depending on the Python adapter, matching this module's own
// language-agnostic scope.
const PYTHON_LEADING_KEYWORD =
  /^(def |class |import |from |return\b|if |elif |else\s*:|for |while |with |try\s*:|except|finally\s*:|raise |yield |lambda |async |await |assert |global |nonlocal |del |pass\s*$|break\s*$|continue\s*$|@\w|#!)/;

describe('looksLikeCommentedOutCode', () => {
  it('is false for an empty run', () => {
    expect(looksLikeCommentedOutCode([])).toBe(false);
  });

  it('is false for ordinary prose, with no keyword pattern supplied', () => {
    expect(
      looksLikeCommentedOutCode(['This function computes the running total for the batch.']),
    ).toBe(false);
  });

  it('is true for a single disabled statement with high punctuation density, with no keyword pattern supplied', () => {
    expect(looksLikeCommentedOutCode(['x = f(a, b, c=1, d=2)'])).toBe(true);
  });

  it('falls back to the punctuation-density signal alone when no keyword pattern is supplied', () => {
    // A Python-shaped definition has low punctuation density on its own
    // (mostly letters) — without a keyword pattern to catch it, this is
    // expected to read as prose rather than code.
    expect(looksLikeCommentedOutCode(['def old_function(argument_one, argument_two):'])).toBe(
      false,
    );
  });

  describe('with a leading-keyword pattern supplied (Python-shaped)', () => {
    it('is true for a disabled function definition', () => {
      expect(
        looksLikeCommentedOutCode(
          ['def old_function(argument_one, argument_two):', '    return argument_one + argument_two'],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(true);
    });

    it('is true for a disabled import', () => {
      expect(looksLikeCommentedOutCode(['import numpy as np'], PYTHON_LEADING_KEYWORD)).toBe(
        true,
      );
    });

    it('is true for a disabled decorator plus definition', () => {
      expect(
        looksLikeCommentedOutCode(
          ['@deprecated', 'def legacy():', '    pass'],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(true);
    });

    it('is false for a prose sentence that merely contains a colon', () => {
      expect(
        looksLikeCommentedOutCode(
          ['Note: this behavior changed in the last release.'],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(false);
    });

    it('is false for a prose sentence with several commas', () => {
      expect(
        looksLikeCommentedOutCode(
          ['Handles apples, oranges, pears, and other common fruit.'],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(false);
    });

    it('ignores blank lines when computing the majority vote', () => {
      expect(
        looksLikeCommentedOutCode(['def f():', '', '    return 1', ''], PYTHON_LEADING_KEYWORD),
      ).toBe(true);
    });

    it('does not flip on a single stray prose line inside disabled code', () => {
      expect(
        looksLikeCommentedOutCode(
          ['# TODO: remove this once the API is fixed', 'def f(x, y):', '    return x + y'],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(true);
    });

    it('does not flip on a single stray code-like aside inside prose', () => {
      expect(
        looksLikeCommentedOutCode(
          [
            'This paragraph is prose from start to finish.',
            "It just happens to mention don't set x = 0 here as an aside.",
            'The rest of it continues on as ordinary sentences.',
          ],
          PYTHON_LEADING_KEYWORD,
        ),
      ).toBe(false);
    });
  });
});
