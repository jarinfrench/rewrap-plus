import type { WrappableRegion } from '../types/region.js';

/**
 * Merge consecutive same-indent regions matching `isGroupable` into single
 * multi-part regions — "consecutive marker-per-line comments at the same
 * indent = one logical block," originally Python's own `'lineComment'`
 * grouping (`# `-comment blocks), generalized here once a second real
 * consumer needed the identical algorithm for a different `RegionKind`:
 * C++'s `///` Doxygen comments, which need the same adjacency merge but
 * for `'docComment'` regions specifically matching the repeated-marker
 * form (not every `'docComment'`, since a `/** ... * /`-form one is
 * already a single complete node needing no merge — see the caller).
 *
 * Two regions merge only if they're on strictly consecutive source rows
 * (`b.span.startRow === a.span.endRow + 1`) *and* share the same
 * `indentColumn` — a comment one line below but at a different
 * indentation (e.g. entering or leaving a nested block) starts a new
 * logical block instead of extending this one. This also means a
 * trailing comment (`x = 1  # note`) essentially never merges with an
 * unrelated standalone comment on the next line, since the two are
 * exceedingly unlikely to land on the same visual column by accident.
 *
 * `discoverRegions` sorts its final return value, but does *not*
 * guarantee the order regions arrive in when handed to a `groupRegions`
 * hook (the driver builds concatenation regions, then comments, then
 * leftover strings, each batch in tree-sitter capture order, which is
 * source order but not merged/sorted across kinds) — so groupable
 * entries are pulled out and sorted by position before the adjacency
 * scan runs, rather than trusting incoming order. Every other region
 * passes through untouched and in whatever relative order it arrived
 * in, since the final `sortByPosition` in `discoverRegions` fixes that
 * up regardless.
 */
export function groupAdjacentRegions(
  regions: readonly WrappableRegion[],
  isGroupable: (region: WrappableRegion) => boolean,
): WrappableRegion[] {
  const others = regions.filter((region) => !isGroupable(region));
  const groupable = regions
    .filter(isGroupable)
    .slice()
    .sort((a, b) => a.span.startRow - b.span.startRow || a.span.startColumn - b.span.startColumn);

  const merged: WrappableRegion[] = [];
  let run: WrappableRegion[] = [];

  const flushRun = (): void => {
    if (run.length === 0) {
      return;
    }
    merged.push(run.length === 1 ? run[0]! : mergeRegionRun(run));
    run = [];
  };

  for (const region of groupable) {
    const prev = run[run.length - 1];
    const continuesRun =
      prev !== undefined &&
      region.span.startRow === prev.span.endRow + 1 &&
      region.indentColumn === prev.indentColumn;
    if (!continuesRun) {
      flushRun();
    }
    run.push(region);
  }
  flushRun();

  return [...others, ...merged];
}

/**
 * Combine a run of single-part regions (adjacent source lines, same
 * indent, same `kind` — guaranteed by `groupAdjacentRegions`'s caller)
 * into one multi-part region spanning all of them.
 *
 * `rawText` approximates the true source slice by joining each part's
 * own text with `'\n' + ' '.repeat(indentColumn)` — reconstructing the
 * newline and re-indentation that sit *between* parts in real source,
 * which individual `WrappableRegion.rawText` values (each just their own
 * node's text, no surrounding whitespace — see `discoverRegions`'s
 * `buildRegion`) don't carry. This is exact for the overwhelmingly
 * common case of space-only indentation; a merged region indented with
 * tabs would see its `rawText` (display/debugging use only — see that
 * field's own doc comment) diverge slightly from the true byte sequence,
 * since `indentColumn` is tab-*expanded*. Nothing downstream treats
 * `rawText` as authoritative for a multi-part region: `wrapRegions`
 * compares prospective edits against a fresh `sliceSpanText(source,
 * region.span)` instead, precisely to avoid depending on this
 * approximation for correctness.
 */
function mergeRegionRun(run: readonly WrappableRegion[]): WrappableRegion {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const indentPrefix = '\n' + ' '.repeat(first.indentColumn);

  return {
    kind: first.kind,
    span: {
      startByte: first.span.startByte,
      endByte: last.span.endByte,
      startRow: first.span.startRow,
      startColumn: first.span.startColumn,
      endRow: last.span.endRow,
      endColumn: last.span.endColumn,
    },
    parts: run.flatMap((region) => region.parts),
    rawText: run.map((region) => region.rawText).join(indentPrefix),
    indentColumn: first.indentColumn,
    languageId: first.languageId,
  };
}
