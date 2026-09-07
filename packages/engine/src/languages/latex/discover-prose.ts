import type { DiscoverRegionsOptions } from '../../types/adapter.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { SyntaxNode, Tree } from '../../types/tree-sitter-types.js';
import { PositionMapper } from '../../types/position-mapper.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { normalizeRawText } from '../../discovery/normalize-raw-text.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';

/**
 * Node types that are always a discovery mask, regardless of name --
 * confirmed against the vendored grammar (`docs/parsing.md` Finding 8's
 * environment-classification table and its `-probe2.mjs` addendum) rather
 * than assumed from the original design draft, which got two of these
 * entries wrong (see below; full writeup in `docs/adapters.md`,
 * "LaTeX -- real adapter" section).
 *
 * `minted_environment` is deliberately **absent** from this list: no such
 * node type exists in this grammar at all -- `\begin{minted}` (with or
 * without the package's required language argument) parses as an `ERROR`
 * node, not a recognized environment. That's already handled: `wrap.ts`
 * skips any region overlapping an `ERROR` node unconditionally, for every
 * region kind, so `minted` content is protected by that generic mechanism
 * without needing an entry here -- the same "no exclusion needed here"
 * reasoning Markdown's own `discoverMarkdownProse` doc comment gives for
 * `ERROR` overlap.
 */
const ALWAYS_MASKED_NODE_TYPES: readonly string[] = [
  'verbatim_environment',
  'listing_environment', // `\begin{lstlisting}` gets this dedicated type; plain `listing` does not -- see MASKED_GENERIC_ENVIRONMENT_NAMES
  'comment_environment', // the `comment` package's block environment, distinct from a `%` line comment
  'block_comment', // `\iffalse ... \fi`
  'displayed_equation', // covers both `\[...\]` and `$$...$$` -- confirmed the same node type for both
  'math_environment', // `align`, `equation`, `gather`, `multline`, `displaymath`, `math`, and -- not predicted by the plan's own draft -- `array`
];

/**
 * `generic_environment` names that must still be masked even though the
 * grammar gives them no dedicated node type of their own -- matched
 * against `begin.name`'s text with its surrounding `{`/`}` stripped.
 * `array` is deliberately **absent**: confirmed via `-probe2.mjs` to
 * already classify as `math_environment` (in `ALWAYS_MASKED_NODE_TYPES`
 * above), not `generic_environment` as the plan's own draft assumed -- an
 * entry here would be unreachable dead weight. `listing` (plain, no `lst`
 * prefix) *is* included here for the opposite reason: `lstlisting` gets
 * its own dedicated type (already masked above), but plain `listing`
 * falls through to `generic_environment` and needs this list to be
 * caught at all.
 *
 * `itemize` and `abstract` are deliberately **excluded** -- the plan's own
 * worked example (Sec. 6.2): `\begin{abstract}` alone on a line, ordinary
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
 * Every LaTeX sectioning command's own node type -- confirmed via
 * `docs/spikes/tree-sitter-latex-probe4.mjs` for the five names Phase A's
 * probe didn't directly exercise (`part`, `chapter`, `subsubsection`,
 * `subparagraph`, and `paragraph` -- note `paragraph` here is LaTeX's
 * `\paragraph{...}` sectioning command, an unrelated grammar node type
 * that happens to share a name with the *Markdown* adapter's very
 * different `paragraph` node; the two are never in the same tree). A
 * starred variant (`\section*{...}`) confirmed to keep the same node
 * type -- the star lives inside the command token's own text
 * (`'\section*'`), not a distinct node shape -- so this list needs no
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
 * One command with its `[..]`/`{..}` arguments, matched from the *start*
 * of whatever text it's tested against (no `$` anchor -- callers use this
 * to consume a prefix, not to test a whole line) --
 * verified as specified (repeated bracket/brace groups in any order and count,
 * e.g. `\newtheorem{name}[counter]{text}` matches: three groups, any mix
 * of `{...}`/`[...]`). The one confirmed failure mode -- a `{...}`
 * argument containing *nested* braces, e.g.
 * `\section{Title with \emph{nested} braces}` (the `[^}]*` character
 * class stops at the first `}`, leaving `braces}` unconsumed) -- is
 * exactly what `structuralConsumedLength`'s tree lookup exists to catch
 * instead; see that function's own doc comment for why tree lookup runs
 * *before* this regex is even tried, not just as a whole-line fallback.
 */
