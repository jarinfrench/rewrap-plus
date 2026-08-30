# Adapters: cross-language engine findings

This document exists to answer one question — "can a new language be
added without touching the engine?" — asked as early as possible, before
Python-specific assumptions have more code built around them to harden
into. It records what that process actually found: engine changes that
*were* needed, recorded as known-leaked assumptions, alongside deliberate
scope limits worth distinguishing from oversights.

The short answer for the JavaScript canary adapter below: yes, with
three leaks found and fixed *before* the canary needed to exist, plus a
handful of CRLF-handling bugs that predate this work but were caught by
the same investigation. Once the canary and conformance kit actually
existed, they passed cleanly against both adapters on the first real
run — no further engine changes were needed at that point. That's the
intended shape of this kind of work: leaks get caught by *building
toward* a second adapter, not by that adapter itself needing a second
round of fixes.

## Leaked assumptions found and fixed before the canary existed

### 1. Commented-out-code detection hardcoded Python's keyword list

`dissolveLineComments`'s commented-out-code heuristic directly
imported a Python-only leading-keyword regex (`def `, `class `,
`import `, ...) from `languages/python/code-like-comment.ts`. Despite
`dissolveLineComments`'s own signature being fully descriptor-driven,
this one call made the whole function secretly Python-only — a second
adapter needing the same heuristic would have had to fork the function
wholesale just to swap the keyword list.

**Fix:** split the pattern out to a new optional
`LanguageDescriptor.comments.codeLikeKeywords` field (data, not code —
same shape as the existing `neverReflow` field, matching the project's
"adapter is data first" rule). The generic punctuation-density heuristic
moved to `packages/engine/src/comments/looks-like-code.ts`, taking the
keyword pattern as an optional parameter. A language that doesn't supply
one still gets the density signal alone — weaker, never absent.

### 2. `wrapRegions` hardcoded to Python

`wrapRegions` originally lived under `languages/python/wrap.ts`,
validated `languageId` against `pythonDescriptor.id` directly, and
imported `pythonAdapter` by name — its own doc comment named this as
exactly the question a second adapter would need answered.

**Fix:** `ParserManager` gained `adapterFor(languageId)`, resolving a
`LanguageAdapter` through the identical registry lookup `parserFor`
already used for a `Parser`. `wrapRegions` moved to engine-level
`wrap.ts`, resolving the adapter via `parserManager.adapterFor(...)`
instead of an adapter-name import. No second registry parameter needed.

### 3. Line-comment dissolve/emit lived under `languages/python/` despite being generic

Once leak #1 was fixed, `dissolveLineComments`/`emitLineComments` had no
remaining Python dependency in their *implementation* — only in their
*file location*, which would have made a second adapter's dissolve/emit
functions look like a fork rather than a shared import.

**Fix:** promoted both, plus `looksLikeCommentedOutCode`, to a new
`packages/engine/src/comments/` directory. This is also where this same
investigation's own block-comment functions (`dissolveBlockComments`/
`emitBlockComments`) landed, for the same reason: Python has no block
comments to exercise them, so nothing about that path should be allowed
to assume Python either.

## CRLF handling

Not adapter-interface leaks in the same sense as the three above — these
are bugs in engine code that happened to only manifest on CRLF source,
caught while establishing a clean test baseline ahead of the JavaScript
canary's own work (a CRLF-preserving conformance invariant would have failed
immediately otherwise). Recorded here because the conformance kit's own
"line endings ... preserved" check is what makes them visible for any
future adapter, not just the ones that happened to trip over them first.

- **Region span/`rawText` leaking a grammar artifact.** A Python
  `comment` node's own span, probed directly against the vendored
  grammar, includes a trailing `\r` on a CRLF-terminated line — the node
  runs to end-of-line, which sits before the `\n` (not part of the node)
  but after the `\r` (which is). A multi-line container node (e.g.
  `concatenated_string`) reproduces real `\r\n` pairs verbatim across its
  interior. Fixed with `normalizeRawText` (display-layer) and
  `trimTrailingCR` (structural span fix, since spans are used for real
  edits) in `discovery/discover-regions.ts`. Confirmed, by probing the
  JavaScript grammar the same way, that this specific quirk is
  Python-grammar-specific: a JavaScript `//` comment's span does *not*
  include a trailing `\r` on a CRLF line at all — `trimTrailingCR` is a
  safe no-op there, not a fix the JavaScript canary separately needed.

- **Emit hardcoding `\n`.** `emitLineComments` always joined its own
  output lines with a bare `\n`, correct for its internal reflow math but
  wrong once that text became an edit against a CRLF source — the
  wrapped region's internal newlines ended up `\n` while the rest of the
  file stayed `\r\n`. Fixed with `detectLineEnding`/`applyLineEnding`
  (`detect-line-ending.ts`), applied once in `wrapRegions` before a
  `newText` is compared or turned into an edit — deliberately not baked
  into emit itself, since every future emit function (block comments
  included) needs the identical treatment and shouldn't have to
  re-implement it.

## JavaScript canary — grammar findings

Verified by probing `tree-sitter-javascript@0.25.0` directly (the
vendored WASM, `packages/engine/grammars/tree-sitter-javascript.wasm`),
not trusted from memory — the same discipline used for Python's own
grammar (see `docs/parsing.md`).

- **One `comment` node type covers `//`, plain `/*...*/`, and
  `/**...*/` alike.** Unlike Python, where the `comment` query only ever
  captures line comments, JavaScript's grammar gives no node-type signal
  to distinguish the three forms — only the captured node's own text
  does. `javascriptAdapter.classify` handles this by checking the text
  prefix directly.
- **No CRLF trailing-`\r` quirk.** Covered above — JavaScript's `//`
  comment tokenizer already excludes a line's trailing `\r`, so
  `discoverRegions`'s Python-motivated `trimTrailingCR` safeguard simply
  never fires for this adapter.
- **`string` nodes match Python's shape exactly** — double- or
  single-quoted, no prefix complexity. Template literals (backtick-
  delimited) are a *separate* node type, `template_string`, not matched
  by `(string) @string` — consistent with this canary declaring no
  template-literal support.
