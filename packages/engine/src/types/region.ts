import type { SourceSpan } from './span.js';

/**
 * The kinds of source regions the engine can discover and wrap.
 *
 * This list is intentionally closed rather than left open-ended — adding
 * a kind is a deliberate, cross-cutting change (dissolve/emit support in
 * every relevant adapter), not something that should happen accidentally
 * via a typo'd string.
 *
 * `'prose'` is exactly that kind of change, added for Markdown/LaTeX
 * support (`docs/planning/markdown-latex-plan.md`): a paragraph-shaped
 * unit whose per-line prefix is derived from container ancestry rather
 * than a fixed marker, discovered via `LanguageAdapter.discoverProse` and
 * wrapped via `LanguageAdapter.wrapProse` (`../types/adapter.ts`) instead
 * of the query-driven comment/string discovery every other kind uses —
 * see that plan's §1 for why prose is a genuinely different shape, not a
 * variant of `'lineComment'`.
 */
export type RegionKind =
  'lineComment' | 'blockComment' | 'docComment' | 'docstring' | 'stringLiteral' | 'prose';

/**
 * A single wrappable region of source text: a comment, a docstring, or a
 * string literal (including a multi-part concatenation run).
 */
export interface WrappableRegion {
  readonly kind: RegionKind;

  /**
   * The full extent of the region, including every part of a concatenation
   * run. For an ordinary (non-concatenated) region this equals `parts[0]`.
   */
  readonly span: SourceSpan;

  /**
   * The individual parts making up this region. Length 1 for an ordinary
   * region; length > 1 only for a concatenation run — adjacent string
   * literals grouped into one logical unit. Grouping a run into a single
   * region with multiple `parts`, rather than one region per literal, is
   * what makes wrapping a concatenation idempotent, which reflow logic
   * depends on.
   */
  readonly parts: readonly SourceSpan[];

  /**
   * The region's source text — still carrying its original syntax
   * (quotes, comment markers, escapes, concatenation operators), except
   * for one normalization: every line ending is collapsed to a bare
   * `\n`, regardless of what the source file actually uses (see
   * `../discovery/normalize-raw-text.ts` for why a CRLF source needs
   * this at all). Display/debugging use only — nothing treats this as
   * an editing source; `wrapRegions` always re-slices fresh text from
   * `source` for anything that becomes an actual `TextEdit`, precisely
   * so this field's own normalization never has to be undone.
   */
  readonly rawText: string;

  /**
   * Visual column of the region's start, with tabs expanded. Used to
   * compute the available width for reflow.
   */
  readonly indentColumn: number;

  /** The VSCode language id the region was discovered in, e.g. `'python'`. */
  readonly languageId: string;
}
