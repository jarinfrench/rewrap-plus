import type { SourceSpan } from './span.js';

/**
 * The kinds of source regions the engine can discover and wrap.
 *
 * This list is intentionally closed for v1 (Python-only, per the decisions
 * of record) rather than left open-ended — adding a kind is a deliberate,
 * cross-cutting change (dissolve/emit support in every relevant adapter),
 * not something that should happen accidentally via a typo'd string.
 */
export type RegionKind =
  'lineComment' | 'blockComment' | 'docComment' | 'docstring' | 'stringLiteral';

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
   * literals grouped into one logical unit (Phase 3: "group adjacent
   * string literals into concatenation runs"). Grouping a run into a
   * single region with multiple `parts`, rather than one region per
   * literal, is what makes wrapping a concatenation idempotent (Phase 10
   * depends on this).
   */
  readonly parts: readonly SourceSpan[];

  /**
   * The region's source text, unmodified — still carrying its original
   * syntax (quotes, comment markers, escapes, concatenation operators).
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
