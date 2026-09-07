import type { LanguageDescriptor } from '../../types/adapter.js';

/**
 * Java's `LanguageDescriptor`.
 *
 * Node names and shapes below were verified against the vendored grammar
 * (`tree-sitter-java@0.23.5`, `packages/engine/grammars/`) with a
 * throwaway probe script, not trusted from memory -- the same discipline
 * every other language descriptor in this package uses; see
 * `docs/adapters.md`'s Java section for the full write-up of what that
 * probe found. The short version of what shapes this descriptor:
 *
 * - **Two distinct comment node types, not one.** Unlike every C-family
 *   or ECMAScript-family grammar vendored so far (`comment` alone covers
 *   `//`/`/* * /`/`/** * /`), Java's grammar produces `line_comment` for
 *   `//` and a *separate* `block_comment` for both `/* ... * /` and
 *   `/** ... * /` -- so `queries.comments` below needs two patterns, not
 *   one, and `../adapter.ts`'s `classify` branches on `node.type` first,
 *   text second (the reverse of `classifyEcmaScriptNode`'s single-node-type
 *   text-only branching). A multi-pattern query sharing one capture name
 *   (`(line_comment) @comment (block_comment) @comment`) was confirmed
 *   directly to compile and capture both node types correctly -- no
 *   engine change needed for this shape.
 * - **A `block_comment` node's own text is what tells `/**` (Javadoc)
 *   apart from a plain `/*`** -- identical to how `classifyEcmaScriptNode`
 *   and `cppAdapter`'s `classify` already tell their own single comment
 *   node type's forms apart by text prefix, just starting from a
 *   narrower node-type filter here since `line_comment` can never be
 *   Javadoc-shaped in the first place.
 * - **No `///`-per-line doc-comment form.** Java has no counterpart to
 *   Doxygen's/Rust's repeated-marker doc comments -- probed directly: a
 *   `///`-prefixed comment parses as an ordinary `line_comment`, no
 *   special node or marker. (Java 23's JEP 467 "Markdown documentation
 *   comments" introduces exactly this convention, but `tree-sitter-java`
 *   `0.23.5` predates it -- probed directly and confirmed no distinct
 *   node or marker for it either; a `///`-prefixed line is still just an
 *   ordinary `line_comment`.) `comments.doc` below declares no
 *   `repeatedMarker`, unlike C++'s descriptor -- a deliberate scope limit,
 *   not an oversight, worth revisiting if a future grammar release adds
 *   real support.
 * - **`string_literal` covers both an ordinary string *and* a text block
 *   (`"""..."""`, Java 15+) -- the same node type, distinguished only by
 *   whether its own delimiter text is `"""` or `"`.** This is a genuinely
 *   new finding relative to every other adapter here: JS/TS's template
 *   literals and C++'s raw strings are each a *separate* grammar node
 *   type, excluded from `queries.strings` by construction; Java's text
 *   blocks are not -- they're captured by the identical
 *   `(string_literal) @string` pattern an ordinary string is, so
 *   excluding them is `../adapter.ts`'s `classify`'s job (checking the
 *   captured text's own leading delimiter), the same shape Python's own
 *   docstring-vs-ordinary-string distinction uses, just returning `null`
 *   (exclude entirely) rather than a different `RegionKind` -- text
 *   blocks are whitespace-*significant* (common-indentation stripping,
 *   a trailing-newline convention, deliberate embedded blank lines) in a
 *   way this project's existing "strip syntax, concatenate bodies
 *   verbatim" dissolve model has no representation for, the identical
 *   reasoning that already deferred Python's own triple-quoted
 *   *non-docstring* strings in earlier phases. A genuine future feature,
 *   not a bug -- see `docs/adapters.md`'s Java section for the full
 *   reasoning.
 * - **`character_literal` (single-quoted, `'x'`) is a separate node
 *   type**, never matched by `queries.strings` -- Java has no
 *   single-quoted string form the way Python does, so `strings.quotes`
 *   below only ever needs `"`.
 * - **`binary_expression` exposes `left`/`operator`/`right` fields for
 *   `+`-concatenation** -- probed directly for a 4-literal chain
 *   (`"a" + "b" + name + "c"`): left-associative nesting confirmed, the
 *   identical shape `discoverRegions`'s concatenation grouper already
 *   expects from Python's `binary_operator` and every ECMAScript-family
 *   `binary_expression`, so `queries.concatenations` below needed no
 *   engine change. Like JavaScript/TypeScript (and unlike C++), Java has
 *   no implicit bare-adjacency string concatenation -- `+` is the only
 *   real join syntax, and it's valid wherever an expression already is,
 *   with no enclosing-grouping requirement the way Python's implicit
 *   juxtaposition has -- so `strings.concatenation` below declares
 *   `'operator'` with no `requiresGrouping`, the identical shape every
 *   ECMAScript-family descriptor uses.
 * - **CRLF trailing-`\r` quirk confirmed present for `line_comment`,
 *   absent for `block_comment`** -- probed directly against a CRLF
 *   source, mirroring the exact Python-grammar finding
 *   `docs/adapters.md`'s CRLF-handling section already documents: a
 *   `line_comment` node's own span runs through the line's trailing
 *   `\r` (before the `\n`, which is never part of the node); a
 *   `block_comment` node ends at its own close delimiter, never at
 *   end-of-line, so it never has this quirk regardless of line ending. Already handled
 *   generically by `discoverRegions`'s existing `trimTrailingCR`
 *   safeguard -- no adapter-specific fix needed here either.
 * - **String placeholder patterns mirror C++'s shape, adjusted for
 *   `java.util.Formatter`'s own conversion-character set.** `{0}`/`{1}`
 *   (`java.text.MessageFormat`) reuses `cppDescriptor.strings.placeholders`'s
 *   fmtlib/std::format pattern verbatim -- genuinely identical syntax. The
 *   `%s`/`%d`-style pattern is *not* reused verbatim, though: Java's
 *   `String.format` has no C-style length modifiers (`hh`/`ll`/`l`/`z`/...)
 *   but does add its own flags (`,` for grouping, `(` for
 *   parenthesized negatives) and conversion characters (`%b`/`%h`/`%t`
 *   date-time, `%n` for the platform line separator) C's printf doesn't
 *   have -- so this descriptor defines its own pattern for that half
 *   rather than reusing one shaped around a different formatter's
 *   grammar.
 */
