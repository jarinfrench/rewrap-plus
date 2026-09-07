import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { javaAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-java.wasm'));
});

describe('javaAdapter', () => {
  it('classifies a // comment as lineComment', () => {
    const source = 'class Foo {\n  // a comment\n  int x = 1;\n}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javaAdapter, tree, source, 'java');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a /** */ comment as docComment', () => {
    const source = 'class Foo {\n  /**\n   * A doc comment.\n   */\n  int x = 1;\n}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javaAdapter, tree, source, 'java');
    expect(region!.kind).toBe('docComment');
  });

  it('discovers a plain single-star /* */ comment as a blockComment', () => {
    const source = 'class Foo {\n  /* plain block comment */\n  int x = 1;\n}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javaAdapter, tree, source, 'java');
    expect(region!.kind).toBe('blockComment');
  });

  it('does not treat a /// comment specially -- Java has no repeated-marker doc form', () => {
    const source = 'class Foo {\n  /// not a real doc-comment marker in Java\n  int x = 1;\n}\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(javaAdapter, tree, source, 'java');
    expect(region!.kind).toBe('lineComment');
  });

  it('does not merge two adjacent // lines into one region', () => {
    const source = 'class Foo {\n  // first\n  // second\n  int x = 1;\n}\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toHaveLength(2);
    expect(regions.every((r) => r.parts.length === 1)).toBe(true);
  });

  it('groups a chained + concatenation into one multi-part region', () => {
    const source = 'class Foo { String x = "foo" + "bar" + "baz"; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('does not merge a "literal" + identifier chain into one region', () => {
    const source = 'class Foo { String x = "foo" + name; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(1);
  });

  it('discovers a string and comment inside a method', () => {
    const source = [
      'class Foo {',
      '  // greet somebody',
      '  String greet() {',
      '    return "hello there";',
      '  }',
      '}',
    ].join('\n');
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'stringLiteral']);
  });

  it('excludes a text block from discovery entirely (shares string_literal with an ordinary string)', () => {
    const source = 'class Foo { String s = """\n    a text block\n    """; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toEqual([]);
  });

  it('excludes a character_literal from discovery entirely', () => {
    const source = "class Foo { char c = 'x'; }\n";
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toEqual([]);
  });

  it('discovers an ordinary string literal alongside an excluded text block', () => {
    const source = 'class Foo { String a = "plain"; String b = """\n    block\n    """; }\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(javaAdapter, tree, source, 'java');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
  });

  // javaAdapter no longer declares its own isSafeToWrap at all -- Java has
  // no string-shape hazard beyond `isStringSafeToWrapBaseline`'s own
  // line-continuation/irregular-whitespace refusals
  // (`../../strings/is-string-safe-to-wrap-baseline.test.ts`), applied
  // unconditionally by `wrap.ts` regardless of adapter.
});
