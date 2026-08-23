import type { SourceSpan } from '../types/span.js';

/**
 * Extract the literal source text covered by `span` from `source`.
 *
 * `SourceSpan`'s row/column fields are UTF-16 code-unit positions (see
 * `../types/span.ts`) — the same units a plain JS string is natively
 * indexed in — so this needs no byte-offset conversion and no
 * `PositionMapper`; it only needs to know where each line starts.
 *
 * This is a generic, language-independent utility (it knows nothing about
 * tree-sitter or Python): anything holding a `SourceSpan` and the original
 * `source` text — most notably a hook like `LanguageAdapter.isSafeToWrap`,
 * which only receives a `WrappableRegion` and `source`, not a live syntax
 * node — can use it to recover the exact text of one part of a region.
 *
 * Shares the CRLF caveat already noted on `PositionMapper`
 * (`../types/position-mapper.ts`): splitting on `\n` alone leaves a
 * trailing `\r` as part of each line's text for a CRLF file. Detecting and
 * normalizing line endings is Phase 10's job; this function only commits
 * to slicing consistently with how the rest of the engine counts columns
 * today.
 */
export function sliceSpanText(source: string, span: SourceSpan): string {
  const lines = source.split('\n');
  const startLine = lines[span.startRow];
  const endLine = lines[span.endRow];
  if (startLine === undefined || endLine === undefined) {
    throw new Error(
      `sliceSpanText: span rows [${span.startRow}, ${span.endRow}] out of range for ` +
        `source with ${lines.length} line(s)`,
    );
  }

  if (span.startRow === span.endRow) {
    return startLine.slice(span.startColumn, span.endColumn);
  }

  const middleLines = lines.slice(span.startRow + 1, span.endRow);
  return [startLine.slice(span.startColumn), ...middleLines, endLine.slice(0, span.endColumn)].join(
    '\n',
  );
}
