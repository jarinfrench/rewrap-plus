import type { DiscoverRegionsOptions } from '../../types/adapter.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { SyntaxNode, Tree } from '../../types/tree-sitter-types.js';
import { PositionMapper } from '../../types/position-mapper.js';
import { captureNodes } from '../../discovery/capture.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { normalizeRawText } from '../../discovery/normalize-raw-text.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { markdownDescriptor } from './descriptor.js';

/**
 * A footnote definition's opening line (`[^note]: body text`) — not a
 * grammar concept in `tree-sitter-markdown` (confirmed directly: it
 * parses as an ordinary `paragraph`, no dedicated node), so this is a
 * text-shape exclusion rather than a node-type one. Rewrap treats a
 * footnote's continuation as 4-space-indented, which this adapter's
 * canonical block-quote/list-derived continuation prefix
 * (`./continuation-prefix.ts`, commit 10) would get wrong — excluded
 * from discovery entirely rather than wrapped incorrectly, per
 * `docs/planning/markdown-latex-plan.md` §5.2/§3.3 item 4.
 */
const FOOTNOTE_DEFINITION = /^\s*\[\^[^\]\s]+\]:/;

/**
 * Find every `'prose'` region in a Markdown `tree` — `LanguageAdapter.discoverProse`'s
 * implementation for this language (`./adapter.ts`).
 *
 * Runs `markdownDescriptor.queries.prose` (`(paragraph) @prose`) and
 * builds one region per captured `paragraph` node, excluding:
 *
 * - a paragraph whose parent is `setext_heading` — its text is the
 *   heading, never wrapped in v1 (§3.3 item 3). Confirmed directly
 *   (`docs/parsing.md` Finding 7): a `setext_heading`'s children are
 *   exactly `[paragraph, setext_h1_underline]` (or `_h2_`), so this is a
 *   one-line parent-type check.
 * - a paragraph whose first physical line looks like a footnote
 *   definition (`FOOTNOTE_DEFINITION` above).
 * - a paragraph containing any physical line that is exactly `$$` or
 *   begins with it — display math (Markdown-with-MathJax/KaTeX); the
 *   block grammar has no math node at all, so a `$$...$$` block that
 *   isn't separated from surrounding prose by blank lines parses as part
 *   of one ordinary paragraph (confirmed directly), and reflowing the
 *   equation lines inside it would corrupt them. Conservative by design —
 *   excludes the *whole* paragraph, not just the `$$` lines within it.
 *
 * A paragraph overlapping a parse `ERROR` node needs no exclusion here:
 * `wrap.ts`'s `wrapRegions` already skips any region overlapping one,
 * for every region kind uniformly (`docs/planning/markdown-latex-plan.md`
 * §5.2's own note that this is "already handled generically").
 *
 * ## Region geometry
 *
 * Built entirely from `source`'s own physical lines and each paragraph
 * node's row range — never from walking `inline`'s children — per
 * `docs/planning/markdown-latex-plan.md` §5.2's own instruction, itself
 * forced by a real finding: `block_continuation` turned out to be a
 * child of the paragraph's `inline` node, not of `paragraph` directly
 * (`docs/parsing.md` Finding 7), so relying on tree structure for
 * per-line boundaries would have been fragile in a way a source-line scan
 * isn't. `lastContentRow` below handles the one real geometry surprise
 * confirmed by direct probing: `paragraph.endPosition` lands one row
 * *past* the last content row (column 0 of the line after) whenever a
 * trailing newline follows the paragraph in the source, but points at the
 * real end column of the actual last line when the file ends without one
 * (probed both shapes directly — this function does not merely assume
 * the "one row past" case is universal).
 */
export function discoverMarkdownProse(
  tree: Tree,
  source: string,
  languageId: string,
  options: DiscoverRegionsOptions,
): WrappableRegion[] {
  const tabSize = options.tabSize ?? 4;
  const sourceLines = source.split('\n');
  const mapper = new PositionMapper(source);

  const paragraphs = captureNodes(tree, markdownDescriptor.queries.prose!, 'prose');
  const regions: WrappableRegion[] = [];

  for (const paragraph of paragraphs) {
    if (isExcluded(paragraph, sourceLines)) {
      continue;
    }

    const parts = buildParts(paragraph, sourceLines, mapper);
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (!first || !last) {
      continue; // a paragraph with no content lines shouldn't occur; skip rather than build a degenerate region
    }

    const span: SourceSpan = {
      startByte: first.startByte,
      endByte: last.endByte,
      startRow: first.startRow,
      startColumn: first.startColumn,
      endRow: last.endRow,
      endColumn: last.endColumn,
    };

    regions.push({
      kind: 'prose',
      span,
      parts,
      rawText: parts.map((part) => normalizeRawText(sliceSpanText(source, part))).join('\n'),
      indentColumn: visualIndentColumn(
        sourceLines[paragraph.startPosition.row] ?? '',
        paragraph.startPosition.column,
        tabSize,
      ),
      languageId,
    });
  }

  return regions;
}

