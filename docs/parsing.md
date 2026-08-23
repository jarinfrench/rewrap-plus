# Parsing: spike findings (Phase 2)

Phase 2 commit 1 ("engine: add web-tree-sitter dependency and grammar
loading spike") existed to answer one question before anything got built
on top of it: **does `tree-sitter-python` ship a usable prebuilt `.wasm`,
or does this project need its own grammar build pipeline?** The plan
flagged this as the fiddliest part of the whole project and asked for it
to be resolved in commit 1, before commit 2 (a conditional build/vendoring
pipeline) either happens or doesn't.

The throwaway script used for this is checked in at
[`spikes/tree-sitter-wasm-loading.mjs`](./spikes/tree-sitter-wasm-loading.mjs)
for reproducibility; it is not part of the build, not linted, and not run
in CI. Everything it demonstrated is written up below, and the durable
product of this phase — `ParserManager` and `ParseResult`, under
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
route works** — so commit 2 from the plan ("build: add grammar wasm build
and vendoring pipeline _(only if step 1 requires it)_") does not apply:
there is no Emscripten/Docker build step to add, and no build pipeline to
maintain. What that commit _would_ have delivered — committing the
artifact with a provenance note, and documenting how to regenerate it — is
still worth having, so it's folded into this commit instead. See
`packages/engine/grammars/PROVENANCE.md` for the vendored file's exact
source, version, checksums, and update instructions.

**Consequence for later phases:** don't assume this holds for every future
grammar. Phase 6b's canary JavaScript adapter re-checks it for
`tree-sitter-javascript` ("also validates that the Phase 2 grammar
pipeline generalizes past one grammar"); Phase 12b/12c should do the same
for `tree-sitter-typescript` and `tree-sitter-cpp` before assuming the
skip applies there too.

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

This is the one worth being careful about. Phase 1's `SourceSpan` doc
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
(astral emoji, CJK, accented characters, smart quotes — all called out as
"extremely common" in docstrings by Phase 1's own risk note).

**What this phase does instead:** `packages/engine/src/parser/span-from-node.ts`
treats a node's `startPosition`/`endPosition` as the authoritative,
already-UTF-16 `Position` and derives the _true_ UTF-8 `startByte`/
`endByte` from them via `PositionMapper.positionToByteOffset`, rather than
trusting `startIndex`/`endIndex` as byte offsets. This is the same
`PositionMapper` built in Phase 1 for this exact purpose, used in the
direction that's actually correct for this parser binding. See that
file's doc comment for the implementation, and
`span-from-node.test.ts` for a non-ASCII regression test asserting the
byte offsets it produces are real UTF-8 byte counts, not a relabeled
UTF-16 count.

If a future phase adds a _native_ (non-WASM) tree-sitter binding — e.g.
for a Node-only CLI fast path — this finding does not carry over: native
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
(commit 4) needs to report `errorSpans`.

## What Phase 2 built on these findings

- `packages/engine/grammars/tree-sitter-python.wasm` — the vendored
  prebuilt asset from finding 1, with `PROVENANCE.md` alongside it.
- `packages/engine/src/parser/parser-manager.ts` — lazy, cached grammar
  loading (finding 2's compatibility check happens here, once, at load
  time).
- `packages/engine/src/parser/span-from-node.ts` — the corrected node-to-
  `SourceSpan` conversion from finding 3.
- `packages/engine/src/parser/parse-result.ts` — error/missing node
  detection from finding 4.