const SINGLE_STRUCTURAL_COMMAND = /^\\[A-Za-z@]+\*?(\[[^\]]*\]|\{[^}]*\})*/;

/** `\[`, `\]`, or `$$` alone on a line -- display-math delimiters, structural even though they never match `STRUCTURAL_COMMAND_LINE` (they aren't `\command` shaped at all). Redundant with `displayed_equation` masking in the common case; kept as a textual safety net for the boundary lines themselves. */
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

/** `line`, with any single trailing `\r` removed -- every row-length computation below needs this, never the raw split segment. */
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

function isRowMasked(row: number, masks: readonly RowMask[]): boolean {
  return masks.some((mask) => row >= mask.startRow && row <= mask.endRow);
}

/**
 * Item-content start columns, by the row each `enum_item` starts on --
 * Sec. 6.2's "a line beginning with `\item` starts a new region whose span
 * begins after `\item` and its optional `[label]`." Confirmed directly
 * (`-probe4.mjs`): `command` is the `\item` node itself, `label` (when
 * present) is a `brack_group_text` node (`[label]`, brackets included)
 * ending right after the closing `]` -- whichever of the two is present
 * and later is where item content begins. The single space conventionally
 * written between `\item`/`[label]` and the item's own text is skipped
 * here too (via `firstNonWhitespaceColumnFrom`), matching every other
 * content-start column this file computes (`firstNonWhitespaceColumn` for
 * an ordinary line) -- an item's first `parts` entry should start at its
 * real text, not at the whitespace conventionally separating it from the
 * marker.
 *
 * `field('label')` above is `\item`'s *own* optional `[label]` bracket
 * argument -- unrelated to a `\label{...}` cross-reference command
 * sometimes chained right after `\item` (e.g. `\item \label{item:foo}
 * Item text.`, confirmed via `-probe5.mjs` to parse as an unnamed
 * `label_definition` child of `enum_item`, sitting between `command`
 * and the item's own `text`). Because `isStructuralLine` is never
 * consulted for an item-start row -- an `\item` line always starts a
 * fresh region regardless of what its content looks like -- a chained
 * `\label{...}` (or any other structural-command chain) right after the
 * marker needs its own consumption pass here, reusing
 * `structuralConsumedLength` (the same scanner `isStructuralLine` uses)
 * rather than a second, duplicated walk: once past `\item`/`[label]`,
 * consume as much further structural-command chain as exists -- the
 * scanner's own whitespace handling means this also swallows any gap
 * before the item's real text starts, so no separate
 * `firstNonWhitespaceColumnFrom` call is needed after it.
 */
function buildEnumItemStartColumns(
  enumItemNodes: readonly SyntaxNode[],
  sourceLines: readonly string[],
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): Map<number, number> {
  const byRow = new Map<number, number>();
  for (const item of enumItemNodes) {
    const command = item.childForFieldName('command');
    const label = item.childForFieldName('label');
    const end = label ?? command;
    if (end) {
      const row = item.startPosition.row;
      const rawLine = stripTrailingCR(sourceLines[row] ?? '');
      const afterMarker = firstNonWhitespaceColumnFrom(rawLine, end.endPosition.column);
      const chainConsumed = structuralConsumedLength(
        row,
        afterMarker,
        rawLine.slice(afterMarker),
        headerSpansByStartRow,
      );
      byRow.set(row, afterMarker + chainConsumed);
    }
  }
  return byRow;
}

