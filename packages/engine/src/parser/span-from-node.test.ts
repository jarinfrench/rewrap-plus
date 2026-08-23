import { Parser, Language } from 'web-tree-sitter';
import { beforeAll, describe, expect, it } from 'vitest';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from './span-from-node.js';

// Relative to the process's cwd, which Vitest sets to this package's root
// (`packages/engine`). No `node:url`/`import.meta.url` here — this
// package's tests avoid depending on `@types/node` (see
// `../types/position-mapper.test.ts`).
const grammarPath = 'grammars/tree-sitter-python.wasm';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const language = await Language.load(grammarPath);
  parser = new Parser();
  parser.setLanguage(language);
});

describe('spanFromNode', () => {
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
    const source = 'x = "\u{1F600}\u65e5\u672c\u8a9e"\n';
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
