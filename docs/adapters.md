# Adapters: Phase 6b findings

Phase 6b exists to answer one question — "can a new language be added
without touching the engine?" — at the cheapest possible moment, before
Python-specific assumptions have had three more phases to harden around.
This document records what that process actually found, per the plan's
own instruction: "Record any engine changes that *were* needed in
`docs/adapters.md` as known-leaked assumptions."

The short answer: yes, with three leaks found and fixed *before* the
canary needed to exist, plus a handful of CRLF-handling bugs that
predate this phase but were caught by the same investigation. Once the
canary and conformance kit actually existed, they passed cleanly against
both adapters on the first real run — no further engine changes were
needed at that point. That's the intended shape of this phase: the leaks
get caught by *building toward* the canary, not by the canary itself
needing a second round of fixes.

## Leaked assumptions found and fixed before the canary existed

### 1. Commented-out-code detection hardcoded Python's keyword list

`dissolveLineComments`'s commented-out-code heuristic (Phase 6) directly
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

Phase 6's `wrapRegions` lived under `languages/python/wrap.ts`,
validated `languageId` against `pythonDescriptor.id` directly, and
imported `pythonAdapter` by name — its own doc comment named this as
exactly the question Phase 6b exists to settle.

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
`packages/engine/src/comments/` directory. This is also where Phase 6b's
own block-comment functions (`dissolveBlockComments`/
`emitBlockComments`) landed, for the same reason: Python has no block
comments to exercise them, so nothing about that path should be allowed
to assume Python either.

## CRLF handling

