import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { cppAdapter } from './adapter.js';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  parser = new Parser();
  parser.setLanguage(await Language.load('grammars/tree-sitter-cpp.wasm'));
});

describe('cppAdapter', () => {
  it('classifies a // comment as lineComment', () => {
    const source = '// a comment\nint x = 1;\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.kind).toBe('lineComment');
  });

  it('classifies a /** */ comment as docComment', () => {
    const source = '/**\n * A doc comment.\n */\nint x = 1;\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.kind).toBe('docComment');
  });

  it('discovers a plain single-star /* */ comment as a blockComment', () => {
    const source = '/* plain block comment */\nint x = 1;\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.kind).toBe('blockComment');
  });

  it('discovers a /// doxygen-style comment as a docComment', () => {
    const source = '/// a triple-slash doc comment\nint x = 1;\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.kind).toBe('docComment');
  });

  it('groups consecutive /// lines at the same indent into one multi-part region', () => {
    const source = '/// Brief.\n/// More detail.\nvoid f();\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('docComment');
    expect(regions[0]!.parts).toHaveLength(2);
  });

  it('does not merge a /// doc comment with an adjacent /** */ one', () => {
    const source = '/// triple-slash\n/** double-star */\nvoid f();\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toHaveLength(2);
    expect(regions.every((region) => region.kind === 'docComment')).toBe(true);
    expect(regions.every((region) => region.parts.length === 1)).toBe(true);
  });

  it('groups an adjacent (implicit) string concatenation into one multi-part region', () => {
    const source = 'const char* x = "foo" "bar" "baz";\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('stringLiteral');
    expect(regions[0]!.parts).toHaveLength(3);
  });

  it('does not merge a "literal" + std::string(...) chain into one region', () => {
    const source = 'auto x = "foo" + std::string("bar");\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    // No @concat.operator pattern is declared at all (see descriptor.test.ts),
    // so "foo" and the "bar" argument to std::string(...) are discovered
    // as two independent, single-part stringLiteral regions rather than
    // one merged concatenation run.
    expect(regions).toHaveLength(2);
    expect(regions.every((r) => r.kind === 'stringLiteral' && r.parts.length === 1)).toBe(true);
  });

  it('discovers a string and comment inside a function', () => {
    const source = ['// greet somebody', 'const char* greet() {', '  return "hello there";', '}'].join('\n');
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions.map((r) => r.kind)).toEqual(['lineComment', 'stringLiteral']);
  });

  it('excludes a raw string literal from discovery entirely (a separate grammar node)', () => {
    const source = 'const char* x = R"(hello "world")";\n';
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toEqual([]);
  });

  it('excludes a char_literal from discovery entirely', () => {
    const source = "const char c = 'x';\n";
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toEqual([]);
  });

  it('discovers a wide-prefixed string literal as an ordinary stringLiteral region', () => {
    const source = 'const wchar_t* w = L"wide value";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.kind).toBe('stringLiteral');
  });

  it('isSafeToWrap refuses a concatenation run mixing distinct prefixes', () => {
    const source = 'const char* x = "abc" L"def";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(region!.parts).toHaveLength(2);
    expect(cppAdapter.isSafeToWrap!(region!, source)).toBe(false);
  });

  it('isSafeToWrap accepts a concatenation run sharing one prefix', () => {
    const source = 'const wchar_t* x = L"abc" L"def";\n';
    const tree = parser.parse(source)!;
    const [region] = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(cppAdapter.isSafeToWrap!(region!, source)).toBe(true);
  });

  // Line-continuation-escape and irregular-whitespace refusals are no
  // longer cppAdapter's own concern — they're `isStringSafeToWrapBaseline`'s
  // (`../../strings/is-string-safe-to-wrap-baseline.test.ts`), applied
  // unconditionally by `wrap.ts` before this hook is ever consulted.

  it('excludes strings and comments inside a macro body from discovery entirely', () => {
    const source = [
      '#define LOG(x) \\',
      '  do_log(x); \\',
      '  const char* s = "in macro"; // a comment too',
      'int y = 2;',
    ].join('\n');
    const tree = parser.parse(source)!;
    const regions = discoverRegions(cppAdapter, tree, source, 'cpp');
    expect(regions).toEqual([]);
  });
});
