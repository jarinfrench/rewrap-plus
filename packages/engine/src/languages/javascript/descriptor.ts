import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * JavaScript's `LanguageDescriptor` — a full adapter, extending an earlier
 * comment-only canary build in place: that canary proved the engine's
 * pipeline generalized past its original Python-only assumptions, and
 * this descriptor turns it into a real, registered adapter.
 *
 * Node names and shapes below remain exactly what that earlier canary
 * already verified against the vendored grammar
 * (`tree-sitter-javascript@0.25.0`, `packages/engine/grammars/`), plus
 * what was additionally probed for `+`-concatenation and string shape
 * while building the sibling `../typescript/` adapter (identical grammar
 * family — see `docs/adapters.md`'s JavaScript/TypeScript/TSX — full
 * adapters section and `docs/parsing.md`'s Finding 5, both written
 * against `tree-sitter-typescript`/`tree-sitter-tsx` but directly
 * re-verified against this package's own vendored
 * `tree-sitter-javascript.wasm` too):
 *
 * - A `comment` node covers `//`, plain `/*` blocks, and `/**` blocks
 *   alike — one node type for all three forms, distinguished only by
 *   their own text. `javascriptAdapter`'s `classify` (`./adapter.ts`,
 *   reusing `../ecmascript/adapter-support.ts`'s shared
 *   `classifyEcmaScriptNode`) is what tells them apart.
 * - A `string` node's shape matches Python's exactly enough for reuse —
 *   double- or single-quoted, no prefix complexity, no triple-quote form
 *   — which is what lets `wrapString` reuse the same `strings/
 *   dissolve-string.ts`/`strings/emit-string.ts` Python's own adapter
 *   uses, promoted to shared code once this adapter needed it too.
 *   Template literals (backtick-delimited) are a *different* node type,
 *   `template_string` — deliberately not captured by `queries.strings`
 *   here (deferred, the same way Python defers triple-quoted ordinary
 *   strings — a known scope boundary, not an oversight).
 * - `binary_expression` exposes `left`/`operator`/`right` fields for
 *   `+`-concatenation — the same field-name convention
 *   `discoverRegions`'s concatenation grouper already expected from
 *   Python's `binary_operator`, so `queries.concatenations` below needed
 *   no engine change to work.
 */
export const javascriptDescriptor: LanguageDescriptor = {
  id: 'javascript',
  aliases: ['javascriptreact'],
  grammarWasm: 'grammars/tree-sitter-javascript.wasm',

  queries: {
    comments: '(comment) @comment',
    strings: '(string) @string',
    // JavaScript has no implicit (bare-adjacency) string concatenation —
    // only `+`. Unlike Python's `queries.concatenations`, there's no
    // `@concat.implicit` alternative to declare.
    concatenations: '(binary_expression operator: "+") @concat.operator',
  },

  comments: {
    line: { marker: '//', spaceAfter: true },

    // JSDoc/Doxygen/Javadoc shape: the open delimiter alone on its own
    // line, continuation-prefixed content on every line after, the close
    // delimiter alone on the last line. Reused identically for both a
    // `'blockComment'` region (were one ever classified — see
    // `./adapter.ts`, none currently is) and every `'docComment'` region,
    // since JSDoc's delimiter syntax *is* this shape.
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // A plain `/* ... */` comment (no JSDoc marker) shares `block`'s
    // close delimiter and continuation style but not its open one —
    // `classifyEcmaScriptNode` checks this distinctly from `block.open`
    // (checked after the doc-marker check, since `/**` also starts with
    // `/*`) to tell a plain block comment apart from a JSDoc one.
    plainBlock: { open: '/*', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // `markers` names the exact delimiter `classifyEcmaScriptNode` checks
    // a comment's text against to classify it `'docComment'` rather than
    // excluding it.
    doc: { markers: ['/**'], dialects: ['jsdoc', 'plain'] },

    // A conservative, well-known set of tooling directives that must
    // never move to a different line — the JS/TS analog of Python's
    // `# noqa`/`# type:`.
    neverReflow: [
      /^\/\/\s*eslint-disable/,
      /^\/\/\s*@ts-(expect-error|ignore|nocheck)\b/,
      /^\/\/\s*prettier-ignore\b/,
      /^\/\/\s*istanbul\s+ignore\b/,
    ],
  },

  strings: {
    quotes: [
      { delimiter: '"', multiline: false, escapes: true },
      { delimiter: "'", multiline: false, escapes: true },
    ],
    // No string-literal prefix concept in JavaScript (unlike Python's
    // `r`/`b`/`f`) — every ordinary string is plain.
    prefixes: [],
    rawForms: [],
    escapes: {
      sequences: [
        /^\\\r?\n/, // line continuation — refused outright by isSafeToWrap, not segmented
        /^\\\\/,
        /^\\'/,
        /^\\"/,
        /^\\`/,
        /^\\0/,
        /^\\b/,
        /^\\f/,
        /^\\n/,
        /^\\r/,
        /^\\t/,
        /^\\v/,
        /^\\x[0-9a-fA-F]{2}/,
        /^\\u\{[0-9a-fA-F]+\}/, // ES2015 Unicode code point escape
        /^\\u[0-9a-fA-F]{4}/,
      ],
    },
    // No `str.format()`/f-string-style placeholder concept in an ordinary
    // JS/TS string literal — `${}` interpolation exists only inside a
    // template literal, which this descriptor's `queries.strings`
    // deliberately never captures (see this module's own doc comment).
    placeholders: [],
    concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
  },
};
