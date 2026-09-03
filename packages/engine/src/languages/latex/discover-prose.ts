import type { DiscoverRegionsOptions } from '../../types/adapter.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { SyntaxNode, Tree } from '../../types/tree-sitter-types.js';
import { PositionMapper } from '../../types/position-mapper.js';
import { captureNodes } from '../../discovery/capture.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { normalizeRawText } from '../../discovery/normalize-raw-text.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { latexDescriptor } from './descriptor.js';

/**
 * Node types that are always a discovery mask, regardless of name —
 * `docs/planning/markdown-latex-plan.md` §6.2's exclusion-mask list,
 * confirmed against the vendored grammar (`docs/parsing.md` Finding 8's
 * environment-classification table and its `-probe2.mjs` addendum) rather
 * than assumed from the plan's own draft, which got two of these entries
 * wrong (see below).
 *
 * `minted_environment` is deliberately **absent** from this list: no such
 * node type exists in this grammar at all — `\begin{minted}` (with or
 * without the package's required language argument) parses as an `ERROR`
 * node, not a recognized environment. That's already handled: `wrap.ts`
 * skips any region overlapping an `ERROR` node unconditionally, for every
 * region kind, so `minted` content is protected by that generic mechanism
 * without needing an entry here — the same "no exclusion needed here"
 * reasoning Markdown's own `discoverMarkdownProse` doc comment gives for
 * `ERROR` overlap.
 */
const ALWAYS_MASKED_NODE_TYPES: readonly string[] = [
  'verbatim_environment',
  'listing_environment', // `\begin{lstlisting}` gets this dedicated type; plain `listing` does not — see MASKED_GENERIC_ENVIRONMENT_NAMES
  'comment_environment', // the `comment` package's block environment, distinct from a `%` line comment
  'block_comment', // `\iffalse ... \fi`
  'displayed_equation', // covers both `\[...\]` and `$$...$$` — confirmed the same node type for both
  'math_environment', // `align`, `equation`, `gather`, `multline`, `displaymath`, `math`, and — not predicted by the plan's own draft — `array`
];

/**
 * `generic_environment` names that must still be masked even though the
 * grammar gives them no dedicated node type of their own — matched
 * against `begin.name`'s text with its surrounding `{`/`}` stripped.
 * `array` is deliberately **absent**: confirmed via `-probe2.mjs` to
 * already classify as `math_environment` (in `ALWAYS_MASKED_NODE_TYPES`
 * above), not `generic_environment` as the plan's own draft assumed — an
 * entry here would be unreachable dead weight. `listing` (plain, no `lst`
 * prefix) *is* included here for the opposite reason: `lstlisting` gets
 * its own dedicated type (already masked above), but plain `listing`
 * falls through to `generic_environment` and needs this list to be
 * caught at all.
 *
 * `itemize` and `abstract` are deliberately **excluded** — the plan's own
 * worked example (§6.2): `\begin{abstract}` alone on a line, ordinary
 * prose below it, is masked only structurally (the `\begin`/`\end` lines
 * themselves are structural lines, handled separately below), not as a
 * verbatim block; the prose between reflows normally. `itemize`'s content
 * is exactly what `\item`-aware discovery below exists to wrap correctly,
 * not to preserve untouched.
 */
const MASKED_GENERIC_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set([
  'alltt',
  'Verbatim',
  'BVerbatim',
  'tikzpicture',
  'tabular',
  'tabular*',
  'tabularx',
  'listing',
]);

/**
 * Every LaTeX sectioning command's own node type — confirmed via
 * `docs/spikes/tree-sitter-latex-probe4.mjs` for the five names Phase A's
 * probe didn't directly exercise (`part`, `chapter`, `subsubsection`,
 * `subparagraph`, and `paragraph` — note `paragraph` here is LaTeX's
 * `\paragraph{...}` sectioning command, an unrelated grammar node type
 * that happens to share a name with the *Markdown* adapter's very
 * different `paragraph` node; the two are never in the same tree). A
 * starred variant (`\section*{...}`) confirmed to keep the same node
 * type — the star lives inside the command token's own text
 * (`'\section*'`), not a distinct node shape — so this list needs no
 * separate starred entries.
 */
