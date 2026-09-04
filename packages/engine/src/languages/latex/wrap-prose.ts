import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SourceSpan } from '../../types/span.js';
import type { Tree } from '../../types/tree-sitter-types.js';
import { reflowOptionsFrom } from '../../reflow/reflow-block.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { visualIndentColumn } from '../../discovery/visual-indent-column.js';
import { dissolveProse, type ProseSpec } from '../../prose/dissolve-prose.js';
import { emitProse } from '../../prose/emit-prose.js';
import { latexContinuationPrefix } from './continuation-prefix.js';
import { LATEX_HARD_BREAK } from './hard-break.js';
import { LATEX_TRAILING_COMMENT_HARD_BREAK } from './trailing-comment.js';

/**
 * `\verb`/`\lstinline` — §4.3's true never-split spans: unlike `$…$`
 * (breakable in TeX; deliberately not added, §11), a split inside either
 * of these changes the typeset output. Both take the *same* delimiter
 * form (an arbitrary character right after the command, matched again to
 * close), confirmed unprotected by the grammar itself
 * (`docs/parsing.md` Finding 8: `\verb|...|` parses as an ordinary
 * `generic_command` followed by plain `text`/`word` nodes, fragmented at
 * internal spaces exactly like prose) — so this is genuinely load-bearing
 * for `atomizeWords`, not defensive. `[^\n]*?\1` is lazy and bounded by
 * the required closing delimiter, satisfying `unbreakable-spans.ts`'s
 * no-adjacent-unbounded-quantifiers rule.
 *
 * **One combined alternation, not two separate patterns each with its
 * own `(.)`/`\1`** — a real bug found while generating this commit's own
 * `\lstinline` gold fixture: `findUnbreakableSpans`
 * (`../../segmentation/unbreakable-spans.ts`) builds one big `RegExp` by
 * joining every `extraUnbreakable` pattern's `.source` with the built-in
 * set via `|`, which *renumbers capture groups across the whole combined
 * pattern* — with `\verb`'s own pattern listed first, its `(.)` becomes
 * group 1, and `\lstinline`'s own `(.)` becomes group 2, but the
 * `\lstinline` pattern's own `\1` text still literally means "group 1"
 * (`\verb`'s delimiter, not `\lstinline`'s own) once combined. Group 1
 * never participates when the `\lstinline` alternative is the one
 * matching, and an unparticipated backreference matches the empty string
 * in JS regex — so `[^\n]*?\1` was satisfied immediately, truncating
 * every `\lstinline|...|` match down to just `\lstinline` plus its
 * opening delimiter character. Confirmed directly: `atomizeWords` split
 * `\lstinline|some_function_name(argument_one, argument_two)|` into three
 * separate atoms at the internal spaces, and the real pipeline reflowed
 * it across two lines, before this fix. One pattern with a single shared
 * capture group sidesteps the whole class of bug — there's only one
 * group for *this* alternative to conflict with itself over, regardless
 * of whatever numbering the built-in patterns end up at when combined
 * (none of `unbreakable-spans.ts`'s own built-in patterns use a capture
 * group or backreference at all, so there's no symmetric risk from that
 * side either).
 */
const LATEX_EXTRA_UNBREAKABLE: readonly RegExp[] = [/\\(?:verb|lstinline)\*?(.)[^\n]*?\1/];

/**
 * The ordinary line-break commands (`\\`, `\newline`, ...) are tried
 * before the trailing-`%`-comment pattern: the former is `$`-anchored
 * (only matches when it's genuinely the last thing on the line), so a
 * line ending `\\ % note` naturally falls through to the comment pattern
 * regardless of order — the two can never both claim the same line's
 * tail, so this ordering is a documentation choice, not a correctness
 * one.
 */
const latexProseSpec: ProseSpec = {
  hardBreak: [...LATEX_HARD_BREAK, ...LATEX_TRAILING_COMMENT_HARD_BREAK],
  extraUnbreakable: LATEX_EXTRA_UNBREAKABLE,
};

/**
 * LaTeX's `LanguageAdapter.wrapProse` implementation (`./adapter.ts`) —
 * dissolve, reflow, and emit one `'prose'` region.
 *
 * The continuation prefix is derived once per region, from the first
 * physical line's own leading whitespace (`./continuation-prefix.ts`,
 * §6.3) — read via `sliceSpanText`, not a fresh `source.split('\n')`, for
 * the identical quadratic-cost reason `wrapMarkdownProse`'s own doc
 * comment documents (`../markdown/wrap-prose.ts`): this function runs
 * once per region, in a loop over every region in the file. The slice's
 * `endColumn` is deliberately oversized (`Number.MAX_SAFE_INTEGER`)
 * rather than the region's own first-part `startColumn` — `String.slice`
 * clamps a too-large end index to the string's actual length for free,
 * and `latexContinuationPrefix`'s own leading-whitespace regex stops at
 * the first non-whitespace character regardless of how much text follows
 * it, so this sidesteps needing to know the raw line's length (or an
 * `\item`'s own marker width) up front just to bound the slice.
 *
 * `firstLineReserve`: `region.indentColumn` is the visual column
 * *continuation* lines land at (`./discover-prose.ts`'s own doc comment
 * on why — for an `\item` region this is the marker's own column, not
 * where the item's text actually starts), so `emitProse`'s single shared
 * `availableWidth = columnLimit - indentColumn` is already correctly
 * sized for continuation lines. Line 1 is narrower than that by however
 * much wider the region's real content-start column is than
 * `indentColumn` — computed here as their visual-column difference and
 * passed through as `ReflowOptions.firstLineReserve`, the same mechanism
 * `strings/emit-string.ts` already uses for its own "line 1 shares a
 * physical line with marker text that isn't part of the region" case
 * (`firstLineReserve = contentWidth - firstLineOwnBudget` there; the
 * identical shape, expressed the other way around since this function
 * already has `indentColumn` as its baseline rather than deriving it
 * fresh). For an ordinary paragraph the two columns coincide (§6.3), so
 * this is always `0` and changes nothing.
 */
export function wrapLatexProse(region: WrappableRegion, source: string, cfg: WrapConfig, _tree: Tree): string {
  const firstPart = region.parts[0]!;
  const firstLineSpan: SourceSpan = {
    startByte: 0,
    endByte: 0,
    startRow: firstPart.startRow,
    startColumn: 0,
    endRow: firstPart.startRow,
    endColumn: Number.MAX_SAFE_INTEGER,
  };
  const firstLineText = sliceSpanText(source, firstLineSpan);
  const continuationPrefix = latexContinuationPrefix(firstLineText);

  const contentColumn = visualIndentColumn(firstLineText, firstPart.startColumn, cfg.tabSize);
  const firstLineReserve = Math.max(0, contentColumn - region.indentColumn);

  const document = dissolveProse(region, source, latexProseSpec);
  const reflowOptions = { ...reflowOptionsFrom(cfg), firstLineReserve };
  return emitProse(document, cfg.columnLimit, { continuationPrefix }, reflowOptions);
}
