import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * SCSS's `LanguageDescriptor` -- comment-only, no string-literal support
 * (see `./adapter.ts`'s own doc comment for why `strings` is omitted).
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-scss@1.0.0`, `../../../grammars/`) with a throwaway probe
 * script -- see `docs/spikes/tree-sitter-comment-langs-batch-probe.mjs`
 * and `docs/language-candidates.md`'s SCSS row. The short version:
 *
 * - **Two distinct comment node types, not one** -- `js_comment` for `//`,
 *   a separate `comment` for `/* ... * /`. The same two-comment-node-type
 *   shape `docs/adapters.md` already found and solved for Java
 *   (`line_comment`/`block_comment`), just under different node names --
 *   `queries.comments` below needs two patterns sharing one capture name
 *   (`(js_comment) @comment (comment) @comment`), the identical mechanism
 *   Java's descriptor already proved compiles and captures correctly with
 *   no engine change. `./adapter.ts`'s `classify` branches on `node.type`
 *   first (`js_comment` is always `'lineComment'`, `comment` is always
 *   `'blockComment'`) -- no text-sniffing needed at all, since neither
 *   node type is ever ambiguous the way Java's `block_comment`
 *   (plain vs. Javadoc-marked) or JS/C++'s single lumped `comment` node
 *   are.
 * - **No doc-comment convention** -- `comments.doc` is left unset; every
 *   `comment`/`js_comment` node resolves to a plain comment kind.
 * - **String/value syntax is identical to CSS's own** -- no concatenation,
 *   no interpolation of the kind this project's `strings` block could
 *   describe.
 */
export const scssDescriptor: LanguageDescriptor = {
  id: 'scss',
  grammarWasm: 'grammars/tree-sitter-scss.wasm',

  queries: {
    // Two patterns, one capture name -- see this module's own doc comment
    // above for why SCSS needs this where CSS itself has gotten away
    // with a single `comment`-node pattern.
    comments: '(js_comment) @comment (comment) @comment',
  },

  comments: {
    line: { marker: '//', spaceAfter: true },
    block: { open: '/*', close: '*/' },

    neverReflow: [
      /^\/\/\s*stylelint-disable/i,
      /^\/\*\s*stylelint-disable/i, // stylelint's own inline enable/disable directive, either comment form
      /^\/\*\s*autoprefixer:\s*(on|off)\b/i, // autoprefixer's own control comment
    ],
  },
};
