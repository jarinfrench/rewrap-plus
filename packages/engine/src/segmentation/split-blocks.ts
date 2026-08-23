import type { Atom, Block } from '../types/document.js';
import { atomizeWords } from './atomize-words.js';
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
 * This commit handles only the two simplest block kinds, per the plan:
 * blank lines separate paragraphs, and within a paragraph every line
 * break is soft — content from consecutive non-blank lines is merged
 * into one continuous atom stream, free to be reflowed without regard to
 * where the *original* line breaks fell. List items and verbatim regions
 * (fenced code, doctests, tables, `::`-triggered literal blocks, and
 * indented blocks under `preserveIndentedBlocks`) are recognized as their
 * own block kinds starting with the next two commits in this phase —
 * until then, every non-blank line is treated as ordinary paragraph text.
 *
 * A run of blank source lines becomes one `blank` `Block` per line, not
 * one collapsed block for the whole run: `Block`'s `blank` variant carries
 * no count, so a 1:1 mapping is what keeps `splitBlocks` reversible
 * (`Block` count and blank-line count would otherwise diverge in a way
 * nothing here could reconstruct later).
 */
export function splitBlocks(text: string, options: SplitBlocksOptions = {}): Block[] {
  void options; // consumed once verbatim detection lands later in this phase

  const blocks: Block[] = [];
  let paragraphAtoms: Atom[] = [];

  const flushParagraph = (): void => {
    if (paragraphAtoms.length > 0) {
      blocks.push({ type: 'paragraph', atoms: paragraphAtoms });
      paragraphAtoms = [];
    }
  };

  for (const line of toLines(text)) {
    if (line.trim() === '') {
      flushParagraph();
      blocks.push({ type: 'blank' });
      continue;
    }
    paragraphAtoms.push(...atomizeWords(line));
  }
  flushParagraph();

  return blocks;
}
