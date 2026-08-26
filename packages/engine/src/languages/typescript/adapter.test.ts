import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { typescriptAdapter, typescriptReactAdapter } from './adapter.js';

let tsParser: Parser;
let tsxParser: Parser;

beforeAll(async () => {
  await Parser.init();
  tsParser = new Parser();
  tsParser.setLanguage(await Language.load('grammars/tree-sitter-typescript.wasm'));
  tsxParser = new Parser();
  tsxParser.setLanguage(await Language.load('grammars/tree-sitter-tsx.wasm'));
});

describe('typescriptAdapter', () => {
  it('classifies a // comment as lineComment', () => {
    const source = '// a comment\nconst x = 1;\n';
    const tree = tsParser.parse(source)!;
    const [region] = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a /** */ comment as docComment', () => {
    const source = '/**\n * A doc comment.\n */\nconst x = 1;\n';
    const tree = tsParser.parse(source)!;
    const [region] = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(region!.kind).toBe('docComment');
  });

  it('discovers a plain single-star /* */ comment as a blockComment', () => {
    const source = '/* plain block comment */\nconst x = 1;\n';
    const tree = tsParser.parse(source)!;
    const [region] = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(region!.kind).toBe('blockComment');
  });

  it('groups a +-concatenated string chain into one multi-part region', () => {
    const source = 'const x: string = "a" + "b" + "c";\n';
    const tree = tsParser.parse(source)!;
    const regions = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('discovers a string and comment inside a type-annotated function', () => {
    const source = ['// greet somebody', 'function greet(name: string): string {', '  return "hi " + name;', '}'].join(
      '\n',
    );
    const tree = tsParser.parse(source)!;
    const regions = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'stringLiteral']);
  });

  it('isSafeToWrap refuses a string with a line-continuation escape', () => {
    const source = 'const x = "foo\\\nbar";\n';
    const tree = tsParser.parse(source)!;
    const [region] = discoverRegions(typescriptAdapter, tree, source, 'typescript');
    expect(typescriptAdapter.isSafeToWrap!(region!, source)).toBe(false);
  });
});

describe('typescriptReactAdapter (TSX)', () => {
  it('discovers a string concatenation nested inside a JSX expression container', () => {
    const source = 'const el = <div>{"a" + "b"}</div>;\n';
    const tree = tsxParser.parse(source)!;
    const regions = discoverRegions(typescriptReactAdapter, tree, source, 'typescriptreact');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(2);
  });

  it('discovers a string inside a JSX attribute', () => {
    const source = 'const el = <div className="hello">text</div>;\n';
    const tree = tsxParser.parse(source)!;
    const regions = discoverRegions(typescriptReactAdapter, tree, source, 'typescriptreact');
    expect(regions.map((r) => r.kind)).toEqual(['stringLiteral']);
  });

  it('classifies comments inside a TSX file identically to plain TS', () => {
    const source = '// a comment\nconst el = <div />;\n';
    const tree = tsxParser.parse(source)!;
    const [region] = discoverRegions(typescriptReactAdapter, tree, source, 'typescriptreact');
    expect(region!.kind).toBe('lineComment');
  });
});
