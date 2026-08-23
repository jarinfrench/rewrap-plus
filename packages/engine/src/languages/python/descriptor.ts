import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * Python's `LanguageDescriptor`.
 *
 * Node names and shapes below were verified against the vendored grammar
 * (`tree-sitter-python@0.25.0`, `packages/engine/grammars/`) with a
 * throwaway probe script, not trusted from memory — the same discipline
 * Phase 2's spike used and documented in `docs/parsing.md`; see that
 * file's own warning ("don't trust memory here") and Phase 3's commit
 * introducing `queries.concatenations` for the specific findings this
 * descriptor depends on (`concatenated_string`'s children are always
 * plain `string` nodes; `binary_operator` exposes `left`/`operator`/
 * `right` fields; a `string` node's `string_start` child carries the
 * prefix and opening quote as one token, e.g. `rb"`, `f"`, `"""`).
 */
export const pythonDescriptor: LanguageDescriptor = {
  id: 'python',
  grammarWasm: 'grammars/tree-sitter-python.wasm',

  queries: {
    comments: '(comment) @comment',
    strings: '(string) @string',
  },

  comments: {
    line: { marker: '#', spaceAfter: true },

    // Python has no block-comment syntax — every `#` comment is a line
    // comment, so `comments.block` is intentionally left unset. Phase 6b
    // introduces the first descriptor that *does* set it (the canary
    // JavaScript adapter, `/** */` and friends), specifically so that
    // path isn't exercised for the first time by a language that also
    // has every other kind of complexity Python does.
    doc: { markers: ['"""', "'''"], dialects: ['google', 'numpy', 'sphinx', 'plain'] },

    // Directive comments that must never be reflowed regardless of
    // policy — moving one to a different line changes program behavior
    // (shebang, encoding declaration, inline type comments) or a
    // tool's own opt-out (`noqa`, `pylint:`, `fmt:`). This is Phase 6
    // territory to *act on*, but the patterns belong on the descriptor —
    // static data about Python's own comment conventions — so they're
    // populated here rather than invented ad hoc later.
    neverReflow: [
      /^#!/, // shebang
      /^#\s*-\*-.*-\*-\s*$/, // PEP 263 coding declaration, e.g. `# -*- coding: utf-8 -*-`
      /^#\s*type:\s*/, // inline type comments
      /^#\s*noqa\b/i,
      /^#\s*pylint:\s*/,
      /^#\s*pragma\b/i,
      /^#\s*fmt:\s*(on|off)\b/i, // Black's own directive (Phase 9 honors these too)
    ],
  },

  strings: {
    quotes: [
      { delimiter: '"""', multiline: true, escapes: true },
      { delimiter: "'''", multiline: true, escapes: true },
      { delimiter: '"', multiline: false, escapes: true },
      { delimiter: "'", multiline: false, escapes: true },
    ],

    // Canonical, lowercase, case-normalized forms — case normalization
    // ("R" vs "r", "Rb" vs "rb") is explicitly the adapter's concern per
    // `PrefixSpec.prefix`'s own doc comment, not the descriptor's. `rf`
    // and `rb` stand in for both orderings (`rf`/`fr`, `rb`/`br`); the
    // adapter's prefix parsing (added later in this phase) normalizes
    // whichever order it finds in source to these canonical forms before
    // matching against this list.
    prefixes: [
      { prefix: '' },
      { prefix: 'u' },
      { prefix: 'r', raw: true },
      { prefix: 'f', formatted: true },
      { prefix: 'b', bytes: true },
      { prefix: 'rf', raw: true, formatted: true },
      { prefix: 'rb', raw: true, bytes: true },
    ],

    // Python has no separate raw-form delimiter pair (unlike C++'s
    // `R"(...)"`, Phase 12c) — rawness is entirely prefix-driven, via the
    // `r`/`rf`/`rb` entries above.
    rawForms: [],

    escapes: {
      sequences: [
        /^\\\r?\n/, // line continuation
        /^\\\\/,
        /^\\'/,
        /^\\"/,
        /^\\a/,
        /^\\b/,
        /^\\f/,
        /^\\n/,
        /^\\r/,
        /^\\t/,
        /^\\v/,
        /^\\[0-7]{1,3}/, // octal
        /^\\x[0-9a-fA-F]{2}/,
        /^\\N\{[^}]+\}/, // named Unicode escape, e.g. \N{BULLET}
        /^\\u[0-9a-fA-F]{4}/,
        /^\\U[0-9a-fA-F]{8}/,
      ],
    },

    placeholders: [
      /\{\{|\}\}/, // literal escaped braces in str.format()/f-strings — atomic either way
      /\{[^{}]*\}/, // `{}`, `{0}`, `{name!r:>10}` — tree-sitter gives f-string interpolations
      // their own `interpolation` node (see the descriptor doc comment
      // above), but this regex form is still the mechanism for plain
      // `str.format()`-style placeholders in an ordinary or docstring
      // string, which never get an `interpolation` node.
      /%\([a-zA-Z_][a-zA-Z0-9_]*\)[-+ #0]*\d*(\.\d+)?[diouxXeEfFgGcrsa%]/, // %(key)d
      /%[-+ #0]*\d*(\.\d+)?[diouxXeEfFgGcrsa%]/, // %s / %d
    ],

    concatenation: {
      style: 'implicit',
      operator: '+',
      requiresGrouping: true,
      operatorPlacement: 'trailing',
    },
  },
};
