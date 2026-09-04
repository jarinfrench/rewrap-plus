import { describe, expect, it } from 'vitest';
import type { WrappableRegion } from '../types/region.js';
import { isStringSafeToWrapBaseline } from './is-string-safe-to-wrap-baseline.js';

function part(startColumn: number, endColumn: number) {
  return { startByte: startColumn, endByte: endColumn, startRow: 0, startColumn, endRow: 0, endColumn };
}

function region(parts: readonly ReturnType<typeof part>[]): WrappableRegion {
  return {
    kind: 'stringLiteral',
    span: { ...parts[0]!, endByte: parts[parts.length - 1]!.endByte, endColumn: parts[parts.length - 1]!.endColumn },
    parts,
    rawText: '',
    indentColumn: 0,
    languageId: 'python',
  };
}

/**
 * Exercises the shared baseline in isolation, independent of any adapter —
 * this is the one function every adapter's own `isSafeToWrap` (Python,
 * C++) or lack thereof (Java, ECMAScript-family, whose adapter-level
 * assertions of this exact behavior moved here) relies on `../wrap.ts` to
 * have already applied. Per-language `adapter.test.ts` suites keep only
 * the assertions for what's genuinely left in that adapter's own hook.
 */
describe('isStringSafeToWrapBaseline', () => {
  it('is safe for an ordinary string with no hazards', () => {
    const source = 'x = "hello world"\n';
    expect(isStringSafeToWrapBaseline(region([part(4, 17)]), source)).toBe(true);
  });

  it('is unsafe for a string containing a real embedded tab character', () => {
    const source = 'x = "foo\tbar"\n';
    expect(isStringSafeToWrapBaseline(region([part(4, 13)]), source)).toBe(false);
  });

  it('is unsafe for a string containing a run of two consecutive spaces', () => {
    const source = 'x = "foo  bar"\n';
    expect(isStringSafeToWrapBaseline(region([part(4, 14)]), source)).toBe(false);
  });

  it('is safe for a string containing the two-character \\t escape sequence, not a real tab', () => {
    const source = 'x = "foo\\tbar"\n';
    expect(isStringSafeToWrapBaseline(region([part(4, 15)]), source)).toBe(true);
  });

  it('is unsafe when any part of a multi-part concatenation run contains the hazard', () => {
    const source = 'x = "a" "foo\tbar"\n';
    const parts = [part(4, 7), part(8, 18)];
    expect(isStringSafeToWrapBaseline(region(parts), source)).toBe(false);
  });

  it('is safe for a multi-row part whose continuation lines carry ordinary paragraph indentation', () => {
    // A single-part triple-quoted Python string is the one shape that
    // legitimately spans multiple physical lines outside a line-
    // continuation escape — its own paragraph indentation (2+ spaces per
    // continuation line) must not trip the single-line-only irregular-
    // whitespace check. Whether this specific region is actually safe to
    // wrap at all is Python's own `isSafeToWrap`'s job (its `looksLikeProse`
    // gate); this baseline only needs to not reject it outright.
    const source = 'x = """line one\n    line two"""\n';
    const multiRowPart = { startByte: 4, endByte: 30, startRow: 0, startColumn: 4, endRow: 1, endColumn: 13 };
    expect(isStringSafeToWrapBaseline(region([multiRowPart]), source)).toBe(true);
  });

  it('is still unsafe for a multi-row part that genuinely contains a line-continuation escape', () => {
    const source = 'x = "a\\\nb"\n';
    const multiRowPart = { startByte: 4, endByte: 9, startRow: 0, startColumn: 4, endRow: 1, endColumn: 2 };
    expect(isStringSafeToWrapBaseline(region([multiRowPart]), source)).toBe(false);
  });
});
