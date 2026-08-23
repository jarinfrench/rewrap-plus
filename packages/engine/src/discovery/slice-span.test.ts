import { describe, expect, it } from 'vitest';
import type { SourceSpan } from '../types/span.js';
import { sliceSpanText } from './slice-span.js';

function span(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): SourceSpan {
  // `startByte`/`endByte` are irrelevant to `sliceSpanText` (it works
  // purely off row/column), so these are dummy values — never 0 for both,
  // so a test mistakenly reading them would still fail loudly.
  return { startByte: -1, endByte: -1, startRow, startColumn, endRow, endColumn };
}

describe('sliceSpanText', () => {
  it('slices a span within a single line', () => {
    const source = 'x = "hello world"\n';

    expect(sliceSpanText(source, span(0, 4, 0, 17))).toBe('"hello world"');
  });

  it('slices a span spanning multiple lines', () => {
    const source = ['def f():', '    """Line one.', '    Line two."""', ''].join('\n');

    expect(sliceSpanText(source, span(1, 4, 2, 17))).toBe('"""Line one.\n    Line two."""');
  });

  it('slices a span covering an entire line with nothing else on it', () => {
    const source = '"""\nbody\n"""\n';

    expect(sliceSpanText(source, span(0, 0, 2, 3))).toBe('"""\nbody\n"""');
  });

  it('throws with the offending rows when a span falls outside the source', () => {
    const source = 'x = 1\n';

    expect(() => sliceSpanText(source, span(5, 0, 5, 1))).toThrow(/\[5, 5\]/);
  });
});
