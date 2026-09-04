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

## Finding 7: `tree-sitter-markdown` (block grammar) — geometry mostly holds, one real tree-shape surprise, and a clean error-overlap rate

Probed via `docs/spikes/tree-sitter-markdown-probe.mjs`, Phase A
commit 1 of the Markdown/LaTeX support work, against the `v0.5.3`
release asset (`tree-sitter-markdown.wasm`, 421,574 bytes —
matches the plan's recorded size exactly).

**Attestation.** `gh` is not installed on this machine (as the plan's own
toolchain inventory already noted), so verification went two routes
instead: (1) `GET /repos/tree-sitter-grammars/tree-sitter-markdown/attestations/sha256:<hash>`
returned HTTP 200 with one attestation bundle for the exact downloaded
file's sha256; decoding the Fulcio certificate's SAN extensions by hand
(no tooling needed — they're plain ASN.1 UTF8Strings) confirmed the
workflow identity: `https://github.com/tree-sitter/workflows/.github/workflows/release.yml@refs/heads/main`,
source repo `tree-sitter-grammars/tree-sitter-markdown`, tag
`refs/tags/v0.5.3`, and source commit `f969cd3ae3f9fbd4e43205431d0ae286014c05b5`
— all four matching the plan's independently-recorded values exactly. (2)
`pip install sigstore` and `sigstore verify identity` got as far as
validating the Fulcio certificate chain and its OIDC identity/issuer
policy match ("Successfully verified signing certificate validity...")
but then failed at the Rekor transparency-log checkpoint-signature step
with `Signature not found for log ID c0d23d6a…` — the client's current
public-good trust root doesn't recognize the log key this checkpoint was
signed with, even after clearing the local TUF cache and re-fetching. This
reads as a sigstore-python/trust-root freshness gap (the cert chain itself
verified cleanly, and its embedded identity data is internally consistent
with route (1)'s findings), not evidence against authenticity — `gh
attestation verify`, which talks to GitHub's own verification service
rather than a locally-cached public trust root, is still the recommended
tool and remains a residual gap on this machine specifically, exactly as
the plan flagged in advance.

**Geometry (§5.2 assumptions):**

- `paragraph.startPosition` is confirmed to be the content start on line
  1, after any `block_quote_marker`/list/task marker — verified across
  single quote, nested (`>>`) quote, ordered/unordered/task lists, and
  quote-in-list/list-in-quote combinations.
- **One real discrepancy from the plan's own node-types.json reading:**
  `block_continuation` is a child of the paragraph's `inline` node, not a
  direct child of `paragraph` itself (e.g. `paragraph → inline →
  block_continuation`, not `paragraph → [inline, block_continuation]`).
  This doesn't change anything downstream, because §5.2 already hedged
  exactly this uncertainty: "parts are built from source lines and the
  paragraph's row range, not from `inline.text`" — that's the approach to
  keep, now confirmed necessary rather than merely cautious.
- A lazy continuation line (no `>` prefix on line 2 of a quoted
  paragraph) produces no `block_continuation` node at all for that line,
  confirmed directly — matches the plan's expectation.
- Tabs in container prefixes (`-\t`, `>\t`) are preserved verbatim in both
  the marker node and the corresponding `block_continuation` text — no
  normalization by the grammar, so the adapter's own tab-preservation
  logic (§5.3) is the only thing that will handle this.
- CRLF: a paragraph's own span (and its `inline` child's span) reproduces
  every interior `\r\n` pair verbatim, not just the last one — confirmed
  across a 3-line block-quoted paragraph. `paragraph.endPosition` lands
  one row *past* the last content row (column 0 of the following line),
  i.e. it includes the trailing line terminator; building `parts[i]`'s end
  from "end of that source line's content, `\r` excluded" (as §5.2
  already specifies) is the correct approach, not the node's own
  `endPosition`.

**Extension defaults confirmed active in the release asset:** pipe tables
(`pipe_table` node, full header/delimiter-row/row structure), YAML front
matter (`minus_metadata`), TOML front matter (`plus_metadata`), and
strikethrough at least doesn't produce a block-level parse error (its
resolution is an inline-grammar concern we're deliberately not vendoring).
All four were open questions in §2.1; all four now verified rather than
inferred from the README.

**Setext heading exclusion (§3.3 item 3):** confirmed trivial —
`setext_heading`'s children are exactly `[paragraph, setext_h1_underline]`
(or `h2`), so `paragraph.parent.type === 'setext_heading'` is a complete,
correct exclusion check.

**Paragraph terminators:** a pipe table immediately following a text line
with no blank line between them correctly ends the paragraph at the table
boundary in the tree itself (`paragraph` node stops one row early,
`pipe_table` starts where it stops) — nothing for `discoverProse` to
special-case; the grammar already resolved it, which is the entire reason
this project chose a tree-sitter grammar Markdown adapter over
re-deriving CommonMark block structure from text.

**Real-corpus error-overlap rate (the Phase A gate's central number):**
parsing every `.md` file under this repo's own `docs/` (7 files, 732
paragraph nodes total) found **0 paragraphs overlapping an `ERROR`
node** — 0.00%. "Skip on parse error" is a footnote here, not the
experience, on ordinary hand-written documentation Markdown.

**Hard-break backslash nuance for §5.4, worth carrying into Phase C:** the
block grammar's `inline` node does tokenize backslashes individually as
leaf `\` nodes even without the vendored inline grammar (confirmed: an
escaped `\\` at line end produces two adjacent `\` leaves; a single
trailing `\` produces one) — informative, but not needed, since the raw
regex `/(?<!\\)\\$/` the plan already specifies gets both of these cases
right by itself. What it does *not* get right on its own: three or more
trailing backslashes, where CommonMark's actual rule is escape-pair
parity (an odd trailing run ends in one real, unescaped backslash = hard
break; an even run doesn't), not "is the immediately preceding character
a backslash." The plan's regex only looks one character back. Not a
Phase A blocker — no fixture in this repo's own corpus exercises it — but
flag it explicitly for the Phase C hard-break implementation and give it
a fixture there (count the trailing backslash run's length and use its
parity, rather than the single-character lookbehind as written).

## Finding 8: `tree-sitter-latex` (built from `@pfoerster/tree-sitter-latex@0.6.0`) — wasi-sdk auto-download works on Windows, several new node shapes, zero errors on a real document

Probed via `docs/spikes/tree-sitter-latex-probe.mjs`, Phase A commit 2
of the Markdown/LaTeX support work.

**The build.** `npm pack @pfoerster/tree-sitter-latex@0.6.0` produced a
tarball matching every value the plan recorded in advance: `gitHead
7e0ecdc02926c7b9b2e0c76003d4fe7b0944f957` (the `v0.6.0` tag), shasum
`a51fd660b8f17b4619457e0570df5bc759d589ff`, and a 43.9 MB `src/parser.c`
already present (no `generate` step needed). `npx --package
tree-sitter-cli@0.26.13 tree-sitter build --wasm <extracted dir> -o
tree-sitter-latex.wasm` **succeeded on this Windows machine on the first
try** — this was the single biggest open question in the plan (§2.2/§3.1:
no `emcc`/Docker/cargo/`tree-sitter` on `PATH`, wasi-sdk auto-download
"the path to test first"). It downloaded `wasi-sdk-29.0-x86_64-windows`
(≈510 MB, ~30s on this connection) to
`%LOCALAPPDATA%\tree-sitter\wasi-sdk`, extracted it, and compiled
`parser.c` + `scanner.c` straight through with no further intervention.
**The `.github/workflows/grammar-wasm.yml` Linux-builder fallback (§3.1)
is not needed** — noted here so it isn't built speculatively; add it only
if a future machine's wasi-sdk download actually fails.

**Output size — the other open question.** The resulting
`tree-sitter-latex.wasm` is **3,710,264 bytes (3.54 MB)** — despite the
43.9 MB `parser.c` input, this lands in the same range as the already-
vendored `tree-sitter-cpp.wasm` (3.4 MB), not the "several MB, maybe much
larger" the plan flagged as a risk. sha256:
`4178504425e5576092735bed9190f2bf5f127ba3573988c016e086ae76d01855`. Grammar
ABI: `14` (same as C++/Java/TypeScript's — inside `web-tree-sitter@0.26.13`'s
supported `[13, 15]` range). `Language.load()` took ~11 ms on this
machine, and a second parse of the same content dropped to ~0.1 ms —
ordinary JIT/instantiate warmup, nothing unusual for a WASM module this
size.

**No release attestation exists for this grammar (confirmed, matching
§2.1's advance finding):** `latex-lsp/tree-sitter-latex`'s GitHub releases
attach no assets at all, so there is nothing to attest either — this
`.wasm` is *self-built* provenance (npm tarball hash + pinned CLI version
+ pinned wasi-sdk version + this build's own output hash), which
`PROVENANCE.md`/`SECURITY.md` need to record as a different trust story
from the Markdown asset's GitHub-attested one, exactly as §3.1 specifies.

**§6.1/§6.2 node shapes, all probed directly:**

- `\\` parses as a `generic_command` whose `command_name` text is the
  literal two-character string `\\` — confirmed, not a dedicated node
  type, resolving the plan's one **verify** item here.
- Environment classification: `align`, `equation`, `gather`, `multline`,
  `displaymath`, and `math` all arrive as `math_environment` — exactly
  Rewrap's own preserved-environment list, and exactly the plan's
  prediction. `alltt`, `tabular`, `tikzpicture`, `abstract`, and
  `itemize` arrive as `generic_environment`. `verbatim` gets its **own**
  dedicated `verbatim_environment` node type, not `generic_environment`
  — worth being explicit about in the Phase D masking list rather than
  assuming it falls under the generic case.
- `generic_environment`'s `begin` field shape confirmed exactly as
  described: `begin.command` → `\begin`, `begin.name` →
  `curly_group_text` (text *includes* the braces, e.g. `{myenv}` — strip
  them when comparing environment names), `begin.options` →
  `brack_group` when a `[...]` is present.
- `line_comment` on CRLF input: the comment node's own text never
  includes a trailing `\r`, confirmed across both a single comment line
  and two consecutive CRLF comment lines — the grammar's `%[^\r\n]*`
  regex behaves exactly as advertised, so `trimTrailingCR` is confirmed
  to be a no-op for this adapter, not merely assumed.
- `enum_item`'s `command`/`label` fields confirmed: `command` → the
  `\item` node; `label` → the `brack_group_text` node (`[label]`,
  brackets included) when present, absent otherwise.
- **Sectioning node extent — the one the plan called out as
  load-bearing:** confirmed the section node's span *does* include its
  entire body (through the next same-or-higher-level sectioning command),
  not just its header line. A two-paragraph body separated by a blank
  line inside one `\section{...}` parsed as a single flat `text` node
  spanning both paragraphs *with the blank line inside it* — there is no
  paragraph-level node anywhere in this grammar, confirming §1's claim
  that LaTeX paragraph boundaries must come from a source-line scan, not
  the tree, with the tree supplying only spans to mask out.
- **New node type the plan didn't anticipate:** `\newtheorem{name}[counter]{text}`
  parses as its own dedicated `theorem_definition` node, not a generic
  `generic_command` — one more example (alongside `enum_item`,
  `block_comment`, the environment family) of this grammar giving
  semantically-named nodes to common macros rather than leaving
  everything as `generic_command`. Doesn't change anything in the plan
  (whole-line-command detection is line-scan-based per §6.2 regardless),
  but worth knowing the commandRegex-vs-tree fallback in §6.2 ("when the
  regex and the tree disagree, prefer the tree's `generic_command`/
  sectioning node extent") needs to check for other named command nodes
  too, not just assume unrecognized commands are always `generic_command`.
- Nested braces resolve correctly through the tree:
  `\section{Title with \emph{nested} braces}` parses with the inner
  `\emph{nested}` as a proper nested `generic_command` inside the
  section's `curly_group`, confirming the tree — not a brace-counting
  regex — is the right tool when §6.2's `commandRegex` and the tree
  disagree.
- **`\verb`/`\lstinline` are genuinely unprotected by this grammar** —
  confirmed, not merely assumed: `\verb|some code here|` parses as an
  ordinary `generic_command` (`\verb`) followed by plain `text`/`word`
  nodes, with the verbatim content fragmented at its internal spaces
  exactly like ordinary prose. §4.3's `extraUnbreakable` regex for
  `\verb`/`\lstinline` is therefore load-bearing, not defensive — without
  it, a reflow could legally split verbatim content and change what it
  typesets to.
- **`\par` has no special tree signal** — confirmed: alone on its own
  line, `\par` parses as an ordinary `generic_command` embedded inside
  the same flat `text` run as the surrounding prose, with no paragraph
  break of any kind in the tree. §6.2's line-scan-based
  structural-line detection is doing all the real work here; the tree
  contributes nothing extra for this case.
- **Trailing `%` comment mid-line — the one real semantic hazard (§6.4)**
  confirmed handled correctly by the grammar: `aaa bbb % note` produces a
  `line_comment` node as a sibling *within* the same flat `text` node,
  positioned exactly at the `%` column, with `more text` on the next
  source line resolving to ordinary `word` nodes after it (not swallowed
  into the comment). The companion escaping case also confirmed:
  `\%` produces **zero** `line_comment` nodes (it parses as a
  `generic_command` named `\%` instead) — this is the exact case Rewrap's
  own `[^\\]%` regex is documented to get wrong, and the grammar gets it
  right for free, which is the whole argument in §6.2 for using
  `line_comment` node spans rather than reimplementing TeX's `%`-lexing.
- `$…$` parses as `inline_formula` with real internal structure
  (`superscript`, `operator`, nested `text`/`word`), not opaque raw text;
  `\[…\]` and `$$…$$` both parse as the **same** `displayed_equation`
  node type, simplifying the Phase D masking list (one type covers both
  shortcut forms, not two).

**Environment classification, completed for §6.2's full preserve-list
candidates** — probed via `docs/spikes/tree-sitter-latex-probe2.mjs`,
following up on the subset above with every remaining name §6.2 needed
classified before commit 15 could write the mask list. Two results the
plan's own draft got wrong (verify, don't assume, paid off again here):

- `lstlisting` gets its **own** dedicated `listing_environment` node type
  — but plain `listing` (no `lst` prefix) does not; it falls through to
  `generic_environment` like the rest of the unnamed cases. §6.2's mask
  list needs `listing_environment` as an always-mask type *and*
  `lstlisting`'s absence from the generic preserve-list (it's never
  reached as `generic_environment` at all), while plain `listing` needs
  adding to the preserve-list explicitly if it's meant to be masked too.
- `array` classifies as `math_environment`, not `generic_environment` —
  so it's already covered by the "always mask `math_environment`" rule
  and needs no separate preserve-list entry, contrary to the plan's
  draft list which named it alongside `tabular`/`tikzpicture` as if it
  needed one.
- `comment` (the `comment` package's environment, distinct from `%`
  line comments) gets its own dedicated `comment_environment` node, as
  the plan predicted.
- `minted` (the `minted` package's syntax-highlighted listing
  environment) produces an **`ERROR`** node, not `minted_environment` —
  no such node type exists in this grammar at all, `\begin{minted}` (with
  or without the package's required language argument) simply fails to
  parse as a recognized environment. This needed no special-casing in the
  end: `wrap.ts` already skips any region overlapping an `ERROR` node
  unconditionally, so `minted` content is protected by that generic
  mechanism rather than needing its own mask-list entry — but it does
  mean `minted_environment` must **not** appear in commit 15's mask-type
  list (referencing a node type that doesn't exist would either be dead
  code or, worse, silently match nothing while looking like it does
  something).
- `Verbatim`, `BVerbatim`, `alltt`, `tikzpicture`, `tabular`, `tabular*`,
  `tabularx`, `itemize`, `abstract` all confirmed `generic_environment`,
  exactly as the plan expected — these are the names that actually need
  the descriptor-declared preserve-list (`itemize`/`abstract` deliberately
  excluded from it, per §6.2's own worked example).

**Trailing-`\r` and `\%`-escaping re-confirmed for commit 14's descriptor**
— probed a second time, independently, via
`docs/spikes/tree-sitter-latex-probe3.mjs`, specifically against the
`latexDescriptor`/`latexAdapter` commit 14 actually shipped (not just the
grammar in the abstract): a `line_comment` node on a CRLF-terminated line
still never includes the trailing `\r` (`trimTrailingCR` confirmed a
no-op), and `\%` still produces zero `line_comment` nodes and zero
`ERROR` nodes. Both match Finding 8's original probe above exactly — kept
as a second, independent confirmation specifically because two of this
session's LaTeX probe scripts (see `-probe2.mjs`'s and `-probe3.mjs`'s own
header comments) had to be rewritten after a shell-tooling bug corrupted
literal backslashes in an earlier heredoc-authored version, and re-deriving
"already known" facts from the corrected script was the cheapest way to
confirm the corrected script itself was trustworthy before relying on its
*new* findings above.

**Every sectioning command's node type name, and header-vs-body extent —
completed for commit 15's structural-line detection** — probed via
`docs/spikes/tree-sitter-latex-probe4.mjs`, filling the one gap Finding
8's original probe left (only `section`/`subsection` had been directly
exercised):

- `part`, `chapter`, `subsubsection`, `paragraph`, and `subparagraph`
  each get their own node type, named identically to the command
  (`\chapter{...}` → a `chapter` node, etc.) — the same
  `[command, curly_group, text]` three-child shape `section`/`subsection`
  already confirmed, extended to the full set. Worth flagging by name:
  LaTeX's `\paragraph{...}` sectioning command produces a node type
  literally called `paragraph` — an unrelated, same-named node type from
  the *Markdown* adapter's very different `paragraph` (a prose block);
  the two grammars are never loaded into the same tree, so this is a
  naming coincidence with no runtime collision, but worth a comment where
  LaTeX's `SECTIONING_NODE_TYPES` list is defined so a future reader
  doesn't assume a connection that isn't there.
- A starred sectioning command (`\section*{...}`) keeps the same node
  type (`section`) — the `*` lives inside the command token's own text
  (`'\section*'`), not a distinct node shape, so no separate starred
  entries are needed anywhere this grammar's node types are matched.
- **The header-vs-body extent question, resolved concretely:** a
  sectioning node's title (`children[1]`, the `curly_group`) ends exactly
  where the visible title text ends — confirmed on
  `\section{Title with \emph{nested} braces}`, where the title group's
  own `endPosition.column` (41) exactly equals the full line's length
  (41), even though the *node's own* `endPosition` (per the finding
  above) extends through the entire body that follows. This is what
  makes commit 15's tree-based structural-line fallback possible at all:
  the title-group's own end position is a reliable "header ends here"
  signal that's genuinely independent of how much body content follows,
  where the sectioning node's own `endPosition` is not.
- `generic_command`'s own extent needs no such header/body split:
  confirmed directly (`\maketitle`, `\newpage`, `\clearpage`, `\noindent`,
  each alone on a line) that a bare command's node ends exactly at its
  own command text, with no trailing-body absorption of any kind — only
  sectioning commands have that behavior.
- `enum_item`'s `label` field, on a real two-item list with one labeled
  and one unlabeled `\item`, confirmed exactly as Finding 8's original
  probe predicted: `command` end lands right after `\item` (column 5 on
  `\item First item text.`), and a present `label` is a
  `brack_group_text` node (`[custom]`, brackets included) ending right
  after its own closing `]`.
- `\[ ... \]` display math (a second confirmation, this time spanning
  multiple lines with real content between the delimiters) parses as a
  single `displayed_equation` node whose row range covers the opening
  `\[` line through the closing `\]` line inclusive — exactly the row
  range commit 15's mask-building needs.

**`\label{...}` is its own dedicated `label_definition` node type, not
`generic_command`** — found while fixing a real gap post-review in
`discoverLatexProse`'s structural-line detection (`-probe5.mjs`): a
`\section{Title}\label{sec:foo}` header — chained structural commands on
one line, one of the most common idioms in real LaTeX — was originally
swallowed whole into a `'prose'` region, because the original single-shot
"does the whole line match one `\command{args}`" check had no concept of
a *chain*, and its tree fallback only ever looked up
`generic_command`/`theorem_definition`/sectioning nodes, none of which
`\label` turned out to be. Confirmed the section node's own children gain
a `label_definition` sibling when a `\label{...}` immediately follows
(`children = ['\section', curly_group, label_definition, text]`, one more
than the plain `[command, curly_group, text]` shape every earlier probe
exercised) — the title `curly_group` stays `children[1]` regardless, so
this didn't change how the *title's own* extent is found, only added a
new node type discovery's chain-walker needed to recognize (or, since
`\label{...}` has no nested-brace argument in practice, simply fall
through to the regex for). Also confirmed the identical
`label_definition` shape appears as a plain, unnamed child of `enum_item`
for `\item \label{...} text` — a related, still-open gap: item rows
currently skip structural-line detection entirely (by design, since
`\item` itself always starts a new region), so a `\label{...}` chained
right after `\item` is not yet excluded from that item's own discovered
prose text.

**An unterminated `\begin{...}` produces a genuine `ERROR` node — no
graceful recovery, unlike `tree-sitter-markdown`'s fenced code block** —
found while writing commit 18's own hardening test for exactly this
input shape and confirmed with a dedicated probe
(`docs/spikes/tree-sitter-latex-probe7.mjs`) rather than assumed from
precedent: `tree-sitter-markdown`'s unterminated code fence extends
gracefully to end of file with zero parse errors (Finding 7's own
unterminated-fence case), but this grammar's `\begin{...}` with no
matching `\end{...}` — tried for `verbatim` specifically and for an
ordinary `itemize` too, both alike — produces a real top-level `ERROR`
node wrapping everything from the `\begin` onward, with the recovered
`begin` field still cleanly typed underneath it but everything after
swallowed into either an `enum_item`/`comment`-typed placeholder or
plain unstructured content depending on shape. Not a problem for
`discoverLatexProse` in practice: nothing here needs the environment's
row range to *mask* an unterminated construct specifically, since
`wrap.ts`'s existing generic "region overlaps a parse `ERROR`" skip
already protects any `'prose'` region discovery finds inside it — the
same mechanism protecting every other adapter's own unparseable input,
confirmed directly by `../../test/hardening/latex-pathological-input.test.ts`'s
own dedicated case for this. Worth recording as its own finding because
the *shape* of the safety net differs from the common case (skip via
`ERROR` overlap, not exclusion via row masking) in a way a future reader
extending the mask list might otherwise assume incorrectly.

**Error rate and performance on real content:** `latex-lsp/tree-sitter-latex`'s
own `examples/texlab.tex` (2,584 bytes, a real README-style project
document with packages, sectioning, links, and inline macros) parsed with
**zero** `ERROR`/missing nodes in 13.3 ms. A synthetic 129,200-byte
document (that file repeated 50×) also parsed with zero errors, in 39.8 ms
— performance scales roughly linearly over this range, nothing
pathological observed. This is one file, not the broader real-corpus
check §8.4 calls for against multiple real papers (that's explicitly
Phase D work), but it's a clean data point for the Phase A gate: nothing
here suggests the grammar chokes on ordinary, non-adversarial LaTeX.
