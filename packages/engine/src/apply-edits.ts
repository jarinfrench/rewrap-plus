import type { TextEdit } from './types/span.js';

/**
 * Compute the UTF-16 code-unit offset (into `source`, a plain JS string)
 * that corresponds to each line's start — index `i` is where line `i`
 * begins.
 *
 * Splits on `\n` alone, matching every other line-oriented convention
 * already established in this package (`../discovery/slice-span.ts`,
 * `../segmentation/to-lines.ts`) and sharing their same CRLF caveat: a
 * trailing `\r` on a CRLF file's lines ends up counted as part of the
 * *previous* line's content rather than stripped, which is fine here
 * since this function only cares about where each line *starts*, not
 * what it contains. Line-ending handling is normalized end to end
 * elsewhere in the codebase; this is consistent with every other
 * line-splitter here.
 */
function lineStartOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/**
 * Apply a set of `TextEdit`s to `source`, returning the resulting text.
 *
 * This is the counterpart every `WrapResult.edits` (from `wrapRegions`)
 * needs on the far side: something has to actually turn "replace this
 * span with this text" into a new document, whether that's a real
 * editor host's `WorkspaceEdit` (the VSCode extension) or — here — a
 * plain string, for engine-level round-trip testing and any other
 * non-VSCode consumer (the CLI) that wants the same "apply this batch
 * of edits" behavior without an editor in the loop.
 *
 * A `TextEdit.span`'s row/column fields are UTF-16 positions (per
 * `../types/span.ts`'s own doc comment) — the same units a JS string is
 * natively indexed in — so each span is converted to a flat UTF-16
 * offset pair via `lineStartOffsets` and then it's ordinary string
 * splicing; no `PositionMapper`/byte-offset conversion is needed (that
 * machinery exists for tree-sitter's byte-indexed world, which this
 * function never touches).
 *
 * Edits are applied in descending order of start offset — from the end
 * of the document backward — so that applying one edit never invalidates
 * the offsets already computed for the others. This assumes
 * non-overlapping edits, which is what `wrapRegions` always produces
 * (one edit per wrapped region, and regions are, by construction, either
 * disjoint spans or nested via `parts` rather than overlapping siblings);
 * behavior for genuinely overlapping input edits is unspecified.
 */
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) {
    return source;
  }

  const starts = lineStartOffsets(source);
  const withOffsets = edits.map((edit) => ({
    edit,
    startOffset: starts[edit.span.startRow]! + edit.span.startColumn,
    endOffset: starts[edit.span.endRow]! + edit.span.endColumn,
  }));
  withOffsets.sort((a, b) => b.startOffset - a.startOffset);

  let result = source;
  for (const { edit, startOffset, endOffset } of withOffsets) {
    result = result.slice(0, startOffset) + edit.newText + result.slice(endOffset);
  }
  return result;
}