/**
 * Every node type this file's tree-scanning cares about -- the input to
 * `buildTreeIndexes`'s single combined `descendantsOfType` call. Typed
 * `string[]` (mutable), not `readonly string[]`, purely to satisfy
 * `descendantsOfType`'s own parameter type -- this array is built once,
 * here, and never mutated afterward.
 *
 * `line_comment` joined this list (rather than staying its own separate
 * `captureNodes(tree, latexDescriptor.queries.comments!, 'comment')` pass,
 * as an earlier version of this file had it) for the same reason the other
 * sixteen-calls-to-one fix above exists, but hitting a different cost:
 * profiling a 50,000-line synthetic file (zero actual `%` comments in it)
 * found `Query.captures` itself costing a consistent ~200-350ms *regardless
 * of match count* -- tree-sitter query execution here scales with tree
 * size, not result size. `discover-regions.ts`'s own shared discovery pass
 * already runs this exact `(line_comment) @comment` query once, necessarily,
 * to build `'lineComment'` regions; this file's own now-removed
 * `buildWholeLineCommentRows` ran the *same* query a second time, purely to
 * classify each comment row as whole-line or trailing -- measured at ~400ms
 * of `discoverLatexProse`'s own ~700ms total at 50,000 lines, i.e. the
 * single largest remaining cost after the combined-`descendantsOfType` fix.
 * `descendantsOfType` doesn't have this per-call floor (it's a plain tree
 * walk, not a compiled-query execution), so folding `line_comment` into the
 * walk this function already does removes that second query pass entirely
 * rather than just deferring it.
 */
const ALL_SCANNED_NODE_TYPES: string[] = [
  ...ALWAYS_MASKED_NODE_TYPES,
  'generic_environment',
  'generic_command',
  'theorem_definition',
  ...SECTIONING_NODE_TYPES,
  'enum_item',
  'line_comment',
];

const ALWAYS_MASKED_NODE_TYPE_SET: ReadonlySet<string> = new Set(ALWAYS_MASKED_NODE_TYPES);
const SIMPLE_HEADER_NODE_TYPES: ReadonlySet<string> = new Set(['generic_command', 'theorem_definition']);

interface TreeIndexes {
  readonly rowMasks: readonly RowMask[];
  readonly headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>;
  readonly enumItemNodes: readonly SyntaxNode[];
  /**
   * Rows whose entire content is a `%` comment (nothing but whitespace
   * precedes it) -- such a row is already its own `'lineComment'` region
   * (Sec. 6.2's "already `'lineComment'` regions -- they split a prose run,
   * deliberately") and must never also become part of a `'prose'` region.
   * A row with a **trailing** (non-whole-line) comment is deliberately
   * *not* in this set: `./adapter.ts`'s `classify` excludes a trailing
   * comment's `line_comment` node from the ordinary query-driven pass
   * entirely (commit 17, Sec. 6.4), so that row's own `parts` entry in
   * `discoverLatexProse` is built through the row's *full* length, comment
   * text included, and `./wrap-prose.ts`'s `LATEX_TRAILING_COMMENT`
   * hard-break pattern is what keeps that text from being reflowed.
   */
  readonly wholeLineCommentRows: ReadonlySet<number>;
}

