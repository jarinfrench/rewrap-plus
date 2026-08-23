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

describe('pythonAdapter (skeleton)', () => {
  it('discovers comments and string literals using the driver default kinds', () => {
    const source = '# a comment\nx = "hello"\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'stringLiteral']);
  });

  it('does not yet distinguish a docstring from an ordinary string literal', () => {
    // This is the skeleton's known limitation, not a bug: `classify` is
    // added in the next commit specifically to fix this.
    const source = '"""A module docstring."""\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(pythonAdapter, tree, source, 'python');

    expect(region!.kind).toBe('stringLiteral');
  });
});
