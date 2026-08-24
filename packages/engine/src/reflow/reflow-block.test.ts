import { describe, expect, it } from 'vitest';
import type { Atom, Block } from '../types/document.js';
import { reflowBlock } from './reflow-block.js';

function atom(text: string, overrides: Partial<Atom> = {}): Atom {
  return { text, width: text.length, breakBefore: false, ...overrides };
}

function words(...texts: string[]): Atom[] {
  return texts.map((t) => atom(t));
}

describe('reflowBlock — pass-through block kinds', () => {
  it('reflows a blank block to a single empty line', () => {
    expect(reflowBlock({ type: 'blank' }, 80, 0)).toEqual(['']);
  });

  it('passes verbatim lines through untouched, regardless of width', () => {
    const block: Block = {
      type: 'verbatim',
      lines: ['a very very very very very very very very very long line indeed', 'short'],
    };
    expect(reflowBlock(block, 20, 0)).toEqual(block.lines);
  });

  it('passes a section header through as one line, regardless of width', () => {
    const block: Block = { type: 'sectionHeader', text: 'Args:' };
    expect(reflowBlock(block, 3, 0)).toEqual(['Args:']);
  });
});

describe('reflowBlock — greedy fill for paragraph', () => {
  it('fits everything on one line when it all fits', () => {
    const block: Block = { type: 'paragraph', atoms: words('one', 'two', 'three') };
    expect(reflowBlock(block, 80, 0)).toEqual(['one two three']);
  });

  it('wraps at the last atom that still fits within the width', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaa', 'bbbb', 'cccc', 'dddd'), // each 4 wide, joined by 1-wide spaces
    };
    // "aaaa bbbb" = 9, adding " cccc" (5) would be 14 > 10 -> wrap
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('places an atom wider than the available width alone on its line (overflow rule)', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('short', 'https://example.com/a/very/long/path/that/exceeds/the/limit', 'ok'),
    };
    const lines = reflowBlock(block, 10, 0);
    expect(lines).toEqual([
      'short',
      'https://example.com/a/very/long/path/that/exceeds/the/limit',
      'ok',
    ]);
    // The overflowing atom's line legitimately exceeds the limit; the
    // other lines do not.
    expect(lines[0]!.length).toBeLessThanOrEqual(10);
    expect(lines[2]!.length).toBeLessThanOrEqual(10);
  });

  it('places two consecutive overflowing atoms on separate lines, each alone', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbb'),
    };
    expect(reflowBlock(block, 5, 0)).toEqual(['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbb']);
  });

  it('indents every line after the first by hangingIndent spaces', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaa', 'bbbb', 'cccc', 'dddd'),
    };
    // First line budget 10 (no indent yet); continuation budget is
    // 10 - 4 = 6, so only one 4-wide atom fits per continuation line.
    const lines = reflowBlock(block, 10, 4);
    expect(lines).toEqual(['aaaa bbbb', '    cccc', '    dddd']);
  });

  it('an atom tagged glue: none joins with no space', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('{name}'), atom(',', { glue: 'none' }), atom('welcome!')],
    };
    expect(reflowBlock(block, 80, 0)).toEqual(['{name}, welcome!']);
  });

  it('a glue: none atom does not count a joining space against the budget', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('aaaaaaaa'), atom('b', { glue: 'none' })], // 8 + 0 + 1 = 9, not 10
    };
    expect(reflowBlock(block, 9, 0)).toEqual(['aaaaaaaab']);
  });

  it('an atom with breakBefore forces a new line even when the current one has room', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('short'), atom('forced', { breakBefore: true }), atom('after')],
    };
    expect(reflowBlock(block, 80, 0)).toEqual(['short', 'forced after']);
  });

  it('breakBefore on the very first atom does not produce a spurious leading blank line', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('first', { breakBefore: true }), atom('second')],
    };
    expect(reflowBlock(block, 80, 0)).toEqual(['first second']);
  });

  it('returns a single empty line for a paragraph with no atoms', () => {
    const block: Block = { type: 'paragraph', atoms: [] };
    expect(reflowBlock(block, 80, 0)).toEqual(['']);
  });
});

describe('reflowBlock — greedy fill for listItem and fieldEntry', () => {
  it("reflows a listItem's atoms without prepending its marker", () => {
    const block: Block = {
      type: 'listItem',
      marker: '-',
      hangingIndent: 2,
      atoms: words('First', 'item', 'of', 'the', 'list.'),
    };
    // Caller is responsible for supplying hangingIndent (here matching
    // the block's own field, but reflowBlock doesn't read it directly).
    expect(reflowBlock(block, 12, block.hangingIndent)).toEqual([
      'First item',
      '  of the',
      '  list.',
    ]);
  });

  it("reflows a fieldEntry's atoms without prepending its label", () => {
    const block: Block = {
      type: 'fieldEntry',
      label: ':param x:',
      hangingIndent: 4,
      atoms: words('The', 'x', 'coordinate,', 'in', 'pixels.'),
    };
    expect(reflowBlock(block, 15, block.hangingIndent)).toEqual([
      'The x',
      '    coordinate,',
      '    in pixels.',
    ]);
  });
});

describe('reflowBlock — width edge cases', () => {
  it('an atom exactly at the limit fits on the current line', () => {
    const block: Block = { type: 'paragraph', atoms: words('aaaaaaaaaa') }; // width 10
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaaaaaaaa']);
  });

  it('an atom exactly one over the limit still gets its own line and is allowed to overflow', () => {
    const block: Block = { type: 'paragraph', atoms: words('aaaaaaaaaaa') }; // width 11
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaaaaaaaaa']);
  });

  it('a second atom that would land exactly at the limit is kept on the same line', () => {
    const block: Block = { type: 'paragraph', atoms: words('aaaa', 'bbbbb') }; // 4 + 1 + 5 = 10
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaa bbbbb']);
  });

  it('a second atom that would land one over the limit wraps', () => {
    const block: Block = { type: 'paragraph', atoms: words('aaaa', 'bbbbbb') }; // 4 + 1 + 6 = 11
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaa', 'bbbbbb']);
  });

  it('hanging indent leaving fewer than 10 columns still produces valid, if cramped, output', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc', 'dddddddddd', 'eeeeeeeeee'),
    };
    // availableWidth 40 comfortably fits three 10-wide atoms on the
    // first line; hangingIndent 36 leaves only 4 columns for
    // continuation content, so each remaining atom overflows onto its
    // own line rather than being force-split.
    const lines = reflowBlock(block, 40, 36);
    expect(lines[0]).toBe('aaaaaaaaaa bbbbbbbbbb cccccccccc');
    expect(lines.slice(1)).toEqual([`${' '.repeat(36)}dddddddddd`, `${' '.repeat(36)}eeeeeeeeee`]);
  });

  it('handles CJK-width atoms (from real display width) against the column budget', () => {
    // "日本語" is 3 characters / 6 display columns (../segmentation/display-width.ts).
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('日本語', { width: 6 }), atom('text', { width: 4 })],
    };
    // 6 + 1 + 4 = 11 > 10 -> wraps
    expect(reflowBlock(block, 10, 0)).toEqual(['日本語', 'text']);
    // But both fit together within a wider budget.
    expect(reflowBlock(block, 11, 0)).toEqual(['日本語 text']);
  });

  it('a zero-width limit still terminates and gives every atom its own line', () => {
    const block: Block = { type: 'paragraph', atoms: words('a', 'b', 'c') };
    expect(reflowBlock(block, 0, 0)).toEqual(['a', 'b', 'c']);
  });
});
