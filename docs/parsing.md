# Parsing: spike findings

This document exists to answer one question before anything got built on
top of it: **does `tree-sitter-python` ship a usable prebuilt `.wasm`, or
does this project need its own grammar build pipeline?** This was
expected to be the fiddliest part of the whole project, and worth
resolving before any conditional build/vendoring pipeline either happens
or doesn't.

The throwaway script used for this is checked in at
[`spikes/tree-sitter-wasm-loading.mjs`](./spikes/tree-sitter-wasm-loading.mjs)
for reproducibility; it is not part of the build, not linted, and not run
in CI. Everything it demonstrated is written up below, and the durable
product of this investigation — `ParserManager` and `ParseResult`, under
`packages/engine/src/parser/` — is properly tested instead.

## Finding 1: `tree-sitter-python` ships a prebuilt `.wasm`

`npm pack tree-sitter-python@0.25.0` and inspecting the tarball shows a
`tree-sitter-python.wasm` file at the package root, alongside the native
`prebuilds/*.node` bindings used by non-web consumers:

```
package/tree-sitter-python.wasm
package/prebuilds/darwin-arm64/tree-sitter-python.node
package/prebuilds/linux-x64/tree-sitter-python.node
...
```

This has been true since at least the `0.23.x` series. **The prebuilt
route works** — a conditional grammar-build/vendoring pipeline does not
apply: there is no Emscripten/Docker build step to add, and no build
pipeline to maintain. What that pipeline _would_ have delivered —
committing the artifact with a provenance note, and documenting how to
regenerate it — is still worth having, so it's covered here instead. See
`packages/engine/grammars/PROVENANCE.md` for the vendored file's exact
source, version, checksums, and update instructions.

