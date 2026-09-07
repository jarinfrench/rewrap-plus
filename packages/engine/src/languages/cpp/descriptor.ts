import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * C++'s `LanguageDescriptor`.
 *
 * Node names and shapes below were verified against the vendored grammar
 * (`tree-sitter-cpp@0.23.4`, `packages/engine/grammars/`) with a throwaway
 * probe script (`docs/spikes/tree-sitter-cpp-probe.mjs`), not trusted from
 * memory -- the same discipline every other language descriptor in this
 * package uses; see `docs/adapters.md`'s C++ section for the full write-up
 * of what that probe found. The short version of what shapes this
 * descriptor:
 *
 * - One `comment` node type covers `//`, plain `/* * /`, `/** * /`, and
 *   `///` alike -- the same finding every earlier ECMAScript-family
 *   descriptor already made, now confirmed for C++ too. `../adapter.ts`'s
 *   `classify` tells them apart by text, same as `classifyEcmaScriptNode`
 *   does.
 * - `concatenated_string` wraps adjacent `string_literal` siblings for
 *   bare-adjacency concatenation (`"foo" "bar"`) -- the *identical* node
 *   name and shape Python's own grammar uses for the same construct, so
 *   `queries.concatenations`'s `@concat.implicit` capture needs no new
 *   engine support at all.
 * - **No `@concat.operator` capture.** Unlike Python/JavaScript/TypeScript,
 *   `+` between two string literals is not valid C++ concatenation syntax
 *   at all -- `const char*` has no `operator+`, so `"a" + "b"` is a compile
 *   error (adding two pointers), never a real second way to join literals.
 *   The only real-world way `+` ever appears next to a string literal is
 *   with a `std::string` operand on at least one side (confirmed directly:
 *   probing `std::string("a") + "b" + "c"` shows the `+` chain's `left`
 *   ultimately bottoming out at a `call_expression`, never a second
 *   `string_literal` leaf) -- exactly the shape `discoverRegions`'s own
 *   concatenation grouper already bails on ("a" + name must never be
 *   treated as one wrappable unit"), so simply not declaring the operator
 *   pattern at all is the correct, semantically honest choice, not a
 *   missing feature to add later.
 * - **Raw strings are excluded from discovery by construction, not by a
 *   runtime safety check.** `R"(...)"`/`R"delim(...)delim"` parse as a
 *   wholly separate node type, `raw_string_literal` -- never matched by
 *   `queries.strings`'s `(string_literal) @string` -- so "raw strings...
 *   (never wrap)" falls out of the query itself, the same mechanism that
 *   already excludes JS/TS template literals (`docs/adapters.md`'s
 *   JavaScript/TypeScript/TSX -- full adapters section: "not a special-case
 *   refusal anywhere"). `strings.rawForms` below still records the
 *   delimiter pair
 *   as descriptive data (the exact motivating example
 *   `RawFormSpec`'s own doc comment on `../../types/adapter.ts` already
 *   names), even though nothing in the engine reads it at runtime yet.
 * - **A `string_literal` node's own source text carries its prefix baked
 *   into the same token as the opening quote** (`L"`, `u8"`, `u"`, `U"`,
 *   or a bare `"`) -- exactly the shape `../../strings/dissolve-string.ts`'s
 *   `PREFIX_AND_QUOTE` regex (`^([A-Za-z]{0,3})('|")`) already expects,
 *   since every C++ prefix is 0-2 letters. No engine change needed here
 *   either; only `../adapter.ts`'s own `isSafeToWrap` needs a C++-specific
 *   mixed-prefix check (`./prefix.ts`), the same shape Python's own
 *   raw/byte-prefix check is.
 * - **`char_literal` (single-quoted, `'x'`) is a separate node type**,
 *   never matched by `queries.strings` -- C++ has no single-quoted string
 *   form the way Python does, so `strings.quotes` below only ever needs
 *   `"`.
 * - **A `#define` macro body is never parsed as C++ syntax at all** -- its
 *   argument is one opaque `preproc_arg` leaf carrying the raw, unparsed
 *   text, confirmed directly by probing a multi-line macro with a
 *   backslash-newline continuation. This means the known hazard of
 *   preprocessor line continuations -- needing to skip strings inside
 *   macro definitions in the first pass -- is already satisfied by the
 *   grammar's
 *   own structure: neither `comment` nor `string_literal` nodes are ever
 *   produced inside a macro body for `queries.comments`/`queries.strings`
 *   to capture in the first place, so there is nothing here to skip --
 *   the same "not a special-case refusal anywhere" shape as the raw-string
 *   and template-literal exclusions above.
 */
export const cppDescriptor: LanguageDescriptor = {
  id: 'cpp',
  grammarWasm: 'grammars/tree-sitter-cpp.wasm',

  queries: {
    comments: '(comment) @comment',
    strings: '(string_literal) @string',

    // Bare-adjacency concatenation only -- see this module's own doc
    // comment above for why C++ declares no `@concat.operator` pattern,
    // unlike every other adapter in this package.
    concatenations: '(concatenated_string) @concat.implicit',
  },

  comments: {
    line: { marker: '//', spaceAfter: true },
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // A plain `/* ... */` comment (no Doxygen marker) shares `block`'s
    // close delimiter and continuation style but not its open one -- see
    // `./adapter.ts`'s `classify` for how a comment node's text is told
    // apart from the Doxygen `/**` and `///` forms.
    plainBlock: { open: '/*', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // `markers` lists every delimiter `classify` recognizes as Doxygen-
    // shaped; `repeatedMarker` names which one of those is a
    // repeated-per-line marker (`///`) rather than an open/close pair --
    // `wrapDocComment` (`../../comments/wrap-doc-comment.ts`) branches on
    // this to dissolve/emit `///` through the same per-line machinery a
    // `'lineComment'` region uses, instead of `block`'s open/close one.
    doc: { markers: ['/**', '///'], dialects: ['doxygen', 'plain'], repeatedMarker: '///' },

    // Tooling directives that must never move to a different line --
    // C++'s counterpart to Python's `# noqa`/`# type:` and JS/TS's
    // `// eslint-disable`/`// @ts-expect-error`.
    neverReflow: [
      /^\/\/\s*NOLINT/, // clang-tidy suppression, e.g. `// NOLINT(readability-...)`
      /^\/\/\s*clang-format\s*(on|off)\b/,
      /^\/\/\s*cppcheck-suppress\b/,
    ],

    // Keywords/directives strong enough on their own to call a dissolved
    // `//` comment line code-like (the commented-out-code detection)
    // without needing the punctuation-density signal too --
    // C++'s counterpart to Python's `def `/`class `/`import `/... list.
    // Anchored to the start of an already-trimmed line.
    codeLikeKeywords:
      /^(#include\b|#define\b|#if\b|#ifdef\b|#ifndef\b|#else\b|#endif\b|#pragma\b|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|return\b|class\s|struct\s|namespace\s|template\s*<)/,
  },

  strings: {
    quotes: [{ delimiter: '"', multiline: false, escapes: true }],

    // Descriptive only -- see this module's own doc comment above on why
    // raw strings never reach discovery in the first place regardless of
    // what's declared here.
    prefixes: [{ prefix: '' }, { prefix: 'L' }, { prefix: 'u' }, { prefix: 'U' }, { prefix: 'u8' }],

    // `RawFormSpec`'s own canonical example (`../../types/adapter.ts`) --
    // recorded as data even though nothing reads it at runtime yet; see
    // this module's own doc comment for why `raw_string_literal` being a
    // wholly separate grammar node already keeps these out of discovery.
    rawForms: [
      { open: 'R"(', close: ')"' },
      { open: 'LR"(', close: ')"' },
      { open: 'u8R"(', close: ')"' },
      { open: 'uR"(', close: ')"' },
      { open: 'UR"(', close: ')"' },
    ],

    escapes: {
      sequences: [
        /^\\\r?\n/, // line continuation
        /^\\\\/,
        /^\\'/,
        /^\\"/,
        /^\\\?/, // escaped question mark (historically, trigraph avoidance)
        /^\\a/,
        /^\\b/,
        /^\\f/,
        /^\\n/,
        /^\\r/,
        /^\\t/,
        /^\\v/,
        /^\\[0-7]{1,3}/, // octal
        /^\\x[0-9a-fA-F]+/, // hex -- C++ consumes as many hex digits as follow, unlike Python's fixed-width \x
        /^\\u[0-9a-fA-F]{4}/, // universal character name, short form
        /^\\U[0-9a-fA-F]{8}/, // universal character name, long form
      ],
    },

    placeholders: [
      /\{[^{}]*\}/, // fmtlib/std::format-style `{}`, `{0}`, `{:.2f}` placeholders
      /%[-+ #0]*\d*(\.\d+)?(hh|h|ll|l|j|z|t|L)?[diouxXeEfFgGaAcspn%]/, // printf-style %s / %d / %-10.2f
    ],

    // Same reasoning as `queries.concatenations`'s own doc comment above:
    // bare adjacency is the only real C++ concatenation syntax, and it
    // never needs its own inserted grouping (`"foo" "bar"` is valid
    // wherever a single string literal is, with no enclosing-parens
    // requirement the way Python's implicit juxtaposition has).
    concatenation: { style: 'implicit' },
  },
};
