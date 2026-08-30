import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from './span-from-node.js';

describe('spanFromNode', () => {
  describe('python grammar', () => {
    // Relative to the process's cwd, which Vitest sets to this package's
    // root (`packages/engine`). No `node:url`/`import.meta.url` here —
    // this package's tests avoid depending on `@types/node` (see
    // `../types/position-mapper.test.ts`).
    const grammarPath = 'grammars/tree-sitter-python.wasm';

    let parser: Parser;

    beforeAll(async () => {
      await Parser.init();
      const language = await Language.load(grammarPath);
      parser = new Parser();
      parser.setLanguage(language);
    });

    it('reports byte offsets equal to row/column-derived offsets for plain ASCII', () => {
      const source = 'x = "hi"\n';
      const tree = parser.parse(source)!;
      const stringNode = tree.rootNode.descendantsOfType('string')[0]!;
      const mapper = new PositionMapper(source);

      const span = spanFromNode(stringNode, mapper);

      expect(span).toEqual({
        startByte: 4,
        endByte: 8,
        startRow: 0,
        startColumn: 4,
        endRow: 0,
        endColumn: 8,
      });
    });

    // Regression test for docs/parsing.md finding 3: web-tree-sitter's own
    // `node.startIndex`/`node.endIndex` are UTF-16 code-unit offsets when
    // fed a JS string, not UTF-8 byte offsets — despite `SourceSpan`'s
    // byte-offset contract and despite web-tree-sitter's own (misleading)
    // "UTF8-encoded text" doc comment. Expected byte offsets below were
    // independently computed in Python before this assertion was written
    // (see the project's stated practice of verifying offset arithmetic
    // out-of-band), not derived from the same code path under test.
    //
    //   x = "😀日本語"
    //   ^^^^^          5 ASCII chars before the opening quote's content
    //         😀 = 4 UTF-8 bytes (2 UTF-16 units, astral / surrogate pair)
    //           日本語 = 3 UTF-8 bytes each (1 UTF-16 unit each)
    //
    //   UTF-16: content spans [5, 10)   (2 + 1 + 1 + 1 = 5 units)
    //   UTF-8:  content spans [5, 18)   (4 + 3 + 3 + 3 = 13 bytes)
    it("derives true UTF-8 byte offsets for non-ASCII content, not web-tree-sitter's UTF-16 node indices", () => {
      const source = 'x = "\u{1F600}日本語"\n';
      const tree = parser.parse(source)!;
      const contentNode = tree.rootNode.descendantsOfType('string_content')[0]!;
      const mapper = new PositionMapper(source);

      // Sanity-check the premise: web-tree-sitter's own node indices are
      // the UTF-16 count, not the UTF-8 byte count, for this input.
      expect(contentNode.startIndex).toBe(5);
      expect(contentNode.endIndex).toBe(10);

      const span = spanFromNode(contentNode, mapper);

      expect(span.startByte).toBe(5);
      expect(span.endByte).toBe(18);
      expect(span.startColumn).toBe(5);
      expect(span.endColumn).toBe(10);
    });

    it('handles a span crossing multiple lines', () => {
      const source = 'x = """\nhello\n"""\n';
      const tree = parser.parse(source)!;
      const stringNode = tree.rootNode.descendantsOfType('string')[0]!;
      const mapper = new PositionMapper(source);

      const span = spanFromNode(stringNode, mapper);

      expect(span.startRow).toBe(0);
      expect(span.endRow).toBe(2);
      expect(span.startByte).toBeLessThan(span.endByte);
    });
  });

  // The non-ASCII/UTF-16 finding above was only ever probed against
  // Python's grammar — every other adapter's own test suite (including
  // the newer cpp/java adapters, see docs/adapters.md) inherited the
  // *mechanism* (spanFromNode is generic, PositionMapper doesn't know
  // what language it's mapping) without a second grammar's own node
  // shape ever being probed directly against non-ASCII content. That gap
  // matters here specifically because this project's own CRLF-handling
  // history (docs/adapters.md, "CRLF handling") already found one real
  // case where a grammar-specific node shape broke an assumption that
  // held for Python — trailing-`\r` inclusion differed between Python's
  // and JavaScript's `comment` node. Non-ASCII offset handling is a
  // property of how web-tree-sitter itself indexes the JS source string
  // (docs/parsing.md finding 3), not of a specific grammar, so this is
  // expected to keep holding — but "expected to hold" is exactly the
  // kind of assumption this project's own convention says to probe
  // directly rather than trust, and neither cpp nor java had been.
  //
  // Both blocks below reuse the identical 😀日本語 payload as the Python
  // case, through both a comment and a string, cross-checked directly
  // against `spanFromNode`'s own output before being written here (not
  // hand-derived alone) — the project's stated verification practice
  // applied to a case where independent computation and "run the code
  // once to see" happen to be easy to do side by side.
  describe('cpp grammar — non-ASCII regression', () => {
    let parser: Parser;

    beforeAll(async () => {
      await Parser.init();
      const language = await Language.load('grammars/tree-sitter-cpp.wasm');
      parser = new Parser();
      parser.setLanguage(language);
    });

    // int x = 1; // 😀日本語 comment
    // ^^^^^^^^^^^^                 11 ASCII chars before the comment's own `//`
    //               // 😀日本語 comment
    //               "// " (3) + 😀 (4 bytes/2 units) + 日本語 (9 bytes/3 units) + " comment" (8) = 24 bytes / 16 units
    it('derives true UTF-8 byte offsets for a // comment containing non-ASCII content', () => {
      const source = 'int x = 1; // \u{1F600}日本語 comment\n';
      const tree = parser.parse(source)!;
      const commentNode = tree.rootNode.descendantsOfType('comment')[0]!;
      const mapper = new PositionMapper(source);

      expect(commentNode.startIndex).toBe(11);
      expect(commentNode.endIndex).toBe(27);

      const span = spanFromNode(commentNode, mapper);

      expect(span.startByte).toBe(11);
      expect(span.endByte).toBe(35);
      expect(span.startColumn).toBe(11);
      expect(span.endColumn).toBe(27);
    });

    // const char* s = "😀日本語";
    //                  ^^^^^^^ content: 😀 (4 bytes/2 units) + 日本語 (9 bytes/3 units) = 13 bytes / 5 units
    // 17 ASCII chars precede the opening quote's content.
    it('derives true UTF-8 byte offsets for a string_content node containing non-ASCII content', () => {
      const source = 'const char* s = "\u{1F600}日本語";\n';
      const tree = parser.parse(source)!;
      const contentNode = tree.rootNode.descendantsOfType('string_content')[0]!;
      const mapper = new PositionMapper(source);

      expect(contentNode.startIndex).toBe(17);
      expect(contentNode.endIndex).toBe(22);

      const span = spanFromNode(contentNode, mapper);

      expect(span.startByte).toBe(17);
      expect(span.endByte).toBe(30);
      expect(span.startColumn).toBe(17);
      expect(span.endColumn).toBe(22);
    });
  });

  describe('java grammar — non-ASCII regression', () => {
    let parser: Parser;

    beforeAll(async () => {
      await Parser.init();
      const language = await Language.load('grammars/tree-sitter-java.wasm');
      parser = new Parser();
      parser.setLanguage(language);
    });

    // class Foo { // 😀日本語 comment
    // ^^^^^^^^^^^^                 12 ASCII chars before the comment's own `//`
    it('derives true UTF-8 byte offsets for a line_comment node containing non-ASCII content', () => {
      const source = 'class Foo { // \u{1F600}日本語 comment\n  int x = 1;\n}\n';
      const tree = parser.parse(source)!;
      const commentNode = tree.rootNode.descendantsOfType('line_comment')[0]!;
      const mapper = new PositionMapper(source);

      expect(commentNode.startIndex).toBe(12);
      expect(commentNode.endIndex).toBe(28);

      const span = spanFromNode(commentNode, mapper);

      expect(span.startByte).toBe(12);
      expect(span.endByte).toBe(36);
      expect(span.startColumn).toBe(12);
      expect(span.endColumn).toBe(28);
    });

    // class Foo { String s = "😀日本語"; }
    // 23 ASCII chars precede the opening quote; string_literal includes
    // both quote characters (1 byte/unit each) around the same content.
    it('derives true UTF-8 byte offsets for a string_literal node containing non-ASCII content', () => {
      const source = 'class Foo { String s = "\u{1F600}日本語"; }\n';
      const tree = parser.parse(source)!;
      const stringNode = tree.rootNode.descendantsOfType('string_literal')[0]!;
      const mapper = new PositionMapper(source);

      expect(stringNode.startIndex).toBe(23);
      expect(stringNode.endIndex).toBe(30);

      const span = spanFromNode(stringNode, mapper);

      expect(span.startByte).toBe(23);
      expect(span.endByte).toBe(38);
      expect(span.startColumn).toBe(23);
      expect(span.endColumn).toBe(30);
    });
  });
});