Not adapter-interface leaks in the same sense as the three above — these
are bugs in engine code that happened to only manifest on CRLF source,
caught while establishing a clean test baseline ahead of this phase's
own work (a CRLF-preserving conformance invariant would have failed
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
not trusted from memory — the same discipline Phase 2/3 used for Python.

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
  partway through. "Bias toward verbatim/skip when uncertain" (Phase 4's
  own stated principle) applied to a case Phase 4 didn't anticipate. A
  real (non-canary) JavaScript adapter — Phase 12b — should decide this
  deliberately rather than inherit the canary's shortcut by default.
- **No `groupRegions` override for JavaScript.** Python merges adjacent
  same-indent `//`-equivalent lines into one logical block;
  JavaScript's canary doesn't attempt the equivalent for `//` comments.
  Left as a genuine open question for Phase 12b, not answered here —
  the canary's job was proving the *interface* holds, not shipping every
  behavior a real adapter would want.
- **`strings` is structurally populated but functionally inert.**
  `LanguageDescriptor`/`validateDescriptor` require at least one quote
  form and a non-empty `queries.strings` regardless of whether an
  adapter does anything with what it discovers. The JavaScript canary's
  `strings` block is real, valid data — but `wrapRegions` never
  dissolves or emits a `'stringLiteral'` region for *any* adapter yet
  (Python's own string/docstring regions are equally reported as
  skipped), so this isn't new engine behavior specific to the canary.

## What this means for Phase 7 and beyond

Both adapters pass the identical `runAdapterConformance` suite
(`packages/engine/src/conformance/run-adapter-conformance.ts`) — 14
checks each, covering structural validation, query compilation,
idempotency, re-parse cleanliness, line-length, and line-ending
preservation, each run against both a CRLF and an LF source fixture.
Adding a language from here means writing a descriptor, a thin adapter
if any hooks are needed, source fixtures, and calling
`runAdapterConformance` — not designing a test strategy from scratch,
and not discovering mid-Phase-9 that dissolve/emit secretly assumed
Python.

---

# Phase 12b: JavaScript/TypeScript/TSX — full adapters

Phase 6b's own canary existed to answer "can a new language be added
without touching the engine?" at the cheapest possible moment — with a
deliberately thin, comments-only JavaScript descriptor. Phase 12b is
where that question gets asked for real: a full adapter with strings,
concatenation, and a documentation dialect, for three language ids
(`javascript` — extending the canary in place, plus its `javascriptreact`
alias — `typescript`, and `typescriptreact`). The short answer, as with
6b: yes, with four real leaked assumptions found and fixed, all in
shared/generic code nothing before this phase had a second real reason
to exercise — the same shape of finding 6b's own list above already
established a pattern for.

## Grammar findings

Re-ran the "prebuilt or build-it-yourself?" check from `docs/parsing.md`
for `tree-sitter-typescript`: it ships *two* prebuilt grammars,
`tree-sitter-typescript.wasm` (plain TS) and `tree-sitter-tsx.wasm`
(TS+JSX), both vendored with full provenance
(`packages/engine/grammars/PROVENANCE.md`). Probed directly (`docs/spikes/
tree-sitter-typescript-probe.mjs`) alongside the already-vendored
`tree-sitter-javascript.wasm`, confirming all three grammars share
identical shapes for everything this phase's descriptors depend on:

- One `comment` node type for `//`, plain `/* */`, and `/** */` alike —
  the same finding Phase 6b already made for JavaScript, now confirmed
  for TypeScript/TSX too.
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
  mechanism by which template-literal wrapping is deferred (per the
  plan's own suggestion, "the way triple-quoted code strings were
  deferred in Python") is simply *not adding that node type to the
  query*, not a special-case refusal anywhere.
- TSX parses identically to plain TypeScript for every construct this
  phase cares about (comments, strings, `+`-concatenation), whether
  they sit in an ordinary statement or inside a JSX attribute/expression
  container — confirmed by probing a JSX element containing a string
  concatenation directly.

## Four leaked assumptions found and fixed

Unlike Phase 6b (which found its three leaks *before* the canary needed
to exist), these were found while generating this phase's own gold
fixtures and conformance sources — real second/third/fourth uses of code
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
(mirroring `comments/`, itself promoted the same way in Phase 6b) — the
identical "promote once a second real consumer needs it" call, applied
a third time now that JS/TS genuinely needs the same code.

### 3. `emitString` silently dropped a string's own trailing space

Found while generating this phase's own JavaScript gold fixtures, not
anticipated by Phase 9's plan text: `atomizeWords` drops any whitespace
trailing the final atom (there's no atom after it for that whitespace to
be "between"), and `reinsertSplitSpaces` only ever restored a space
consumed at an *interior* line-break split point — its own `i ===
lines.length - 1` branch returned the last line completely unexamined.
A string ending in a real trailing space before its closing quote
(`"Hello, " + name` — entirely ordinary) silently re-emitted as
`"Hello," + name`: a genuine value change, not a formatting one, exactly
the "silent string corruption" Phase 9's plan calls its central risk —
just at the *end* of the text rather than at a split point, which is why
the existing interior-only check never caught it. This is shared code
Python's own Phase 9 already shipped; none of Python's existing gold
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
— not an error, just nothing happening. Unexercised until this phase
because no adapter before it had registered an alias meant to be
user-facing (Python has none; the Phase 6b JavaScript canary declared
none either). Fixed by returning every registered key instead of a
separately-tracked primary-only set.

## Deliberate scope limits (not leaks)

- **A plain single-star `/* ... */` block comment is excluded from
  discovery**, for the real JavaScript/TypeScript/TSX adapters just as
  it was for the Phase 6b canary — but now a deliberate decision made
  explicitly for real adapters, not inherited implicitly.
  `LanguageDescriptor.comments.block` is one open/close/continuation-
  prefix shape, already spoken for by the JSDoc `/**`/`*`-continuation
  form every `'docComment'` region reuses (`wrapDocComment` dissolves/
  emits through that exact same `comments.block` data). Supporting a
  second, differently-shaped block-comment delimiter on one descriptor
  would be real engine schema surface (`comments.block` becoming a list)
  that nothing in this phase's plan text asks for.
- **Template literals are not wrapped** — deferred per the plan's own
  suggestion, mechanically enforced by `queries.strings` simply never
  capturing `template_string` nodes (see the grammar findings above).
- **No `groupRegions` override for JavaScript/TypeScript** — `//`
  comments still aren't merged across adjacent lines the way Python's
  are, the same open question Phase 6b already deferred and this phase
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

## What this means for Phase 12c and beyond

Four adapters now pass the identical `runAdapterConformance` suite:
Python, JavaScript, TypeScript, TSX. The four fixes above were each
found by a *second, third, or fourth* real consumer of code that looked
generic — the same lesson Phase 6b's own three leaks taught, just
arriving one adapter-family later because nothing before Phase 12b
happened to register a real alias, share `strings/`'s promoted code, or
feed a trailing-space string through the pipeline. Phase 12c (C++) adds
a language with genuinely new shapes this phase never exercised — raw
strings, wide/UTF prefixes, preprocessor line continuations — and should
expect its own round of this same kind of finding, not assume the
adapter seam is now fully proven just because four languages pass.

---

# Phase 12c: C++ — full adapter

Unlike JavaScript's canary-then-real path (Phase 6b, then extended in
12b) or TypeScript/TSX (born full in 12b), C++ had no thin precursor —
`cppAdapter` is a real adapter, with strings and a Doxygen documentation
dialect, from its first commit. The short answer, as with every earlier
phase's version of this same question: the adapter interface held with
**zero engine changes**, though only because two of C++'s genuinely new
shapes turned out to be handled *for free* by the grammar's own
structure rather than by new adapter code — see below. Full grammar
findings are in `docs/parsing.md`'s Finding 6; this section covers what
they meant for the descriptor/adapter design.

## Two hazards the plan named that needed no code at all

- **"Raw strings ... (never wrap)."** `R"(...)"` parses as a wholly
  separate `raw_string_literal` node, never matched by
  `queries.strings`'s `(string_literal) @string` — so raw strings are
  excluded from discovery by construction, the identical mechanism that
  already kept JS/TS template literals out (`docs/adapters.md`'s Phase
  12b section: "not a special-case refusal anywhere"). No `isSafeToWrap`
  check was needed for this one at all.
- **"Preprocessor line continuations ... skip strings inside macro
  definitions in the first pass."** A `#define` macro body is never
  parsed as C++ syntax — its argument is one opaque `preproc_arg` leaf
  carrying raw, unparsed text (confirmed by probing a multi-line macro
  with a backslash-newline continuation). Neither `comment` nor
  `string_literal` nodes are ever produced inside one, so this hazard
  was already resolved before any adapter code was written.

## A hazard the plan didn't name: no valid `+` concatenation exists

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

- **`///` (Doxygen's repeated-line-marker doc-comment style) is excluded
  from discovery entirely**, the same "bias toward verbatim/skip when
  uncertain" call already made for plain `/* */` in Phase 6b/12b, but for
  a different underlying reason: `///` is a genuinely different
  delimiter *shape* than `/** ... */` — no single open/close pair
  `dissolveBlockCommentText`/`emitBlockComments` (and therefore
  `wrapDocComment`) can express, since both are built entirely around
  one open delimiter, one close delimiter, and an optional per-line
  continuation marker. Merging consecutive `///` lines into a region and
  running them through that unchanged machinery would either silently
  rewrite a user's `///` style into `/** */` on emit, or fail to strip
  the marker at all. Building genuine `///` support is real, separate
  engine work (a repeated-marker dissolve/emit pair alongside the
  existing open/close one) that nothing in this phase's plan text
  demands — Doxygen documentation is still fully supported via the
  `/** ... */` form, which is the more common convention for anything
  beyond a one-line comment anyway.
- **A plain single-star `/* ... */` block comment is excluded from
  discovery**, for the identical reason every earlier phase's descriptor
  already chose this: `comments.block` is one delimiter shape, already
  spoken for by the Doxygen `/**`/`*`-continuation form.
- **No `groupRegions` override for C++** — consecutive `//` lines aren't
  merged into one logical block, the same open question Phase 6b/12b
  already deferred for JavaScript/TypeScript's own `//` comments.
- **No `c` alias.** `LanguageDescriptor.aliases`' own doc comment names
  `'cpp'` vs `'c'` as a hypothetical example, but C is a genuinely
  different grammar (`tree-sitter-c`), not a superset/subset relationship
  the way `javascriptreact` truly is an alias of `javascript` — a future
  `c` adapter is separate work, not a same-descriptor alias, the same
  distinction TSX already established against plain TypeScript.
- **`strings.rawForms` is populated but functionally inert**, the same
  shape `docs/adapters.md`'s Phase 6b section already noted for
  `strings` in general: real, valid descriptor data (`RawFormSpec`'s own
  canonical example, `../../types/adapter.ts`), but nothing in the
  engine reads it at runtime — raw strings are already excluded from
  discovery by the query itself (see above), so this field currently
  documents a scope decision rather than driving one.

## What this means for future adapters

Five adapters now pass the identical `runAdapterConformance` suite:
Python, JavaScript, TypeScript, TSX, C++. Unlike every phase before it,
12c required no fix to shared engine code at all — both of its
plan-named hazards (raw strings, macro line continuations) turned out to
be free consequences of how `tree-sitter-cpp` itself parses, and its one
genuinely new correctness question (mixed-prefix concatenation) was
resolved entirely inside `languages/cpp/`'s own `isSafeToWrap`, the same
adapter-local pattern Python's raw/byte-prefix check already
established. That's a useful data point, not a promise: a future
C-family adapter (plain C, Objective-C, Java) should still expect its
own round of grammar-specific findings, the same caution 12b's own
closing note already gave 12c.

---

# Phase 12d: CLI and pre-commit

Every phase through 12c asked "does the adapter interface hold?" Phase
12d asks the plan's other standing question about this architecture:
"does the *engine/glue* separation hold?" — `packages/cli`
(`@rewrap-plus/cli`, bin name `rewrap-plus`) is a second, independent
consumer of `packages/engine`, built without touching the engine at all.
The short answer, stated as plainly as the plan's own acceptance
criterion puts it: yes — zero engine changes, and the one class of
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
scenario this phase covers, and `require.resolve` (via
`node:module`'s `createRequire`, since this file is ESM) is simply the
correct, permanent answer here, not an interim one a future packaging step
will need to undo.

## Config sources: two independent glue-layer peers, not a shared dependency

The plan named three CLI config sources: `.rewraprc`, `pyproject.toml`'s
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
consumer needs it" pattern this document's own Phase 6b/12b sections
establish repeatedly — and deliberately not treated as an instance of it.
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
future non-VSCode consumer (the CLI, Phase 12d)" when it was written back
in Phase 6 — and `packages/engine/src/types/config.ts`'s `WrapConfig` doc
comment calls itself "the plain-data contract between a caller (the VSCode
extension today; a future CLI per Phase 12d) and the engine." Both
predictions held exactly: `wrapRegions(source, languageId, 'all', wrapConfig,
parserManager)` followed by `applyTextEdits(source, result.edits)` is the
CLI's entire wrap path (`src/apply.ts`) — the identical two calls
`packages/vscode-extension/src/commands/apply-wrap.ts` makes, modulo
translating the result to `vscode.TextEdit`/`WorkspaceEdit` instead of a
plain string written back with `node:fs`. Targeting whole files with `'all'`
(never a cursor or selection) means the CLI never needs `PositionMapper` or
byte-offset conversion at all — the one piece of Phase 1's UTF-8/UTF-16
machinery neither of these two glue layers's *own* new code has to touch
directly, since `wrapRegions`/`applyTextEdits` already hide it.

## What this means going forward

Six real consumers of `packages/engine` now exist across two packages
(five language adapters plus the CLI's own direct use of the wrap
pipeline), and the plan's own two standing architectural questions —
"does the adapter interface hold?" (Phase 6b, reconfirmed through 12c) and
"does the engine/glue separation hold?" (this phase) — have both now been
answered with a real second implementation, not just an aspiration in a
doc comment. The `WrapConfig`/`apply-edits.ts` doc comments that predicted
this phase by name turned out to be exactly right, which is itself the
useful data point: a plain-data config contract and an edit-application
function with no editor-host awareness baked in really do transfer to an
entirely different runtime shape (batch CLI vs. live editor) with no
engine-side changes at all.
