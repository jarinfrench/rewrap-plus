/**
 * Identifiers for the documentation-comment dialects the engine
 * understands, via a dialect registry decoupled from language adapters.
 *
 * Split into its own module because dialects are a cross-cutting concern,
 * not an adapter internal: Google/NumPy/Sphinx-style docstrings were
 * Python-specific at first, but the same idea applies to other languages
 * too — `'jsdoc'` is the first dialect governing a `'docComment'` region
 * (a `/** ... * /` block comment) rather than a `'docstring'` region,
 * proving the split this doc comment already anticipated. `'doxygen'` is
 * the second `'docComment'` dialect — its tags may be written `@tag` *or*
 * `\tag` (both are valid Doxygen syntax; JSDoc only ever has the former),
 * see `../docs/doxygen.ts`. `'javadoc'` is the third — `@`-only like
 * JSDoc, but kept as its own dialect id rather than reusing `'jsdoc'`
 * directly, matching how `'doxygen'` got its own id despite the same
 * near-identical field-list shape: a `LanguageDescriptor`'s
 * `comments.doc.dialects` list is meant to name the real convention a
 * language's ecosystem actually uses, not an implementation detail of
 * which existing dialect happens to share its parsing logic — see
 * `../docs/javadoc.ts`.
 * A `LanguageDescriptor` only *lists* which dialect ids it supports via
 * `comments.doc.dialects`; it never owns dialect detection or reflow logic
 * itself.
 */
export type DocDialectId = 'google' | 'numpy' | 'sphinx' | 'jsdoc' | 'doxygen' | 'javadoc' | 'plain';
