/**
 * Identifiers for the documentation-comment dialects the engine
 * understands (Phase 8: "add dialect registry decoupled from language
 * adapters").
 *
 * Split into its own module because dialects are a cross-cutting concern,
 * not an adapter internal: Google/NumPy/Sphinx-style docstrings are
 * Python-specific today, but the same idea (JSDoc, Doxygen) applies to
 * other languages later (Phase 12b/12c). A `LanguageDescriptor` only
 * *lists* which dialect ids it supports via `comments.doc.dialects`; it
 * never owns dialect detection or reflow logic itself.
 */
export type DocDialectId = 'google' | 'numpy' | 'sphinx' | 'plain';
