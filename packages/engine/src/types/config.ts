/**
 * Wrap configuration: the plain-data contract between a caller (the VSCode
 * extension today; a future CLI per Phase 12d) and the engine.
 *
 * Deliberately plain data — no VSCode types anywhere in this file, and
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
   * - `'off'` — never wrap strings; comments/docstrings only.
   * - `'prose'` — wrap only strings that score as prose-like under the
   *   heuristic (Phase 9). The conservative default.
   * - `'all'` — wrap every eligible string, ignoring the prose heuristic.
   */
  readonly stringPolicy: 'prose' | 'all' | 'off';

  /**
   * Documentation dialect to assume for docstrings/doc comments. `'auto'`
   * detects per docstring (Phase 8, "detect per docstring, not per file");
   * the named dialects force that dialect's parsing/emission regardless of
   * detection.
   */
  readonly docDialect: 'auto' | 'google' | 'numpy' | 'sphinx' | 'plain';

  /**
   * Treat already-indented blocks (beyond a paragraph's first line) as
   * verbatim rather than reflowing them.
   */
  readonly preserveIndentedBlocks: boolean;

  /**
   * Adapter-specific override, e.g. forcing a particular concatenation
   * style. Opaque to the engine core; interpreted by the active language
   * adapter, if it recognizes it.
   */
  readonly concatStyle?: string;
}