- **A `string`-classified node still needs explicit handling in
  `classify`.** The first draft of `javascriptAdapter.classify` only
  handled `comment` nodes and returned `null` for everything else,
  which silently excluded every string node from discovery (`null`
  means "exclude entirely," not "use the driver's fallback" — see
  `LanguageAdapter.classify`'s own doc comment). Caught before it
  shipped, by the adapter's own test suite (`languages/javascript/adapter.test.ts`)
  rather than by the conformance kit — a reminder that per-adapter tests
  and the shared conformance suite catch different classes of bug, and
  neither substitutes for the other.

## Deliberate scope limits (not leaks — documented so a future reader
## doesn't mistake a choice for an oversight)

- **A plain single-star block comment is excluded from discovery, not
  mis-dissolved.** `javascriptAdapter.classify` only ever assigns
  `'blockComment'` to a comment whose text starts with the descriptor's
  exact configured `comments.block.open` (`'/**'`). A plain `/* ... */`
  comment doesn't match and is excluded entirely (`classify` returns
  `null`) rather than dissolved through a delimiter pair it doesn't
  actually use, which would either silently mis-parse it or throw
  partway through. "Bias toward verbatim/skip when uncertain," applied
  here to a case not otherwise anticipated. A real (non-canary)
  JavaScript adapter should decide this deliberately rather than inherit
  the canary's shortcut by default.
- **No `groupRegions` override for JavaScript.** Python merges adjacent
  same-indent `//`-equivalent lines into one logical block;
  JavaScript's canary doesn't attempt the equivalent for `//` comments.
  Left as a genuine open question for a future full adapter, not
  answered here — the canary's job was proving the *interface* holds, not shipping every
  behavior a real adapter would want.
- **`strings` is structurally populated but functionally inert.**
  `LanguageDescriptor`/`validateDescriptor` require at least one quote
  form and a non-empty `queries.strings` regardless of whether an
  adapter does anything with what it discovers. The JavaScript canary's
  `strings` block is real, valid data — but `wrapRegions` never
  dissolves or emits a `'stringLiteral'` region for *any* adapter yet
  (Python's own string/docstring regions are equally reported as
  skipped), so this isn't new engine behavior specific to the canary.

## What this means for future adapters

Both adapters pass the identical `runAdapterConformance` suite
(`packages/engine/src/conformance/run-adapter-conformance.ts`) — 14
checks each, covering structural validation, query compilation,
idempotency, re-parse cleanliness, line-length, and line-ending
preservation, each run against both a CRLF and an LF source fixture.
Adding a language from here means writing a descriptor, a thin adapter
if any hooks are needed, source fixtures, and calling
`runAdapterConformance` — not designing a test strategy from scratch,
and not discovering partway through string-literal support that
dissolve/emit secretly assumed Python.

---

# JavaScript/TypeScript/TSX — full adapters

The JavaScript canary above existed to answer "can a new language be
added without touching the engine?" at the cheapest possible moment —
with a deliberately thin, comments-only descriptor. This section is
where that question gets asked for real: a full adapter with strings,
concatenation, and a documentation dialect, for three language ids
(`javascript` — extending the canary in place, plus its `javascriptreact`
alias — `typescript`, and `typescriptreact`). The short answer, as with
the canary: yes, with four real leaked assumptions found and fixed, all
in shared/generic code nothing before this work had a second real reason
to exercise — the same shape of finding the canary's own list above
already established a pattern for.

## Grammar findings

Re-ran the "prebuilt or build-it-yourself?" check from `docs/parsing.md`
for `tree-sitter-typescript`: it ships *two* prebuilt grammars,
`tree-sitter-typescript.wasm` (plain TS) and `tree-sitter-tsx.wasm`
(TS+JSX), both vendored with full provenance
(`packages/engine/grammars/PROVENANCE.md`). Probed directly (`docs/spikes/
tree-sitter-typescript-probe.mjs`) alongside the already-vendored
`tree-sitter-javascript.wasm`, confirming all three grammars share
identical shapes for everything this adapter work depends on:

- One `comment` node type for `//`, plain `/* */`, and `/** */` alike —
  the same finding already made for JavaScript above, now confirmed for
  TypeScript/TSX too.
- A `string` node's children are its own quote tokens plus a
  `string_fragment` body — no prefix complexity the way Python's
  `string_start` carries one. This is what makes Python's own
  `dissolveString`/`emitString` (see below) reusable verbatim.
- `binary_expression` exposes `left`/`operator`/`right` fields for
  `+`-concatenation — the identical field-name convention
  `discoverRegions`'s concatenation grouper already expected from
  Python's `binary_operator`, so `queries.concatenations` needed no
  engine change at all to work for any of the three languages.
