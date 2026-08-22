/**
 * Source span and text edit primitives.
 *
 * This is the foundational vocabulary of the whole engine: every region,
 * every diff, and every edit sent back to an editor host is expressed in
 * terms of a `SourceSpan` and, ultimately, a `TextEdit`.
 *
 * ## UTF-16 vs UTF-8 (decide here, not later)
 *
 * tree-sitter indexes source text in UTF-8 *bytes*. VSCode's `Position`
 * (and therefore every `TextEdit` VSCode expects back) counts UTF-16
 * *code units*. These two schemes agree for plain ASCII and diverge for
 * anything else — and "anything else" is common: em dashes and smart
 * quotes show up constantly in real docstrings and comments.
 *
 * `SourceSpan` carries both byte offsets *and* row/column so a span never
 * has to be lossily reconverted between the two schemes after the fact.
 * `startByte`/`endByte` are tree-sitter's UTF-8 byte offsets, unchanged.
 * `startRow`/`startColumn`/`endRow`/`endColumn` are VSCode-shaped: `row`
 * is a 0-based line number and `column` is a 0-based UTF-16 code-unit
 * offset into that line — matching `vscode.Position`'s `line`/`character`.
 *
 * The single place that converts between the two schemes is
 * `PositionMapper` (`./position-mapper.ts`, added later in this phase).
 * Nothing else in the engine should reimplement that conversion.
 */

export interface SourceSpan {
  readonly startByte: number;
  readonly endByte: number;
  readonly startRow: number;
  readonly startColumn: number;
  readonly endRow: number;
  readonly endColumn: number;
}

/**
 * A single replacement to apply to the source: replace the text covered by
 * `span` with `newText`. `startByte`/`endByte` on the span are the source
 * of truth for *where* the edit applies inside the engine (e.g. when
 * diffing against a re-parsed tree); the row/column fields are what get
 * handed to an editor host such as VSCode's `WorkspaceEdit`.
 */
export interface TextEdit {
  readonly span: SourceSpan;
  readonly newText: string;
}
