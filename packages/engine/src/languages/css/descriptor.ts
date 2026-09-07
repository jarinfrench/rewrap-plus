import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * CSS's `LanguageDescriptor` — comment-only, no string-literal support
 * (see `./adapter.ts`'s own doc comment for why `strings` is omitted).
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-css@0.25.0`, `../../../grammars/`) with a throwaway probe
 * script — see `docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`
 * and `docs/language-candidates.md`'s CSS row. The short version:
 *
 * - **One `comment` node type, `/* ... * /` only — no `//` line-comment
 *   form at all.** Unlike every language shipped so far (Python's `#`,
 *   the ECMAScript/C/Java family's `//`), CSS has nothing for
 *   `comments.line` to describe, so it's left unset entirely — the first
 *   descriptor in this package with a block-only comment shape and no
 *   line form to fall back on. `./adapter.ts`'s `classify` is required
 *   because of this: `discoverRegions`'s default fallback assigns
 *   `'lineComment'` to every `@comment` capture when the adapter declares
 *   no override, which would be wrong for every single CSS comment (there
 *   is no `comments.line` for the emit path to use).
 * - **No JSDoc/Doxygen-style doc-comment convention** — `comments.doc` is
 *   left unset; every `comment` node is a plain `'blockComment'`.
 * - **No concatenation, no interpolation** — CSS has no string-joining
 *   syntax of any kind, unlike every language with a `strings` block in
 *   this package.
 */
export const cssDescriptor: LanguageDescriptor = {
  id: 'css',
  grammarWasm: 'grammars/tree-sitter-css.wasm',

  queries: {
    comments: '(comment) @comment',
  },

  comments: {
    // No `line` — CSS has no `//` form, see this module's own doc comment.
    block: { open: '/*', close: '*/' },

    neverReflow: [
      /^\/\*\s*stylelint-disable/i, // stylelint's own inline enable/disable directive
      /^\/\*\s*autoprefixer:\s*(on|off)\b/i, // autoprefixer's own control comment
    ],
  },

  // `../../wrap.ts`'s own directive-marker resolution
  // (`descriptor.directives?.marker ?? descriptor.comments.line?.marker`)
  // falls back to `'#'` when both are unset — silently wrong for a
  // language with no line comment at all, the same gap Markdown's own
  // `directives: { marker: '<!--' }` already exists to close. `# rewrap:
  // off` means nothing in CSS; `/* rewrap: off */` is the natural,
  // idiomatic spelling, and `scanDirectives` only ever looks for its
  // marker text anywhere on a line, not a matching close delimiter, so a
  // bare `/*` here is sufficient the same way `<!--` is for Markdown.
  directives: { marker: '/*' },
};
