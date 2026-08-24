import { describe, expect, it } from 'vitest';
import { applyTextEdits } from './apply-edits.js';
import type { TextEdit } from './types/span.js';

function edit(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
  newText: string,
): TextEdit {
  return {
    span: { startByte: 0, endByte: 0, startRow, startColumn, endRow, endColumn },
    newText,
  };
}

describe('applyTextEdits', () => {
  it('returns the source unchanged when there are no edits', () => {
    expect(applyTextEdits('hello world', [])).toBe('hello world');
  });

  it('applies a single single-line replacement', () => {
    const source = 'x = "hello"\n';
    const result = applyTextEdits(source, [edit(0, 4, 0, 11, '"goodbye"')]);
    expect(result).toBe('x = "goodbye"\n');
  });

  it('applies a single multi-line replacement', () => {
    const source = '# one\n# two\n';
    const result = applyTextEdits(source, [edit(0, 0, 1, 5, '# merged into one line')]);
    expect(result).toBe('# merged into one line\n');
  });

  it('applies multiple non-overlapping edits regardless of input order', () => {
    const source = 'first\nsecond\nthird\n';
    const edits = [edit(2, 0, 2, 5, 'THIRD'), edit(0, 0, 0, 5, 'FIRST')];
    const result = applyTextEdits(source, edits);
    expect(result).toBe('FIRST\nsecond\nTHIRD\n');
  });

  it('applies an edit that grows the document (wrapping one line into several)', () => {
    const source = '# a very long comment that needs to be wrapped\n';
    const result = applyTextEdits(source, [
      edit(0, 0, 0, 46, '# a very long comment\n# that needs to be\n# wrapped'),
    ]);
    expect(result).toBe('# a very long comment\n# that needs to be\n# wrapped\n');
  });

  it('applies an edit that shrinks the document (several lines collapsed to one)', () => {
    const source = '# a\n# b\n# c\n';
    const result = applyTextEdits(source, [edit(0, 0, 2, 3, '# a b c')]);
    expect(result).toBe('# a b c\n');
  });
});
