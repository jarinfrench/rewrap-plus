import type { WrapConfig } from '../types/config.js';
import type { WrappableRegion } from '../types/region.js';
import { reflowOptionsFrom } from '../reflow/reflow-block.js';
import { visualIndentColumn } from '../discovery/visual-indent-column.js';
import { dissolveString } from './dissolve-string.js';
import { escapeQuoteCollisions } from './escape-quote-collisions.js';
import { emitString, type ConcatenationStyle } from './emit-string.js';

/**
 * The two axes a `'stringLiteral'` `wrapString` implementation can differ
 * on, once the dissolve/escape/hanging-indent/emit pipeline itself is
 * shared: whether a split run needs its own inserted grouping parentheses,
 * and which concatenation syntax to emit with. Both are always constant
 * per language for C++/Java/ECMAScript (see `wrapStringDefault`'s own doc
 * comment) — only Python's own `wrapString` (`../languages/python/wrap-string.ts`)
 * ever needs to *resolve* these per-region, from real syntax-tree context
 * (`../languages/python/emit-context.ts`), which is exactly why Python
 * doesn't use this helper.
 */
export interface WrapStringDefaultOptions {
  readonly needsParens: boolean;
  readonly concatenationStyle: ConcatenationStyle;
}

/**
 * Shared `wrapString` pipeline for a `'stringLiteral'` region whose
 * `needsParens`/`concatenationStyle` are fixed constants rather than
 * something that needs resolving per-region: dissolve
 * (`./dissolve-string.ts`), normalize quote collisions
 * (`./escape-quote-collisions.ts`), and emit (`./emit-string.ts`).
 *
 * Extracted once three real adapters — C++, Java, and every ECMAScript-
 * family language — turned out to share this exact pipeline byte-for-byte,
 * differing only in the two `opts` literals each passes in (C++:
 * `{ needsParens: false, concatenationStyle: 'implicit' }`; Java and
 * ECMAScript: `{ needsParens: false, concatenationStyle: 'operator' }`) —
 * the same "promote once more than one real consumer needs it" call this
 * project has made repeatedly (`docs/adapters.md`). None of these three
 * ever had a real reason to call through an `emitContext`-shaped hook in
 * the first place: each already knows its own answer to both questions
 * before ever looking at `region`/`tree`, which is exactly why the
 * `LanguageAdapter.emitContext` hook these three used to nominally
 * implement was never actually invoked by anything — see the git history
 * on that interface member's removal for the full investigation.
 *
 * Python's own `wrapString` (`../languages/python/wrap-string.ts`) is
 * deliberately not rebuilt on top of this helper: it genuinely needs
 * `../languages/python/emit-context.ts`'s real tree-walking resolution of
 * both axes per-region (a bare assignment RHS needs parens; an argument to
 * a call doesn't), which this helper's constant-`opts` shape can't express.
 */
export function wrapStringDefault(
  region: WrappableRegion,
  source: string,
  cfg: WrapConfig,
  opts: WrapStringDefaultOptions,
): string {
  const dissolved = dissolveString(region, source);
  const safeText = escapeQuoteCollisions(dissolved.text, dissolved.quoteDelimiter);

  const sourceLine = source.split('\n')[region.span.startRow] ?? '';
  const statementIndentChars = /^[ \t]*/.exec(sourceLine)?.[0].length ?? 0;
  const statementIndentColumns = visualIndentColumn(sourceLine, statementIndentChars, cfg.tabSize);
  const hangingIndentColumns = statementIndentColumns + 4;

  const reflowOptions = reflowOptionsFrom(cfg);

  return emitString(
    safeText,
    dissolved.prefix,
    dissolved.quoteDelimiter,
    region.indentColumn,
    hangingIndentColumns,
    opts.needsParens,
    opts.concatenationStyle,
    cfg.columnLimit,
    reflowOptions,
  );
}
