import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { javascriptAdapter } from './adapter.js';

const grammarPath = 'grammars/tree-sitter-javascript.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('javascriptAdapter', () => {
  it('classifies a // comment as lineComment', () => {
    const source = '// a comment\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a /** */ comment as blockComment', () => {
    const source = '/**\n * A doc comment.\n */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('blockComment');
  });

  it('classifies a single-line /** */ comment as blockComment', () => {
    const source = '/** inline doc comment */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('blockComment');
  });

  it('excludes a plain single-star /* */ comment from discovery entirely', () => {
    // Deliberate scope limit — see `./adapter.ts`'s own doc comment.
    const source = '/* plain block comment */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions).toEqual([]);
  });

  it('discovers both comment forms plus an ordinary string in the same file', () => {
    const source = ['// line', '/**', ' * block', ' */', 'const s = "hello";'].join('\n');
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'blockComment', 'stringLiteral']);
  });

  it('does not merge adjacent line comments the way the Python adapter does', () => {
    // No groupRegions override — each `//` line is its own region.
    const source = '// first\n// second\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'lineComment']);
    expect(regions.every((r) => r.parts.length === 1)).toBe(true);
  });
});