- Template literals (`` `...` ``) are a separate `template_string` node
  type, never matched by a plain `(string) @string` query — the
  mechanism by which template-literal wrapping is deferred (the same way
  Python's own triple-quoted non-docstring strings are deferred) is
  simply *not adding that node type to the query*, not a special-case
  refusal anywhere.
- TSX parses identically to plain TypeScript for every construct this
  work cares about (comments, strings, `+`-concatenation), whether
  they sit in an ordinary statement or inside a JSX attribute/expression
  container — confirmed by probing a JSX element containing a string
  concatenation directly.

## Four leaked assumptions found and fixed

Unlike the canary work above (which found its three leaks *before* the
canary needed to exist), these were found while generating this adapter
work's own gold fixtures and conformance sources — real second/third/fourth uses of code
that read as generic but had only ever been exercised by Python-shaped
(or single-adapter-shaped) input before.

### 1. `directives.ts` hardcoded Python's `#` marker

`scanDirectives`'s `DIRECTIVE_PATTERN` spliced a literal `#` into its
regex, despite the module's own doc comment already claiming to be
"engine-level and region-kind-agnostic." `// rewrap: off` would never
have been recognized for any non-Python adapter. Fixed by taking the
governing `commentMarker` as a parameter (default `'#'`, so every
existing Python call site is unaffected); `wrap.ts` now passes
`descriptor.comments.line?.marker`.

### 2. `strings/dissolve-string.ts`/`emit-string.ts`/`escape-quote-collisions.ts` were Python-only by file location, not by behavior

None of the three had any Python-specific logic left in their
*implementation* (only in their location under `languages/python/`) —
`dissolveString`'s own prefix/quote regex already matches a zero-length
prefix before a single quote, exactly JavaScript/TypeScript's shape;
`emitString` already supports `'operator'`-style concatenation
alongside `'implicit'`. Promoted to a new shared `strings/` directory
(mirroring `comments/`, itself promoted the same way for the JavaScript
canary) — the
identical "promote once a second real consumer needs it" call, applied
a third time now that JS/TS genuinely needs the same code.

### 3. `emitString` silently dropped a string's own trailing space

Found while generating this adapter work's own JavaScript gold fixtures,
not anticipated ahead of time: `atomizeWords` drops any whitespace
trailing the final atom (there's no atom after it for that whitespace to
be "between"), and `reinsertSplitSpaces` only ever restored a space
consumed at an *interior* line-break split point — its own `i ===
lines.length - 1` branch returned the last line completely unexamined.
A string ending in a real trailing space before its closing quote
(`"Hello, " + name` — entirely ordinary) silently re-emitted as
`"Hello," + name`: a genuine value change, not a formatting one, exactly
exactly the kind of silent string corruption string-literal wrapping
most needs to guard against — just at the *end* of the text rather than
at a split point, which is why the existing interior-only check never
caught it. This is shared code Python's own string-literal wrapping
already shipped; none of Python's existing gold
fixtures happen to end a string in a trailing space, so it went
uncaught until JS's own fixtures exercised it. Fixed in
`strings/emit-string.ts`'s `reinsertSplitSpaces`, with regression tests
for both the single-line and multi-line-final-line cases; confirmed no
existing Python fixture was affected.

### 4. `AdapterRegistry.supportedLanguages()` silently dropped aliases

Returned only primary descriptor ids, excluding every alias — despite
`packages/vscode-extension/src/engine-host.ts`'s own `getSupportedLanguages`
doc comment already promising "every VSCode languageId (and alias) a
registered adapter supports," a promise real call sites
(`apply-wrap.ts`'s `computeWrapResult`, `format-on-save.ts`) depend on:
either would have silently no-opped every wrap command on a `.jsx` file
— not an error, just nothing happening. Unexercised until now because
no adapter before it had registered an alias meant to be user-facing
(Python has none; the JavaScript canary declared none either). Fixed by
returning every registered key instead of a
separately-tracked primary-only set.

## Deliberate scope limits (not leaks)

- **A plain single-star `/* ... */` block comment was excluded from
  discovery** for the real JavaScript/TypeScript/TSX adapters just as it
  was for the canary above, until a later pass
  (`docs/adapters.md`'s "Plain block comments and Doxygen `///` support"
  section, below the CLI section) gave `LanguageDescriptor.comments` a
  second, distinct `plainBlock` delimiter alongside `block` specifically
  so this could be supported without conflating it with the JSDoc-marked
  form. Left here as the historical record of why it was excluded in the
  first place.
- **Template literals are not wrapped** — deferred the same way Python's
  own triple-quoted non-docstring strings are, mechanically enforced by
  `queries.strings` simply never capturing `template_string` nodes (see
  the grammar findings above).
- **No `groupRegions` override for JavaScript/TypeScript** — `//`
  comments still aren't merged across adjacent lines the way Python's
  are, the same open question the canary already deferred and this work
  doesn't need to resolve either.
- **TSX gets a full duplicate gold-fixture set only at the unit-test
  level (adapter/descriptor tests), not the end-to-end wrap-fixture
  level** — every string/JSDoc finding transfers identically from plain
  TypeScript (confirmed directly), so a second full copy of
  `test/wrap/typescript-*-fixtures.test.ts` for TSX would exercise
  nothing new; its own conformance suite (wrapping a comment and a doc
  comment inside a JSX component body) plus adapter unit tests (a JSX
  attribute string, a JSX-expression-container concatenation) cover what
  is TSX-specific.

## What this means for future adapters

Four adapters now pass the identical `runAdapterConformance` suite:
Python, JavaScript, TypeScript, TSX. The four fixes above were each
found by a *second, third, or fourth* real consumer of code that looked
generic — the same lesson the JavaScript canary's own three leaks
taught, just arriving one adapter-family later because nothing before
this work happened to register a real alias, share `strings/`'s
promoted code, or feed a trailing-space string through the pipeline. The
C++ adapter below adds a language with genuinely new shapes this work
never exercised — raw strings, wide/UTF prefixes, preprocessor line
continuations — and should expect its own round of this same kind of
finding, not assume the adapter seam is now fully proven just because
four languages pass.

---

# C++ — full adapter

Unlike JavaScript's canary-then-real path (the canary above, then
extended into a full adapter) or TypeScript/TSX (born full alongside
it), C++ had no thin precursor — `cppAdapter` is a real adapter, with
strings and a Doxygen documentation dialect, from its first commit. The
short answer, as with every earlier adapter's version of this same
question: the adapter interface held with
**zero engine changes**, though only because two of C++'s genuinely new
shapes turned out to be handled *for free* by the grammar's own
structure rather than by new adapter code — see below. Full grammar
findings are in `docs/parsing.md`'s Finding 6; this section covers what
they meant for the descriptor/adapter design.

## Two anticipated hazards that needed no code at all

- **Raw strings.** `R"(...)"` parses as a wholly separate
  `raw_string_literal` node, never matched by `queries.strings`'s
  `(string_literal) @string` — so raw strings are excluded from
  discovery by construction, the identical mechanism that already kept
  JS/TS template literals out (this document's JavaScript/TypeScript/TSX
  section above: "not a special-case refusal anywhere"). No
  `isSafeToWrap` check was needed for this one at all.
- **Preprocessor line continuations inside macro bodies.** A `#define`
  macro body is never parsed as C++ syntax — its argument is one opaque `preproc_arg` leaf
  carrying raw, unparsed text (confirmed by probing a multi-line macro
  with a backslash-newline continuation). Neither `comment` nor
  `string_literal` nodes are ever produced inside one, so this hazard
  was already resolved before any adapter code was written.

## An unanticipated hazard: no valid `+` concatenation exists

Every other adapter in this package (`python`, `javascript`, `typescript`,
`typescriptreact`) declares an `@concat.operator` pattern alongside
`@concat.implicit`. C++ declares **only** `@concat.implicit` — `"a" + "b"`
between two string literals is not valid C++ (`const char*` has no
`operator+`; adding two pointers is a compile error). The only real way
`+` ever appears near a string literal is with a `std::string` operand on
one side, and probing `std::string("a") + "b" + "c"` confirmed the chain's
`left` operand bottoms out at a `call_expression`, never a second
`string_literal` leaf — exactly the shape `discoverRegions`'s own
concatenation grouper already bails on for every language's `"a" + name`
case. Simply not declaring the operator pattern is the correct,
semantically honest choice, not a missing feature — see
`languages/cpp/descriptor.ts`'s own doc comment for the full reasoning.
This is also why `strings.concatenation` needs no `operator`/
`operatorPlacement`/`requiresGrouping` fields at all: bare adjacency is
valid wherever a single string literal already is, the same "no grouping
ever needed" shape ECMAScript's `'operator'` style has, just via
`'implicit'` instead.

## A genuinely new adapter-level check: mixed encoding-prefix concatenation

C++ string literals carry an encoding prefix (`L`, `u`, `U`, `u8`) baked
into the same token as the opening quote. Real, standards-legal C++
allows an unprefixed literal to merge with a prefixed one in a
concatenation run (`"abc" L"def"` takes on `L`'s encoding) — but
`strings/dissolve-string.ts`'s shared `dissolveString` always reuses the
*first* part's own prefix as the sole representative for the whole
merged run (see that module's own "Representative prefix/quote choice"
doc comment). Merging `"abc" L"def"` under that design would silently
drop the `L` the moment the unprefixed first part was chosen to
represent the whole run — a real value change (a narrow vs. wide
string), not a cosmetic one. `languages/cpp/adapter.ts`'s `isSafeToWrap`
refuses *any* prefix mismatch across a run's parts, including empty vs.
non-empty, mirroring Python's own strictness for its own prefix letters
(`../python/adapter.ts`) rather than teaching shared emit code a new
representative-prefix-selection rule no other adapter needs.

## Deliberate scope limits (not leaks)

- **`///` (Doxygen's repeated-line-marker doc-comment style) was excluded
  from discovery entirely at first**, the same "bias toward verbatim/skip
  when uncertain" call already made for plain `/* */` in the JavaScript/
  TypeScript sections above, for the reason named there: `///` is a
  genuinely different delimiter *shape* than `/** ... */`, one no single
  open/close pair could express. A later pass ("Plain block comments and
  Doxygen `///` support," below the CLI section) built the repeated-marker
  dissolve/emit path this needed and a `groupRegions` adjacency merge for
  consecutive `///` lines, reusing the identical merge algorithm Python's
  own `'lineComment'` grouping already established — `///` is fully
  supported as of that section, this bullet left as the historical record
  of why it wasn't at first.
- **A plain single-star `/* ... */` block comment was excluded from
  discovery** for the identical reason it was for JavaScript/TypeScript,
  until that same later pass gave `comments.block` a second, distinct
  `plainBlock` delimiter — see the note on the JavaScript/TypeScript
  section's own version of this bullet, above.
- **No `c` alias.** `LanguageDescriptor.aliases`' own doc comment names
  `'cpp'` vs `'c'` as a hypothetical example, but C is a genuinely
  different grammar (`tree-sitter-c`), not a superset/subset relationship
  the way `javascriptreact` truly is an alias of `javascript` — a future
  `c` adapter is separate work, not a same-descriptor alias, the same
  distinction TSX already established against plain TypeScript.
- **`strings.rawForms` is populated but functionally inert**, the same
  shape this document's JavaScript-canary section above already noted
  for `strings` in general: real, valid descriptor data (`RawFormSpec`'s own
  canonical example, `../../types/adapter.ts`), but nothing in the
  engine reads it at runtime — raw strings are already excluded from
  discovery by the query itself (see above), so this field currently
  documents a scope decision rather than driving one.

## What this means for future adapters

Five adapters now pass the identical `runAdapterConformance` suite:
Python, JavaScript, TypeScript, TSX, C++. Unlike every adapter before it,
C++ required no fix to shared engine code at all — both of its
anticipated hazards (raw strings, macro line continuations) turned out to
be free consequences of how `tree-sitter-cpp` itself parses, and its one
genuinely new correctness question (mixed-prefix concatenation) was
resolved entirely inside `languages/cpp/`'s own `isSafeToWrap`, the same
adapter-local pattern Python's raw/byte-prefix check already
established. That's a useful data point, not a promise: a future
C-family adapter (plain C, Objective-C, Java) should still expect its
own round of grammar-specific findings, the same caution already given
above.

---

# CLI and pre-commit

Every adapter above asked "does the adapter interface hold?" This
section asks this project's other standing architectural question:
"does the *engine/glue* separation hold?" — `packages/cli`
(`@rewrap-plus/cli`, bin name `rewrap-plus`) is a second, independent
consumer of `packages/engine`, built without touching the engine at all.
The short answer: yes — zero engine changes, and the one class of
friction the extension needed real engineering to solve turned out to be
a VSCode-hosting artifact, not an engine one, which the CLI simply never
encounters.

## The ESM/CJS friction the extension paid for and the CLI doesn't

`packages/vscode-extension/src/engine-host.ts`'s own doc comment spends
several paragraphs on why consuming the ESM-only `@rewrap-plus/engine`
from that package needs a dynamic `import()`, a `with { 'resolution-mode':
'import' }` type-import attribute, and (for `web-tree-sitter` specifically)
an esbuild `alias` redirecting to a hand-written runtime loader
(`web-tree-sitter-runtime.ts`) — all downstream of one constraint: VSCode's
extension host loads a `"main"` entry via `require()`, which forces that
package to compile to CommonJS, which then can't `import` an ESM-only
dependency the ordinary way.

`packages/cli` has no such host. `package.json` declares `"type":
"module"`; `packages/cli/src/engine-host.ts` imports `@rewrap-plus/engine`
with a plain top-of-file `import { AdapterRegistry, ParserManager, ... }
from '@rewrap-plus/engine'`, exactly like any other ESM package depending
on another. No dynamic import, no resolution-mode attribute, no
`web-tree-sitter` aliasing — `web-tree-sitter` itself resolves normally
through the monorepo's hoisted `node_modules`, the same way any of its
other dependents would. Confirms directly what the extension's own doc
comment could only argue by inference: the friction really was VSCode's
`require()`-based hosting model, not `@rewrap-plus/engine` being ESM-only.

## `wasmDir` resolution: the CLI gets to keep the simple answer

`engine-host.ts` (extension) explicitly *moved away* from
`require.resolve('@rewrap-plus/engine/package.json')` for locating grammar
WASM, because a packaged `.vsix` bundles the engine's compiled output
directly into `dist/extension.js` — no `node_modules/@rewrap-plus/engine`
exists at runtime for that lookup to find (`context.extensionUri.fsPath`
replaced it instead, per that file's own doc comment). `packages/cli` has
no bundling step at all — `package.json`'s `build` script is a plain
`tsc -b`, the same shape as the engine's own build — so
`@rewrap-plus/engine` stays a real, resolvable package at runtime in every
scenario this covers, and `require.resolve` (via
`node:module`'s `createRequire`, since this file is ESM) is simply the
correct, permanent answer here, not an interim one a future packaging step
will need to undo.

## Config sources: two independent glue-layer peers, not a shared dependency

This CLI supports three config sources: `.rewraprc`, `pyproject.toml`'s
`[tool.rewrap-plus]`, and flags. `.editorconfig` `max_line_length` joins them
as a fourth (the CLI's own column-limit chain, `src/config/column-limit.ts`,
is `flag > .rewraprc > pyproject.toml > .editorconfig > default` — shorter
than the extension's five-tier chain since there's no live-editor
`editor.rulers` concept to fold in).

`packages/cli/src/config/editorconfig.ts` is a deliberate byte-for-byte
duplicate of `packages/vscode-extension/src/config/editorconfig.ts` — same
walk-up algorithm, same glob subset, same tests (adapted only for this
package being ESM, so its test can use `import.meta.url` directly instead
of the extension test's `__dirname` CommonJS workaround). This is a
conscious departure from the "promote to shared code once a second real
consumer needs it" pattern this document's own JavaScript-canary and
JavaScript/TypeScript/TSX sections establish repeatedly — and deliberately not treated as an instance of it.
That pattern is about code living inside one language adapter's directory
that turns out to be generic *engine* logic, promoted so every adapter
shares one implementation. `packages/vscode-extension` and `packages/cli`
are not two adapters feeding one engine; they're two independent,
optionally-installed glue layers, each meant to be usable without the
other (nothing about installing this CLI should pull in `vscode`-adjacent
tooling, and nothing about packaging the extension should need to know the
CLI exists). A future third glue-layer consumer needing the identical
`.editorconfig` logic would be the actual trigger to extract it somewhere
both can import from — two is exactly the number of peers this project's
own architecture wants to stay decoupled at.

`pyproject.toml` parsing (`src/config/toml-subset.ts`) is a new,
from-scratch minimal TOML reader — not a `.editorconfig`-style adaptation
of existing code, since nothing in this repo previously read TOML. Follows
the identical "implement only the spec surface this feature needs" call
`editorconfig.ts` already made: table headers and flat `key = value` pairs
(strings, integers, booleans) are enough for `[tool.rewrap-plus]`'s own key
set, the same shape every other Python tool's `[tool.*]` table uses.
Unsupported TOML (arrays, floats, inline tables, `[[array tables]]`) isn't
a parse error — the key is simply omitted, the same "skip malformed/
unsupported input, don't block" posture this project applies everywhere
from a skipped source region up to a skipped `.editorconfig` line.

## Why `applyTextEdits` needed no changes to exist for this

`packages/engine/src/apply-edits.ts`'s own doc comment already named "any
future non-VSCode consumer (a future CLI)" when it was first written —
and `packages/engine/src/types/config.ts`'s `WrapConfig` doc comment
calls itself "the plain-data contract between a caller (the VSCode
extension, and now the CLI) and the engine." Both
predictions held exactly: `wrapRegions(source, languageId, 'all', wrapConfig,
parserManager)` followed by `applyTextEdits(source, result.edits)` is the
CLI's entire wrap path (`src/apply.ts`) — the identical two calls
`packages/vscode-extension/src/commands/apply-wrap.ts` makes, modulo
translating the result to `vscode.TextEdit`/`WorkspaceEdit` instead of a
plain string written back with `node:fs`. Targeting whole files with `'all'`
(never a cursor or selection) means the CLI never needs `PositionMapper` or
byte-offset conversion at all — the one piece of the UTF-8/UTF-16 span
machinery neither of these two glue layers's *own* new code has to touch
directly, since `wrapRegions`/`applyTextEdits` already hide it.

## What this means going forward

Six real consumers of `packages/engine` now exist across two packages
(five language adapters plus the CLI's own direct use of the wrap
pipeline), and this project's own two standing architectural questions —
"does the adapter interface hold?" (the JavaScript canary, reconfirmed
through every adapter since) and "does the engine/glue separation hold?"
(this section) — have both now been answered with a real second
implementation, not just an aspiration in a doc comment. The
`WrapConfig`/`apply-edits.ts` doc comments that predicted this outcome by
name turned out to be exactly right, which is itself the
useful data point: a plain-data config contract and an edit-application
function with no editor-host awareness baked in really do transfer to an
entirely different runtime shape (batch CLI vs. live editor) with no
engine-side changes at all.

---

# Plain block comments and Doxygen `///` support

Two gaps left open deliberately by the JavaScript/TypeScript and C++
sections above — a plain single-star `/* ... */` block comment excluded
from discovery entirely, and (C++ only) Doxygen's `///` repeated-marker
doc-comment style excluded the same way — turned out to both be real,
tractable engine work rather than permanent limitations, once actually
attempted. Closing them needed two small, additive descriptor fields and
one shared grouping helper; nothing about the existing dissolve/emit/wrap
pipeline for any other region kind changed.

## Plain block comments: a second delimiter, not a schema rewrite

The blocker named in both earlier sections was real: `LanguageDescriptor.comments.block`
is a single open/close/continuation-prefix spec, already the delimiter a
`'docComment'` region uses (JSDoc's `/**`/`*`-continuation form). A plain
`/* ... */` comment shares `block`'s close delimiter and continuation
style but not its open one — `/*` vs `/**` — so classifying it as
`'blockComment'` and dissolving/emitting it through `block` unchanged
would either strip the wrong prefix or leave a stray `*` behind.

The fix was additive, not a rewrite: a new optional `comments.plainBlock`
field, identically shaped to `comments.block`, declared by every real
ECMAScript-family descriptor and by C++'s. `dissolveBlockCommentText`/
`emitBlockComments` (`packages/engine/src/comments/`) each gained one new
optional parameter — the block spec to use, defaulting to
`descriptor.comments.block` exactly as before — so a `'docComment'`
region's own dissolve/emit call sites (`wrap-doc-comment.ts`) needed no
change at all, while `wrap.ts`'s `emitWrappedBlockComment` (and
`dissolveBlockComments` itself) now pass `descriptor.comments.plainBlock`
explicitly. `classifyEcmaScriptNode`/C++'s own `classify` each gained one
more check, ordered *after* the doc-marker check (`/**` also starts with
`/*`, so order matters) and *before* falling through to `null`.

## `///`: a repeated-marker doc comment, not a block one

Doxygen's `///` turned out to be structurally closer to a `'lineComment'`
than to a `'docComment'`'s open/close pair — probing `tree-sitter-cpp`
directly (`docs/spikes/tree-sitter-cpp-doc-comment-probe.mjs`) confirmed
each `///` line is its own separate `comment` node, exactly the
"marker repeated per physical line" shape `dissolveLineComments`/
`emitLineComments` already exist for, not one node with the whole
comment's text inside it the way `/** ... */` is. Non-adjacent `///`
lines (separated by real code) stay as separate nodes too, confirming an
adjacency-based merge — not the grammar — is what turns consecutive
`///` lines into one logical comment.

That reframing is what made this tractable: rather than inventing a new
dissolve/emit pair from scratch, `wrapDocComment`
(`packages/engine/src/comments/wrap-doc-comment.ts`) now branches on a
new `comments.doc.repeatedMarker` field (`'///'` for C++; unset
everywhere else). When a `'docComment'` region's own text starts with
that marker, it dissolves through a small new per-line stripping helper
and emits through `emitLineComments` *completely unchanged* — a dialect's
`segment` already produces the identical `Block[]` shape that function
knows how to lay out, the same reuse the block-shaped path already gets
from `emitBlockComments`. Every other `'docComment'` region (including
C++'s own `/** ... */` one) is unaffected, still dissolving/emitting
through `comments.block`.

Grouping consecutive `///` lines into one multi-part region needed the
identical adjacency-merge algorithm Python's own `'lineComment'`
grouping already implemented (same-indent, strictly consecutive source
rows) — promoted out of `languages/python/adapter.ts` into a new shared
`packages/engine/src/comments/group-adjacent-regions.ts`, the same
"promote once a second real consumer needs it" pattern this document's
earlier sections establish repeatedly, just arriving for a `groupRegions`
hook rather than a dissolve/emit pair this time. C++'s own `groupRegions`
merges only `'docComment'` regions whose `rawText` starts with `///` —
deliberately excluding `/** ... */`-form `'docComment'` regions from the
same merge, since each is already one complete node and merging two
genuinely separate adjacent block doc comments would corrupt the span
`dissolveBlockCommentText`/`emitBlockComments` expect.

## What this means going forward

Both gaps are closed without touching a single existing dissolve/emit
function's own behavior for the region kinds they already supported —
`plainBlock`/`repeatedMarker` are additive descriptor fields an adapter
opts into, and every call site that doesn't pass the new optional
parameter behaves exactly as it did before this work. That's the same
data point every section above already makes about this project's own
seams (dissolve/emit per-language-shape, classify/groupRegions as narrow
adapter-local overrides, generic engine dispatch knowing nothing about
delimiter styles) holding up for cases they weren't originally designed
around. The one genuinely new reusable piece —
`group-adjacent-regions.ts`'s adjacency merge — is now available to any
future adapter with its own repeated-per-line comment convention, not
just C++'s `///`.

---

# Triple-quoted non-docstring string literals

This section covers a case region discovery originally scoped out — "a
triple-quoted string anywhere else [outside a docstring position]... is
an ordinary `stringLiteral`" — which string-literal wrapping then
hard-refused outright by name (`isSafeToWrap`'s own `TRIPLE_QUOTE_BODY`
comment called it out as real, separate work). Unlike every adapter
section above, this isn't a new language adapter — it's a new *shape* of
region inside the existing Python adapter — so there's no
grammar-probing section here; the finding is about reuse and
safety-gate design instead.

## The pipeline is reused verbatim, not forked

`dissolveDocstring`/`emitDocstring` (`languages/python/dissolve-docstring.ts`,
`emit-docstring.ts`) turned out to have never actually depended on
docstring *position* — both operate purely on a triple-quoted literal's own
text shape (prefix, quote delimiter, PEP-257 physical-line/indentation
structure). `wrapCodeString` (`languages/python/wrap-code-string.ts`) calls
both directly, unchanged, for a non-docstring triple-quoted
`'stringLiteral'` — the same "promote once a second real consumer needs
it" pattern this document's JavaScript-canary, JavaScript/TypeScript/TSX,
and C++ sections already establish repeatedly, except here the second
consumer needed the literally identical
functions, not a copy with one field swapped. The one deliberate
divergence from `wrapDocstring`: segmentation always uses `plainDialect`
directly, never `cfg.docDialect`'s Google/NumPy/Sphinx choice — those
dialects parse a *documentation* convention (`Args:`, a NumPy underline, a
Sphinx field marker) that has no business being scanned for inside an
arbitrary program value.

## The safety gate had to become stricter than every other `'stringLiteral'`

This is the one genuinely new design question this work raised, not
answered by precedent. Every other `'stringLiteral'` wrap in this package
is value-preserving by construction — concatenation-splitting a string
inserts zero characters into its runtime value
(`strings/dissolve-string.ts`'s own doc comment) — so gating it behind
`stringPolicy: 'prose'` is purely a *stylistic* default: `'all'` or a
`# rewrap: force` directive can reasonably bypass it, because doing so
can't corrupt anything, only wrap text a human might not have wanted
wrapped. `wrapCodeString` breaks that property on purpose — it applies the
same PEP-257 indent-stripping and paragraph-whitespace normalization a
docstring already accepts (and this project has accepted since docstring
wrapping was first added) — which means `looksLikeProse` can't be left as a stylistic default for this
one shape without also handing `stringPolicy: 'all'` a real corruption
path it doesn't have for any other string. The fix: `isSafeToWrap`
(`languages/python/adapter.ts`) calls `looksLikeProse` itself, directly,
for a single-part triple-quoted literal — unconditionally, before
`../../wrap.ts`'s own policy-gated prose branch ever runs, and not
bypassable by `force` either, matching the same "never bypass a hard
structural refusal" posture raw/byte-prefix strings already establish in
the same function. A multi-part triple-quoted concatenation run (`"""a"""
"""b"""`) stays unsafe regardless — genuinely separate work, since neither
`wrapCodeString` nor the concatenation-based pipeline is built for that
shape.

## Two pre-existing bugs found while building this work's own fixtures, fixed as their own follow-up

Both were first sidestepped in this work's own 009 fixture (different
fixture wording; keeping the summary on the opening delimiter's line
rather than exercising the "quote alone" convention) rather than fixed
inline, since neither is specific to triple-quoted non-docstring strings
— fixing either under this section's own commit would have been scope
creep into docstring- and string-wrapping territory well outside it. Both
were then fixed separately, recorded here rather than as their own new
section since neither changed anything about this work's own feature —
009's fixture still uses its sidestepped wording; it didn't need to go
back to exercising the bug now that the bug is gone.

- **`looksLikeProse`'s `SQL_KEYWORDS` regex matched ordinary English.** A
  hand-written prose paragraph containing the word "from" (`"...separated
  from the first by..."`) scored +4 on every positive signal but was
  driven to a final score of exactly 0 (not eligible) by the same -4
  SQL-keyword penalty meant for `SELECT ... FROM ...`. `FROM`/`WHERE`/
  `JOIN`/`VALUES` are common enough as ordinary English words that
  matching any one of them alone was a real false-positive risk;
  `SELECT`/`INSERT INTO`/`DELETE FROM`/`CREATE TABLE`/`DROP TABLE` are not.
  **Fix:** split into `SQL_STRONG_KEYWORDS` (any one alone still counts)
  and `SQL_WEAK_KEYWORDS` (only counts once at least two *distinct* ones
  co-occur — the shape a real query almost always has and a stray English
  sentence almost never does). `prose-heuristic.ts`'s own doc comment on
  the two regexes has the full reasoning; `prose-heuristic.test.ts` gained
  a dedicated regression suite (prose containing "from"/"where" now
  accepted; a query built only from co-occurring weak keywords, and every
  strong keyword alone, still rejected).
- **Docstring wrapping was not idempotent for "quote alone on its own
  line" + "more than one paragraph."** Reproduced identically through the
  ordinary `wrapDocstring` path for a real `'docstring'` region — nothing
  to do with `wrapCodeString` — so it was a latent bug in docstring
  wrapping itself, not one this work introduced. Wrapping such a
  docstring once was correct; wrapping the result a second time inserted
  an additional spurious blank line after the opening delimiter, and
  repeated on every subsequent wrap. **Root cause:** `emit-docstring.ts`'s
  `rest` (the physical lines after the very first one) was computed as
  `openingHasSummary ? contentLines.slice(1) : contentLines` — when the
  opening line had no summary (a leading `blank` block, `contentLines[0]
  === ''`), the *whole* `contentLines` array was kept instead of dropping
  its already-consumed first element, so that blank line got emitted a
  second time. An existing `emit-docstring.test.ts` case had, in effect,
  asserted the bug as intended behavior (its expected output had the same
  spurious extra blank line) — corrected alongside the fix. **Fix:**
  `rest` is now always `contentLines.slice(1)`, matching what the
  function's own "Opening and closing placement" doc comment already said
  the intended behavior was ("line 0's own (empty) content becomes its
  own following blank physical line" turned out to describe the bug, not
  the fix — reworded). New coverage: a regression case in
  `emit-docstring.test.ts` (two paragraphs after a leading blank — one
  paragraph alone didn't expose the duplication clearly enough to have
  caught this originally) and a new end-to-end gold fixture,
  `docstrings/008-quote-alone-multi-paragraph`.

## What this means going forward

This work didn't need a new adapter hook, a new region kind, or any
change to `../../wrap.ts`'s generic dispatch — the entire feature lives
inside `languages/python/`, gated by `isSafeToWrap` the same way every
other Python-specific string refusal already is. That's a data point in
the same direction as every section above: the seams this project drew
early (dissolve/emit per-language, safety gating owned by the adapter,
generic dispatch knowing nothing about quote styles) keep paying off for
a case none of them were designed with in mind. It's also the first
entry in this document where the interesting finding isn't "did the
interface hold" but
"how much of an existing pipeline can be reused as-is for a shape it
wasn't originally written for" — the answer here being all of it, with the
safety story adjusted at the one call site (`isSafeToWrap`) that actually
needed to know the difference.

---

# Java — full adapter

Phase 12f's first stretch language (of four surveyed — Rust, Go, Java,
Ruby — all confirmed to ship a prebuilt, MIT-licensed grammar WASM before
picking one to go deep on). Like C++, `javaAdapter` is a real adapter —
strings, concatenation, a documentation dialect — from its first commit,
with no thin-canary precursor. The short answer, as with every earlier
adapter: the interface held with **zero engine changes**, confirmed by
`test/conformance/java-conformance.test.ts` passing on the first real
run. Two grammar shapes below are genuinely new relative to every
adapter before it, though — neither is a "free consequence" the way
C++'s two hazards were; both needed real adapter-level handling.

## A genuinely new shape: two comment node types, not one

Every C-family or ECMAScript-family grammar vendored so far — Python
excepted, which has no block comments at all — produces exactly *one*
comment node type (`comment`) covering every form (`//`, plain
`/* ... */`, JSDoc/Doxygen-marked `/** ... */`), told apart afterward by
the node's own text. Probed directly against `tree-sitter-java@0.23.5`:
Java's grammar produces **two** — `line_comment` for `//`, a wholly
separate `block_comment` node for both block forms. `queries.comments`
needed two patterns sharing one capture name
(`(line_comment) @comment (block_comment) @comment`), confirmed to
compile and capture both types correctly with no `discoverRegions`
change — multi-pattern queries sharing a capture name turn out to be
ordinary, well-supported tree-sitter query syntax, not something this
project's existing single-pattern queries had exercised yet.
`languages/java/adapter.ts`'s `classify` branches on `node.type` first,
text second — the reverse of `classifyEcmaScriptNode`'s text-only
branching, since only `block_comment` can ever be Javadoc-shaped in the
first place.

## A genuinely new hazard: a text block shares its node type with an ordinary string

Java 15+ text blocks (`"""..."""`) are not a separate grammar node the
way JS/TS template literals (`template_string`) or C++ raw strings
(`raw_string_literal`) are — probed directly, a text block parses as the
*same* `string_literal` node an ordinary `"..."` string does, distinguished
only by its own delimiter text being `"""` rather than `"`. This means
`queries.strings`'s `(string_literal) @string` pattern captures both
forms indiscriminately; excluding a text block is `classify`'s job
(returning `null` for a `string_literal` whose text starts with `"""`),
not something a query-level exclusion or an `isSafeToWrap` refusal could
express — the first case in this project's history where "excluded by
construction, the query itself never captures it" (the mechanism every
earlier raw-string/template-literal exclusion relied on) genuinely
doesn't apply, and a `classify`-level exclusion was the only available
tool.

The exclusion itself is a deliberate scope limit, the direct Java
counterpart to Python's deferred triple-quoted non-docstring strings: a
text block's common-indentation-stripping and trailing-newline
conventions have no representation in `strings/dissolve-string.ts`'s
"strip syntax, concatenate bodies verbatim" model, the same reasoning
that deferred Python's own case. Unlike that Python work (which later
built real support, see "Triple-quoted non-docstring string literals"
above), no such follow-up exists yet for Java's text blocks — a real
future feature, tracked as an open scope limit, not attempted here.
Covered by its own negative gold fixture
(`test/fixtures/java/strings/neg-004-text-block`) asserting *zero edits
and zero skipped regions* — proving the exclusion happens at discovery,
never as a declined wrap the way `neg-001`/`neg-002`/`neg-003`'s
prose-heuristic refusals do.

## Everything else: established precedent, confirmed rather than assumed

- **`+`-only operator concatenation, no grouping requirement** — the
  identical shape JS/TS already declare. `binary_expression` exposes
  `left`/`operator`/`right` fields, probed directly with a 4-literal
  chain (`"a" + "b" + name + "c"`) to confirm left-associative nesting
  and a bail-out at the first non-literal operand, the same shape
  `discoverRegions`'s concatenation grouper already expects.
- **The CRLF trailing-`\r` quirk, confirmed present for `line_comment`,
  absent for `block_comment`** — the identical Python-grammar finding
  this document's "CRLF handling" section already made, re-verified
  directly against Java's own grammar rather than assumed to transfer.
  Already handled by `discoverRegions`'s existing `trimTrailingCR`
  safeguard; no adapter-specific fix needed.
- **`isSafeToWrap`/`emitContext`/`proseText`/`wrapString` written as
  Java's own local functions**, not imported from
  `languages/ecmascript/adapter-support.ts` despite near-identical logic
  (operator style, no grouping, the same line-continuation/irregular-
  whitespace refusals) — Java isn't an ECMAScript-family grammar, and
  `languages/cpp/wrap-string.ts` already established the precedent of
  keeping a language's thin wrapper local rather than risking a change to
  already-hardened JS/TS code for a purely cosmetic dedup.
- **The `javadoc` documentation dialect** mirrors `jsdoc.ts`/`doxygen.ts`'s
  field-list shape exactly (a flush-left `@tag` marker, `groupFieldEntries`
  folding continuation lines) — kept as its own dialect id rather than
  reusing `'jsdoc'` directly, matching how `'doxygen'` already earned its
  own id despite comparable overlap, since `@return`/`@param`'s exact
  vocabulary is Javadoc's own, not JSDoc's borrowed. Inline `{@link ...}`/
  `{@code ...}` tags needed no dedicated handling at all: the existing
  generic brace-placeholder unbreakable-span mechanism (`{...}`, already
  exercised by `jsdoc.test.ts`'s own `{Type}`-annotation case) keeps them
  intact for free, since it applies to every comment/docstring reflow
  generically, not just string literals.
- **No `///`-repeated-marker doc-comment form** — probed directly: a
  `///`-prefixed comment parses as an ordinary `line_comment`, no special
  node or marker, unlike C++'s Doxygen `///`. (Java 23's JEP 467
  "Markdown documentation comments" introduces exactly this convention,
  but `tree-sitter-java@0.23.5` predates it — also probed directly and
  confirmed absent.) `comments.doc` declares no `repeatedMarker`; worth
  revisiting once a grammar release adds real support.
- **No `groupRegions` override** — Java's `//` comments aren't merged
  across adjacent lines, the same open question left for JS/TS's and
  C++'s own ordinary `//` comments, and Java has no `///` form needing
  the adjacency merge C++'s own `groupRegions` exists for.

## What this means for future adapters

Six adapters now pass the identical `runAdapterConformance` suite:
Python, JavaScript, TypeScript, TSX, C++, Java. Unlike C++ (whose two
anticipated hazards both turned out to be free consequences of the
grammar's own structure), Java's two genuinely new shapes — two comment
node types, and a text block sharing its node type with an ordinary
string — both needed real adapter-level code, not zero-cost query
exclusions. That's the more representative case, and the more useful
data point for whichever of Rust/Go/Ruby (Phase 12f's remaining stretch
languages) comes next: "no engine change needed" continues to hold, but
"needs no adapter-level thought either" was never a safe assumption to
begin with, and Java's own two findings are the concrete evidence for
why a real probe-first pass — not a template copy from the nearest
similar-looking adapter — stays the right way to add one.
