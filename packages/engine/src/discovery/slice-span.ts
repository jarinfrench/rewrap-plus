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
 * normalizing line endings is handled elsewhere; this function only
 * commits to slicing consistently with how the rest of the engine counts
 * columns today.
 */
// Single-entry, reference-equality cache of `source.split('\n')` for the
// most recently seen `source` string. `wrapRegions` (`../wrap.ts`) calls
// `sliceSpanText` once per region — directly, and indirectly through
// several dissolve functions and `isSafeToWrap` — always with the exact
// same `source` string reference for the whole of one invocation. Without
// this, every one of those calls re-split the entire file from scratch,
// making "wrap every region in the file" quadratic in file size: a
// 50,000-line synthetic benchmark file (10,000 regions) took roughly a
// minute to wrap before this fix, confirmed by direct profiling, and a
// small fraction of a second after it.
//
// A single cached entry (not an unbounded `Map`) is deliberate: `source`
// is fixed for the duration of one `wrapRegions` call, so one entry is
// all any real call site benefits from, and a long-lived process (the
// VSCode extension host, wrapping many different large files over a
// session) never accumulates memory for files it's done with. Reference
// equality (`===`), not content equality, is the right comparison here —
// it's `O(1)` rather than `O(source length)`, and every real caller
// passes the identical string object through, never a same-content copy.
let cachedSource: string | undefined;
let cachedLines: string[] | undefined;

function splitLinesCached(source: string): string[] {
  if (cachedSource === source && cachedLines !== undefined) {
    return cachedLines;
  }
  const lines = source.split('\n');
  cachedSource = source;
  cachedLines = lines;
  return lines;
}

/**
 * Prime this module's single-entry cache with a `source.split('\n')` the
 * caller already computed, so the first `sliceSpanText` call for `source`
 * reuses it instead of redundantly re-splitting — `wrapRegions` (`../wrap.ts`)
 * already splits `source` once, up front, for its own line-ending
 * detection, and calls this immediately after so that split is the *only*
 * one paid per `wrapRegions` invocation rather than one more on top of it.
 *
 * Safe to call with the exact array a caller is about to reuse elsewhere
 * too (nothing in this module ever mutates `cachedLines`), and safe to
 * call multiple times or not at all — same reference-equality contract
 * `splitLinesCached` above already has, just populated eagerly instead of
 * lazily on first `sliceSpanText` call.
 */
export function primeSliceSpanCache(source: string, lines: string[]): void {
  cachedSource = source;
  cachedLines = lines;
}

export function sliceSpanText(source: string, span: SourceSpan): string {
  const lines = splitLinesCached(source);
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
