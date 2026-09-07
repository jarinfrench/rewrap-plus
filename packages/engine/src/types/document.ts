import type { DocDialectId } from './doc-dialect.js';

/**
 * A unit of reflowable text produced by atom segmentation. Defined here,
 * ahead of the segmentation code that produces it, only because `Block`
 * needs to reference it in its shape -- `width`, `breakBefore`, and `glue`
 * aren't exercised until segmentation and reflow exist.
 */
export interface Atom {
  readonly text: string;
  /**
   * Display width in columns, not character count (East Asian
   * Wide/Fullwidth characters count as 2, combining marks as 0).
   */
  readonly width: number;
  readonly breakBefore: boolean;
  /**
   * How this atom joins to the one before it when both land on the same
   * reflowed line: `'none'` -- no space (glued: a placeholder followed
   * immediately by punctuation, an inline-code span, etc). `'double'` --
   * two spaces, because the *original* source had two-or-more spaces
   * here immediately after a sentence-ending `.`/`!`/`?` on the previous
   * atom (`../segmentation/atomize-words.ts` is the one place that sets
   * this -- see its own doc comment for why the detection is scoped that
   * narrowly rather than preserving any run of 2+ spaces anywhere).
   * Absent (or `'space'`) -- the ordinary case, one space.
   */
  readonly glue?: 'none' | 'space' | 'double';
}

/**
 * A structural unit of a `LogicalDocument`.
 *
 * `verbatim` is the escape hatch that makes "preserve formatting"
 * tractable: anything the engine can't confidently reflow -- code fences,
 * tables, ASCII art -- becomes `verbatim` and passes through untouched
 * rather than risking corruption. The engine biases toward `verbatim`
 * when uncertain for exactly this reason: a missed reflow opportunity is
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
      /**
       * The entry's description, as nested blocks rather than a flat atom
       * stream -- `blocks[0]` is conventionally the description's own
       * opening content (`paragraph`, or `listItem`/`verbatim` if the
       * description opens directly with one), with any further structure
       * (a nested list, a fenced sample) as later entries in the same
       * array.
       */
      readonly blocks: readonly Block[];
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
   * comment body. Absent for plain comment blocks, which have no
   * dialect concept.
   */
  readonly dialect?: DocDialectId;
}

/**
 * The dissolved, structure-preserving representation of a region's text --
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
