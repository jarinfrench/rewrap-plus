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
});
