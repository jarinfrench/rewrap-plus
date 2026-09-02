import { describe, expect, it } from 'vitest';
import type { Atom, Block, LogicalDocument } from './document.js';

function atom(text: string, overrides: Partial<Atom> = {}): Atom {
  return { text, width: text.length, breakBefore: false, ...overrides };
}

describe('Block', () => {
  it('models a paragraph as a sequence of atoms', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('Hello,'), atom('world.', { breakBefore: true, glue: 'space' })],
    };

    expect(block.type).toBe('paragraph');
    expect(block.atoms).toHaveLength(2);
  });

  it('models a list item with a marker and hanging indent', () => {
    const block: Block = {
      type: 'listItem',
      marker: '-',
      hangingIndent: 2,
      atoms: [atom('First'), atom('item.')],
    };

    expect(block.marker).toBe('-');
    expect(block.hangingIndent).toBe(2);
  });

  it('models a verbatim block as raw lines, not atoms', () => {
    const block: Block = {
      type: 'verbatim',
      lines: ['def f():', '    return 1'],
    };

    expect(block.lines).toHaveLength(2);
  });

  it('models a blank block with no payload', () => {
    const block: Block = { type: 'blank' };

    expect(block.type).toBe('blank');
  });

  it('models a section header as bare text', () => {
    const block: Block = { type: 'sectionHeader', text: 'Args:' };

    expect(block.text).toBe('Args:');
  });

  it('models a field entry with a label, hanging indent, and nested blocks', () => {
    const block: Block = {
      type: 'fieldEntry',
      label: 'x',
      hangingIndent: 4,
      blocks: [{ type: 'paragraph', atoms: [atom('The'), atom('x'), atom('coordinate.')] }],
    };

    expect(block.label).toBe('x');
    expect(block.blocks).toHaveLength(1);
    expect(block.blocks[0]).toEqual({
      type: 'paragraph',
      atoms: [atom('The'), atom('x'), atom('coordinate.')],
    });
  });
});

describe('LogicalDocument', () => {
  it('pairs a block sequence with metadata, dialect optional', () => {
    const doc: LogicalDocument = {
      blocks: [
        { type: 'paragraph', atoms: [atom('Summary line.')] },
        { type: 'blank' },
        { type: 'sectionHeader', text: 'Args:' },
        {
          type: 'fieldEntry',
          label: 'name',
          hangingIndent: 4,
          blocks: [{ type: 'paragraph', atoms: [atom('The'), atom('name.')] }],
        },
      ],
      meta: { indentColumn: 4, dialect: 'google' },
    };

    expect(doc.blocks).toHaveLength(4);
    expect(doc.meta.dialect).toBe('google');
  });

  it('allows an undialected document, e.g. a plain comment block', () => {
    const doc: LogicalDocument = {
      blocks: [{ type: 'paragraph', atoms: [atom('Just a comment.')] }],
      meta: { indentColumn: 0 },
    };

    expect(doc.meta.dialect).toBeUndefined();
  });
});
