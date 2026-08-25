/**
 * Normalize a node's raw source text for use as `WrappableRegion.rawText`
 * (and, transitively, the merged `rawText` a `groupRegions` hook like
 * Python's `mergeLineCommentRun` builds by joining several of them — see
 * `../languages/python/adapter.ts`): every line ending collapses to a
 * bare `\n`, regardless of what the underlying source file actually uses.
 *
 * Two distinct CRLF shapes need handling, both confirmed against the
 * vendored grammar directly (`docs/adapters.md`, "CRLF handling" —
 * probed the same way Phase 2/3 probed node shapes, not assumed):
 *
 * - A node whose span is fully interior to the source — e.g. a
 *   multi-line `concatenated_string` container — reproduces the file's
 *   real `\r\n` pairs verbatim in `node.text`, both characters inside
 *   the node's own extent.
 * - A `comment` node ends at end-of-line, but that boundary sits
 *   *before* the `\n` — which is not part of the node — while the `\r`
 *   immediately preceding it *is* included. So a comment on a
 *   CRLF-terminated line has `node.text` ending in a lone trailing `\r`
 *   with no paired `\n` anywhere in the same string.
 *
 * `.replace(/\r\n/g, '\n')` alone only fixes the first shape; a
 * separate `.replace(/\r$/, '')` catches the second. Both are applied
 * here, in that order, so a lone trailing `\r` left over after the
 * paired case is handled doesn't survive either.
 *
 * This only ever affects `rawText` — a field every consumer treats as
 * display/debugging output, not as an editing source (`wrapRegions`
 * always re-slices fresh text from `source` for anything that becomes
 * an actual edit; see that function's own doc comment). Nothing here
 * touches `SourceSpan` byte/row/column offsets, which still need to
 * reflect the node's true extent — including the trailing `\r` that
 * this function strips back out of the *text* — for slicing and editing
 * to stay correct. Confining the normalization to this one field is
 * what makes it safe to apply unconditionally rather than needing to
 * reason about every call site that reads a `SourceSpan`.
 */
export function normalizeRawText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r$/, '');
}
