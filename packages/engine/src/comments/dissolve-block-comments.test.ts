import { describe, expect, it } from 'vitest';
import type { LanguageDescriptor } from '../types/adapter.js';
import type { WrappableRegion } from '../types/region.js';
import { dissolveBlockComments } from './dissolve-block-comments.js';

const JSDOC_DESCRIPTOR: LanguageDescriptor = {
  id: 'test-lang',
  grammarWasm: 'unused.wasm',
  queries: { comments: '(comment) @comment', strings: '(string) @string' },
  comments: {
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },
    neverReflow: [],
  },
  strings: {
    quotes: [{ delimiter: '"', multiline: false, escapes: true }],
    prefixes: [],
    rawForms: [],
    escapes: { sequences: [] },
    placeholders: [],
    concatenation: { style: 'implicit' },
  },
};

const PLAIN_DESCRIPTOR: LanguageDescriptor = {
  ...JSDOC_DESCRIPTOR,
  comments: { block: { open: '/*', close: '*/' }, neverReflow: [] },
};

/**
 * Builds a `WrappableRegion` whose span covers the *entire* `source` —
 * every test in this file uses a `source` that's nothing but the block
 * comment itself, so `sliceSpanText` always returns `source` back
 * unchanged, and there's no risk of hand-computed row/column offsets
 * drifting from what the text actually contains.
 */
function regionForWholeSource(source: string, indentColumn = 0): WrappableRegion {
  const lines = source.split('\n');
  const endRow = lines.length - 1;
  const endColumn = lines[endRow]!.length;
  const span = { startByte: 0, endByte: 0, startRow: 0, startColumn: 0, endRow, endColumn };
  return {
    kind: 'blockComment',
    span,
    parts: [span],
    rawText: source,
    indentColumn,
    languageId: 'test-lang',
  };
}

function words(doc: ReturnType<typeof dissolveBlockComments>): string[] {
  const block = doc.blocks[0];
  if (!block || (block.type !== 'paragraph' && block.type !== 'listItem')) {
    throw new Error(`expected an atom-bearing first block, got '${block?.type}'`);
  }
  return block.atoms.map((a) => a.text);
}

describe('dissolveBlockComments', () => {
  it('throws when the descriptor declares no comments.block', () => {
    const descriptor: LanguageDescriptor = { ...JSDOC_DESCRIPTOR, comments: { neverReflow: [] } };
    const source = '/** x */';
    expect(() => dissolveBlockComments(regionForWholeSource(source), source, descriptor)).toThrow(
      /declares no comments\.block/,
    );
  });

  describe('single-line form', () => {
    it('strips both delimiters and trims the content', () => {
      const source = '/** hello world */';
      const doc = dissolveBlockComments(regionForWholeSource(source), source, JSDOC_DESCRIPTOR);
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0]!.type).toBe('paragraph');
      expect(words(doc)).toEqual(['hello', 'world']);
    });

    it('works with the plain (no continuation prefix) delimiter pair', () => {
      const source = '/* hello world */';
      const doc = dissolveBlockComments(regionForWholeSource(source), source, PLAIN_DESCRIPTOR);
      expect(words(doc)).toEqual(['hello', 'world']);
    });
  });

  describe('multi-line JSDoc-shaped form', () => {
    it('strips the open/close delimiter lines and the leading * on every interior line', () => {
      const source = ['/**', ' * hello world', ' * second line', ' */'].join('\n');
      const doc = dissolveBlockComments(regionForWholeSource(source), source, JSDOC_DESCRIPTOR);
      expect(doc.blocks).toHaveLength(1);
      expect(words(doc)).toEqual(['hello', 'world', 'second', 'line']);
    });

    it('carries the region indentColumn through to DocMeta', () => {
      const source = ['/**', ' * x', ' */'].join('\n');
      const doc = dissolveBlockComments(
        regionForWholeSource(source, 4),
        source,
        JSDOC_DESCRIPTOR,
      );
      expect(doc.meta.indentColumn).toBe(4);
    });

    it('does not register the open/close-only lines as a blank-line paragraph break', () => {
      const source = ['/**', ' * one paragraph', ' *', ' * two paragraph', ' */'].join('\n');
      const doc = dissolveBlockComments(regionForWholeSource(source), source, JSDOC_DESCRIPTOR);
      // Exactly two paragraphs, separated by the blank `*` line — not
      // three, which would mean the open/close lines were mistakenly
      // treated as blank content of their own.
      expect(doc.blocks.filter((b) => b.type === 'paragraph')).toHaveLength(2);
    });

    it('still strips leading indentation from a continuation line missing the prefix', () => {
      const source = ['/**', '    stray line without a star', ' */'].join('\n');
      const doc = dissolveBlockComments(regionForWholeSource(source), source, JSDOC_DESCRIPTOR);
      expect(words(doc)).toEqual(['stray', 'line', 'without', 'a', 'star']);
    });

    it('works with the plain (no continuation prefix) delimiter pair across multiple lines', () => {
      const source = ['/*', '   hello world', '   second line', '*/'].join('\n');
      const doc = dissolveBlockComments(regionForWholeSource(source), source, PLAIN_DESCRIPTOR);
      expect(words(doc)).toEqual(['hello', 'world', 'second', 'line']);
    });
  });
});
