import { describe, expect, it } from 'vitest';
import type { SourceSpan, TextEdit } from './span.js';

// `./span.ts` is pure vocabulary — no behavior to exercise yet. These
// tests exist to prove the shapes are actually usable and to pin the
// field names down: a typo here would otherwise only surface as a
// confusing type error much further downstream.
describe('SourceSpan', () => {
  it('carries both byte offsets and row/column positions', () => {
    const span: SourceSpan = {
      startByte: 0,
      endByte: 5,
      startRow: 0,
      startColumn: 0,
      endRow: 0,
      endColumn: 5,
    };

    expect(span.endByte - span.startByte).toBe(5);
    expect(span.endColumn - span.startColumn).toBe(5);
  });

  it('supports spans crossing multiple rows', () => {
    const span: SourceSpan = {
      startByte: 10,
      endByte: 40,
      startRow: 1,
      startColumn: 4,
      endRow: 3,
      endColumn: 0,
    };

    expect(span.endRow).toBeGreaterThan(span.startRow);
  });
});

describe('TextEdit', () => {
  it('pairs a span with replacement text', () => {
    const span: SourceSpan = {
      startByte: 10,
      endByte: 14,
      startRow: 1,
      startColumn: 2,
      endRow: 1,
      endColumn: 6,
    };
    const edit: TextEdit = { span, newText: 'quux' };

    expect(edit.span).toBe(span);
    expect(edit.newText).toBe('quux');
  });
});
