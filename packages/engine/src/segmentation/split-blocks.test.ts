import { describe, expect, it } from 'vitest';
import type { Block } from '../types/document.js';
import { splitBlocks } from './split-blocks.js';

function words(block: Block): string[] {
  if (block.type !== 'paragraph') {
    throw new Error(`expected a paragraph block, got '${block.type}'`);
  }
  return block.atoms.map((a) => a.text);
}

describe('splitBlocks — blank lines and paragraphs', () => {
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