const SECTIONING_NODE_TYPES: ReadonlySet<string> = new Set([
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
]);

/**
 * A line whose trimmed text is entirely one command with its `[..]`/`{..}`
 * arguments — `docs/planning/markdown-latex-plan.md` §6.2's `commandRegex`,
 * verified as specified (repeated bracket/brace groups in any order and
 * count, e.g. `\newtheorem{name}[counter]{text}` matches: three groups,
 * any mix of `{...}`/`[...]`). The one confirmed failure mode — a `{...}`
 * argument containing *nested* braces, e.g.
 * `\section{Title with \emph{nested} braces}` (the `[^}]*` character class
 * stops at the first `}`, so the trailing `braces}` is left over and the
 * `$` anchor fails) — is exactly what `treeStructuralLineEnd` below exists
 * to catch instead.
 */
const STRUCTURAL_COMMAND_LINE = /^\\[A-Za-z@]+\*?(\[[^\]]*\]|\{[^}]*\})*\s*$/;

/** `\[`, `\]`, or `$$` alone on a line — display-math delimiters, structural even though they never match `STRUCTURAL_COMMAND_LINE` (they aren't `\command` shaped at all). Redundant with `displayed_equation` masking in the common case; kept as a textual safety net for the boundary lines themselves. */
const DISPLAY_MATH_DELIMITER_LINE = /^(\\\[|\\\]|\$\$)$/;

interface RowMask {
  readonly startRow: number;
  readonly endRow: number;
}