/**
 * Every row mask, header span, and `enum_item` node this file needs,
 * gathered in **one** combined `tree.rootNode.descendantsOfType(ALL_SCANNED_NODE_TYPES)`
 * call rather than the sixteen separate single-type calls an earlier
 * version of this file made (one per `ALWAYS_MASKED_NODE_TYPES` entry,
 * one for `generic_environment`, one each for `generic_command`/
 * `theorem_definition`, one per `SECTIONING_NODE_TYPES` entry, one for
 * `enum_item`). `descendantsOfType` accepts an array natively -- passing
 * every type at once still does exactly one walk of the tree internally,
 * just filtering against a combined set as it goes, rather than sixteen
 * separate walks each re-visiting every node in the tree to ask "are you
 * one of my one or two types?"
 *
 * Found to matter, not just theorized: profiled directly (a 50,000-line
 * synthetic file) at **17x** -- the sixteen-separate-calls version took
 * ~1.7s, this combined version ~0.1s. This was the dominant cost in
 * `discoverLatexProse` by a wide margin (parsing the same file took
 * ~0.7s), and specifically what made a near-cursor "wrap the one region
 * under the cursor" request scale with total file size the same as a
 * whole-file wrap would -- `discoverRegions` (`../../discovery/discover-regions.ts`)
 * always runs discovery on the whole tree before filtering to the
 * requested target, for every adapter alike, so this adapter's own
 * discovery cost is the whole story for that path. That distinction
 * stayed invisible for every language before LaTeX because a single
 * tree-sitter query pass (every other adapter's own discovery mechanism)
 * is cheap enough that it was never the bottleneck; LaTeX's masked line
 * scan is the first adapter where it was.
 *
 * Each node is dispatched to exactly one of four buckets by its own
 * `.type`, reproducing the identical per-node logic the original
 * single-purpose functions each had -- `rowMasks`
 * (Sec. 6.2 item 1: `ALWAYS_MASKED_NODE_TYPES` unconditionally, plus a
 * `generic_environment` whose `begin.name` is in
 * `MASKED_GENERIC_ENVIRONMENT_NAMES`), `headerSpansByStartRow`
 * (`generic_command`/`theorem_definition` via their own full extent --
 * confirmed via `-probe4.mjs` to need no special-casing, no trailing
 * body absorption -- and every `SECTIONING_NODE_TYPES` entry via its
 * title `curly_group` only, `children[1]`, deliberately never its own
 * `endPosition`, which absorbs the entire section body through the next
 * same-or-higher-level section per Finding 8), `enumItemNodes` (the
 * raw node list only -- `buildEnumItemStartColumns` still does its own
 * per-item processing afterward, since it needs `headerSpansByStartRow`
 * fully built first for its own `structuralConsumedLength` calls), and
 * `wholeLineCommentRows` (see `TreeIndexes`'s own doc comment for what
 * "whole-line" means and why a trailing comment's row is excluded --
 * folded in here, rather than kept as its own separate
 * `captureNodes`-based pass, for the same query-execution-cost reason
 * explained on `ALL_SCANNED_NODE_TYPES` above).
 */
function buildTreeIndexes(tree: Tree, sourceLines: readonly string[]): TreeIndexes {
  const rowMasks: RowMask[] = [];
  const headerSpansByStartRow = new Map<number, TreeHeaderSpan[]>();
  const enumItemNodes: SyntaxNode[] = [];
  const wholeLineCommentRows = new Set<number>();

  const pushHeaderSpan = (startRow: number, span: TreeHeaderSpan): void => {
    const existing = headerSpansByStartRow.get(startRow);
    if (existing) {
      existing.push(span);
    } else {
      headerSpansByStartRow.set(startRow, [span]);
    }
  };

  for (const node of tree.rootNode.descendantsOfType(ALL_SCANNED_NODE_TYPES)) {
    if (!node) {
      continue;
    }
    if (ALWAYS_MASKED_NODE_TYPE_SET.has(node.type)) {
      rowMasks.push({ startRow: node.startPosition.row, endRow: node.endPosition.row });
    } else if (node.type === 'generic_environment') {
      const name = environmentName(node.childForFieldName('begin'));
      if (name !== null && MASKED_GENERIC_ENVIRONMENT_NAMES.has(name)) {
        rowMasks.push({ startRow: node.startPosition.row, endRow: node.endPosition.row });
      }
    } else if (SIMPLE_HEADER_NODE_TYPES.has(node.type)) {
      pushHeaderSpan(node.startPosition.row, {
        startColumn: node.startPosition.column,
        endRow: node.endPosition.row,
        endColumn: node.endPosition.column,
      });
    } else if (SECTIONING_NODE_TYPES.has(node.type)) {
      // children[0] is the command token (`\section`), children[1] is
      // the title `curly_group` -- confirmed directly (`-probe.mjs`'s
      // original section probe, re-confirmed for every sectioning type
      // by `-probe4.mjs`) that this is *always* the shape, never fewer
      // than two children. children[2] onward is the absorbed body,
      // deliberately excluded -- see this function's own doc comment.
      const titleGroup = node.children[1];
      if (titleGroup) {
        pushHeaderSpan(node.startPosition.row, {
          startColumn: node.startPosition.column,
          endRow: titleGroup.endPosition.row,
          endColumn: titleGroup.endPosition.column,
        });
      }
    } else if (node.type === 'enum_item') {
      enumItemNodes.push(node);
    } else if (node.type === 'line_comment') {
      const row = node.startPosition.row;
      const before = stripTrailingCR(sourceLines[row] ?? '').slice(0, node.startPosition.column);
      if (before.trim().length === 0) {
        wholeLineCommentRows.add(row);
      }
    }
  }

  return { rowMasks, headerSpansByStartRow, enumItemNodes, wholeLineCommentRows };
}

