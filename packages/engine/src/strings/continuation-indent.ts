import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import { visualIndentColumn } from '../discovery/visual-indent-column.js';

/**
 * The visual column every continuation line of a split `'stringLiteral'`
 * is indented to -- the `hangingIndentColumns` argument `emitString`
 * (`./emit-string.ts`) takes. Shared by every concatenation-based
 * `wrapString` (`./wrap-string-default.ts`, and Python's own
 * `../languages/python/wrap-string.ts`), since nothing about this choice
 * is language-specific.
 *
 * ## A string starting its own line: align to the string itself
 *
 * When nothing but whitespace precedes the region on its first line --
 * an argument already broken onto its own line inside an open bracket:
 *
 * ```python
 * raise ValueError(
 *     "first part of the message "
 *     "second part of the message"
 * )
 * ```
 *
 * -- every continuation part lines up with the first part's own opening
 * quote (`region.indentColumn`). Anything else would add a hanging indent
 * relative to the string's *own* first line, which is never how a run of
 * concatenated literals sitting on lines of their own is laid out, and was
 * a real bug before this case was split out: the `+4` fallback below,
 * applied to this shape, measured from the string's own line and pushed
 * every part after the first four columns further right.
 *
 * Only when `needsParens` is false. With `needsParens` set, `emitString`
 * glues a fresh `(` in front of the first part, so the output's first line
 * no longer starts with the string -- and wrapping that same output again
 * would take the fallback below instead, giving a different answer on the
 * second pass. Using the fallback on the first pass too keeps the two
 * passes in agreement (idempotency), at the cost of a layout that's merely
 * conventional rather than aligned for this rare shape (a bare string
 * alone on a backslash-continued line, the only way a string that needs
 * its own grouping parens can start a line of its own).
 *
 * ## Otherwise: the statement's own indent, plus four
 *
 * A string starting mid-line (`x = "..."`, `foo("...")`) gets the
 * *statement's own* line indentation (the source line the region starts
 * on, tab-expanded the same way `discoverRegions` computes `indentColumn`
 * itself) plus four columns, matching Black's own hanging-indent
 * convention -- deliberately not `region.indentColumn`, which is the
 * string's own column mid-line and would place continuation lines
 * arbitrarily far right. Aligning to the opening quote instead (visual
 * indent) is a legitimate style too, but `WrapConfig` has no setting to
 * choose between the two, so this is a documented simplification rather
 * than a configurable one.
 */
export function continuationIndentColumns(
  region: WrappableRegion,
  source: string,
  cfg: WrapConfig,
  needsParens: boolean,
): number {
  const sourceLine = source.split('\n')[region.span.startRow] ?? '';

  // `trim()` rather than the `[ \t]` test below: ECMAScript also accepts
  // non-ASCII whitespace (U+00A0, U+FEFF, the Zs category) as indentation,
  // and a string indented that way still starts its own line. Every
  // continuation line is emitted with plain spaces regardless, so aligning
  // to `region.indentColumn` stays visually correct either way.
  if (!needsParens && sourceLine.slice(0, region.span.startColumn).trim() === '') {
    return region.indentColumn;
  }

  const statementIndentChars = /^[ \t]*/.exec(sourceLine)?.[0].length ?? 0;
  const statementIndentColumns = visualIndentColumn(sourceLine, statementIndentChars, cfg.tabSize);
  return statementIndentColumns + 4;
}