interface TreeHeaderSpan {
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/** The column of the first non-whitespace (space/tab) character in `line`, or its length if none. */
function firstNonWhitespaceColumn(line: string): number {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

/** The column of the first non-whitespace (space/tab) character in `line` at or after `from`, or `line.length` if none. */
function firstNonWhitespaceColumnFrom(line: string, from: number): number {
  let column = from;
  while (column < line.length && (line[column] === ' ' || line[column] === '\t')) {
    column++;
  }
  return column;
}

/** `line`, with any single trailing `\r` removed — every row-length computation below needs this, never the raw split segment. */
function stripTrailingCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function environmentName(beginNode: SyntaxNode | null): string | null {
  const nameNode = beginNode?.childForFieldName('name');
  if (!nameNode) {
    return null;
  }
  const text = nameNode.text;
  return text.startsWith('{') && text.endsWith('}') ? text.slice(1, -1) : text;
}

/**
 * Row ranges (inclusive) that no prose region may include or start in —
 * `docs/planning/markdown-latex-plan.md` §6.2 item 1. Built from
 * `ALWAYS_MASKED_NODE_TYPES` unconditionally, plus every
 * `generic_environment` whose `begin.name` is in
 * `MASKED_GENERIC_ENVIRONMENT_NAMES`. A `\begin{…}` that isn't alone on
 * its line is still masked by these node rows regardless — per the plan's
 * own instruction, this never falls back to a line-based `\begin`/`\end`
 * scan the way Rewrap's own rule does.
 */
function buildRowMasks(tree: Tree): RowMask[] {
  const masks: RowMask[] = [];

  for (const nodeType of ALWAYS_MASKED_NODE_TYPES) {
    for (const node of tree.rootNode.descendantsOfType(nodeType)) {
      if (node) {
        masks.push({ startRow: node.startPosition.row, endRow: node.endPosition.row });
      }
    }
  }

  for (const node of tree.rootNode.descendantsOfType('generic_environment')) {
    if (!node) {
      continue;
    }
    const name = environmentName(node.childForFieldName('begin'));
    if (name !== null && MASKED_GENERIC_ENVIRONMENT_NAMES.has(name)) {
      masks.push({ startRow: node.startPosition.row, endRow: node.endPosition.row });
    }
  }

  return masks;
}

function isRowMasked(row: number, masks: readonly RowMask[]): boolean {
  return masks.some((mask) => row >= mask.startRow && row <= mask.endRow);
}

/**
 * Comment info per row, from every `line_comment` node in the tree (the
 * same nodes `latexDescriptor.queries.comments` captures for the ordinary
 * `'lineComment'` discovery pass — reusing that query rather than a
 * second, hand-rolled tree walk). `isWholeLine` says whether the comment
 * is the entire line's content (nothing but whitespace precedes it) —
 * such a row is already its own `'lineComment'` region (§6.2's "already
 * `'lineComment'` regions — they split a prose run, deliberately") and
 * must never also become part of a `'prose'` region. A line with real
 * text *before* a trailing comment stays prose-eligible, but that line's
 * part must end at the comment's own start column: `discoverRegions`
 * (`../../discovery/discover-regions.ts`) has no mechanism to reconcile
 * two regions whose spans overlap, and the ordinary comment-query pass
 * above already claims that exact span unconditionally — so this
 * function guarantees non-overlap by construction rather than relying on
 * anything downstream to catch it. (The richer §6.4 treatment — folding
 * a trailing comment's text into the prose region itself as a glued,
 * unbreakable atom — is explicitly a later commit's work, per the plan's
 * own phase split; this discovery pass only needs to get the region
 * *geometry* right, not the reflow semantics of trailing comments.)
 */
function buildCommentsByRow(
  tree: Tree,
  sourceLines: readonly string[],
): Map<number, { readonly startColumn: number; readonly isWholeLine: boolean }> {
  const byRow = new Map<number, { startColumn: number; isWholeLine: boolean }>();
  for (const node of captureNodes(tree, latexDescriptor.queries.comments!, 'comment')) {
    const row = node.startPosition.row;
    const startColumn = node.startPosition.column;
    const before = stripTrailingCR(sourceLines[row] ?? '').slice(0, startColumn);
    byRow.set(row, { startColumn, isWholeLine: before.trim().length === 0 });
  }
  return byRow;
}

/**
 * Item-content start columns, by the row each `enum_item` starts on —
 * §6.2's "a line beginning with `\item` starts a new region whose span
 * begins after `\item` and its optional `[label]`." Confirmed directly
 * (`-probe4.mjs`): `command` is the `\item` node itself, `label` (when
 * present) is a `brack_group_text` node (`[label]`, brackets included)
 * ending right after the closing `]` — whichever of the two is present
 * and later is where item content begins. The single space conventionally
 * written between `\item`/`[label]` and the item's own text is skipped
 * here too (via `firstNonWhitespaceColumnFrom`), matching every other
 * content-start column this file computes (`firstNonWhitespaceColumn` for
 * an ordinary line) — an item's first `parts` entry should start at its
 * real text, not at the whitespace conventionally separating it from the
 * marker.
 */
function buildEnumItemStartColumns(tree: Tree, sourceLines: readonly string[]): Map<number, number> {
  const byRow = new Map<number, number>();
  for (const item of tree.rootNode.descendantsOfType('enum_item')) {
    if (!item) {
      continue;
    }
    const command = item.childForFieldName('command');
    const label = item.childForFieldName('label');
    const end = label ?? command;
    if (end) {
      const row = item.startPosition.row;
      const rawLine = stripTrailingCR(sourceLines[row] ?? '');
      byRow.set(row, firstNonWhitespaceColumnFrom(rawLine, end.endPosition.column));
    }
  }
  return byRow;
}

/**
 * Header spans (command plus its immediate argument groups, *never*
 * including a sectioning node's absorbed body) for every
 * `generic_command`, `theorem_definition`, and sectioning node in the
 * tree, indexed by the row each one starts on. This is
 * `treeStructuralLineEnd`'s data source — see that function's own doc
 * comment for why a sectioning node's *own* `endPosition` can never be
 * used directly here.
 *
 * `generic_command`/`theorem_definition` need no special-casing:
 * confirmed directly (`-probe4.mjs`'s "generic_command header shape"
 * section — `\maketitle`/`\newpage`/`\clearpage`/`\noindent` each end
 * exactly at their own command text, no trailing body absorption) that
 * their own node extent already *is* the header, unlike sectioning nodes.
 */
function buildHeaderSpansByStartRow(tree: Tree): Map<number, TreeHeaderSpan[]> {
  const byRow = new Map<number, TreeHeaderSpan[]>();
  const push = (startRow: number, span: TreeHeaderSpan): void => {
    const existing = byRow.get(startRow);
    if (existing) {
      existing.push(span);
    } else {
      byRow.set(startRow, [span]);
    }
  };

  for (const nodeType of ['generic_command', 'theorem_definition']) {
    for (const node of tree.rootNode.descendantsOfType(nodeType)) {
      if (node) {
        push(node.startPosition.row, {
          startColumn: node.startPosition.column,
          endRow: node.endPosition.row,
          endColumn: node.endPosition.column,
        });
      }
    }
  }

  for (const nodeType of SECTIONING_NODE_TYPES) {
    for (const node of tree.rootNode.descendantsOfType(nodeType)) {
      if (!node) {
        continue;
      }
      // children[0] is the command token (`\section`), children[1] is
      // the title `curly_group` — confirmed directly (`-probe.mjs`'s
      // original section probe, re-confirmed for every sectioning type
      // by `-probe4.mjs`) that this is *always* the shape, never fewer
      // than two children. children[2] onward is the absorbed body,
      // deliberately excluded: a sectioning node's own `endPosition`
      // spans through the *next* same-or-higher-level section (Finding
      // 8), so using it directly here would treat that entire body as
      // part of the header line, masking real prose paragraphs as
      // "structural" on every row of the section.
      const titleGroup = node.children[1];
      if (titleGroup) {
        push(node.startPosition.row, {
          startColumn: node.startPosition.column,
          endRow: titleGroup.endPosition.row,
          endColumn: titleGroup.endPosition.column,
        });
      }
    }
  }

  return byRow;
}

/**
 * The tree-derived end position of the structural command/sectioning
 * header starting at `(row, startColumn)`, or `null` if none starts
 * there — `treeHeaderSpans`'s per-row lookup, filtered to spans that
 * actually begin at the caller's own already-computed content-start
 * column (an entry starting elsewhere on the row, e.g. a command nested
 * inside another line's prose text, is never a whole-line match and must
 * not be treated as one).
 */
function treeStructuralLineEnd(
  row: number,
  startColumn: number,
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): { readonly row: number; readonly column: number } | null {
  const candidates = headerSpansByStartRow.get(row) ?? [];
  for (const span of candidates) {
    if (span.startColumn === startColumn) {
      return { row: span.endRow, column: span.endColumn };
    }
  }
  return null;
}

/**
 * True if the text from `(row, startColumn)` through `(row, endColumn)`
 * is a "structural line" per §6.2: a line whose trimmed text is entirely
 * one command with its arguments, `\begin{…}`/`\end{…}` (already covered
 * by `STRUCTURAL_COMMAND_LINE` — both parse as an ordinary
 * `\command{arg}` shape), or a display-math delimiter alone. Tries the
 * regex first; when it fails on a line starting with `\`, falls back to
 * the tree's own header-span extent (`treeStructuralLineEnd`) — the one
 * case the plan calls out by name: nested braces inside a command
 * argument defeat the regex's `[^}]*` character class, but the tree
 * parses them correctly regardless.
 */
function isStructuralLine(
  row: number,
  startColumn: number,
  endColumn: number,
  rawLine: string,
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): boolean {
  const text = rawLine.slice(startColumn, endColumn).trim();
  if (text.length === 0) {
    return false;
  }
  if (STRUCTURAL_COMMAND_LINE.test(text) || DISPLAY_MATH_DELIMITER_LINE.test(text)) {
    return true;
  }
  if (!text.startsWith('\\')) {
    return false;
  }
  const treeEnd = treeStructuralLineEnd(row, startColumn, headerSpansByStartRow);
  return treeEnd !== null && treeEnd.row === row && treeEnd.column === endColumn;
}

/**
 * Find every `'prose'` region in a LaTeX `tree` — `LanguageAdapter.discoverProse`'s
 * implementation for this language (`./adapter.ts`). LaTeX's grammar has
 * no paragraph node at all (`docs/planning/markdown-latex-plan.md` §1/§3.2),
 * so this is a masked line scan rather than a query capture: `source`'s
 * physical lines, outside `buildRowMasks`'s exclusion ranges, grouped into
 * maximal runs that are none of: masked; blank; a whole-line comment
 * (already its own `'lineComment'` region); or a structural line
 * (`isStructuralLine`). A line beginning an `enum_item` always starts a
 * fresh region at that item's own content column
 * (`buildEnumItemStartColumns`), ending whatever run preceded it.
 *
 * Each qualifying row contributes one `parts` entry spanning from its
 * content-start column (the item's content column on an `\item` row, else
 * the first non-whitespace column) through its content-end column (a
 * trailing comment's own start column, when one exists on that row —
 * `buildCommentsByRow`'s non-overlap guarantee — else the row's full
 * length). `wrapProse`, the reflow/indentation half of this adapter, is
 * later work (`docs/planning/markdown-latex-plan.md` §9 commit 16); this
 * function's whole job is correct region *geometry*.
 */
export function discoverLatexProse(
  tree: Tree,
  source: string,
  languageId: string,
  options: DiscoverRegionsOptions,
): WrappableRegion[] {
  const tabSize = options.tabSize ?? 4;
  const sourceLines = source.split('\n');
  const mapper = new PositionMapper(source);

  const rowMasks = buildRowMasks(tree);
  const commentsByRow = buildCommentsByRow(tree, sourceLines);
  const enumItemStartColumns = buildEnumItemStartColumns(tree, sourceLines);
  const headerSpansByStartRow = buildHeaderSpansByStartRow(tree);

  const regions: WrappableRegion[] = [];
  let currentParts: SourceSpan[] = [];

  const flush = (): void => {
    if (currentParts.length === 0) {
      return;
    }
    const first = currentParts[0]!;
    const last = currentParts[currentParts.length - 1]!;
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
      parts: currentParts,
      rawText: currentParts.map((part) => normalizeRawText(sliceSpanText(source, part))).join('\n'),
      indentColumn: visualIndentColumn(sourceLines[first.startRow] ?? '', first.startColumn, tabSize),
      languageId,
    });
    currentParts = [];
  };

