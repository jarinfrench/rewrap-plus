import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { pythonAdapter } from './adapter.js';

const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('pythonAdapter', () => {
  it('discovers comments as lineComment and ordinary strings as stringLiteral', () => {
    const source = '# a comment\nx = "hello"\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'stringLiteral']);
  });

  it('classifies a module docstring as docstring, not stringLiteral', () => {
    const source = '"""A module docstring."""\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(region!.kind).toBe('docstring');
  });

  it('classifies a function docstring alongside an ordinary string in the same file', () => {
    const source = 'def f():\n    """Docstring."""\n    return "not a docstring"\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions.map((r) => r.kind)).toEqual(['docstring', 'stringLiteral']);
  });

  it('groups an implicit concatenation run into one multi-part stringLiteral region', () => {
    const source = 'x = "a" "b" "c"\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('groups a + concatenation run into one multi-part stringLiteral region', () => {
    const source = 'x = "a" + "b" + "c"\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('never groups a docstring — a docstring is always a single bare string literal', () => {
    // Not realistic Python (a docstring position can't syntactically hold
    // a binary expression), but confirms the invariant holds structurally:
    // grouping only ever looks at `queries.strings` captures gathered
    // through concatenation constructs, which a docstring position is
    // never part of.
    const source = '"""Module docstring."""\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('docstring');
    expect(regions[0]!.parts).toHaveLength(1);
  });
});

describe('pythonAdapter.isSafeToWrap', () => {
  function discoverOne(source: string) {
    const tree = parser.parse(source)!;
    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    if (regions.length !== 1) {
      throw new Error(`test setup: expected exactly one region, got ${regions.length}`);
    }
    return { region: regions[0]!, source };
  }

  it('is safe for an ordinary unprefixed string', () => {
    const { region, source } = discoverOne('x = "hello world"\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(true);
  });

  it('is safe for a docstring', () => {
    const { region, source } = discoverOne('"""A docstring."""\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(true);
  });

  it('is safe for an f-string', () => {
    const { region, source } = discoverOne('x = f"hello {name}"\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(true);
  });

  it('is unsafe for a raw string', () => {
    const { region, source } = discoverOne('x = r"raw\\d+"\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(false);
  });

  it('is unsafe for a byte string', () => {
    const { region, source } = discoverOne('x = b"bytes"\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(false);
  });

  it('is unsafe for a raw-bytes string regardless of prefix letter order', () => {
    const { region, source } = discoverOne('x = br"bytes"\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(false);
  });

  it('is safe for a same-prefix concatenation run', () => {
    const { region, source } = discoverOne('x = f"a" f"b"\n');
    expect(region.parts).toHaveLength(2);
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(true);
  });

  it('is unsafe for a mixed-prefix concatenation run, even with neither prefix individually unsafe', () => {
    const { region, source } = discoverOne('x = f"a" "b"\n');
    expect(region.parts).toHaveLength(2);
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(false);
  });

  it('is unsafe for a concatenation run mixing a raw part with a plain part', () => {
    const { region, source } = discoverOne('x = r"a" "b"\n');
    expect(region.parts).toHaveLength(2);
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(false);
  });

  it('is safe for a comment region regardless of its text', () => {
    const { region, source } = discoverOne('# looks like r"raw" but is a comment\n');
    expect(pythonAdapter.isSafeToWrap?.(region, source)).toBe(true);
  });
});

describe('pythonAdapter groupRegions — line comment merging', () => {
  it('merges consecutive same-indent line comments into one multi-part region', () => {
    const source = '# first line\n# second line\n# third line\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('lineComment');
    expect(regions[0]!.parts).toHaveLength(3);
    expect(regions[0]!.span.startRow).toBe(0);
    expect(regions[0]!.span.endRow).toBe(2);
  });

  it('does not merge comments separated by a non-comment line', () => {
    const source = '# first block\nx = 1\n# second block\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    const comments = regions.filter((r) => r.kind === 'lineComment');

    expect(comments).toHaveLength(2);
    expect(comments[0]!.parts).toHaveLength(1);
    expect(comments[1]!.parts).toHaveLength(1);
  });

  it('does not merge comments at different indent columns', () => {
    const source = '# outer\nif True:\n    # inner\n    pass\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    const comments = regions.filter((r) => r.kind === 'lineComment');

    expect(comments).toHaveLength(2);
    expect(comments.every((r) => r.parts.length === 1)).toBe(true);
  });

  it('does not merge a trailing comment with an unrelated standalone comment below it', () => {
    const source = 'x = 1  # trailing\n# standalone, different column\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    const comments = regions.filter((r) => r.kind === 'lineComment');

    expect(comments).toHaveLength(2);
  });

  it('leaves a lone comment ungrouped (single-part, unchanged)', () => {
    const source = '# only comment\nx = 1\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    const [comment] = regions.filter((r) => r.kind === 'lineComment');

    expect(comment!.parts).toHaveLength(1);
  });

  it('merges three consecutive blank-comment-separated lines but stops at a blank source line', () => {
    // A run of bare "#" separator lines is still "consecutive `#`
    // comments at the same indent" from groupRegions's perspective —
    // dissolve (not grouping) is what turns their empty content into a
    // paragraph-separating `blank` block. A genuinely blank *source*
    // line, by contrast, has no comment node at all and breaks the row
    // adjacency the merge requires.
    const source = '# para one\n#\n# para two\n\n# unrelated\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');
    const comments = regions.filter((r) => r.kind === 'lineComment');

    expect(comments).toHaveLength(2);
    expect(comments[0]!.parts).toHaveLength(3);
    expect(comments[1]!.parts).toHaveLength(1);
  });
});
