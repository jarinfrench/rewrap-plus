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
 *
 * `'commentBasedHelp'` is the fourth `'docComment'` dialect (after
 * `'jsdoc'`/`'doxygen'`/`'javadoc'`) — PowerShell's own convention
 * (`.SYNOPSIS`/`.DESCRIPTION`/`.PARAMETER` flush-left dot-tags inside a
 * `<# ... #>` block, per Microsoft's `about_Comment_Based_Help`). Unlike
 * every earlier `'docComment'` dialect's marker, a `.TAG` isn't a fixed
 * literal prefix `LanguageDescriptor.comments.doc.markers` can express by
 * itself the way `/**`/`\tag`/`@tag` are — see
 * `../languages/powershell/adapter.ts`'s own doc comment for how
 * `classify` tells a comment-based-help block apart from a plain
 * `<# ... #>` comment (both share the identical grammar node type; text
 * content is the only signal, the same mechanism `'jsdoc'`/`'doxygen'`/
 * `'javadoc'` already rely on).
 */
export type DocDialectId =
  | 'google'
  | 'numpy'
  | 'sphinx'
  | 'jsdoc'
  | 'doxygen'
  | 'javadoc'
  | 'commentBasedHelp'
  | 'plain';
