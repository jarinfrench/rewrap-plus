import { describe, expect, it } from 'vitest';
import type { SourceSpan } from './span.js';
import type { RegionKind, WrappableRegion } from './region.js';

function span(startByte: number, endByte: number): SourceSpan {
  return { startByte, endByte, startRow: 0, startColumn: startByte, endRow: 0, endColumn: endByte };
}

describe('RegionKind', () => {
  it('covers every region kind exactly once', () => {
    const kinds: readonly RegionKind[] = [
      'lineComment',
      'blockComment',
      'docComment',
      'docstring',
      'stringLiteral',
      'prose',
    ];

    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('WrappableRegion', () => {
  it('models a single-part region, where span equals parts[0]', () => {
    const partSpan = span(4, 20);
    const region: WrappableRegion = {
      kind: 'lineComment',
      span: partSpan,
      parts: [partSpan],
      rawText: '# a short comment',
      indentColumn: 4,
      languageId: 'python',
    };

    expect(region.parts).toHaveLength(1);
    expect(region.parts[0]).toBe(region.span);
  });

  it('models a multi-part concatenation run', () => {
    const first = span(0, 5);
    const second = span(6, 11);
    const region: WrappableRegion = {
      kind: 'stringLiteral',
      span: span(0, 11),
      parts: [first, second],
      rawText: '"foo" "bar"',
      indentColumn: 0,
      languageId: 'python',
    };

    expect(region.parts).toHaveLength(2);
    expect(region.span.endByte).toBe(region.parts[1]!.endByte);
  });

  it('models a multi-part prose region -- one part per physical line', () => {
    // A `'prose'` region's `parts` are its physical lines, per-line prefix
    // (block-quote marker, list hanging indent, ...) excluded from each
    // part's own span -- the same per-line contract `'lineComment'`
    // regions already follow.
    const first = span(0, 11);
    const second = span(14, 25);
    const region: WrappableRegion = {
      kind: 'prose',
      span: span(0, 25),
      parts: [first, second],
      rawText: 'hello world\nsecond line',
      indentColumn: 0,
      languageId: 'markdown',
    };

    expect(region.parts).toHaveLength(2);
    expect(region.span.startByte).toBe(region.parts[0]!.startByte);
    expect(region.span.endByte).toBe(region.parts[1]!.endByte);
  });
});