function isExcluded(paragraph: SyntaxNode, sourceLines: readonly string[]): boolean {
  if (paragraph.parent?.type === 'setext_heading') {
    return true;
  }

  const startRow = paragraph.startPosition.row;
  if (FOOTNOTE_DEFINITION.test(sourceLines[startRow] ?? '')) {
    return true;
  }

  const lastRow = lastContentRow(paragraph);
  for (let row = startRow; row <= lastRow; row++) {
    const line = (sourceLines[row] ?? '').replace(/\r$/, '').trimStart();
    if (line === '$$' || line.startsWith('$$')) {
      return true;
    }
  }

  return false;
}

/**
 * The row a paragraph node's content genuinely ends on — see this file's
 * own doc comment for the two confirmed shapes `paragraph.endPosition`
 * takes. `column === 0` on a row strictly after `startPosition.row` is
 * the reliable signal for "this is one row past the real end" (a
 * Markdown paragraph line is never genuinely empty — a blank line always
 * terminates the paragraph before it — so this shape never legitimately
 * means "the last real line was empty").
 */
function lastContentRow(paragraph: SyntaxNode): number {
  const { row: endRow, column: endColumn } = paragraph.endPosition;
  return endColumn === 0 && endRow > paragraph.startPosition.row ? endRow - 1 : endRow;
}

/**
 * Every `block_continuation` node under `paragraph`, indexed by the row
 * it starts on — one per continuation line that has a container prefix
 * to record (a lazy continuation line has none, confirmed directly, and
 * simply has no entry here).
 */
function continuationColumnsByRow(paragraph: SyntaxNode): Map<number, number> {
  const byRow = new Map<number, number>();
  for (const node of paragraph.descendantsOfType('block_continuation')) {
    if (node) {
      byRow.set(node.startPosition.row, node.endPosition.column);
    }
  }
  return byRow;
}

/** The column of the first non-whitespace (space/tab) character in `line`, or its length if none. */
function firstNonWhitespaceColumn(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

/**
 * Build one `SourceSpan` per physical line of `paragraph`, from
 * `paragraph.startPosition.row` through `lastContentRow` inclusive.
 * Line 1's start column is `paragraph.startPosition.column` (confirmed
 * directly: always right after any block-quote/list marker chain).
 * Every later line's start column is the end of that row's own
 * `block_continuation` node when one exists, else the row's first
 * non-whitespace column (a lazy continuation line) — `docs/planning/markdown-latex-plan.md`
 * §5.2's exact rule. Every line's end column is that row's own content
 * length, `\r` excluded — not `paragraph.endColumn`, which (per
 * `lastContentRow`'s own doc comment) only ever describes the *last* row
 * correctly and says nothing about the rows before it.
 */
function buildParts(
  paragraph: SyntaxNode,
  sourceLines: readonly string[],
  mapper: PositionMapper,
): SourceSpan[] {
  const startRow = paragraph.startPosition.row;
  const lastRow = lastContentRow(paragraph);
  const continuationColumns = continuationColumnsByRow(paragraph);

  const parts: SourceSpan[] = [];
  for (let row = startRow; row <= lastRow; row++) {
    const rawLine = sourceLines[row] ?? '';
    const lineLength = rawLine.endsWith('\r') ? rawLine.length - 1 : rawLine.length;

    const startColumn =
      row === startRow
        ? paragraph.startPosition.column
        : (continuationColumns.get(row) ?? firstNonWhitespaceColumn(rawLine));

    parts.push({
      startByte: mapper.positionToByteOffset({ line: row, character: startColumn }),
      endByte: mapper.positionToByteOffset({ line: row, character: lineLength }),
      startRow: row,
      startColumn,
      endRow: row,
      endColumn: lineLength,
    });
  }

  return parts;
}
