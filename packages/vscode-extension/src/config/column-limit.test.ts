import { describe, expect, it } from 'vitest';
import { resolveColumnLimit, type ColumnLimitInputs } from './column-limit.js';

function inputs(overrides: Partial<ColumnLimitInputs> = {}): ColumnLimitInputs {
  return {
    rewrapPlusColumnLimit: null,
    languageRulers: undefined,
    editorConfigMaxLineLength: undefined,
    globalRulers: undefined,
    rulerIndex: 0,
    ...overrides,
  };
}

describe('resolveColumnLimit', () => {
  it('falls back to the built-in default when nothing else is configured', () => {
    expect(resolveColumnLimit(inputs())).toEqual({ value: 80, source: 'default' });
  });

  it('tier 4: uses a global (non-language) ruler over the default', () => {
    expect(resolveColumnLimit(inputs({ globalRulers: [100] }))).toEqual({
      value: 100,
      source: 'editor.rulers (global)',
    });
  });

  it('tier 3: prefers .editorconfig over a global ruler', () => {
    expect(
      resolveColumnLimit(inputs({ globalRulers: [100], editorConfigMaxLineLength: 72 })),
    ).toEqual({ value: 72, source: '.editorconfig' });
  });

  it('tier 2: prefers a language-scoped ruler over .editorconfig', () => {
    expect(
      resolveColumnLimit(
        inputs({ languageRulers: [88], editorConfigMaxLineLength: 72, globalRulers: [100] }),
      ),
    ).toEqual({ value: 88, source: 'editor.rulers (language-scoped)' });
  });

  it('tier 1: prefers rewrapPlus.columnLimit over everything else', () => {
    expect(
      resolveColumnLimit(
        inputs({
          rewrapPlusColumnLimit: 79,
          languageRulers: [88],
          editorConfigMaxLineLength: 72,
          globalRulers: [100],
        }),
      ),
    ).toEqual({ value: 79, source: 'rewrapPlus.columnLimit' });
  });

  it('treats rewrapPlus.columnLimit of 0 as an explicit value, not "unset"', () => {
    // Only `null` means "fall through" (the setting's own default) —
    // a configured 0 is a real (if degenerate) value and must not be
    // treated the same as absence via a falsy check.
    expect(resolveColumnLimit(inputs({ rewrapPlusColumnLimit: 0 }))).toEqual({
      value: 0,
      source: 'rewrapPlus.columnLimit',
    });
  });

  it('normalizes { column, color } ruler entries alongside bare numbers', () => {
    expect(
      resolveColumnLimit(inputs({ globalRulers: [{ column: 100, color: '#ff0000' }] })),
    ).toEqual({ value: 100, source: 'editor.rulers (global)' });
  });

  it('honors rulerIndex to select among multiple rulers', () => {
    expect(resolveColumnLimit(inputs({ globalRulers: [80, 120], rulerIndex: 1 }))).toEqual({
      value: 120,
      source: 'editor.rulers (global)',
    });
  });

  it('falls back to the first ruler when rulerIndex is out of range', () => {
    expect(resolveColumnLimit(inputs({ globalRulers: [80, 120], rulerIndex: 5 }))).toEqual({
      value: 80,
      source: 'editor.rulers (global)',
    });
  });

  it('treats an empty rulers array as absent, not as a ruler at column undefined', () => {
    expect(resolveColumnLimit(inputs({ globalRulers: [] }))).toEqual({
      value: 80,
      source: 'default',
    });
  });
});
