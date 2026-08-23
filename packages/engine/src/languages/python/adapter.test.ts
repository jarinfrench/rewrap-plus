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