  for (let row = 0; row < sourceLines.length; row++) {
    if (isRowMasked(row, rowMasks)) {
      flush();
      continue;
    }

    const rawLine = stripTrailingCR(sourceLines[row] ?? '');
    if (rawLine.trim().length === 0) {
      flush();
      continue;
    }

    const comment = commentsByRow.get(row);
    if (comment?.isWholeLine) {
      flush();
      continue;
    }

    const itemStartColumn = enumItemStartColumns.get(row);
    const startColumn = itemStartColumn ?? firstNonWhitespaceColumn(rawLine);
    const endColumn = comment ? comment.startColumn : rawLine.length;

    if (startColumn >= endColumn) {
      flush();
      continue;
    }

    if (itemStartColumn === undefined && isStructuralLine(row, startColumn, endColumn, rawLine, headerSpansByStartRow)) {
      flush();
      continue;
    }

    if (itemStartColumn !== undefined) {
      flush(); // an \item line always starts a fresh region, per §6.2
    }

    currentParts.push({
      startByte: mapper.positionToByteOffset({ line: row, character: startColumn }),
      endByte: mapper.positionToByteOffset({ line: row, character: endColumn }),
      startRow: row,
      startColumn,
      endRow: row,
      endColumn,
    });
  }
  flush();

  return regions;
}
