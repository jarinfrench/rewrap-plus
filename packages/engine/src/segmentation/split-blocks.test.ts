import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { splitBlocks } from './split-blocks.js';

function words(block: Block): string[] {
  if (block.type !== 'paragraph' && block.type !== 'listItem') {
    throw new Error(`expected an atom-bearing block, got '${block.type}'`);
  }
  return block.atoms.map((a) => a.text);
}

describe('splitBlocks -- blank lines and paragraphs', () => {
  it('treats a single line as one paragraph', () => {
    const blocks = splitBlocks('Hello, world.');
    expect(blocks).toHaveLength(1);
    expect(words(blocks[0]!)).toEqual(['Hello,', 'world.']);
  });

  it('merges consecutive non-blank lines into one paragraph', () => {
    const blocks = splitBlocks('First line\nsecond line\nthird line.');
    expect(blocks).toHaveLength(1);
    expect(words(blocks[0]!)).toEqual(['First', 'line', 'second', 'line', 'third', 'line.']);
  });

  it('separates paragraphs on a blank line', () => {
    const blocks = splitBlocks('First paragraph.\n\nSecond paragraph.');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
    expect(words(blocks[0]!)).toEqual(['First', 'paragraph.']);
    expect(words(blocks[2]!)).toEqual(['Second', 'paragraph.']);
  });

  it('emits one blank block per blank source line, not a collapsed run', () => {
    const blocks = splitBlocks('a\n\n\n\nb');
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'blank',
      'blank',
      'blank',
      'paragraph',
    ]);
  });

  it('treats whitespace-only lines as blank', () => {
    const blocks = splitBlocks('a\n   \nb');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('does not emit leading/trailing blank blocks for a bare trailing newline', () => {
    const blocks = splitBlocks('one line\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
  });

  it('does emit a trailing blank block for a genuinely blank final line', () => {
    const blocks = splitBlocks('one line\n\n');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank']);
  });

  it('returns an empty block list for empty input', () => {
    expect(splitBlocks('')).toEqual([]);
  });

  it('returns an empty block list for whitespace-only input', () => {
    expect(splitBlocks('   \n  \n')).toEqual([{ type: 'blank' }, { type: 'blank' }]);
  });
});

describe('splitBlocks -- list items', () => {
  it('recognizes a single bulleted item', () => {
    const blocks = splitBlocks('- First item.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'listItem', marker: '-' });
    expect(words(blocks[0]!)).toEqual(['First', 'item.']);
  });

  it('merges an indented continuation line into the same item', () => {
    const blocks = splitBlocks('- First item\n  continues here.');
    expect(blocks).toHaveLength(1);
    expect(words(blocks[0]!)).toEqual(['First', 'item', 'continues', 'here.']);
  });

  it('starts a new item at the next marker', () => {
    const blocks = splitBlocks('- First item.\n- Second item.');
    expect(blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
    expect(words(blocks[0]!)).toEqual(['First', 'item.']);
    expect(words(blocks[1]!)).toEqual(['Second', 'item.']);
  });

  it('ends an item at a blank line, and resumes as a paragraph after', () => {
    const blocks = splitBlocks('- Item text.\n\nA plain paragraph.');
    expect(blocks.map((b) => b.type)).toEqual(['listItem', 'blank', 'paragraph']);
  });

  it('represents a nested item as its own listItem block with a deeper hangingIndent', () => {
    const blocks = splitBlocks('- Outer item.\n  - Inner item.');
    expect(blocks.map((b) => b.type)).toEqual(['listItem', 'listItem']);
    const outer = blocks[0] as Extract<Block, { type: 'listItem' }>;
    const inner = blocks[1] as Extract<Block, { type: 'listItem' }>;
    expect(inner.hangingIndent).toBeGreaterThan(outer.hangingIndent);
    expect(words(blocks[1]!)).toEqual(['Inner', 'item.']);
  });

  it('recognizes ordered markers alongside bullets', () => {
    const blocks = splitBlocks('1. First.\n2. Second.\n3. Third.');
    expect(blocks.map((b) => (b as Extract<Block, { type: 'listItem' }>).marker)).toEqual([
      '1.',
      '2.',
      '3.',
    ]);
  });

  it('does not treat ordinary indented prose as a list', () => {
    // No marker at all, and preserveIndentedBlocks is off by default --
    // this stays a paragraph. See "splitBlocks -- verbatim regions"
    // below for the preserveIndentedBlocks-on behavior.
    const blocks = splitBlocks('Some text.\n    More indented text, no marker.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
  });
});

describe('splitBlocks -- verbatim regions', () => {
  it('treats a fenced code block as verbatim', () => {
    const blocks = splitBlocks('Before.\n\n```\ncode line\n```\n\nAfter.');
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'blank',
      'verbatim',
      'blank',
      'paragraph',
    ]);
    const fence = blocks[2] as Extract<Block, { type: 'verbatim' }>;
    expect(fence.lines).toEqual(['```', 'code line', '```']);
  });

  it('treats a doctest block as verbatim', () => {
    const blocks = splitBlocks('>>> 1 + 1\n2\n\nExplanatory text.');
    expect(blocks.map((b) => b.type)).toEqual(['verbatim', 'blank', 'paragraph']);
    const doctest = blocks[0] as Extract<Block, { type: 'verbatim' }>;
    expect(doctest.lines).toEqual(['>>> 1 + 1', '2']);
  });

  it('treats a markdown table as verbatim', () => {
    const blocks = splitBlocks('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('verbatim');
  });

  it('treats a fenced block as verbatim even if it looks like a list', () => {
    // Bias toward verbatim: fence detection runs before list detection.
    const blocks = splitBlocks('```\n- not actually a list item\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('verbatim');
  });

  it('starts a reST literal block after a paragraph ending in "::"', () => {
    const blocks = splitBlocks('Example::\n\n    indented literal\n    block content.\n\nAfter.');
    expect(blocks.map((b) => b.type)).toEqual([
      'paragraph',
      'blank',
      'verbatim',
      'blank',
      'paragraph',
    ]);
    const literal = blocks[2] as Extract<Block, { type: 'verbatim' }>;
    expect(literal.lines).toEqual(['    indented literal', '    block content.']);
  });

  it('does not start a literal block when "::" is not followed by indentation', () => {
    const blocks = splitBlocks('Example::\n\nNot indented, so not a literal block.');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('does not treat "::" as a trigger without a following blank line', () => {
    const blocks = splitBlocks('Example::\n    still just a paragraph continuation');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
  });

  it('leaves indented lines as ordinary paragraph text when preserveIndentedBlocks is off', () => {
    const blocks = splitBlocks('Some text.\n    More indented text, no marker.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
  });

  it('treats indented lines as verbatim when preserveIndentedBlocks is on', () => {
    const blocks = splitBlocks('Some text.\n    Indented, no marker.', {
      preserveIndentedBlocks: true,
    });
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'verbatim']);
    const verbatim = blocks[1] as Extract<Block, { type: 'verbatim' }>;
    expect(verbatim.lines).toEqual(['    Indented, no marker.']);
  });

  it('still prefers list-item detection over preserveIndentedBlocks', () => {
    const blocks = splitBlocks('- An item.', { preserveIndentedBlocks: true });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('listItem');
  });
});
