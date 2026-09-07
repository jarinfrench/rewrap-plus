import { describe, expect, it } from 'vitest';
import { toLines } from './to-lines.js';
import {
  leadingWhitespaceLength,
  matchDoctestBlock,
  matchFencedCode,
  matchIndentedRun,
  matchTableBlock,
} from './verbatim.js';

describe('leadingWhitespaceLength', () => {
  it('counts leading spaces', () => {
    expect(leadingWhitespaceLength('    x')).toBe(4);
  });

  it('counts leading tabs', () => {
    expect(leadingWhitespaceLength('\t\tx')).toBe(2);
  });

  it('is zero for an unindented line', () => {
    expect(leadingWhitespaceLength('x')).toBe(0);
  });
});

describe('matchFencedCode', () => {
  it('matches a backtick fence with a matching close', () => {
    const lines = toLines('```\ncode line\n```\nafter');
    const match = matchFencedCode(lines, 0);
    expect(match?.lines).toEqual(['```', 'code line', '```']);
    expect(match?.nextIndex).toBe(3);
  });

  it('matches a tilde fence', () => {
    const lines = toLines('~~~\ncode\n~~~');
    const match = matchFencedCode(lines, 0);
    expect(match?.lines).toEqual(['~~~', 'code', '~~~']);
  });

  it('accepts an info string on the open fence', () => {
    const lines = toLines('```python\nx = 1\n```');
    const match = matchFencedCode(lines, 0);
    expect(match?.lines[0]).toBe('```python');
  });

  it('requires the close fence to use the same character', () => {
    const lines = toLines('```\nnot closed by tildes\n~~~\n```\nafter');
    const match = matchFencedCode(lines, 0);
    // ~~~ does not close a ``` fence -- consumes through the real close.
    expect(match?.lines).toEqual(['```', 'not closed by tildes', '~~~', '```']);
    expect(match?.nextIndex).toBe(4);
  });

  it('consumes to end of input when never closed (bias toward verbatim)', () => {
    const lines = toLines('```\nunterminated\nstill going');
    const match = matchFencedCode(lines, 0);
    expect(match?.lines).toEqual(['```', 'unterminated', 'still going']);
    expect(match?.nextIndex).toBe(3);
  });

  it('returns null when the line is not a fence', () => {
    expect(matchFencedCode(toLines('plain text'), 0)).toBeNull();
  });
});

describe('matchDoctestBlock', () => {
  it('matches a single prompt/output pair, stopping at a blank line', () => {
    const lines = toLines('>>> 1 + 1\n2\n\nafter');
    const match = matchDoctestBlock(lines, 0);
    expect(match?.lines).toEqual(['>>> 1 + 1', '2']);
    expect(match?.nextIndex).toBe(2);
  });

  it('includes continuation lines', () => {
    const lines = toLines('>>> if True:\n...     print(1)\n1');
    const match = matchDoctestBlock(lines, 0);
    expect(match?.lines).toEqual(['>>> if True:', '...     print(1)', '1']);
  });

  it('runs to end of input when never followed by a blank line', () => {
    const lines = toLines('>>> x\ny');
    const match = matchDoctestBlock(lines, 0);
    expect(match?.nextIndex).toBe(2);
  });

  it('returns null for a non-doctest line', () => {
    expect(matchDoctestBlock(toLines('plain text'), 0)).toBeNull();
  });
});

describe('matchTableBlock', () => {
  it('matches a header row, delimiter row, and body rows', () => {
    const lines = toLines('| A | B |\n|---|---|\n| 1 | 2 |\nafter');
    const match = matchTableBlock(lines, 0);
    expect(match?.lines).toEqual(['| A | B |', '|---|---|', '| 1 | 2 |']);
    expect(match?.nextIndex).toBe(3);
  });

  it('accepts alignment colons in the delimiter row', () => {
    const lines = toLines('| A |\n|:--:|');
    const match = matchTableBlock(lines, 0);
    expect(match?.lines).toHaveLength(2);
  });

  it('requires the second line to be a real delimiter row', () => {
    const lines = toLines('| A | B |\nnot a delimiter row');
    expect(matchTableBlock(lines, 0)).toBeNull();
  });

  it('returns null for a line with no pipe', () => {
    expect(matchTableBlock(toLines('plain text\n|---|'), 0)).toBeNull();
  });

  it('stops at the first non-table-row line', () => {
    const lines = toLines('| A |\n|---|\n| 1 |\n\n| not part of the table |');
    const match = matchTableBlock(lines, 0);
    expect(match?.nextIndex).toBe(3);
  });
});

describe('matchIndentedRun', () => {
  it('consumes a contiguous indented run', () => {
    const lines = toLines('    line one\n    line two\nback to margin');
    const match = matchIndentedRun(lines, 0);
    expect(match?.lines).toEqual(['    line one', '    line two']);
    expect(match?.nextIndex).toBe(2);
  });

  it('keeps interior blank lines but trims trailing ones', () => {
    const lines = toLines('    line one\n\n    line two\n\n\nback to margin');
    const match = matchIndentedRun(lines, 0);
    expect(match?.lines).toEqual(['    line one', '', '    line two']);
    expect(match?.nextIndex).toBe(3);
  });

  it('runs to end of input if never dedented', () => {
    const lines = toLines('    a\n    b');
    const match = matchIndentedRun(lines, 0);
    expect(match?.nextIndex).toBe(2);
  });

  it('returns null starting on a blank line', () => {
    expect(matchIndentedRun(toLines('\n    x'), 0)).toBeNull();
  });

  it('returns null starting on an unindented line', () => {
    expect(matchIndentedRun(toLines('x\n    y'), 0)).toBeNull();
  });
});
