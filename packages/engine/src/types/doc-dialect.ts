/**
 * Identifiers for the documentation-comment dialects the engine
 * understands (Phase 8: "add dialect registry decoupled from language
 * adapters").
 *
 * Split into its own module because dialects are a cross-cutting concern,
 * not an adapter internal: Google/NumPy/Sphinx-style docstrings were
 * Python-specific at first, but the same idea applies to other languages
 * too — `'jsdoc'` (Phase 12b) is the first dialect governing a
 * `'docComment'` region (a `/** ... * /` block comment) rather than a
 * `'docstring'` region, proving the split this doc comment already
 * anticipated. A `LanguageDescriptor` only *lists* which dialect ids it
 * supports via `comments.doc.dialects`; it never owns dialect detection or
 * reflow logic itself.
 */
export type DocDialectId = 'google' | 'numpy' | 'sphinx' | 'jsdoc' | 'plain';
