import type { Atom, LogicalDocument } from '../types/document.js';
import type { WrappableRegion } from '../types/region.js';
import { sliceSpanText } from '../discovery/slice-span.js';
import { displayWidth } from '../segmentation/display-width.js';
import { atomizeWords } from '../segmentation/atomize-words.js';

/**
 * Language-specific data `dissolveProse` needs to turn a `'prose'`
 * region's physical lines into atoms — the prose counterpart of
 * `dissolveLineComments`'s `descriptor` parameter, but narrower: unlike a
 * comment marker (one fixed string, known from `LanguageDescriptor`
 * alone), hard-break detection and never-split forms genuinely vary in
 * *shape* per prose language, not just per value, so this is its own
 * small spec type rather than reusing `LanguageDescriptor.comments`.
 */
export interface ProseSpec {
  /**
   * Patterns tested, in order, against each physical line's raw text (the
   * line's own content, prefix already excluded per `WrappableRegion.parts`'
   * own contract). The *first* pattern that matches wins; each is
   * expected to anchor at the end of the line (`$`) itself — this
   * module trusts wherever a match
   * lands rather than enforcing that itself. Markdown's shape:
   * `/(\\|[ ]{2,}|<br\s*\/?>)$/i` (trailing backslash, two-or-more
   * spaces, or an HTML `<br>`); LaTeX's: line-break commands (`\\`,
   * `\newline`, ...) — see that plan's §4.2/§5.4/§6.4 for the concrete
   * patterns each adapter declares. Must be non-global (no `g` flag) —
   * see `../segmentation/unbreakable-spans.ts`'s `findUnbreakableSpans`
   * doc comment for why every regex-array parameter in this codebase
   * shares that expectation.
   */
  readonly hardBreak: readonly RegExp[];

  /**
   * Extra never-split atom patterns for this region's language, merged
   * into `atomizeWords`'s recognition for every line of this region only
   * — see `../segmentation/atomize-words.ts`'s `AtomizeWordsOptions.extraUnbreakable`.
   * Absent for a language with nothing beyond the shared built-in set
   * (Markdown, in v1); LaTeX passes `\verb`/`\lstinline`.
   */
  readonly extraUnbreakable?: readonly RegExp[];
}

/**
 * Dissolve a `'prose'` `WrappableRegion` into a `LogicalDocument`.
 *
 * Unlike `dissolveLineComments`, this never calls `splitBlocks`: a
 * `'prose'` region is already exactly one paragraph-shaped unit by
 * construction (`LanguageAdapter.discoverProse`'s own contract, one
 * region per paragraph) — the grammar-backed discovery that produced it
 * already resolved the block structure `splitBlocks` would otherwise be
 * re-guessing from text, which is the entire reason this project chose a
 * tree-sitter grammar for Markdown/LaTeX in the first place. So the
 * result is always exactly one `{ type: 'paragraph' }` block, atoms only.
 *
 * Walks `region.parts` (one per physical line) in order, atomizing each
 * line's content and concatenating the results into one flat atom
 * stream — an ordinary (non-hard-break) line boundary needs no special
 * handling at all: consecutive lines' atoms simply sit next to each
 * other in the stream with the default single-space join, letting
 * `reflowBlock` decide where to actually break, exactly as if the two
 * source lines had been one long line to begin with.
 *
 * ## Hard breaks
 *
 * When `spec.hardBreak` matches a line's trailing text (`matchHardBreak`,
 * below), the matched marker text is appended onto that line's *last*
 * atom — literally concatenated onto its `text`, with its `width` grown
 * by `displayWidth` of the marker (a two-space break stays exactly two
 * spaces and counts 2 columns of width) — and the
 * *following* line's first atom is tagged `breakBefore: true`, which
 * `reflowBlock` already honors under both fill modes (it forces a fresh
 * line the moment a `breakBefore` atom is next up — see that function's
 * own doc comment), so no reflow change is needed for the break itself to
 * take effect.
 *
 * Any whitespace between the last real word and where the hard-break
 * pattern's match begins is discarded, not preserved — consistent with
 * how ordinary inter-word whitespace already collapses everywhere else in
 * this pipeline (`atomizeWords`'s own doc comment: "any whitespace run
 * ... still collapses to one join"). In practice every real hard-break
 * form (a bare trailing backslash, `<br>` glued to the preceding word, a
 * TeX line-break command) sits immediately after content anyway, so this
 * is a theoretical edge case, not a lived one.
 *
 * A trailing two-space (or backslash/`<br>`) marker surviving into the
 * emitted line as real trailing whitespace is deliberate — the one
 * legitimate trailing whitespace this whole project produces; see
 * `../conformance/run-adapter-conformance.ts` for the conformance kit's
 * carve-out for it.
 */
export function dissolveProse(
  region: WrappableRegion,
  source: string,
  spec: ProseSpec,
): LogicalDocument {
  const atoms: Atom[] = [];
  let previousLineHadHardBreak = false;

  for (const part of region.parts) {
    const raw = sliceSpanText(source, part);
    const hardBreak = matchHardBreak(raw, spec.hardBreak);
    const content = hardBreak ? raw.slice(0, hardBreak.index) : raw;

    const lineAtoms = atomizeWords(
      content,
      spec.extraUnbreakable ? { extraUnbreakable: spec.extraUnbreakable } : {},
    );

    if (lineAtoms.length > 0 && previousLineHadHardBreak) {
      lineAtoms[0] = { ...lineAtoms[0]!, breakBefore: true };
    }

    if (hardBreak) {
      appendHardBreakMarker(lineAtoms, hardBreak.text, previousLineHadHardBreak);
    }

    atoms.push(...lineAtoms);
    previousLineHadHardBreak = hardBreak !== null;
  }

  return {
    blocks: [{ type: 'paragraph', atoms }],
    meta: { indentColumn: region.indentColumn },
  };
}

/**
 * The first `spec.hardBreak` pattern (in declaration order) that matches
 * `raw`, or `null`. Returns the match's own `index` (so the caller can
 * split off the content before it) and matched `text` (so the caller can
 * re-attach it verbatim, rather than reconstructing it from the pattern).
 */
function matchHardBreak(
  raw: string,
  patterns: readonly RegExp[],
): { readonly index: number; readonly text: string } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match) {
      return { index: match.index, text: match[0] };
    }
  }
  return null;
}

/**
 * Append a matched hard-break marker's text onto `lineAtoms`' last atom,
 * mutating the array in place (it's a fresh, line-local array from
 * `atomizeWords` — safe to mutate before it's pushed into the region's
 * shared atom stream).
 *
 * Handles the degenerate case of a line with no real content at all (an
 * empty `content` after stripping the marker — `atomizeWords('')` returns
 * `[]`) by synthesizing a single atom for the marker itself, rather than
 * silently dropping it. Shouldn't arise from either shipped adapter's own
 * `discoverProse` (a wholly blank line never becomes part of a
 * paragraph's `parts` in the first place, for either grammar), but a
 * correctness fallback is cheap and losing a hard break silently would be
 * a real, if rare, wrap-time regression.
 */
function appendHardBreakMarker(
  lineAtoms: Atom[],
  markerText: string,
  breakBeforeIfEmpty: boolean,
): void {
  if (lineAtoms.length === 0) {
    lineAtoms.push({
      text: markerText,
      width: displayWidth(markerText),
      breakBefore: breakBeforeIfEmpty,
    });
    return;
  }
  const last = lineAtoms[lineAtoms.length - 1]!;
  lineAtoms[lineAtoms.length - 1] = {
    ...last,
    text: last.text + markerText,
    width: last.width + displayWidth(markerText),
  };
}
