import { Parser, Language, Query } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateDescriptor } from '../../adapter-registry.js';
import { javaDescriptor } from './descriptor.js';

let language: Language;

beforeAll(async () => {
  await Parser.init();
  language = await Language.load('grammars/tree-sitter-java.wasm');
});

describe('javaDescriptor', () => {
  it('passes structural validation', () => {
    expect(() => validateDescriptor(javaDescriptor)).not.toThrow();
  });

  it('declares queries that compile against its own vendored grammar', () => {
    expect(() => new Query(language, javaDescriptor.queries.comments!)).not.toThrow();
    expect(() => new Query(language, javaDescriptor.queries.strings!)).not.toThrow();
    expect(() => new Query(language, javaDescriptor.queries.concatenations!)).not.toThrow();
  });

  it('captures both line_comment and block_comment under one @comment capture', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = '// line\n/* block */\n/** doc */\nclass Foo {}\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, javaDescriptor.queries.comments!);
    const matches = query.matches(tree.rootNode);
    const texts = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(texts).toEqual(['// line', '/* block */', '/** doc */']);
  });

  it('declares the javadoc dialect (falling back to plain) with no repeated-marker form', () => {
    expect(javaDescriptor.comments.doc).toEqual({
      markers: ['/**'],
      dialects: ['javadoc', 'plain'],
    });
  });

  it('declares operator (+) concatenation with no grouping requirement', () => {
    expect(javaDescriptor.strings!.concatenation).toEqual({
      style: 'operator',
      operator: '+',
      operatorPlacement: 'trailing',
    });
  });

  it('declares only a double-quote form, no single-quote (character_literal is a separate node type)', () => {
    expect(javaDescriptor.strings!.quotes).toEqual([{ delimiter: '"', multiline: false, escapes: true }]);
  });

  it('declares no string-literal prefixes (Java has no r/b/f-style prefix concept)', () => {
    expect(javaDescriptor.strings!.prefixes).toEqual([]);
  });

  it('flags common Java tooling directives as never-reflow', () => {
    const patterns = javaDescriptor.comments.neverReflow;
    const matches = (text: string): boolean => patterns.some((re) => re.test(text));

    expect(matches('// NOPMD')).toBe(true);
    expect(matches('// NOSONAR')).toBe(true);
    expect(matches('// CHECKSTYLE:OFF')).toBe(true);
    expect(matches('// noinspection unused')).toBe(true);
    expect(matches('// just a regular comment')).toBe(false);
  });

  it('recognizes a text block\'s own triple-quote delimiter distinctly from an ordinary string', () => {
    // Not a descriptor-level check per se (the exclusion itself is
    // `../adapter.ts`'s `classify` job — see `./descriptor.ts`'s own doc
    // comment) — this test just confirms, directly against the grammar,
    // that both forms really do share one node type, which is the whole
    // reason that classify-level exclusion is needed at all.
    const parser = new Parser();
    parser.setLanguage(language);
    const source = 'class Foo { String a = "plain"; String b = """\n  text block\n  """; }\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, javaDescriptor.queries.strings!);
    const matches = query.matches(tree.rootNode);
    const nodeTypes = matches.flatMap((m) => m.captures.map((c) => c.node.type));
    expect(nodeTypes).toEqual(['string_literal', 'string_literal']);
    const texts = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(texts[0]?.startsWith('"')).toBe(true);
    expect(texts[0]?.startsWith('"""')).toBe(false);
    expect(texts[1]?.startsWith('"""')).toBe(true);
  });

  it('exposes left/operator/right fields on a chained + concatenation, left-associatively', () => {
    const parser = new Parser();
    parser.setLanguage(language);
    const source = 'class Foo { String s = "a" + "b" + "c"; }\n';
    const tree = parser.parse(source)!;
    const query = new Query(language, javaDescriptor.queries.concatenations!);
    const matches = query.matches(tree.rootNode);
    // Outermost match: left is itself a binary_expression (the "a" + "b"
    // pair), right is the trailing "c" literal — left-associative, the
    // same shape `discoverRegions`'s concatenation grouper already
    // expects from every other adapter's `+`-chains.
    const outermost = matches[matches.length - 1]!;
    const node = outermost.captures[0]!.node;
    expect(node.childForFieldName('left')?.type).toBe('binary_expression');
    expect(node.childForFieldName('right')?.type).toBe('string_literal');
    expect(node.childForFieldName('operator')?.text).toBe('+');
  });

  it('grammar loads and reports an ABI compatible with the pinned web-tree-sitter version', () => {
    expect(language.abiVersion).toBeGreaterThanOrEqual(13);
    expect(language.abiVersion).toBeLessThanOrEqual(15);
  });
});
