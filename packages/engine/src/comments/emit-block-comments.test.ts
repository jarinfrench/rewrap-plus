import { describe, expect, it } from 'vitest';
import type { LanguageDescriptor } from '../types/adapter.js';
import type { LogicalDocument } from '../types/document.js';
import { emitBlockComments } from './emit-block-comments.js';

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

const INDENT_ALIGNED_DESCRIPTOR: LanguageDescriptor = {
  ...JSDOC_DESCRIPTOR,
  comments: {
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'indent' },
    neverReflow: [],
  },
};

function paragraph(text: string, indentColumn = 0): LogicalDocument {
  const atoms = text.split(' ').map((word) => ({ text: word, width: word.length, breakBefore: false }));
  return { blocks: [{ type: 'paragraph', atoms }], meta: { indentColumn } };
}

describe('emitBlockComments', () => {
  it('throws when the descriptor declares no comments.block', () => {
    const descriptor: LanguageDescriptor = { ...JSDOC_DESCRIPTOR, comments: { neverReflow: [] } };
    expect(() => emitBlockComments(paragraph('x'), 80, descriptor)).toThrow(
      /declares no comments\.block/,
    );
  });

  it('emits a short comment as a single line when it fits', () => {
    const result = emitBlockComments(paragraph('hello world'), 40, JSDOC_DESCRIPTOR);
    expect(result).toBe('/** hello world */');
  });

  it('emits the plain delimiter pair as a single line with no continuation marker', () => {
    const result = emitBlockComments(paragraph('hello world'), 40, PLAIN_DESCRIPTOR);
    expect(result).toBe('/* hello world */');
  });

  it('expands to multi-line JSDoc form when the content does not fit on one line', () => {
    const result = emitBlockComments(
      paragraph('this comment is much too long to fit on a single physical line'),
      30,
      JSDOC_DESCRIPTOR,
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('/**');
    expect(lines[lines.length - 1]).toBe(' */');
    for (const line of lines.slice(1, -1)) {
      expect(line.startsWith(' * ')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });

  it('aligns continuation lines and the closing delimiter one column past the indent by default', () => {
    const result = emitBlockComments(
      paragraph('this needs multiple lines to fit within the limit given', 4),
      25,
      JSDOC_DESCRIPTOR,
    );
    const lines = result.split('\n');
    // Every continuation/close line (everything after the open line,
    // which never spells out its own indent — see emitLineComments'
    // analogous convention) starts with indentColumn + 1 spaces.
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' '.repeat(5))).toBe(true);
      expect(line.startsWith(' '.repeat(6))).toBe(false);
    }
  });

  it("aligns flush with the region's own indent when alignContinuation is 'indent'", () => {
    const result = emitBlockComments(
      paragraph('this needs multiple lines to fit within the limit given', 4),
      25,
      INDENT_ALIGNED_DESCRIPTOR,
    );
    const lines = result.split('\n');
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' '.repeat(4))).toBe(true);
      expect(line.startsWith(' '.repeat(5))).toBe(false);
    }
  });

  it('expands the plain delimiter pair to multi-line form with no continuation marker', () => {
    const result = emitBlockComments(
      paragraph('this comment is much too long to fit on a single physical line'),
      30,
      PLAIN_DESCRIPTOR,
    );
    const lines = result.split('\n');
    expect(lines[0]).toBe('/*');
    expect(lines[lines.length - 1]).toBe(' */');
    for (const line of lines.slice(1, -1)) {
      expect(line.startsWith(' *')).toBe(false);
    }
  });

  it('never leaves trailing whitespace after a bare continuation marker on a blank paragraph-separator line', () => {
    const doc: LogicalDocument = {
      blocks: [
        { type: 'paragraph', atoms: [{ text: 'one', width: 3, breakBefore: true }] },
        { type: 'blank' },
        { type: 'paragraph', atoms: [{ text: 'two', width: 3, breakBefore: true }] },
      ],
      meta: { indentColumn: 0 },
    };
    const result = emitBlockComments(doc, 40, JSDOC_DESCRIPTOR);
    const lines = result.split('\n');
    expect(lines).toContain(' *');
    for (const line of lines) {
      expect(line).not.toMatch(/[ \t]$/);
    }
  });
});
