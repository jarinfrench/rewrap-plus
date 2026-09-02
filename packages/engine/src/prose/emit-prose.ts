import type { LogicalDocument } from '../types/document.js';
import { reflowBlock, type ReflowOptions } from '../reflow/reflow-block.js';

/**
 * Per-region layout `emitProse` needs beyond what `LogicalDocument.meta`
 * already carries — the prose counterpart of `emitLineComments`'
 * `marker`/`spaceAfterMarker` parameters, but computed by the adapter
 * (`docs/planning/markdown-latex-plan.md` §5.3/§6.3), not descriptor
 * data, since a prose region's continuation prefix is derived per-region
 * from its container ancestry rather than being one fixed value for the
 * whole language.
 */
export interface ProseLayout {
  /**
   * Text prepended to every physical output line after the first — a
   * block quote's `>`/`>> `, a list item's hanging-indent spaces, a
   * LaTeX `\item` continuation's own indent, .... Never spelled out on
   * line 1 itself; see this function's own doc comment for why.
   */
  readonly continuationPrefix: string;
}

/**
 * Reflow a dissolved `'prose'` region (`dissolveProse`) and re-apply its
 * per-line continuation prefix, producing the region's replacement
 * source text.
 *
 * ## Column budget
 *
 * A single `availableWidth = columnLimit - document.meta.indentColumn`
 * is used for *every* line, first and continuation alike — unlike
 * `emitLineComments`, which subtracts a constant marker width once and
 * relies on every line sharing that same marker, this leans on
 * `WrappableRegion.indentColumn`'s own contract ("the visual column of
 * the content start") and `../types/adapter.ts`'s `wrapProse` callers
 * deriving `continuationPrefix` specifically so it lands at that same
 * visual column (`docs/planning/markdown-latex-plan.md` §5.3's
 * continuation-prefix table is built for exactly this property). The two
 * widths coincide exactly except when the prefix contains a tab:
 * `indentColumn` is tab-*expanded* (`../discovery/visual-indent-column.ts`),
 * while `displayWidth` (used nowhere in this function, notably) treats a
 * tab as a single column — so a tab-containing prefix's *true* visual
 * width can differ slightly from `indentColumn`. This is the same
 * approximation `../comments/group-adjacent-regions.ts` already accepts
 * for its own tab-indented `rawText` case (see that module's own doc
 * comment): exact for the overwhelmingly common space-only-indentation
 * case, and not treated as authoritative for correctness anywhere
 * (`wrapRegions` always diffs the actual emitted text against source,
 * never depends on the budget calculation itself being byte-exact).
 *
 * ## Line 1 is emitted bare
 *
 * The `TextEdit` this feeds (`../wrap.ts`) replaces `region.span`, which
 * starts *after* the first physical line's own container prefix — that
 * prefix is untouched, pre-existing source text, not part of the edit —
 * so line 1 of the output carries no prefix of its own. Every line after
 * that is brand-new text being inserted, so it spells out
 * `layout.continuationPrefix` to land in the same visual column. The
 * identical reasoning `../comments/emit-line-comments.ts`'s
 * `spellOutIndent` documents for its own first-line case.
 *
 * `dissolveProse` always produces exactly one `paragraph` block (see its
 * own doc comment), so this reduces to one `reflowBlock` call in
 * practice — implemented as a loop over `document.blocks` anyway, purely
 * for structural symmetry with `emitLineComments`, not because more than
 * one block is ever expected here.
 */
export function emitProse(
  document: LogicalDocument,
  columnLimit: number,
  layout: ProseLayout,
  reflowOptions: ReflowOptions = {},
): string {
  const indentColumn = document.meta.indentColumn;
  // Never let a deeply-indented region compute a negative or zero
  // budget — `reflowBlock`'s own overflow rule already handles "this atom
  // doesn't fit" gracefully, but it still needs a positive width to
  // reason about (the same guard `emitLineComments` applies).
  const availableWidth = Math.max(1, columnLimit - indentColumn);

  const outputLines: string[] = [];
  let isFirstLineOverall = true;

  for (const block of document.blocks) {
    // `hangingIndent: 0` — a `'prose'` region's dissolved block is always
    // a bare `paragraph` (no `listItem`/`fieldEntry` marker of its own to
    // align continuation text under), so `reflowBlock` adds no literal
    // indent of its own; `layout.continuationPrefix` below is prepended
    // externally instead, the same division of labor
    // `emitLineComments` uses for its own marker.
    const reflowed = reflowBlock(block, availableWidth, 0, reflowOptions);

    for (const line of reflowed) {
      outputLines.push(isFirstLineOverall ? line : layout.continuationPrefix + line);
      isFirstLineOverall = false;
    }
  }

  return outputLines.join('\n');
}
