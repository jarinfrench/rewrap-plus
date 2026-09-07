import type { LogicalDocument } from '../types/document.js';
import { decorateFirstLine } from '../reflow/decorate-block.js';
import { reflowBlock, type ReflowOptions } from '../reflow/reflow-block.js';

/**
 * Re-apply a language's line-comment marker (and, for reflowed content, its
 * observed spacing convention) to a dissolved-and-reflowed
 * `LogicalDocument`, producing the region's replacement source text.
 *
 * ## Column budget
 *
 * Every physical output line -- the first one included -- visually costs
 * `document.meta.indentColumn` leading columns plus the marker overhead
 * (`marker.length`, plus one more if `spaceAfterMarker`) before any
 * content starts. That's *unlike* `reflowBlock`'s own `hangingIndent`
 * parameter, which only discounts non-first lines of a block: for a
 * `'lineComment'` region, the first physical line pays the same
 * indent-column cost as every other one, because that indentation is
 * genuinely present in the file (it's just that the replacement text for
 * the first line doesn't need to *spell it out*, since `region.span`
 * starts right at the marker -- see `spellOutIndent` below). So the
 * indent/marker overhead is subtracted from `availableWidth` once, up
 * front, uniformly -- not folded into a per-block `hangingIndent` the way
 * a docstring's quote delimiter is.
 *
 * A block's own `hangingIndent` (`listItem`/`fieldEntry`) is still
 * passed through to `reflowBlock` as-is: that's a *content-internal*
 * alignment (continuation text lining up under a bullet or field label),
 * layered on top of the marker/indent overhead already subtracted from
 * `availableWidth`, not a substitute for it. `reflowBlock` itself never
 * writes the bullet/label text back in (see its own doc comment) -- that's
 * `../reflow/decorate-block.ts`'s `decorateFirstLine`, applied here to
 * every block's own reflowed lines before the comment marker is added.
 *

 * ## Marker placement
 *
 * `reflowBlock` is called for every block, `'verbatim'` included -- for a
 * verbatim block this is a no-op pass-through (see that function's own
 * doc comment), which is simpler than special-casing verbatim blocks out
 * of the loop. What differs per block is what happens to each resulting
 * line:
 *
 * - `'verbatim'` lines are already complete, marker and all (dissolve
 *   preserved them byte-for-byte) -- only the indent prefix is added.
 * - every other line gets `marker` prepended, plus a single space when
 *   `spaceAfterMarker` and the line has content -- and *no* trailing
 *   space when it doesn't (an empty `paragraph`/`blank` line becomes a
 *   bare marker, never `'# '` with nothing after the space: trailing
 *   whitespace should never be introduced, and there's no reason to get
 *   it wrong just because this particular case is easy).
 */
export function emitLineComments(
  document: LogicalDocument,
  columnLimit: number,
  marker: string,
  spaceAfterMarker: boolean,
  options: ReflowOptions = {},
): string {
  const markerOverhead = marker.length + (spaceAfterMarker ? 1 : 0);
  const indentColumn = document.meta.indentColumn;
  // Never let a deeply-indented, long-markered region compute a
  // negative or zero budget -- `reflowBlock`'s own overflow rule already
  // handles "this atom doesn't fit" gracefully, but it still needs a
  // positive width to reason about.
  const availableWidth = Math.max(1, columnLimit - indentColumn - markerOverhead);

  const outputLines: string[] = [];
  let isFirstLineOverall = true;

  for (const block of document.blocks) {
    const hangingIndent =
      block.type === 'listItem' || block.type === 'fieldEntry' ? block.hangingIndent : 0;
    // `firstLineReserve` matches `hangingIndent`: `decorateFirstLine`
    // (below) prepends exactly `hangingIndent` columns of marker text to
    // line 1, so `reflowBlock` needs to reserve that same width -- see
    // `ReflowOptions.firstLineReserve`'s own doc comment.
    const reflowed = decorateFirstLine(
      block,
      reflowBlock(block, availableWidth, hangingIndent, { ...options, firstLineReserve: hangingIndent }),
    );

    for (const line of reflowed) {
      const indentPrefix = spellOutIndent(isFirstLineOverall, indentColumn);
      const rendered =
        block.type === 'verbatim' ? line : withMarker(line, marker, spaceAfterMarker);
      outputLines.push(indentPrefix + rendered);
      isFirstLineOverall = false;
    }
  }

  return outputLines.join('\n');
}

/**
 * The very first output line never spells out its own indentation: the
 * `TextEdit` this feeds (`wrapRegions`) replaces `region.span`, which
 * starts at the marker itself -- the indentation
 * before it is untouched, pre-existing source text, not part of the
 * edit. Every later line is brand new text being inserted into the
 * document, so it has to spell its own indentation out to land in the
 * same visual column.
 */
function spellOutIndent(isFirstLineOverall: boolean, indentColumn: number): string {
  return isFirstLineOverall ? '' : ' '.repeat(indentColumn);
}

/**
 * Prefix one reflowed content line with the comment marker, honoring
 * the observed spacing convention (`DissolvedLineComments.spaceAfterMarker`)
 * and never leaving trailing whitespace after a bare marker.
 */
function withMarker(content: string, marker: string, spaceAfterMarker: boolean): string {
  if (content.length === 0) {
    return marker;
  }
  return spaceAfterMarker ? `${marker} ${content}` : `${marker}${content}`;
}
