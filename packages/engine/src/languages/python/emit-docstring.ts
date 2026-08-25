import type { Block } from '../../types/document.js';
import type { ReflowOptions } from '../../reflow/reflow-block.js';
import { reflowDocBlocks } from '../../docs/dialect.js';
import type { DocstringQuoteMeta } from './dissolve-docstring.js';

/**
 * Re-apply a docstring's prefix, quote delimiters, and indentation to a
 * segmented-and-reflowed block sequence, producing the region's
 * replacement source text — the docstring counterpart to
 * `../../comments/emit-block-comments.ts`, and Python's own half of
 * `DocstringQuoteMeta`'s "restore on emit" contract
 * (`./dissolve-docstring.ts`).
 *
 * `blocks` reflow via `reflowDocBlocks` (`../../docs/dialect.ts`) —
 * exactly what every `DocDialect.emit` uses, since the dialect that
 * produced `blocks` has already baked all of its own display form into
 * `fieldEntry.label`/`sectionHeader.text`; nothing here needs to know
 * which dialect segmented them.
 *
 * ## Opening and closing placement
 *
 * The very first physical output line is always `prefix + quoteDelimiter
 * + <line 0's content, if any>` — whether line 0 has content at all is
 * exactly `meta.commonIndent`'s counterpart on the summary-line
 * convention: a blank line 0 (dissolve's own PEP 257 handling, see
 * `dissolveDocstring`) means the quote sits alone, and line 0's own
 * (empty) content becomes its own following blank physical line, rather
 * than anything special-cased here — the same reflowed-content array
 * either way.
 *
 * The closing delimiter either sits on its own new line, indented to
 * `commonIndent` (`closingQuoteOwnLine`), or attaches directly to
 * whatever ends up as the last physical line — which, after reflow, may
 * not be the same *line count* as the original had, but is still the
 * same last-line *attachment*, matching "preserved as observed" rather
 * than the original's exact shape.
 *
 * ## Quote-collision safety
 *
 * Reattaching content directly against a quote delimiter — on either
 * end — can change what the delimiter *means* if the adjacent character
 * would otherwise merge with it: content immediately touching the quote
 * character itself risks 4-in-a-row ambiguity, and content ending in an
 * unescaped backslash would escape away part of the closing delimiter
 * entirely (`\` + `"""` parses as an escaped `"` plus two stray `"`
 * characters, not a terminated string). `dissolveDocstring`'s own
 * PEP 257 trimming strips exactly the trailing whitespace that might
 * have been protecting against this in the original source, so this
 * function re-guards independently — see `needsOpeningSeparator`/
 * `needsClosingSeparator` — rather than assuming whatever adjacency the
 * original had is still safe once whitespace normalization has run.
 */
export function emitDocstring(
  blocks: readonly Block[],
  meta: DocstringQuoteMeta,
  columnLimit: number,
  reflowOptions: ReflowOptions = {},
): string {
  const { prefix, quoteDelimiter, indentColumn, commonIndent, closingQuoteOwnLine } = meta;
  const quoteChar = quoteDelimiter.charAt(0);
  const indent = ' '.repeat(commonIndent);
  const availableWidth = Math.max(1, columnLimit - commonIndent);

  // Every physical line pays `commonIndent` — except the very first,
  // which instead pays `indentColumn + prefix.length +
  // quoteDelimiter.length`: it attaches directly to the opening quote at
  // the delimiter's own file column (`indentColumn`), never
  // `commonIndent`'s own spelled-out spaces — see `physicalLines`'
  // construction below, and `emitLineComments`'s analogous "first line
  // never spells out its own indentation" note for why `indentColumn`
  // still counts against the *visual* budget even though it isn't
  // literal text in `newText`. Reflowing the *first* block at this
  // narrower budget, and every later block at the ordinary one, keeps
  // every physical line within `columnLimit`. A minor, deliberate
  // trade-off: this narrower budget applies to *every* line the first
  // block reflows to, not just its own first one — a long first block
  // (the summary itself needing several lines) wraps its later lines
  // slightly narrower than `columnLimit` strictly allows, since
  // `reflowBlock` has no way to vary the budget mid-block. Always
  // correct, occasionally a few columns short of optimal.
  const firstLineWidth = Math.max(
    1,
    columnLimit - indentColumn - prefix.length - quoteDelimiter.length,
  );

  const [firstBlock, ...restBlocks] = blocks;
  const contentLines = firstBlock
    ? [
        ...reflowDocBlocks([firstBlock], { availableWidth: firstLineWidth, reflowOptions }),
        ...reflowDocBlocks(restBlocks, { availableWidth, reflowOptions }),
      ]
    : [];

  const openingHasSummary = (contentLines[0] ?? '').length > 0;
  const firstContent = openingHasSummary
    ? maybeAddOpeningSeparator(contentLines[0]!, quoteChar)
    : '';

  const physicalLines: string[] = [prefix + quoteDelimiter + firstContent];
  const rest = openingHasSummary ? contentLines.slice(1) : contentLines;
  for (const line of rest) {
    physicalLines.push(line.length === 0 ? '' : indent + line);
  }

  if (closingQuoteOwnLine) {
    physicalLines.push(indent + quoteDelimiter);
  } else {
    const lastIndex = physicalLines.length - 1;
    physicalLines[lastIndex] =
      maybeAddClosingSeparator(physicalLines[lastIndex]!, quoteChar) + quoteDelimiter;
  }

  return physicalLines.join('\n');
}

function maybeAddOpeningSeparator(content: string, quoteChar: string): string {
  return content.startsWith(quoteChar) ? ` ${content}` : content;
}

function maybeAddClosingSeparator(content: string, quoteChar: string): string {
  if (content.endsWith(quoteChar)) {
    return `${content} `;
  }
  const trailingBackslashes = /\\+$/.exec(content)?.[0].length ?? 0;
  return trailingBackslashes % 2 === 1 ? `${content} ` : content;
}
