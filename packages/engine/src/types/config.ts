/**
 * Wrap configuration: the plain-data contract between a caller (the VSCode
 * extension, the CLI) and the engine.
 *
 * Deliberately plain data -- no VSCode types anywhere in this file, and
 * nothing here requires a live editor host. This is the reuse seam that
 * keeps the engine usable outside VSCode without a rewrite: anything that
 * can construct a `WrapConfig` object can drive the engine.
 */
export interface WrapConfig {
  /** Maximum line width to wrap to. */
  readonly columnLimit: number;

  /** Width, in columns, a tab character expands to for indent/width calculations. */
  readonly tabSize: number;

  readonly wrapComments: boolean;
  readonly wrapStrings: boolean;

  /**
   * How aggressively to wrap string literals:
   * - `'off'` -- never wrap strings; comments/docstrings only.
   * - `'prose'` -- wrap only strings that score as prose-like under the
   *   shared prose heuristic. The conservative default.
   * - `'all'` -- wrap every eligible string, ignoring the prose heuristic.
   */
  readonly stringPolicy: 'prose' | 'all' | 'off';

  /**
   * Documentation dialect to assume for docstrings/doc comments. `'auto'`
   * detects per docstring, not per file; the named dialects force that
   * dialect's parsing/emission regardless of detection.
   */
  readonly docDialect:
    | 'auto'
    | 'google'
    | 'numpy'
    | 'sphinx'
    | 'jsdoc'
    | 'doxygen'
    | 'javadoc'
    | 'plain';

  /**
   * Treat already-indented blocks (beyond a paragraph's first line) as
   * verbatim rather than reflowing them.
   */
  readonly preserveIndentedBlocks: boolean;

  /**
   * Use `reflowBlock`'s `'balanced'` (minimum-raggedness) line-breaking
   * mode instead of the `'greedy'` default -- see `ReflowOptions.mode`
   * (`../reflow/reflow-block.ts`) for what the two modes actually do.
   * `false` (greedy) by default: greedy is the more predictable, more
   * widely-expected default, and costs less to compute. This field was
   * anticipated well before it was actually added to the interface,
   * once VSCode integration needed it for real -- see `../wrap.ts` for
   * where it's threaded through to `emitLineComments`/`emitBlockComments`.
   */
  readonly balancedWrapping: boolean;

  /**
   * How a field-entry's (`:param x:`, `x (int):`, `@param x`, ...)
   * continuation lines are indented, in every dialect built on
   * `../docs/field-entries.ts`'s shared `groupFieldEntries` (Google,
   * Sphinx, Doxygen, Javadoc, JSDoc -- NumPy is exempt, its own entries
   * never put a label and description on the same line to begin with):
   * - `'fixed'` -- one consistent extra indent level
   *   (`continuationIndentWidth`, 4 columns) past the entry's own indent,
   *   regardless of the label's length. The default: every field in a
   *   docstring lands at the same continuation column, so touching one
   *   field's wrap never changes another untouched field's indentation.
   * - `'aligned'` -- continuation lines align under the description text
   *   that follows the label on its own first line, so the indent grows
   *   with the label's length (`:param a_much_longer_name:` indents
   *   deeper than `:param x:`). Visually tidy for a hand-written
   *   docstring where every field already uses this convention
   *   consistently, but a longer label in one field doesn't change any
   *   other field's own alignment, so it's opt-in rather than the
   *   default.
   *
   * Optional; a caller that omits it gets `'fixed'`, same as explicitly
   * setting it -- see `../docs/field-entries.ts`'s own default parameter.
   */
  readonly hangingIndentStyle?: 'fixed' | 'aligned';

  /**
   * Adapter-specific override, e.g. forcing a particular concatenation
   * style. Opaque to the engine core; interpreted by the active language
   * adapter, if it recognizes it.
   */
  readonly concatStyle?: string;
}
