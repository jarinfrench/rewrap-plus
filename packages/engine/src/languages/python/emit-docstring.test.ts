import { describe, expect, it } from 'vitest';
import type { Block } from '../../types/document.js';
import type { DocstringQuoteMeta } from './dissolve-docstring.js';
import { emitDocstring } from './emit-docstring.js';

function paragraph(text: string): Block {
  const atoms = text.split(' ').map((word) => ({ text: word, width: word.length, breakBefore: false }));
  return { type: 'paragraph', atoms };
}

function meta(overrides: Partial<DocstringQuoteMeta> = {}): DocstringQuoteMeta {
  return {
    prefix: '',
    quoteDelimiter: '"""',
    indentColumn: 0,
    commonIndent: 0,
    closingQuoteOwnLine: false,
    ...overrides,
  };
}

describe('emitDocstring', () => {
  it('emits a short single-block docstring on one physical line', () => {
    const result = emitDocstring([paragraph('A short summary.')], meta(), 80);
    expect(result).toBe('"""A short summary."""');
  });

  it('reproduces the summary-on-opening-line convention', () => {
    const blocks: Block[] = [paragraph('Summary.'), { type: 'blank' }, paragraph('More text.')];
    const result = emitDocstring(blocks, meta({ indentColumn: 4, commonIndent: 4 }), 80);
    expect(result).toBe('"""Summary.\n\n    More text."""');
  });

  it('reproduces the quote-alone-on-its-own-line convention when the first block is blank', () => {
    // A leading `blank` block is exactly what a dissolved text starting
    // with an empty line looks like (dissolve's own reproduction of "the
    // opening quote sat alone" — see `./dissolve-docstring.test.ts`'s
    // "quote-alone" case). With `closingQuoteOwnLine: false` (the
    // default here), the closing delimiter attaches to whatever the
    // *last* physical line ends up being — the content line, not the
    // leading blank one.
    const blocks: Block[] = [{ type: 'blank' }, paragraph('Starts on its own line.')];
    const result = emitDocstring(blocks, meta({ indentColumn: 4, commonIndent: 4 }), 80);
    expect(result).toBe('"""\n\n    Starts on its own line."""');
  });

  it('places the closing delimiter on its own line when closingQuoteOwnLine is true', () => {
    const blocks: Block[] = [paragraph('Summary.')];
    const result = emitDocstring(blocks, meta({ indentColumn: 4, commonIndent: 4, closingQuoteOwnLine: true }), 80);
    expect(result).toBe('"""Summary.\n    """');
  });

  it('preserves the observed prefix', () => {
    const result = emitDocstring([paragraph('Summary.')], meta({ prefix: 'U' }), 80);
    expect(result).toBe('U"""Summary."""');
  });

  it('wraps long content across multiple lines within the column limit', () => {
    const blocks: Block[] = [paragraph('one two three four five six seven eight nine ten')];
    const result = emitDocstring(blocks, meta(), 20);
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  describe('quote-collision safety', () => {
    it('inserts a separating space when content would end with the quote character', () => {
      const blocks: Block[] = [paragraph('a value of "x"')];
      const result = emitDocstring(blocks, meta(), 80);
      // Without protection this would produce `x""""` — four quote
      // characters in a row.
      expect(result).toBe('"""a value of "x" """');
    });

    it('inserts a separating space when content would end with an odd number of backslashes', () => {
      const blocks: Block[] = [paragraph('a trailing backslash\\')];
      const result = emitDocstring(blocks, meta(), 80);
      expect(result).toBe('"""a trailing backslash\\ """');
    });

    it('does not insert a separator for an even number of trailing backslashes', () => {
      const blocks: Block[] = [paragraph('an escaped backslash\\\\')];
      const result = emitDocstring(blocks, meta(), 80);
      expect(result).toBe('"""an escaped backslash\\\\"""');
    });

    it('inserts a separating space when the summary would start with the quote character', () => {
      const blocks: Block[] = [paragraph('"quoted" at the start')];
      const result = emitDocstring(blocks, meta(), 80);
      expect(result).toBe('""" "quoted" at the start"""');
    });

    it('does not insert a separator when closingQuoteOwnLine is true, regardless of trailing content', () => {
      const blocks: Block[] = [paragraph('ends with a quote "')];
      const result = emitDocstring(blocks, meta({ commonIndent: 0, closingQuoteOwnLine: true }), 80);
      expect(result).toBe('"""ends with a quote "\n"""');
    });
  });

  it('restores a listItem block’s bullet marker inside a docstring body', () => {
    const blocks: Block[] = [
      paragraph('Summary.'),
      { type: 'blank' },
      { type: 'listItem', marker: '-', hangingIndent: 2, atoms: [{ text: 'one', width: 3, breakBefore: false }] },
    ];
    const result = emitDocstring(blocks, meta(), 80);
    expect(result).toBe('"""Summary.\n\n- one"""');
  });
});
