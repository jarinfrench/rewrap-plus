import { describe, expect, it } from 'vitest';
import { emitString } from './emit-string.js';

describe('emitString', () => {
  it('emits a single literal with no parens when it already fits on one line', () => {
    const result = emitString('hello world', '', '"', 4, 8, true, 'implicit', 80);
    expect(result).toBe('"hello world"');
  });

  it('re-merges into one literal even if needsParens/style suggest otherwise, once it fits', () => {
    const result = emitString('short', '', '"', 4, 8, true, 'operator', 80);
    expect(result).toBe('"short"');
  });

  it('splits with inserted parens, implicit style, hugging the opening quote', () => {
    const result = emitString(
      'hello there wonderful world today',
      '',
      '"',
      /* indentColumn */ 4,
      /* hangingIndentColumns */ 4,
      /* needsParens */ true,
      'implicit',
      /* columnLimit */ 20,
    );
    expect(result).toBe('("hello there"\n    "wonderful"\n    "world today")');
  });

  it('splits with no parens when already grouped, gluing to the existing bracket', () => {
    const result = emitString(
      'hello there wonderful world today',
      '',
      '"',
      4,
      4,
      /* needsParens */ false,
      'implicit',
      20,
    );
    expect(result).toBe('"hello there"\n    "wonderful"\n    "world today"');
  });

  it('appends a trailing " +" to every non-final line in operator style', () => {
    const result = emitString('alpha beta gamma delta', '', '"', 4, 4, true, 'operator', 16);
    expect(result).toBe('("alpha" +\n    "beta" +\n    "gamma" +\n    "delta")');
  });

  it('carries the prefix onto every emitted part', () => {
    const result = emitString(
      'processing item one and processing item two now',
      'f',
      '"',
      4,
      4,
      true,
      'implicit',
      24,
    );
    for (const line of result.split('\n')) {
      const trimmed = line.trim().replace(/^\(/, '').replace(/\)$/, '');
      expect(trimmed.startsWith('f"')).toBe(true);
    }
  });

  it('never produces a line over columnLimit for any split fixture above', () => {
    const cases: Array<[string, string, string, number, number, boolean, 'implicit' | 'operator', number]> = [
      ['hello there wonderful world today', '', '"', 4, 4, true, 'implicit', 20],
      ['hello there wonderful world today', '', '"', 4, 4, false, 'implicit', 20],
      ['alpha beta gamma delta', '', '"', 4, 4, true, 'operator', 16],
    ];
    for (const [text, prefix, quote, indentColumn, hanging, needsParens, style, limit] of cases) {
      const result = emitString(text, prefix, quote, indentColumn, hanging, needsParens, style, limit);
      for (const line of result.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(limit);
      }
    }
  });
});
