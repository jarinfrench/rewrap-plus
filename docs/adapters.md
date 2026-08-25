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
