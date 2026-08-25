import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * JavaScript's `LanguageDescriptor` — Phase 6b's canary adapter.
 *
 * **Deliberately thin: comments only.** No strings, no dialects, no
 * docstrings — this exists to answer one question ("can a new language
 * be added without touching the engine?") at the cheapest possible
 * moment, not to be a real JavaScript adapter. Full JS/TS support
 * (template literals, JSDoc as a registered dialect, `+`-operator
 * string concatenation) is Phase 12b's job, building on whatever this
 * canary proves out.
 *
 * `strings` below is still populated with real, structurally valid
 * data — `LanguageDescriptor`/`validateDescriptor` require at least one
 * quote form and a non-empty `queries.strings` regardless of whether an
 * adapter does anything with what it discovers (`AdapterRegistry`
 * enforces this at registration, and rightly so: a malformed descriptor
 * should fail loudly, not surface as a mysterious runtime error). This
 * adapter simply never dissolves or emits string regions — Python's own
 * `'stringLiteral'`/`'docstring'` regions are equally undissolved by
 * `wrapRegions` today, reported as skipped with a reason, so this isn't
 * new engine behavior, just the second adapter to rely on it.
 *
 * Node names and shapes verified against the vendored grammar
 * (`tree-sitter-javascript@0.25.0`, `packages/engine/grammars/`) with a
 * throwaway probe script, not trusted from memory — the same
 * "probe before coding" discipline Phase 2/3 used for Python. Findings
 * this descriptor depends on, documented in full in
 * `docs/adapters.md` ("JavaScript canary — grammar findings"):
 *
 * - A `comment` node covers `//`, plain `/*` blocks, and `/**` blocks
 *   alike — one node type for all three forms, distinguished only by
 *   their own text. `javascriptAdapter`'s `classify` (`./adapter.ts`)
 *   is what tells them apart.
 * - Unlike Python's `comment` node, a JavaScript `//` comment's span
 *   does *not* include a trailing `\r` on a CRLF-terminated line — the
 *   grammar's own tokenizer already excludes it. `discoverRegions`'s
 *   `trimTrailingCR` safeguard (added for Python) is a no-op here, not
 *   a fix this adapter separately needed.
 * - A `string` node's shape matches Python's exactly (double- or
 *   single-quoted, no prefix complexity to speak of). Template literals
 *   (backtick-delimited) are a *different* node type, `template_string`
 *   — not captured by `queries.strings` here, consistent with this
 *   adapter not supporting strings at all.
 */
export const javascriptDescriptor: LanguageDescriptor = {
  id: 'javascript',
  grammarWasm: 'grammars/tree-sitter-javascript.wasm',

  queries: {
    comments: '(comment) @comment',
    strings: '(string) @string',
    // No `concatenations` — this adapter doesn't support string
    // wrapping, so there's nothing for concatenation-run grouping to
    // do. Phase 12b adds this alongside real string support.
  },

  comments: {
    line: { marker: '//', spaceAfter: true },

    // JSDoc/Doxygen/Javadoc shape: the open delimiter alone on its own
    // line, a continuation-prefixed content on every line after, the
    // close delimiter alone on the last line — Phase 6b's own reason
    // for existing (`comments/dissolve-block-comments.ts`,
    // `comments/emit-block-comments.ts`). `classify` only ever assigns
    // `'blockComment'` to a comment whose text starts with this exact
    // `open` form; a plain single-star block comment is deliberately
    // excluded from discovery rather than mis-dissolved through a
    // delimiter pair it doesn't match — see `./adapter.ts`.
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // A conservative, well-known set of tooling directives that must
    // never move to a different line — the JS/TS analog of Python's
    // `# noqa`/`# type:`. Not exhaustive (this is a canary, not a real
    // adapter); extending it is exactly the kind of change Phase 12b
    // should make freely without touching the engine.
    neverReflow: [
      /^\/\/\s*eslint-disable/,
      /^\/\/\s*@ts-(expect-error|ignore|nocheck)\b/,
      /^\/\/\s*prettier-ignore\b/,
      /^\/\/\s*istanbul\s+ignore\b/,
    ],
  },

  strings: {
    // Structurally valid but unexercised — see this module's own doc
    // comment for why a "comments only" adapter still populates this.
    quotes: [
      { delimiter: '"', multiline: false, escapes: true },
      { delimiter: "'", multiline: false, escapes: true },
    ],
    prefixes: [],
    rawForms: [],
    escapes: {
      sequences: [/^\\\\/, /^\\'/, /^\\"/, /^\\n/, /^\\t/, /^\\r/, /^\\0/, /^\\u[0-9a-fA-F]{4}/],
    },
    placeholders: [],
    concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
  },
};
