import type { SyntaxNode } from '../types/tree-sitter-types.js';
import { PositionMapper, type Position } from '../types/position-mapper.js';
import type { SourceSpan } from '../types/span.js';

/**
 * Build a `SourceSpan` from a tree-sitter node.
 *
 * **Deliberately does not use `node.startIndex`/`node.endIndex`.** Those
 * read as UTF-8 byte offsets — that's what native tree-sitter bindings
 * give you, it's what `web-tree-sitter`'s own `Parser#parse` doc comment
 * claims ("the UTF8-encoded text to parse"), and it's what `SourceSpan`'s
 * own doc comment originally assumed. But `web-tree-sitter`, fed a plain
 * JS string as this project always does,
 * actually reports `startIndex`/`endIndex`/every `Point.column` as
 * UTF-16 code-unit offsets — identical in kind to `node.startPosition`/
 * `node.endPosition`, and to `vscode.Position`. Passing `node.startIndex`
 * to something expecting a real byte offset silently produces a wrong,
 * too-small value for any non-ASCII text. See `docs/parsing.md` (finding
 * 3) for the spike that found this, with a worked example.
 *
 * Instead: treat `startPosition`/`endPosition` as the authoritative,
 * already-UTF-16 position (which is genuinely what they are), and derive
 * true UTF-8 `startByte`/`endByte` from them via `PositionMapper`, going
 * through the same conversion every other part of the engine uses.
 */
export function spanFromNode(node: SyntaxNode, mapper: PositionMapper): SourceSpan {
  const start: Position = { line: node.startPosition.row, character: node.startPosition.column };
  const end: Position = { line: node.endPosition.row, character: node.endPosition.column };

  return {
    startByte: mapper.positionToByteOffset(start),
    endByte: mapper.positionToByteOffset(end),
    startRow: start.line,
    startColumn: start.character,
    endRow: end.line,
    endColumn: end.character,
  };
}
