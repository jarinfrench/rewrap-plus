import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * TOML's `LanguageDescriptor` -- comment-only, no string-literal support
 * (see `./adapter.ts`'s own doc comment for why `strings` is omitted
 * entirely, matching Markdown/LaTeX's precedent for a language with
 * nothing safe to wrap there).
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-toml@0.5.1`, `../../../grammars/`) with a throwaway probe
 * script, not trusted from memory -- see
 * `docs/spikes/tree-sitter-comment-langs-batch-probe.mjs` and
 * `docs/language-candidates.md`'s TOML row for the investigation this
 * descriptor is built from. The short version:
 *
 * - **One `comment` node type**, covering both a standalone `# ...` line
 *   and a comment trailing a `key = "value"` pair on the same line --
 *   identical shape to Python's own `comment` node, no block form at all.
 *   No `classify` override needed: `discoverRegions`'s default fallback
 *   (`'lineComment'` for every `@comment` capture when the adapter
 *   declares no override) is already correct here, the same way it is for
 *   Bash below -- TOML has no other comment-shaped `RegionKind` a default
 *   fallback could get wrong.
 * - **No doc-comment convention.** TOML has nothing resembling a
 *   docstring/JSDoc-style tag-list convention, so `comments.doc` is left
 *   unset.
 * - **String *values* are deliberately out of scope**, not an oversight --
 *   see `./adapter.ts`'s doc comment.
 */
export const tomlDescriptor: LanguageDescriptor = {
  id: 'toml',
  grammarWasm: 'grammars/tree-sitter-toml.wasm',

  queries: {
    comments: '(comment) @comment',
  },

  comments: {
    line: { marker: '#', spaceAfter: true },

    // No well-established suppress-comment convention for TOML (unlike
    // Python's `# noqa` or Bash's `# shellcheck disable=...`) -- left
    // empty rather than guessed at, matching this field's own
    // requiredness (every descriptor must set it, even to `[]`).
    neverReflow: [],
  },
};
