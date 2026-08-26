import { describe, expect, it } from 'vitest';
import { parseTomlSubset } from './toml-subset.js';

describe('parseTomlSubset', () => {
  it('reads a dotted table header', () => {
    const tables = parseTomlSubset('[tool.rewrap-plus]\ncolumn-limit = 88\n');
    expect(tables.get('tool.rewrap-plus')?.get('column-limit')).toBe(88);
  });

  it('reads strings, integers, and booleans', () => {
    const tables = parseTomlSubset(
      [
        '[tool.rewrap-plus]',
        'string-policy = "prose"',
        'column-limit = 100',
        'negative = -4',
        'underscored = 1_000',
        'wrap-comments = true',
        'wrap-strings = false',
      ].join('\n'),
    );
    const table = tables.get('tool.rewrap-plus')!;
    expect(table.get('string-policy')).toBe('prose');
    expect(table.get('column-limit')).toBe(100);
    expect(table.get('negative')).toBe(-4);
    expect(table.get('underscored')).toBe(1000);
    expect(table.get('wrap-comments')).toBe(true);
    expect(table.get('wrap-strings')).toBe(false);
  });

  it('ignores unrelated tables and only exposes the requested one', () => {
    const tables = parseTomlSubset(
      ['[tool.black]', 'line-length = 88', '', '[tool.rewrap-plus]', 'column-limit = 79'].join(
        '\n',
      ),
    );
    expect(tables.get('tool.black')?.get('line-length')).toBe(88);
    expect(tables.get('tool.rewrap-plus')?.get('column-limit')).toBe(79);
  });

  it('strips full-line and trailing comments outside strings', () => {
    const tables = parseTomlSubset(
      [
        '# a full-line comment',
        '[tool.rewrap-plus]',
        'column-limit = 79 # trailing comment',
        'doc-dialect = "plain # not a comment"',
      ].join('\n'),
    );
    const table = tables.get('tool.rewrap-plus')!;
    expect(table.get('column-limit')).toBe(79);
    expect(table.get('doc-dialect')).toBe('plain # not a comment');
  });

  it('unescapes \\n, \\t, \\", and \\\\ inside strings', () => {
    const tables = parseTomlSubset('[tool.rewrap-plus]\nvalue = "a\\nb\\tc\\"d\\\\e"\n');
    expect(tables.get('tool.rewrap-plus')?.get('value')).toBe('a\nb\tc"d\\e');
  });

  it('skips a key/value line that appears before any table header', () => {
    const tables = parseTomlSubset('orphan = 1\n[tool.rewrap-plus]\ncolumn-limit = 79\n');
    expect(tables.has('')).toBe(false);
    expect(tables.get('tool.rewrap-plus')?.get('column-limit')).toBe(79);
  });

  it('omits a key whose value is an unsupported TOML shape', () => {
    const tables = parseTomlSubset(
      ['[tool.rewrap-plus]', 'an-array = [1, 2, 3]', 'a-float = 1.5', 'column-limit = 79'].join(
        '\n',
      ),
    );
    const table = tables.get('tool.rewrap-plus')!;
    expect(table.has('an-array')).toBe(false);
    expect(table.has('a-float')).toBe(false);
    expect(table.get('column-limit')).toBe(79);
  });

  it('returns an empty map for content with no matching table', () => {
    const tables = parseTomlSubset('[tool.black]\nline-length = 88\n');
    expect(tables.get('tool.rewrap-plus')).toBeUndefined();
  });
});
