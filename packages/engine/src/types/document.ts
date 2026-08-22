import type { DocDialectId } from './doc-dialect.js';

/**
 * A unit of reflowable text produced by segmentation (Phase 5: "add atom
 * segmentation with unbreakable unit support"). Defined here, ahead of
 * Phase 5, only because `Block` needs to reference it in its shape —
 * `width`, `breakBefore`, and `glue` aren't exercised until segmentation
 * and reflow exist.
 */
export interface Atom {
  readonly text: string;
  /**
   * Display width in columns, not character count (Phase 5: East Asian
   * Wide/Fullwidth characters count as 2, combining marks as 0).
   */
  readonly width: number;
  readonly breakBefore: boolean;
  readonly glue?: 'none' | 'space';
}

/**
 * A structural unit of a `LogicalDocument`.
 *
 * `verbatim` is the escape hatch that makes "preserve formatting"
 * tractable: anything the engine can't confidently reflow — code fences,
 * tables, ASCII art — becomes `verbatim` and passes through untouched
 * rather than risking corruption. Phase 4 biases toward `verbatim` when
 * uncertain for exactly this reason: a missed reflow opportunity is
 * invisible, a mangled table is a bug report.
 */
export type Block =
  | { readonly type: 'paragraph'; readonly atoms: readonly Atom[] }
  | {
      readonly type: 'listItem';
      readonly marker: string;
      readonly hangingIndent: number;
      readonly atoms: readonly Atom[];
    }
  | { readonly type: 'verbatim'; readonly lines: readonly string[] }
  | { readonly type: 'blank' }
  | { readonly type: 'sectionHeader'; readonly text: string }
  | {
      readonly type: 'fieldEntry';
      readonly label: string;
      readonly hangingIndent: number;
      readonly atoms: readonly Atom[];
    };

/**
 * Metadata about a `LogicalDocument` that isn't itself part of the block
 * sequence but is needed to reflow and re-emit it.
 */
export interface DocMeta {
  /**
   * Visual column (tabs expanded) that block content is relative to before
   * re-indenting on emit.
   */
  readonly indentColumn: number;
  /**
   * Detected or configured documentation dialect, for a docstring/doc-
   * comment body (Phase 8). Absent for plain comment blocks, which have no
   * dialect concept.
   */
  readonly dialect?: DocDialectId;
}

/**
 * The dissolved, structure-preserving representation of a region's text —
 * what segmentation produces and reflow operates on.
 *
 * Shared across every language: dissolve and emit are per-language, but
 * this model, and everything built on top of it (block splitting, atom
 * segmentation, reflow), is not. That split is the whole reason the
 * adapter interface can stay small.
 */
export interface LogicalDocument {
  readonly blocks: readonly Block[];
  readonly meta: DocMeta;
}