/**
 * The tree-derived end column of the structural command/sectioning
 * header starting at `(row, column)`, or `null` if none starts there --
 * `headerSpansByStartRow`'s per-row lookup, filtered to spans that
 * actually begin at the caller's own already-computed position (an entry
 * starting elsewhere on the row, e.g. a command nested inside another
 * line's prose text, is never a match here). Only ever returns a
 * same-row result: a header span whose own `endRow` differs from `row`
 * (a title that itself wraps onto a second physical line -- unusual, but
 * not impossible) is deliberately excluded, since this file's line-by-line
 * scan has nowhere to fit a "structural, but spans two rows" verdict.
 */
function treeStructuralLineEnd(
  row: number,
  column: number,
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): number | null {
  const candidates = headerSpansByStartRow.get(row) ?? [];
  for (const span of candidates) {
    if (span.startColumn === column && span.endRow === row) {
      return span.endColumn;
    }
  }
  return null;
}

/**
 * How much of `text` (a row's own content slice, starting wherever the
 * caller's own scan already begins -- *not* pre-trimmed, since trailing
 * whitespace is itself valid input to consume) is a run of one or more
 * structural commands, each optionally separated by horizontal
 * whitespace, starting from `text`'s own beginning. Returning
 * `text.length` means the entire slice is structural; anything less
 * means real, non-command content exists somewhere in it.
 *
 * Two callers, both consuming this scanner's result differently:
 * `isStructuralLine` below only ever accepts a *full* match (the whole
 * line, nothing else on it); `buildEnumItemStartColumns` above instead
 * uses however much of a chain it *does* consume, whatever that is, to
 * advance an `\item`'s own content-start column past any commands
 * (`\label{...}` and its own kind) chained right after the marker --
 * a partial (or zero-length) result there is exactly the correct answer
 * for "nothing more to skip," not treated as a failure the way it is in
 * `isStructuralLine`.
 *
 * This is the fix for a real gap found by review after commit 15 first
 * shipped: `\section{Title}\label{sec:foo}` -- an extremely common LaTeX
 * idiom (a sectioning header immediately followed by its cross-reference
 * label, with or without a space between) -- is *two* structural commands
 * on one line, not one, and the original single-shot "does the whole
 * line match one `\command{args}`" check had no way to recognize a
 * *chain*. Confirmed empirically (not just reasoned about) that this
 * really did get swallowed into a `'prose'` region and, for a long
 * enough label, actually reflowed the command syntax across output
 * lines. This function walks the row consuming one command at a time
 * (via the tree when a header span starts exactly at the current
 * position, via `SINGLE_STRUCTURAL_COMMAND` otherwise -- `\label{...}`
 * itself is a dedicated `label_definition` node, not one of the types
 * `buildHeaderSpansByStartRow` collects, confirmed by
 * `docs/spikes/tree-sitter-latex-probe5.mjs`, so the regex path is what
 * actually catches it in practice) until neither can consume anything
 * further.
 *
 * The tree is tried *before* the regex at each position, not only as a
 * fallback after a whole-line regex failure the way commit 15 originally
 * had it: once a chain is possible, a regex match for the *first* unit
 * can consume fewer characters than the tree would have (imagine a
 * nested-brace title followed by a plain second command -- the regex
 * alone would stop mid-title with no way to resync), so preferring the
 * authoritative tree result at every step, and falling back to the regex
 * only where the tree has nothing to say, is what keeps this correct for
 * an arbitrary mix of tree-known and tree-unknown command types chained
 * together.
 *
 * Deliberately a hand-rolled loop, not a single regex with a repeated
 * outer group (`(\\...)+`): nesting an unbounded quantifier around a
 * group that already contains one is a classic catastrophic-backtracking
 * shape, and every unit here is unambiguously delimited by its own
 * leading `\`, so a loop is both safer and no harder to follow.
 */