**Consequence for future grammars:** don't assume this holds for every
future one. The JavaScript canary adapter re-checks it for
`tree-sitter-javascript` ("also validates that this grammar-loading
approach generalizes past one grammar"); every language added since does
the same for its own grammar before assuming the skip applies there too.

## Finding 2: `web-tree-sitter` and the grammar's ABI must be compatible

`web-tree-sitter` exports `LANGUAGE_VERSION` (the newest grammar ABI it
supports) and `MIN_COMPATIBLE_VERSION` (the oldest). A loaded `Language`
exposes its own `abiVersion`. `Parser#setLanguage` throws if the two don't
overlap.

At the versions this project pins — `web-tree-sitter@0.26.13` and the
vendored `tree-sitter-python@0.25.0` grammar — the numbers are:

|                                            | value |
| ------------------------------------------ | ----- |
| `web-tree-sitter` `MIN_COMPATIBLE_VERSION` | 13    |
| `web-tree-sitter` `LANGUAGE_VERSION`       | 15    |
| vendored grammar `abiVersion`              | 15    |

Compatible today. `ParserManager`'s tests assert a language loads and
`setLanguage` succeeds specifically so an incompatible upgrade of either
package fails loudly in CI rather than at first use in the extension.

## Finding 3: `web-tree-sitter` node offsets are UTF-16, not UTF-8 — despite the byte-oriented framing everywhere else

This is the one worth being careful about. `SourceSpan`'s own doc
comment states the general, correct rule for _native_ tree-sitter
bindings: tree-sitter indexes bytes (UTF-8), VSCode indexes UTF-16 code
units, and the two diverge for any non-ASCII content. `PositionMapper` was
built to bridge exactly that gap, converting a raw UTF-8 byte offset to a
UTF-16 `Position` and back.

`web-tree-sitter`'s own type declarations reinforce the same assumption —
`Parser#parse`'s `callback` parameter is documented as _"The UTF8-encoded
text to parse."_

But when you feed `Parser#parse` a plain JS string (as this project
always will — see `ParserManager` below), that documentation doesn't hold
in practice. The spike parses `x = "😀日本語"` — a line that's 11 UTF-16
code units long but 19 UTF-8 bytes long, because of the astral-plane
emoji (a surrogate pair, 4 UTF-8 bytes) and the three CJK characters (1
UTF-16 unit but 3 UTF-8 bytes each). The `string_content` node's
`startIndex`/`endIndex` come back as `5`/`10` — a span of 5, matching the
UTF-16 code-unit count of `😀日本語` (2 + 1 + 1 + 1), not its UTF-8 byte
count of 13 (4 + 3 + 3 + 3). `startPosition.column`/`endPosition.column`
agree with `startIndex`/`endIndex` exactly — they're UTF-16-code-unit
columns too, not byte columns.

In other words: **when fed a JS string, `web-tree-sitter`'s node
offsets — `startIndex`, `endIndex`, and every `Point.column` — are already
UTF-16 code-unit offsets, identical in kind to what `vscode.Position`
uses.** This is very likely `web-tree-sitter` internally maintaining its
own UTF-16 offset table over the JS string it was given, independent of
whatever encoding it feeds the WASM heap — but that's an implementation
detail this project doesn't depend on; only the observed behavior above
does.

**Why this matters:** `PositionMapper.spanFromByteRange(startByte,
endByte)` exists to convert genuine UTF-8 byte offsets into a full
`SourceSpan`. It would be a natural-looking but _wrong_ mistake to call
`spanFromByteRange(node.startIndex, node.endIndex)` — that silently
double-interprets an already-UTF-16 number as if it were a UTF-8 byte
count, corrupting every span for any file containing non-ASCII text
(astral emoji, CJK, accented characters, smart quotes — all extremely
common in real source).

**What this project does instead:** `packages/engine/src/parser/span-from-node.ts`
treats a node's `startPosition`/`endPosition` as the authoritative,
already-UTF-16 `Position` and derives the _true_ UTF-8 `startByte`/
`endByte` from them via `PositionMapper.positionToByteOffset`, rather than
trusting `startIndex`/`endIndex` as byte offsets. This is the same
`PositionMapper` built for this exact purpose, used in the direction
that's actually correct for this parser binding. See that file's doc
comment for the implementation, and `span-from-node.test.ts` for a
non-ASCII regression test asserting the byte offsets it produces are
real UTF-8 byte counts, not a relabeled UTF-16 count.

If a future addition brings in a _native_ (non-WASM) tree-sitter
binding — e.g. for a Node-only CLI fast path — this finding does not
carry over: native
bindings parse raw bytes directly and their offsets are genuine UTF-8
bytes. `span-from-node.ts` is specifically about the WASM/JS-string
binding this project uses everywhere today.

## Finding 4: error/missing node detection is straightforward

`Node#hasError` (true if the node or anything under it is an `ERROR` node),
`Node#isError`, and `Node#isMissing` are sufcient to implement the
"skip region, warn, never block" policy from decision-of-record. A
deliberately broken snippet (`def greet(name:` with no closing paren or
body) produces `rootNode.hasError === true` and two descendant `ERROR`
nodes bounding the malformed region — exactly the shape `ParseResult`
needs to report `errorSpans`.

## Finding 5: `tree-sitter-typescript` also ships prebuilt WASM — for *two* grammars

Re-checking the "prebuilt or build-it-yourself?" question for
`tree-sitter-typescript`, per this file's own note flagging it as
something to verify per grammar rather than assume: `npm pack
tree-sitter-typescript@0.23.2` and inspecting the tarball shows *both*
`tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm` at the package
root. One npm package, two grammars — TSX is a genuinely separate
grammar from plain TypeScript (upstream's own split; a `<T>` type
assertion and a JSX element are ambiguous under one grammar), not a
superset flag on the same one, so both are vendored and registered
separately (`packages/engine/grammars/PROVENANCE.md`). No build pipeline
needed for either, same as Python and JavaScript before it.

One difference worth naming: this grammar's own `abiVersion` is `14`,
one older than Python/JavaScript's `15` — still inside
`web-tree-sitter@0.26.13`'s supported `[13, 15]` range (Finding 2 above),
but a reminder that a future grammar could fall outside it where Python
and JavaScript's shared `15` didn't hint at any ceiling.

The probe script for this (`docs/spikes/tree-sitter-typescript-probe.mjs`)
also confirmed the node shapes the TypeScript/TSX descriptors depend on:
a `comment` node covers all three JS/TS comment forms exactly as the
JavaScript canary already found for `tree-sitter-javascript`; a
`string` node's children are its quote tokens plus a `string_fragment`
body (no prefix complexity, unlike Python); `binary_expression` exposes
`left`/`operator`/`right` fields for `+`-concatenation, the same
convention `discoverRegions`'s concatenation-grouping algorithm already
expected from Python's `binary_operator`; and template literals
(`` ` ``-delimited) are a separate `template_string` node type, not
matched by a plain `(string) @string` query — consistent with the
deliberate choice to defer template-literal wrapping the same way
Python defers triple-quoted ordinary strings.

## Finding 6: `tree-sitter-cpp` — one grammar, several genuinely new node shapes

Re-checking the "prebuilt or build-it-yourself?" question once more, per
this file's own repeated "verify per grammar" note: `npm pack
tree-sitter-cpp@0.23.4` shows a prebuilt `tree-sitter-cpp.wasm` at the
package root, same as every grammar vendored so far — no build pipeline
needed. `0.23.4` is this package's newest release, noticeably behind
Python/JavaScript's `0.25.0` and even `tree-sitter-typescript`'s `0.23.2`
(no `0.24.x`/`0.25.x` series exists yet); its own `abiVersion` is `14`,
same as `tree-sitter-typescript`'s, still inside `web-tree-sitter@0.26.13`'s
supported `[13, 15]` range.

The probe script for this (`docs/spikes/tree-sitter-cpp-probe.mjs`) found
several node shapes genuinely new to this project, not just a repeat of
JS/TS's findings:

- One `comment` node type covers `//`, `///`, plain `/* * /`, and
  `/** * /` alike — the same "tell them apart by text" shape every
  ECMAScript-family grammar already needed.
- `concatenated_string` wraps adjacent `string_literal` siblings for bare
  adjacency (`"foo" "bar"`) — the *identical* node name Python's own
  grammar uses for the same construct.
- **No valid `+`-operator string concatenation exists in C++ at all** —
  `"a" + "b"` is a compile error (pointer + pointer), so unlike every
  other adapter in this package, `cppDescriptor.queries.concatenations`
  declares no `@concat.operator` pattern whatsoever. Probing
  `std::string("a") + "b" + "c"` confirmed the only real-world shape:
  the `+` chain's `left` operand bottoms out at a `call_expression`
  (`std::string(...)`), never a second `string_literal` leaf — exactly
  what `discoverRegions`'s own concatenation grouper already bails on for
  every other language's `"a" + name` case, so simply not declaring the
  pattern is correct, not incomplete.
- **Raw strings (`R"(...)"`, `R"delim(...)delim"`) parse as a wholly
  separate node type, `raw_string_literal`** — never matched by
  `(string_literal) @string` — the same "excluded by construction, not by
  a runtime check" mechanism that already kept JS/TS template literals
  out of discovery.
- **A `string_literal` node's own source text bakes its encoding prefix
  (`L`, `u`, `U`, `u8`) into the same token as the opening quote** —
  0-2 letters, well inside the shared `dissolve-string.ts`/`emit-string.ts`
  prefix regex's existing `{0,3}` allowance, so no engine change was
  needed there; only a small C++-specific mixed-prefix `isSafeToWrap`
  check (`packages/engine/src/languages/cpp/prefix.ts`) was.
- `char_literal` (single-quoted, `'x'`) is a separate node type from
  `string_literal` — never matched by `queries.strings`, so C++'s
  `strings.quotes` only ever needs `"`.
- **A `#define` macro body is never parsed as C++ syntax at all** — its
  argument is one opaque `preproc_arg` leaf carrying raw, unparsed text,
  confirmed by probing a multi-line macro with a backslash-newline
  continuation. Neither `comment` nor `string_literal` nodes are ever
  produced inside one, so the anticipated hazard of needing to skip
  strings inside macro definitions turned out to already be satisfied by
  the grammar's own structure — nothing to special-case.

See `docs/adapters.md`'s C++ section for how each of these shaped
`packages/engine/src/languages/cpp/`'s descriptor and adapter.

## What this investigation built on these findings

- `packages/engine/grammars/tree-sitter-python.wasm` — the vendored
  prebuilt asset from finding 1, with `PROVENANCE.md` alongside it.
- `packages/engine/src/parser/parser-manager.ts` — lazy, cached grammar
  loading (finding 2's compatibility check happens here, once, at load
  time).
- `packages/engine/src/parser/span-from-node.ts` — the corrected node-to-
  `SourceSpan` conversion from finding 3.
- `packages/engine/src/parser/parse-result.ts` — error/missing node
  detection from finding 4.
