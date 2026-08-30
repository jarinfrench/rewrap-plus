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

  it('classifies a /** */ comment as docComment (JSDoc-eligible)', () => {
    const source = '/**\n * A doc comment.\n */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('docComment');
  });

  it('classifies a single-line /** */ comment as docComment', () => {
    const source = '/** inline doc comment */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('docComment');
  });

  it('discovers a plain single-star /* */ comment as a blockComment', () => {
    const source = '/* plain block comment */\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(region!.kind).toBe('blockComment');
  });

  it('discovers both comment forms plus an ordinary string in the same file', () => {
    const source = ['// line', '/**', ' * block', ' */', 'const s = "hello";'].join('\n');
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'docComment', 'stringLiteral']);
  });

  it('does not merge adjacent line comments the way the Python adapter does', () => {
    // No groupRegions override — each `//` line is its own region.
    const source = '// first\n// second\nconst x = 1;\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'lineComment']);
    expect(regions.every((r) => r.parts.length === 1)).toBe(true);
  });

  it('groups a +-concatenated string chain into one multi-part region', () => {
    const source = 'const x = "a" + "b" + "c";\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('does not group a chain with a non-literal operand', () => {
    const source = 'const x = "a" + name + "b";\n';
    const tree = parser.parse(source)!;

    const regions = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(regions.every((r) => r.parts.length === 1)).toBe(true);
  });

  it('isSafeToWrap refuses a string with a line-continuation escape', () => {
    const source = 'const x = "foo\\\nbar";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(javascriptAdapter.isSafeToWrap!(region!, source)).toBe(false);
  });

  it('isSafeToWrap refuses a string with a tab or double space', () => {
    const source = 'const x = "foo  bar";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(javascriptAdapter.isSafeToWrap!(region!, source)).toBe(false);
  });

  it('isSafeToWrap allows an ordinary string', () => {
    const source = 'const x = "a perfectly ordinary string";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    expect(javascriptAdapter.isSafeToWrap!(region!, source)).toBe(true);
  });

  it('emitContext never needs parens and always resolves to operator style', () => {
    const source = 'const x = "a" + "b";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javascriptAdapter, tree, source, 'javascript');

    const ctx = javascriptAdapter.emitContext!(region!, tree, {} as never);
    expect(ctx).toEqual({ needsParens: false, concatenationStyle: 'operator' });
  });
});
