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
    expect(result).toBe('("hello there "\n    "wonderful "\n    "world today")');
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
    expect(result).toBe('"hello there "\n    "wonderful "\n    "world today"');
  });

  it('appends a trailing " +" to every non-final line in operator style', () => {
    const result = emitString('alpha beta gamma delta', '', '"', 4, 4, true, 'operator', 16);
    expect(result).toBe('("alpha " +\n    "beta " +\n    "gamma " +\n    "delta")');
  });

  it('preserves the space at every split point — concatenating every part reconstructs the original text exactly', () => {
    // The plan's own named central risk: "Preserve the trailing space at
    // split points... the single most likely source of silent behavior
    // change; test it hard."
    const cases: Array<[string, boolean, 'implicit' | 'operator']> = [
      ['hello there wonderful world today', true, 'implicit'],
      ['hello there wonderful world today', false, 'implicit'],
      ['alpha beta gamma delta', true, 'operator'],
    ];
    for (const [text, needsParens, style] of cases) {
      const result = emitString(text, '', '"', 4, 4, needsParens, style, 20);
      const parts = [...result.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
      expect(parts.join('')).toBe(text);
    }
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

  it('is idempotent across the needsParens transition a real first-wrap/re-wrap causes', () => {
    // Regression: a bare assignment's first wrap has needsParens=true and
    // indentColumn pointing at the bare string's own column. Once wrapped,
    // the SAME logical text sits inside its own freshly-inserted parens —
    // a re-wrap sees needsParens=false and an indentColumn one column
    // further right (the string now starts just past the inserted `(`).
    // Both the reflowed line breaks and the physical text must come out
    // identical either way; a naive per-pass width budget can drift by
    // exactly the one column the paren itself occupies. See
    // `closingReserve`'s own doc comment in emit-string.ts for the full
    // story of why the fix is asymmetric (closing side unconditional,
    // opening side still gated on needsParens).
    const text = 'This message is intentionally long so that it exceeds the limit and must be wrapped.';
    const first = emitString(text, '', '"', 10, 4, true, 'implicit', 60);
    // Re-wrapping: the string's own column shifts right by one (the `(`
    // now precedes it on the same line, unchanged from the first pass —
    // the surrounding parens are never part of what emitString itself
    // returns, only the region between them), and it's already grouped.
    const second = emitString(text, '', '"', 11, 4, false, 'implicit', 60);
    expect(first).toBe('(' + second + ')');
  });

  it('preserves a trailing space before the closing quote on a single-line result', () => {
    // Regression: `atomizeWords` drops any whitespace trailing the final
    // atom (nothing follows it to be "between"), which `reinsertSplitSpaces`
    // used to only check for at interior split points, silently dropping a
    // string's own trailing space even when it never gets split at all —
    // e.g. `"Hello, " + name` re-emitting as `"Hello," + name`, a real
    // value change, not merely cosmetic.
    const result = emitString('Hello, ', '', '"', 4, 8, false, 'operator', 80);
    expect(result).toBe('"Hello, "');
  });

  it('preserves a trailing space before the closing quote on the last line of a multi-line result', () => {
    const text = 'hello there wonderful world today ';
    const result = emitString(text, '', '"', 4, 4, false, 'implicit', 20);
    const parts = [...result.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
    expect(parts.join('')).toBe(text);
  });

  it('re-wraps quotes around empty content rather than dropping them', () => {
    // Regression: a naive `atomizeWords('')` → zero atoms → zero reflowed
    // lines path would make `lines.length <= 1` return
    // `prefix + quoteDelimiter + (lines[0] ?? '') + quoteDelimiter` with
    // `lines` itself `[]` rather than `['']` — the `lines[0] ?? ''` still
    // saves it, but `reflowBlock`'s own `atoms.length === 0` guard
    // (`../reflow/reflow-block.ts`) is the first line of defense, and is
    // what's actually being exercised here. An empty string literal like
    // `""` must never lose its delimiters and become a bare `""`-less
    // sequence — that's invalid syntax in every language this engine
    // supports (e.g. Python's `x = ""` must never re-emit as `x =`).
    expect(emitString('', '', '"', 4, 8, false, 'implicit', 80)).toBe('""');
    expect(emitString('', 'f', '"', 4, 8, false, 'implicit', 80)).toBe('f""');
    expect(emitString('', '', "'", 4, 8, true, 'operator', 80)).toBe("''");
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
