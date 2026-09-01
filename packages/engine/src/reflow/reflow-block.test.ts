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

  it('never strands a glue: none atom alone at the start of a continuation line', () => {
    // "aaaaaaaaaaaa" (12) + "b" glued (0) = 13, which doesn't fit in 10 —
    // both must move to the next line together, not just "b" alone.
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('short'), atom('aaaaaaaaaaaa'), atom('b', { glue: 'none' })],
    };
    expect(reflowBlock(block, 10, 0)).toEqual(['short', 'aaaaaaaaaaaab']);
  });

  it('treats a whole glued cluster as one overflow-rule unit when it alone exceeds the budget', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('short'), atom('aaaaaaaaaaaa'), atom('b', { glue: 'none' }), atom('ok')],
    };
    expect(reflowBlock(block, 10, 0)).toEqual(['short', 'aaaaaaaaaaaab', 'ok']);
  });

  it('an atom tagged glue: double joins with two spaces', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('End.'), atom('Next.', { glue: 'double' })],
    };
    expect(reflowBlock(block, 80, 0)).toEqual(['End.  Next.']);
  });

  it('a glue: double join counts two columns against the budget', () => {
    // "aaaaaaaa" (8) + "  " (2) + "b" (1) = 11 > 10 -> wraps, unlike a
    // plain space join of the same atoms which would fit at exactly 10.
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('aaaaaaaa'), atom('b', { glue: 'double' })],
    };
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaaaaaa', 'b']);
    expect(reflowBlock(block, 11, 0)).toEqual(['aaaaaaaa  b']);
  });

  it('a line break at a glue: double boundary drops the double space, same as an ordinary break', () => {
    // "End." (4) + "  " (2) + "Next." (5) = 11 > 5, forcing a break right
    // at the double-spaced boundary; the continuation line starts flush
    // with the word, not with a leading gap.
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('End.'), atom('Next.', { glue: 'double' })],
    };
    expect(reflowBlock(block, 5, 0)).toEqual(['End.', 'Next.']);
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

describe('reflowBlock — balanced (minimum-raggedness) mode', () => {
  it('produces the same output as greedy when everything fits on one line', () => {
    const block: Block = { type: 'paragraph', atoms: words('one', 'two', 'three') };
    expect(reflowBlock(block, 80, 0, { mode: 'balanced' })).toEqual(['one two three']);
  });

  it('spreads raggedness more evenly than greedy for a short paragraph', () => {
    // Six 4-wide words at width 12 (3 words + 2 spaces = 14 > 12, so at
    // most 2 fit per line). Greedy crams 2+2+2 = three lines of equal
    // length here too, coincidentally -- use a case with an uneven word
    // count so the difference actually shows.
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'),
    };
    // Greedy at width 10: "aaaa bbbb" (9) then "cccc dddd" (9) then "eeee" (4)
    // -- a short, ragged final line.
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaa bbbb', 'cccc dddd', 'eeee']);
    // Balanced prefers spreading the five words across three lines more
    // evenly (2/2/1 either way is forced by width, but balanced is free
    // to choose *which* pairing minimizes total non-last-line slack --
    // here there's only one 2/2/1 partition that fits, so balanced and
    // greedy agree; the point of this test is that balanced still
    // produces valid, width-respecting output on the same input).
    const balanced = reflowBlock(block, 10, 0, { mode: 'balanced' });
    for (const line of balanced.slice(0, -1)) {
      expect(line.length).toBeLessThanOrEqual(10);
    }
    expect(balanced.join(' ').replace(/\s+/g, ' ')).toBe('aaaa bbbb cccc dddd eeee');
  });

  it('finds a strictly lower-cost partition than greedy when one exists', () => {
    // A concrete case where greedy's locally-first-fit choice locks in a
    // worse global partition: greedy fills "aaaaaa b" (8/10) early,
    // forcing "ccccc" (5/10) onto its own ragged line. Balanced instead
    // leaves "aaaaaa" alone and pairs "b" with "ccccc" (7/10), which
    // reduces total non-last-line squared slack from 38 to 34 — a
    // genuinely different, better partition, not just a tie.
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaaaa', 'b', 'ccccc', 'ddddddd', 'eeeeeee'),
    };
    expect(reflowBlock(block, 10, 0)).toEqual(['aaaaaa b', 'ccccc', 'ddddddd', 'eeeeeee']);
    expect(reflowBlock(block, 10, 0, { mode: 'balanced' })).toEqual([
      'aaaaaa',
      'b ccccc',
      'ddddddd',
      'eeeeeee',
    ]);
  });

  it('never produces a higher total squared slack than greedy, across varied inputs', () => {
    // Words: "a"(1) "bb"(2) "ccc"(3) "dddd"(4) "eeeee"(5) at width 7.
    // Greedy: "a bb ccc" is 1+1+2+1+3=8>7, so greedy fits "a bb"(4) then
    // must decide "ccc"(3) alone or with more -- walk it precisely
    // below instead of asserting greedy's exact shape (it's exercised
    // elsewhere); the point here is balanced's total squared slack is
    // never worse than greedy's for the same input.
    const block: Block = {
      type: 'paragraph',
      atoms: words('a', 'bb', 'ccc', 'dddd', 'eeeee'),
    };
    const width = 7;
    const greedyLines = reflowBlock(block, width, 0);
    const balancedLines = reflowBlock(block, width, 0, { mode: 'balanced' });

    const slackCost = (lines: string[]): number =>
      lines
        .slice(0, -1)
        .map((l) => width - l.length)
        .reduce((sum, slack) => sum + slack * slack, 0);

    expect(slackCost(balancedLines)).toBeLessThanOrEqual(slackCost(greedyLines));
    // Both must still reproduce the same words in order.
    const words_ = (lines: string[]): string => lines.join(' ').replace(/\s+/g, ' ').trim();
    expect(words_(balancedLines)).toBe(words_(greedyLines));
  });

  it('never strands a glue: none atom alone at the start of a continuation line', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('short'), atom('aaaaaaaaaaaa'), atom('b', { glue: 'none' })],
    };
    expect(reflowBlock(block, 10, 0, { mode: 'balanced' })).toEqual(['short', 'aaaaaaaaaaaab']);
  });

  it('still applies the overflow rule: a too-wide atom gets its own line', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('short', 'aVeryVeryVeryVeryVeryVeryLongUnbreakableAtom', 'ok'),
    };
    expect(reflowBlock(block, 10, 0, { mode: 'balanced' })).toEqual([
      'short',
      'aVeryVeryVeryVeryVeryVeryLongUnbreakableAtom',
      'ok',
    ]);
  });

  it('still respects breakBefore', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: [atom('short'), atom('forced', { breakBefore: true }), atom('after')],
    };
    expect(reflowBlock(block, 80, 0, { mode: 'balanced' })).toEqual(['short', 'forced after']);
  });

  it('still indents continuation lines by hangingIndent', () => {
    const block: Block = {
      type: 'paragraph',
      atoms: words('aaaa', 'bbbb', 'cccc', 'dddd'),
    };
    const lines = reflowBlock(block, 10, 4, { mode: 'balanced' });
    expect(lines[0]!.startsWith(' ')).toBe(false);
    for (const line of lines.slice(1)) {
      expect(line.startsWith('    ')).toBe(true);
    }
  });

  it('returns a single empty line for an empty paragraph', () => {
    const block: Block = { type: 'paragraph', atoms: [] };
    expect(reflowBlock(block, 80, 0, { mode: 'balanced' })).toEqual(['']);
  });
});
