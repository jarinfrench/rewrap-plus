import type { Atom, Block } from '../types/document.js';
import { atomizeWords } from './atomize-words.js';
import { isListContinuation, matchListMarker } from './list-item.js';
import { toLines } from './to-lines.js';

/**
 * Options controlling `splitBlocks`. Threaded straight through from
 * `WrapConfig` by whatever calls this (dissolve, from Phase 6 onward) —
 * kept as its own narrow interface, per this project's established
 * pattern (see `../discovery/discover-regions.ts`'s `DiscoverRegionsOptions`),
 * rather than taking the whole `WrapConfig` and coupling this
 * language-agnostic module to that shape.
 */
export interface SplitBlocksOptions {
  /**
   * Treat indented lines within a paragraph as `verbatim` rather than
   * reflowing them. Unused until the next commit in this phase
   * ("add verbatim block detection") wires it in; accepted now so the
   * public signature doesn't change again mid-phase.
   */
  readonly preserveIndentedBlocks?: boolean;
}

/**
 * Turn dissolved region text into a flat sequence of `Block`s.
 *
 * This is the shared, language-agnostic half of Phase 4's goal ("turn raw
 * region text into a `LogicalDocument` of blocks") — the counterpart that
 * actually assembles a `LogicalDocument` (pairing this with `DocMeta`)
 * belongs to whichever dissolve step calls it (docstrings in Phase 8,
 * comments in Phase 6), since only the caller knows the region's
 * `indentColumn` and detected dialect.
 *
 * Blank lines separate paragraphs, and within a paragraph every line
 * break is soft — content from consecutive non-blank lines is merged
 * into one continuous atom stream, free to be reflowed without regard to
 * where the *original* line breaks fell.
 *
 * This commit adds list items (`./list-item.ts`): a line matching the
 * bullet/ordered-marker grammar starts a `listItem` block instead of
 * being folded into the surrounding paragraph, and its continuation
 * lines (indented further than the marker, per `isListContinuation`) are
 * merged into that same item's atom stream the same soft way a
 * paragraph's lines are. Verbatim regions (fenced code, doctests, tables,
 * `::`-triggered literal blocks, and indented blocks under
 * `preserveIndentedBlocks`) are recognized as their own block kind
 * starting with the next commit in this phase — until then, any
 * non-blank, non-list-marker line is treated as ordinary paragraph text,
 * including lines that will eventually be classified as verbatim.
 *
 * A run of blank source lines becomes one `blank` `Block` per line, not
 * one collapsed block for the whole run: `Block`'s `blank` variant carries
 * no count, so a 1:1 mapping is what keeps `splitBlocks` reversible
 * (`Block` count and blank-line count would otherwise diverge in a way
 * nothing here could reconstruct later).
 */
export function splitBlocks(text: string, options: SplitBlocksOptions = {}): Block[] {
  void options; // consumed once verbatim detection lands later in this phase

  const lines = toLines(text);
  const blocks: Block[] = [];
  let paragraphAtoms: Atom[] = [];

  const flushParagraph = (): void => {
    if (paragraphAtoms.length > 0) {
      blocks.push({ type: 'paragraph', atoms: paragraphAtoms });
      paragraphAtoms = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      flushParagraph();
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }

    const item = matchListMarker(line);
    if (item) {
      flushParagraph();
      const atoms = atomizeWords(item.rest);
      i++;
      while (i < lines.length && isListContinuation(lines[i]!, item)) {
        atoms.push(...atomizeWords(lines[i]!));
        i++;
      }
      blocks.push({
        type: 'listItem',
        marker: item.marker,
        hangingIndent: item.hangingIndent,
        atoms,
      });
      continue;
    }

    paragraphAtoms.push(...atomizeWords(line));
    i++;
  }
  flushParagraph();

  return blocks;
}