function structuralConsumedLength(
  row: number,
  lineStartColumn: number,
  text: string,
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): number {
  let pos = 0;
  while (pos < text.length) {
    const whitespace = /^[ \t]+/.exec(text.slice(pos));
    if (whitespace) {
      pos += whitespace[0].length;
      continue;
    }
    if (text[pos] !== '\\') {
      break;
    }

    const treeEndColumn = treeStructuralLineEnd(row, lineStartColumn + pos, headerSpansByStartRow);
    if (treeEndColumn !== null && treeEndColumn > lineStartColumn + pos) {
      pos = treeEndColumn - lineStartColumn;
      continue;
    }

    const regexMatch = SINGLE_STRUCTURAL_COMMAND.exec(text.slice(pos));
    if (regexMatch && regexMatch[0].length > 0) {
      pos += regexMatch[0].length;
      continue;
    }

    break;
  }
  return pos;
}

/**
 * True if the text from `(row, startColumn)` through `(row, endColumn)`
 * is a "structural line" per Sec. 6.2: one or more structural commands
 * (`structuralConsumedLength`), possibly chained, with nothing else on
 * the line -- or a display-math delimiter alone.
 */
function isStructuralLine(
  row: number,
  startColumn: number,
  endColumn: number,
  rawLine: string,
  headerSpansByStartRow: ReadonlyMap<number, readonly TreeHeaderSpan[]>,
): boolean {
  const text = rawLine.slice(startColumn, endColumn);
  if (text.trim().length === 0) {
    return false;
  }
  if (DISPLAY_MATH_DELIMITER_LINE.test(text.trim())) {
    return true;
  }
  return structuralConsumedLength(row, startColumn, text, headerSpansByStartRow) === text.length;
}

