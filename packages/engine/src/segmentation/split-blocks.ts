import type { Atom, Block } from '../types/document.js';
import { atomizeWords } from './atomize-words.js';
import { isListContinuation, matchListMarker } from './list-item.js';
import { toLines } from './to-lines.js';
import {
  leadingWhitespaceLength,
  matchDoctestBlock,
  matchFencedCode,
  matchIndentedRun,
  matchTableBlock,
} from './verbatim.js';

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
   * Treat indented, non-list-marker lines as `verbatim` rather than
   * reflowing them. The reST `::`-triggered literal-block convention
   * (see `./verbatim.ts`) is recognized regardless of this option — it's
   * an explicit syntactic marker, not a heuristic — this option is only
   * for the more aggressive "any indented line is verbatim" behavior.
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
 * Line-by-line, in priority order:
 *
 * 1. **Blank** — a whitespace-only line becomes its own `blank` block
 *    (see the note below on why blank blocks aren't collapsed).
 * 2. **`::`-triggered literal block** — if the paragraph immediately
 *    before the last blank line ended with `::`, and this line is
 *    indented, the whole contiguous indented/blank run becomes one
 *    `verbatim` block (`./verbatim.ts`'s `matchIndentedRun`), per the
 *    reST literal-block convention. Always active, independent of
 *    `preserveIndentedBlocks`.
 * 3. **Fenced code** (```` ``` ```` / `~~~`), **doctest** (`>>>`/`...`),
 *    and **Markdown table** (`|`-delimited with a delimiter row) —
 *    each its own `verbatim` block, per `./verbatim.ts`. Checked ahead
 *    of list-item and paragraph handling: a line that happens to also
 *    look like a list marker or ordinary prose still gets the verbatim
 *    treatment if it opens one of these ("bias toward verbatim when
 *    uncertain" — a missed reflow opportunity is invisible, a mangled
 *    table is a bug report).
 * 4. **List item** (`./list-item.ts`) — a line matching the
 *    bullet/ordered-marker grammar starts a `listItem` block; its
 *    continuation lines (indented further than the marker) merge into
 *    that item's atom stream the same soft way a paragraph's lines do.
 * 5. **Indented block** under `preserveIndentedBlocks` — any remaining
 *    indented line becomes a `verbatim` block for the whole contiguous
 *    indented/blank run, same mechanics as case 2.
 * 6. **Paragraph** (fallback) — merged into the current paragraph's atom
 *    stream; consecutive non-blank paragraph lines share one `paragraph`
 *    block, since within a paragraph every line break is soft.
 *
 * A run of blank source lines becomes one `blank` `Block` per line, not
 * one collapsed block for the whole run: `Block`'s `blank` variant carries
 * no count, so a 1:1 mapping is what keeps `splitBlocks` reversible
 * (`Block` count and blank-line count would otherwise diverge in a way
 * nothing here could reconstruct later).
 */
export function splitBlocks(text: string, options: SplitBlocksOptions = {}): Block[] {
  const lines = toLines(text);
  const blocks: Block[] = [];
  let paragraphAtoms: Atom[] = [];
  let lastParagraphRawLine = '';
  let literalBlockPending = false;

  /** Flushes the in-progress paragraph, if any, returning whether its
   * last raw line ended with `::` (the reST literal-block trigger). */
  const flushParagraph = (): boolean => {
    const endsWithColonColon =
      paragraphAtoms.length > 0 && lastParagraphRawLine.trim().endsWith('::');
    if (paragraphAtoms.length > 0) {
      blocks.push({ type: 'paragraph', atoms: paragraphAtoms });
      paragraphAtoms = [];
    }
    lastParagraphRawLine = '';
    return endsWithColonColon;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      if (flushParagraph()) {
        literalBlockPending = true;
      }
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }

    if (literalBlockPending) {
      literalBlockPending = false; // this non-blank line resolves it either way
      if (leadingWhitespaceLength(line) > 0) {
        const run = matchIndentedRun(lines, i);
        if (run) {
          blocks.push({ type: 'verbatim', lines: run.lines });
          i = run.nextIndex;
          continue;
        }
      }
      // No indented content followed the trailing "::" after all — fall
      // through and let this line be classified normally.
    }

    const fence = matchFencedCode(lines, i);
    if (fence) {
      flushParagraph();
      blocks.push({ type: 'verbatim', lines: fence.lines });
      i = fence.nextIndex;
      continue;
    }

    const doctest = matchDoctestBlock(lines, i);
    if (doctest) {
      flushParagraph();
      blocks.push({ type: 'verbatim', lines: doctest.lines });
      i = doctest.nextIndex;
      continue;
    }

    const table = matchTableBlock(lines, i);
    if (table) {
      flushParagraph();
      blocks.push({ type: 'verbatim', lines: table.lines });
      i = table.nextIndex;
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

    if (options.preserveIndentedBlocks && leadingWhitespaceLength(line) > 0) {
      const run = matchIndentedRun(lines, i);
      if (run) {
        flushParagraph();
        blocks.push({ type: 'verbatim', lines: run.lines });
        i = run.nextIndex;
        continue;
      }
    }

    paragraphAtoms.push(...atomizeWords(line));
    lastParagraphRawLine = line;
    i++;
  }
  flushParagraph();

  return blocks;
}
