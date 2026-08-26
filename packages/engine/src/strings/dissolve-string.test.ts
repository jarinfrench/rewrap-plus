import { describe, expect, it } from 'vitest';
import type { WrappableRegion } from '../types/region.js';
import { dissolveString } from './dissolve-string.js';

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

describe('dissolveString', () => {
  it('strips quotes from a single ordinary string', () => {
    const source = 'x = "hello world"\n';
    const dissolved = dissolveString(region([part(4, 17)]), source);

    expect(dissolved.text).toBe('hello world');
    expect(dissolved.prefix).toBe('');
    expect(dissolved.quoteDelimiter).toBe('"');
  });

  it('concatenates an implicit run with no separator', () => {
    const source = 'x = "hello " "world"\n';
    const dissolved = dissolveString(region([part(4, 12), part(13, 20)]), source);

    expect(dissolved.text).toBe('hello world');
  });

  it('never decodes an escape sequence', () => {
    const source = String.raw`x = "line one\nline two"` + '\n';
    const dissolved = dissolveString(region([part(4, 24)]), source);

    expect(dissolved.text).toBe(String.raw`line one\nline two`);
  });

  it('preserves original casing of the prefix', () => {
    const source = 'x = F"hi"\n';
    const dissolved = dissolveString(region([part(4, 9)]), source);

    expect(dissolved.prefix).toBe('F');
  });

  it('uses the first part\'s own quote delimiter as representative for a mixed-quote run', () => {
    const source = `x = "a" 'b'\n`;
    const dissolved = dissolveString(region([part(4, 7), part(8, 11)]), source);

    expect(dissolved.quoteDelimiter).toBe('"');
    expect(dissolved.text).toBe('ab');
  });

  it('throws on a part that is not a recognizable string literal', () => {
    const source = 'x = 123\n';
    expect(() => dissolveString(region([part(4, 7)]), source)).toThrow(/recognizable prefix\/quote/);
  });
});