/**
 * Find every `'prose'` region in a LaTeX `tree` -- `LanguageAdapter.discoverProse`'s
 * implementation for this language (`./adapter.ts`). LaTeX's grammar has
 * no paragraph node at all (`docs/parsing.md` Finding 8), so this is a
 * masked line scan rather than a query capture: `source`'s
 * physical lines, outside `buildRowMasks`'s exclusion ranges, grouped into
 * maximal runs that are none of: masked; blank; a whole-line comment
 * (already its own `'lineComment'` region); or a structural line
 * (`isStructuralLine`). A line beginning an `enum_item` always starts a
 * fresh region at that item's own content column
 * (`buildEnumItemStartColumns`), ending whatever run preceded it.
 *
 * Each qualifying row contributes one `parts` entry spanning from its
 * content-start column (the item's content column on an `\item` row, else
 * the first non-whitespace column) through the row's own full length -- a
 * trailing (non-whole-line) comment, if one exists on that row, is
 * included rather than excluded: `./adapter.ts`'s `classify` already
 * keeps it from also becoming a separate `'lineComment'` region (commit
 * 17, Sec. 6.4), and `./wrap-prose.ts`'s dedicated hard-break pattern is what
 * keeps that comment text from ever being reflowed once dissolve reaches
 * it.
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

  const { rowMasks, headerSpansByStartRow, enumItemNodes, wholeLineCommentRows } = buildTreeIndexes(tree, sourceLines);
  const enumItemStartColumns = buildEnumItemStartColumns(enumItemNodes, sourceLines, headerSpansByStartRow);

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
    // `indentColumn` is the visual column *continuation* lines land at --
    // for an ordinary paragraph this is the same as `first.startColumn`
    // (both computed as `firstNonWhitespaceColumn` of the same row), but
    // for an `\item` region it deliberately is **not**: `first.startColumn`
    // is the item's own *content* start, past `\item`/`[label]` (and any
    // further chained command, `structuralConsumedLength`), while
    // continuation lines align under the marker itself (Sec. 6.3, confirmed
    // by `./continuation-prefix.ts`'s own `latexContinuationPrefix`,
    // which derives from the same raw leading-whitespace run computed
    // here). Using `first.startColumn` here instead -- as an earlier
    // version of this function did -- fed `emitProse`'s single shared
    // `availableWidth` (`columnLimit - indentColumn`) a value far
    // narrower than what continuation lines actually have room for once
    // displayed at the marker's own (shorter) `continuationPrefix`,
    // producing needlessly short, choppy continuation lines for any
    // labeled or long-markered item -- confirmed by direct comparison
    // against the real pipeline's output before this fix, not assumed.
    // `wrapLatexProse` (`./wrap-prose.ts`) is the other half: it derives
    // `firstLineReserve` from the *difference* between this value and the
    // real content-start column, so line 1 (which genuinely does start
    // printing at the content column, since the marker itself is
    // untouched source text) still gets its own correctly narrower
    // budget -- the same `firstLineReserve` mechanism `strings/emit-string.ts`
    // already uses for an analogous "marker text precedes line 1"
    // scenario.
    const markerColumn = firstNonWhitespaceColumn(sourceLines[first.startRow] ?? '');
    regions.push({
      kind: 'prose',
      span,
      parts: currentParts,
      rawText: currentParts.map((part) => normalizeRawText(sliceSpanText(source, part))).join('\n'),
      indentColumn: visualIndentColumn(sourceLines[first.startRow] ?? '', markerColumn, tabSize),
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

    if (wholeLineCommentRows.has(row)) {
      flush();
      continue;
    }

    const itemStartColumn = enumItemStartColumns.get(row);
    const startColumn = itemStartColumn ?? firstNonWhitespaceColumn(rawLine);
    // A trailing (non-whole-line) comment's text is deliberately *not*
    // excluded here -- `endColumn` runs through the row's full length,
    // comment included. `./adapter.ts`'s `classify` already keeps that
    // comment from also becoming its own separate `'lineComment'`
    // region (commit 17, Sec. 6.4), so there is nothing left to avoid
    // overlapping with; `./wrap-prose.ts`'s `LATEX_TRAILING_COMMENT`
    // hard-break pattern is what keeps the comment text itself from
    // ever being reflowed once this part reaches `dissolveProse`.
    const endColumn = rawLine.length;

    if (startColumn >= endColumn) {
      flush();
      continue;
    }

    if (itemStartColumn === undefined && isStructuralLine(row, startColumn, endColumn, rawLine, headerSpansByStartRow)) {
      flush();
      continue;
    }

    if (itemStartColumn !== undefined) {
      flush(); // an \item line always starts a fresh region, per Sec. 6.2
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
