import { describe, expect, it } from 'vitest';
import type { WrappableRegion } from '../../types/region.js';
import { dissolveDocstring } from './dissolve-docstring.js';

/**
 * Builds a `WrappableRegion` whose span covers the *entire* `source` --
 * every test in this file uses a `source` that's nothing but the
 * docstring itself, so `sliceSpanText` always returns `source` back
 * unchanged. Mirrors `../../comments/dissolve-block-comments.test.ts`'s
 * own `regionForWholeSource`.
 */
function regionForWholeSource(source: string, indentColumn = 0): WrappableRegion {
  const lines = source.split('\n');
  const endRow = lines.length - 1;
  const endColumn = lines[endRow]!.length;
  const span = { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow, endColumn };
  return {
    kind: 'docstring',
    span,
    parts: [span],
    rawText: source,
    indentColumn,
    languageId: 'python',
  };
}

describe('dissolveDocstring', () => {
  it('throws for text that does not start with a recognizable prefix/quote', () => {
    const source = 'not a string at all';
    expect(() => dissolveDocstring(regionForWholeSource(source), source)).toThrow(
      /recognizable prefix\/quote/,
    );
  });

  describe('single physical line', () => {
    it('strips both quote delimiters and detects no closing-own-line', () => {
      const source = '"""A short summary."""';
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.text).toBe('A short summary.');
      expect(result.prefix).toBe('');
      expect(result.quoteDelimiter).toBe('"""');
      expect(result.closingQuoteOwnLine).toBe(false);
    });

    it("recognizes single-quote triple delimiters ('''...''')", () => {
      const source = "'''A short summary.'''";
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.text).toBe('A short summary.');
      expect(result.quoteDelimiter).toBe("'''");
    });

    it('preserves an observed prefix, case included', () => {
      const source = 'U"""A short summary."""';
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.prefix).toBe('U');
      expect(result.text).toBe('A short summary.');
    });

    it('falls back to region.indentColumn for commonIndent with no continuation lines', () => {
      // `region.span` -- and so `sliceSpanText` -- never includes the
      // docstring's own leading indentation in real usage (it always
      // starts at the quote itself); `indentColumn` is a separate field
      // the caller (`discoverRegions`) derives independently. Simulated
      // here by passing `indentColumn` directly rather than indenting
      // `source`.
      const source = '"""A short summary."""';
      const result = dissolveDocstring(regionForWholeSource(source, 4), source);
      expect(result.commonIndent).toBe(4);
    });
  });

  describe('summary-line convention', () => {
    it('keeps the summary on the opening line when observed that way', () => {
      const source = ['"""Summary.', '', 'More text.', '"""'].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      // A non-blank first dissolved line means the summary shared the
      // opening quote's physical line -- see `./emit-docstring.ts`.
      expect(result.text.split('\n')[0]).toBe('Summary.');
    });

    it('reproduces the quote-alone-on-its-own-line convention as a leading blank line', () => {
      const source = ['"""', 'Summary starts on its own line.', '"""'].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.text.split('\n')[0]).toBe('');
      expect(result.text.split('\n')[1]).toBe('Summary starts on its own line.');
    });
  });

  describe('closing delimiter placement', () => {
    it('detects the closing quote sharing its line with trailing content', () => {
      const source = ['"""Summary.', '', 'More text."""'].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.closingQuoteOwnLine).toBe(false);
      expect(result.text).toBe('Summary.\n\nMore text.');
    });

    it('detects the closing quote alone on its own line and excludes its indentation from text', () => {
      const source = ['"""Summary.', '', '    More text.', '    """'].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.closingQuoteOwnLine).toBe(true);
      expect(result.text).toBe('Summary.\n\nMore text.');
    });

    it('preserves a genuine blank line immediately before a closing-own-line delimiter', () => {
      const source = ['"""Summary.', '', '    More text.', '', '    """'].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.closingQuoteOwnLine).toBe(true);
      expect(result.text).toBe('Summary.\n\nMore text.\n');
    });
  });

  describe('PEP 257 common-indent stripping', () => {
    it('strips the minimum indentation shared by every line after the first', () => {
      const source = [
        '"""Summary.',
        '',
        '    Body line one.',
        '        Nested more.',
        '    """',
      ].join('\n');
      const result = dissolveDocstring(regionForWholeSource(source), source);
      expect(result.commonIndent).toBe(4);
      expect(result.text).toBe('Summary.\n\nBody line one.\n    Nested more.');
    });

    it('computes commonIndent independently of region.indentColumn when the source is inconsistently indented', () => {
      const source = ['"""Summary.', '  Body indented only two spaces.', '  """'].join('\n');
      // region.indentColumn (8) intentionally does not match the body's
      // own actual indentation (2) -- dissolve should trust what it
      // observes in the text, not the region's own start column.
      const result = dissolveDocstring(regionForWholeSource(source, 8), source);
      expect(result.commonIndent).toBe(2);
      expect(result.text).toBe('Summary.\nBody indented only two spaces.');
    });
  });
});