export const javaDescriptor: LanguageDescriptor = {
  id: 'java',
  grammarWasm: 'grammars/tree-sitter-java.wasm',

  queries: {
    // Two patterns, one capture name -- see this module's own doc comment
    // above for why Java needs this where every other adapter here has
    // gotten away with one `comment`-node pattern.
    comments: '(line_comment) @comment (block_comment) @comment',
    strings: '(string_literal) @string',

    // Bare `+` only -- see this module's own doc comment above for why
    // Java, like JavaScript/TypeScript, declares no `@concat.implicit`
    // alternative.
    concatenations: '(binary_expression operator: "+") @concat.operator',
  },

  comments: {
    line: { marker: '//', spaceAfter: true },
    block: { open: '/**', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // A plain `/* ... */` comment (no Javadoc marker) shares `block`'s
    // close delimiter and continuation style but not its open one -- see
    // `./adapter.ts`'s `classify` for how a `block_comment` node's text
    // is told apart from the Javadoc-marked `/**` form.
    plainBlock: { open: '/*', close: '*/', continuationPrefix: '*', alignContinuation: 'open' },

    // No `repeatedMarker` -- Java has no `///`-per-line doc-comment
    // convention in this grammar version, see this module's own doc
    // comment above.
    doc: { markers: ['/**'], dialects: ['javadoc', 'plain'] },

    // Tooling directives that must never move to a different line --
    // Java's counterpart to Python's `# noqa`/`# type:` and JS/TS's
    // `// eslint-disable`/`// @ts-expect-error`.
    neverReflow: [
      /^\/\/\s*NOPMD\b/,
      /^\/\/\s*NOSONAR\b/,
      /^\/\/\s*CHECKSTYLE:(OFF|ON)\b/,
      /^\/\/\s*noinspection\b/i,
    ],

    // Keywords/modifiers/annotations strong enough on their own to call a
    // dissolved `//` comment line code-like (the commented-out-code
    // detection) without needing the punctuation-density signal too --
    // Java's counterpart to Python's `def `/`class `/`import `/... list.
    // Anchored to the start of an already-trimmed line.
    codeLikeKeywords:
      /^(import\b|package\b|public\b|private\b|protected\b|static\b|final\b|class\s|interface\s|enum\s|@\w+|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|return\b|throw\b|try\s*\{|catch\s*\()/,
  },

  strings: {
    // Only `"` -- text blocks (`"""`) are excluded from discovery entirely
    // by `./adapter.ts`'s `classify` (see this module's own doc comment
    // above), so no separate `QuoteSpec` is needed for them here.
    quotes: [{ delimiter: '"', multiline: false, escapes: true }],

    // No string-literal prefix concept in Java (unlike Python's
    // `r`/`b`/`f`) -- every ordinary string is plain.
    prefixes: [],
    rawForms: [],

    escapes: {
      sequences: [
        /^\\\\/,
        /^\\'/,
        /^\\"/,
        /^\\b/,
        /^\\f/,
        /^\\n/,
        /^\\r/,
        /^\\s/, // text-block-only escape (suppresses trailing-space stripping); harmless to recognize in an ordinary string too
        /^\\t/,
        /^\\[0-7]{1,3}/, // octal, up to \377
        /^\\u[0-9a-fA-F]{4}/, // Unicode escape -- exactly 4 hex digits, no \U long form (unlike C++)
      ],
    },

    placeholders: [
      /\{[^{}]*\}/, // java.text.MessageFormat-style `{0}`, `{1}`
      /%[-+ #0,(]*\d*(\.\d+)?[bBhHsScCdoxXeEfgGaAtTn%]/, // String.format-style %s / %d / %-10.2f / %n
    ],

    concatenation: { style: 'operator', operator: '+', operatorPlacement: 'trailing' },
  },
};
