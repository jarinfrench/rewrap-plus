# Language coverage: competitor gap analysis

Scoping investigation, not implementation. Answers one question: what
would it take to bring Rewrap+'s language coverage up to what stkb/Rewrap
and Rewrap Revived (dnut's fork) already ship, and which of the gap
languages are actually worth doing next. No adapter code, no new grammars
vendored under `grammars/` — this file is the only artifact this pass
produced; every probe script that generated its evidence was written to a
scratch directory outside the repo and discarded, per this project's
"probe before coding" convention (`docs/parsing.md`'s original Python
spike, `docs/adapters.md`'s canary spikes).

## Pass 1 — the actual target list

Sourced from `core/Parsing.Documents.fs` in `stkb/Rewrap` (`stable` branch,
pinned to the commit current as of this investigation), which is the real
language registry — the marketplace README and docs site only describe a
"Content Types" subset that needs dedicated spec pages, not the full
supported set. `dnut/rewrap` (Rewrap Revived) forks the same F# core; its
`CHANGELOG.md` shows exactly two languages added on top of stkb's base:
**Zig** (17.9) and **CUDA C++** (17.10), confirmed directly against
`core/Parsing.Documents.fs` on the `dnut/rewrap` `master` branch.

Combined competitor set: **76 languages** (74 from stkb + Zig + CUDA C++).

Already shipped by Rewrap+ (`packages/engine/src/languages/`): Python,
JavaScript, TypeScript/TSX, C++, Java, Markdown, LaTeX (7).

Already named in the implementation plan (12b/12c/12f, not yet all
shipped): JS/TS full (shipped), C++ (shipped), Java (shipped, ahead of
schedule), Rust, Go, Ruby (12f, not yet shipped).

**Candidate set for this investigation** — competitor-supported, not
shipped, not already planned (66 languages):

AsciiDoc, AutoHotkey, Basic (VB), Batch file, Bikeshed, C#, Clojure, CMake,
CoffeeScript, Common Lisp, Configuration/properties, Crystal, CSS, CUDA
C++, D, Dart, Dockerfile, Elixir, Elm, Emacs Lisp, FIDL, Git commit,
GraphQL, Groovy, HCL/Terraform, Handlebars, Haskell, INI, J, JSON, Julia,
Lean, Less, Lua, Makefile, MATLAB, Objective-C, Octave, Pascal/Delphi,
Perl, PHP, PowerShell, Prisma, Prolog, Protobuf, Pug/Jade, PureScript, R,
SCSS, SQL, Scala, Scheme, Shaderlab, Shell script, Swift,
Tcl, Textile, TOML, Verilog/SystemVerilog, XAML, XML, YAML, Zig,
reStructuredText, HTML (+erb/svelte/vue aliases).

## Pass 2 — grammar availability spike

### Method

For each candidate: check the npm registry for a `tree-sitter-<lang>`
package (or its real name, when the literal name is squatted by an npm
security placeholder — `0.0.1-security` with no real content, several hit
this); if found, `npm pack` + extract and check for a prebuilt `.wasm` at
the package root (the pattern every currently-vendored grammar except
Markdown and LaTeX follows). If no prebuilt `.wasm` but the tarball ships a
generated `src/parser.c`, build one locally with `tree-sitter build --wasm`
pinned to this project's own `tree-sitter-cli@0.26.13` (the exact path
`tree-sitter-latex.wasm` was vendored through — see `PROVENANCE.md`). Then
actually load the result with this project's pinned `web-tree-sitter@0.26.13`
and parse a representative snippet — package existence and a `.wasm` file
existing are not the same as a working parse, and the two languages below
that failed to load prove why that check matters.

A representative-snippet parse was run for 13 candidates — the shortlist
justified in Pass 4 as worth spending real probe time on. The remaining 53
were checked at the registry/tarball level only (does a real, current
grammar package exist; does it ship a `.wasm` or the buildable-from-source
equivalent) — not dry-run parsed. Flagged as such throughout; treat their
descriptor-fit tier in Pass 3/4 as provisional.

### Full parse-probed (13)

| Language | Package | WASM path | Result |
|---|---|---|---|
| C# | `tree-sitter-c-sharp@0.23.5` | prebuilt at root | Parses clean. `abiVersion 15`. |
| Shell script (Bash) | `tree-sitter-bash@0.25.1` | prebuilt at root | Parses clean. `abiVersion 15`. |
| PowerShell | `tree-sitter-powershell@0.26.4` | prebuilt at root | Parses clean. `abiVersion 15`. |
| TOML | `tree-sitter-toml@0.5.1` | built locally (`--wasm`, ships `src/parser.c`, C only) | Parses clean. `abiVersion 13`. No Emscripten/Docker needed — same as the LaTeX vendoring. |
| YAML | `tree-sitter-yaml@0.5.0` | built locally — **fails to load** | See Finding Y below. |
| JSON | `tree-sitter-json@0.24.8` | prebuilt at root | Parses clean, but see Finding J — strict JSON only, no comment support at all. |
| HTML | `tree-sitter-html@0.23.2` | prebuilt at root | Parses clean. `abiVersion 14`. |
| CSS | `tree-sitter-css@0.25.0` | prebuilt at root | Parses clean. `abiVersion 15`. |
| SCSS | `tree-sitter-scss@1.0.0` | built locally (`src/parser.c`, C only) | Parses clean. `abiVersion 14`. |
| PHP | `tree-sitter-php@0.24.2` | prebuilt at root | Parses clean. `abiVersion 15`. |
| Lua | `tree-sitter-lua@2.1.3` | built locally (`src/parser.c` + C `scanner.c`) | Parses clean. `abiVersion 13`. |
| SQL | `tree-sitter-sql@0.1.0` | built locally (`src/parser.c`, C only) | **Parses with errors** on a trivial `SELECT '...' FROM foo;`. See Finding S below. |
| Dart | `tree-sitter-dart@1.0.0` | prebuilt at root **fails to load**; rebuilt locally from the same tarball's `src/` — works | See Finding D below. |

All local builds used `npx --package tree-sitter-cli@0.26.13 tree-sitter
build --wasm <dir>`, pinned to match this project's `web-tree-sitter`
version — the exact command `PROVENANCE.md` documents for
`tree-sitter-latex.wasm`. None needed a `tree-sitter generate` step (every
package's tarball already ships a generated `src/parser.c`); none needed
Emscripten or Docker.

#### Finding Y — RESOLVED: a GitHub release asset ships a working prebuilt WASM

Building `tree-sitter-yaml`'s C++ external scanner from the npm tarball's
source still fails exactly as originally found: `tree-sitter build --wasm`
completes without a fatal error and produces a 163 KB file, but loading it
with `web-tree-sitter@0.26.13`'s `Language.load` throws `Error: bad export
type for 'tree_sitter_yaml_external_scanner_create': undefined` — the
wasi-sdk toolchain the CLI auto-downloads is C-only and doesn't correctly
link the C++ scanner. A different WASI-target C++ toolchain was **not**
investigated further, because the second question this finding raised —
whether a prebuilt exists from a source other than the npm tarball —
resolved the whole question on its own and made the toolchain path moot.

`tree-sitter-yaml`'s real upstream has moved to the `tree-sitter-grammars`
org (the same publisher Markdown's `.wasm` was originally sourced from).
That org's GitHub repo (`tree-sitter-grammars/tree-sitter-yaml`) publishes
a prebuilt `tree-sitter-yaml.wasm` as a release asset on every tagged
release — confirmed on the latest, `v0.7.2` (2025-10-07):
`https://github.com/tree-sitter-grammars/tree-sitter-yaml/releases/download/v0.7.2/tree-sitter-yaml.wasm`,
189 KB. Downloaded directly and loaded with this project's pinned
`web-tree-sitter@0.26.13`: loads cleanly, `abiVersion 14`, and parses a
representative sample (a `#` comment, a block mapping, a block sequence,
and a `|` block scalar) with `hasError: false`.

**Conclusion: resolved.** A future adoption pass should vendor this
release-asset `.wasm` directly (the same sourcing pattern already used for
Markdown), documented in `PROVENANCE.md` with the release tag, asset URL,
and checksum — not attempt to build the C++ scanner from source, which
remains genuinely broken with this project's current toolchain.

#### Finding S — a second, more active SQL grammar exists; it's ANSI/Postgres-ready, not MySQL/T-SQL-ready

`m-novikov`'s `tree-sitter-sql` is not the only real generic SQL grammar on
npm. `@derekstride/tree-sitter-sql` (GitHub: `DerekStride/tree-sitter-sql`,
246 stars vs. m-novikov's 126, 14 published npm versions vs. one lone
`0.1.0`, and a commit as recent as 2026-09-03 vs. m-novikov's dormant
single release) is a second, actively-maintained "general/permissive SQL
grammar" per its own README, explicitly drawing on ANSI, PostgreSQL, and
SQLite references. Its tarball ships a plain-C `src/parser.c` +
`src/scanner.c` (no C++, unlike YAML above) — built locally the same way as
TOML/Lua/SCSS (`tree-sitter build --wasm`, pinned `tree-sitter-cli@0.26.13`,
no Emscripten/Docker), producing a working 2.4 MB `.wasm` (`abiVersion 14`
— notably larger than any grammar vendored so far, consistent with SQL's
broader surface area). No prebuilt `.wasm` ships in the npm tarball itself
(only via the project's `gh-pages` branch, per its own README), so this
would follow the "build locally from the tarball's C source" path, not the
"vendor a prebuilt" path.

Dialect-scoped dry run (a basic `SELECT` with a string literal and a
comment, plus each dialect's own idiomatic syntax), against this locally
built `.wasm` with the pinned `web-tree-sitter@0.26.13`:

| Dialect | Basic `SELECT` + string + comment | Dialect-specific syntax | Result |
|---|---|---|---|
| ANSI | Clean | — | `hasError: false` |
| PostgreSQL | Clean | `$1` positional placeholder, `::` cast | `hasError: false` |
| MySQL | Clean (`?` placeholder, `` `backtick` `` identifiers both parse) | `#`-style comment | **`hasError: true`** — `#` comments don't parse at all, standalone or trailing |
| T-SQL | Clean (`@p1` named parameter, `--` comment both parse) | `TOP N` clause, `[bracket]`-quoted identifiers | **`hasError: true`** — both constructs fail |

**Conclusion: better than m-novikov's grammar, but still dialect-incomplete
— not a clean adoption yet.** m-novikov's package failed on literally the
most basic SQL statement; this one handles ANSI and PostgreSQL cleanly,
including PostgreSQL-specific placeholder and cast syntax. But it does not
know MySQL's `#` comment convention or T-SQL's `TOP`/`[bracket]` syntax at
all — real, confirmed gaps, not smoke-test noise. A real adoption decision
still needs a scope call this pass can't make on its own: if this
project's SQL support only needs to cover ANSI/Postgres-flavored SQL, this
grammar is usable today; if MySQL or T-SQL idioms matter, it isn't, and no
further npm search in this pass turned up a third generic-SQL grammar
covering that gap (dialect-specific packages exist — e.g. BigQuery, SQLite
— but narrowing to a single non-ANSI dialect is a different scope decision
than "generic SQL," and wasn't evaluated here).

#### Finding D — a prebuilt WASM that fails to load is a real, recurring hazard, not a one-off

`tree-sitter-dart`'s npm-published `tree-sitter-dart.wasm` (prebuilt at the
package root, same as C#/Bash/HTML/CSS/PHP/JSON) throws a `dylink metadata`
error on load with this project's pinned `web-tree-sitter@0.26.13` — the
exact hazard `PROVENANCE.md`'s LaTeX entry already named as a *possibility*
("a CLI/runtime version mismatch can emit a dynamic-linking format the
runtime can't load even when the ABI number is supported") but that no
grammar vendored so far had actually hit. Rebuilding from the same
tarball's `src/parser.c`/`src/scanner.c` with the project's pinned
`tree-sitter-cli@0.26.13` fixed it immediately (`abiVersion 14`, parses
clean). **Consequence for future vendoring: "ships a prebuilt `.wasm`" is
not sufficient evidence on its own — it must be loaded with this project's
actual pinned `web-tree-sitter` version before being trusted, the same way
`docs/parsing.md`'s "prebuilt or build-it-yourself" question already
established per-grammar checking is necessary; this extends that finding
to "prebuilt and loadable" as two separate things to verify, not one.**

#### Finding J — RESOLVED: the original premise was wrong — `tree-sitter-json` already handles JSONC

The original finding's claim that `tree-sitter-json` parses strict JSON
only, with zero comment support by design, does not hold for the exact
version this project's own Pass 2 already dry-run parsed
(`tree-sitter-json@0.24.8`). Its upstream `grammar.js` has included
`comment` (both `//` line and `/* */` block forms) as an `extras` rule
since a commit titled "Allow comments" landed **2022-04-21** — over two
years before this project's own probe ran the package. That probe parsed
clean, but only because it never actually fed the grammar a comment; strict
JSON was never a reason it *couldn't* handle JSONC.

Reloading the exact `tree-sitter-json@0.24.8` tarball with this project's
pinned `web-tree-sitter@0.26.13` and parsing a representative JSONC sample
(`//` line comment, `/* */` block comment, a trailing `//` comment, and a
`"http://..."` string value that must *not* be misread as a comment)
produces `hasError: false` across the board — including the exact
string-vs-comment ambiguity a real JSONC implementation has to get right,
which upstream itself had already hit and fixed
(`Fix `//` in string literal is parsed as comment token`, 2022-05-13,
PR #24).

Independent confirmation: `tree-sitter-json`'s own upstream repo has an
open issue (#59, "JSONC support") from the maintainer of the unrelated
`tree-sitter-jsonc` project, stating that `tree-sitter-json` now fully
subsumes JSONC and that they intend to deprecate their own fork because of
it — with an open, unmerged PR (#60) to update the README to say so
explicitly ("JSON and JSONC grammar for tree-sitter"). No separate
`tree-sitter-json5`/JSONC-variant package is needed; the grammar already in
hand covers it.

**Conclusion: resolved, no sourcing gap.** Comment shape: a single lumped
`comment` node type for both `//` and `/* */` — the same already-solved
text-sniffing pattern this project used for JS/C#/PHP, not a new problem.
A "JSON" descriptor built on the already-vendored-and-tested
`tree-sitter-json@0.24.8` would cover JSONC out of the box; no further
grammar sourcing is required for this finding.

### Registry-checked only (53) — not dry-run parsed

Existence and shipped-artifact-shape checked via `npm view` /
`npm pack --dry-run` against the real package name (the literal
`tree-sitter-<lang>` name, when it wasn't itself a security placeholder).

**Prebuilt `.wasm` confirmed at package root** (same low-risk vendoring
path as the shipped languages): Scala (`tree-sitter-scala@0.24.0`), Swift
(`tree-sitter-swift@0.7.1`), Elixir (`tree-sitter-elixir@0.3.5`), Haskell
(`tree-sitter-haskell@0.23.1`), Clojure (`tree-sitter-clojure@0.4.0`),
Common Lisp (`tree-sitter-commonlisp@0.4.1`), Elm (`tree-sitter-elm@4.5.0`),
GraphQL (`tree-sitter-graphql@1.0.0`), Makefile (`tree-sitter-make@1.1.1`),
XML (`tree-sitter-xml@1.0.0`), Verilog/SystemVerilog
(`tree-sitter-verilog@1.0.0`), Objective-C (`tree-sitter-objc@3.0.2`), Perl
(`tree-sitter-perl@2.0.0`), Pug/Jade (`tree-sitter-pug@1.0.12`),
reStructuredText (`tree-sitter-rst@0.2.0`), Zig (`tree-sitter-zig@0.2.0`),
Vue-flavored HTML (`tree-sitter-vue@0.2.1`), Svelte-flavored HTML
(`tree-sitter-svelte@0.11.0`), ERB-flavored HTML
(`tree-sitter-embedded-template@0.25.0`), Groovy (`tree-sitter-groovy@0.1.2`),
Scheme (`tree-sitter-scheme@1.0.0`), Emacs Lisp
(`tree-sitter-elisp@1.7.2`), MATLAB (`tree-sitter-matlab@1.0.17`), Julia
(`tree-sitter-julia@0.23.1`), Batch file (`tree-sitter-batch@0.11.1`),
Pascal/Delphi (`tree-sitter-pascal@0.0.1`), Prolog
(`tree-sitter-prolog@1.1.0`), D (`tree-sitter-d@0.8.2`), Handlebars
(`tree-sitter-handlebars@0.1.1`), CUDA C++ (`tree-sitter-cuda@0.21.1` —
see the CUDA C++ note in Pass 3), HCL/Terraform
(`@tree-sitter-grammars/tree-sitter-hcl@1.2.0` — the unscoped
`tree-sitter-hcl` name is an npm security placeholder; the real package
moved to the `@tree-sitter-grammars` org, the same publisher Markdown's
`.wasm` release asset came from).

**Real package exists but is a single-maintainer/unofficial fork, not an
org-backed grammar** (higher trust-story risk, same category this
project's `SECURITY.md` already treats LaTeX's self-built provenance as a
*different*, not lesser, trust story — these would need the same level of
scrutiny before vendoring): R (no real `tree-sitter-r`; two live
alternatives, `@davisvaughan/tree-sitter-r@1.3.0` and
`@eagleoutice/tree-sitter-r@1.1.2`, neither the upstream `r-lib` org).

**`npm view` 404s on the literal name and no plausible real name found in
this pass** (would need its own naming/sourcing investigation before a
grammar-availability verdict is even possible): CMake, Protobuf,
AsciiDoc, PureScript, Tcl, Crystal, CoffeeScript, AutoHotkey, INI (as
distinct from `tree-sitter-properties`'s Java `.properties` dialect, which
exists but is a different comment/section-header syntax than classic INI),
Dockerfile (unscoped name is a security placeholder; unlike HCL, no
`@tree-sitter-grammars` scoped replacement was found), Prisma (unscoped
`tree-sitter-prisma-io` 404s; the real package name wasn't tracked down in
this pass).

**Not checked at all this pass** (niche enough, per Pass 4's priority
reasoning, that spending registry-lookup time on them wasn't worth it
ahead of a real prioritization decision): Bikeshed, FIDL, J, Lean,
Shaderlab, Textile, XAML, Octave, Less (near-certain to exist and be
trivial — CSS-family — given `tree-sitter-css`/`tree-sitter-scss` both
confirmed clean), Configuration/properties (partially covered — see
`tree-sitter-properties` above), Git commit (trivial — Rewrap itself just
treats it as Markdown, no dedicated grammar needed).

## Pass 3 — descriptor-fit assessment

Only for the 13 parse-probed candidates, since a descriptor-fit call for
comment/string *node shape* needs an actual grammar, not just a syntax
description. The registry-checked-only 53 get a syntax-knowledge-based
provisional tier in Pass 4 directly, explicitly marked provisional.

Every one of the 13 hits the same recurring gap this project has already
named twice (JS/TS's `${}` interpolation, deferred; Java's text blocks,
deferred as a scope limit) a **third+ time**: interpolated strings.
`strings.escapes`/`strings.placeholders` in `LanguageDescriptor`
(`packages/engine/src/types/adapter.ts`) can express literal escape/format
patterns, but not "this substring is itself a nested expression with its
own internal syntax" — the same reason template literals were deferred in
12b. Every candidate below with interpolated strings inherits that same
deferred status rather than a fresh problem.

- **C#** — Comments: single lumped `comment` node type for `//`, `/* */`,
  *and* `///` XML doc alike (the JS/PHP hazard, not the Java one — text
  sniffing needed, already-solved shape). XML doc (`///` triple-slash,
  `<summary>`/`<param>` XML tags, not a tag-list dialect like
  JSDoc/Doxygen/Javadoc) doesn't fit any existing `DocDialectId` —
  genuinely needs a new one. Strings: `"..."` (backslash escapes),
  interpolated `$"..."` (deferred-shape problem above), verbatim
  `@"..."` with `""`-doubling instead of backslash escaping for embedded
  quotes — `EscapeSpec`'s `RegExp`-sequence model assumes backslash-led
  escapes; a doubling convention doesn't fit it as-is. Concatenation: `+`
  operator, matches existing precedent. **Tier: comment-only is pure
  descriptor + fixtures (once a new `xmldoc` `DocDialectId` exists);
  full string support needs engine changes (interpolation, and a
  doubling-escape shape `EscapeSpec` doesn't cover).**

- **Shell script (Bash)** — Comments: single `#` line form, no block, no
  doc dialect — as simple as Python's, minus the docstring convention.
  Strings: `"..."` (interpolated — deferred-shape problem), `'...'` (fully
  raw, no interpolation, fits `QuoteSpec` cleanly), heredocs
  (`<<'MARKER' ... MARKER`) — a genuinely different construct with no
  fixed open/close delimiter (the marker is caller-chosen) and
  multi-line-by-construction; doesn't fit `QuoteSpec` or `RawFormSpec`
  (both assume a fixed delimiter pair) at all. No concatenation operator —
  Bash uses juxtaposition, which isn't `'implicit'` in the Python/C++
  sense (no parens-grouping convention either) or `'operator'`. **Tier:
  comment-only is pure descriptor + fixtures, trivial, real precedent
  (Python's own `#`-line-only shape); full string support needs engine
  changes (heredocs don't fit either string-literal shape; concatenation
  style has no existing match).**

- **PowerShell** — Comments: `#` line, `<# #>` block, and comment-based
  help (`.SYNOPSIS`/`.DESCRIPTION`/`.PARAMETER` tags inside a `<# #>`
  block) — a real, distinct doc convention, structurally closer to a
  tag-list dialect than XML doc is, but with `.Tag` syntax no existing
  `DocDialectId` covers — needs a new one. Strings: `"..."` (interpolated,
  `$var`/`$($expr)` — deferred-shape problem, doubly so since `$(...)`
  subexpression syntax is richer than JS's `${}`), `'...'` (raw, fits
  cleanly), here-strings (`@"..."@`/`@'...'@`, multi-line, fixed
  three-character-ish delimiters unlike Bash's caller-chosen marker) — closer
  to `RawFormSpec` shape than Bash's heredocs, plausibly fits with a
  multi-line allowance, but not verified against the actual grammar node
  shape in this pass. **Tier: comment-only likely needs a new
  `DocDialectId` (comment-based help) but is otherwise pure descriptor;
  full string support needs engine changes (interpolation) and has one
  string shape (here-strings) whose descriptor fit is genuinely
  uncertain rather than a known gap.**

- **TOML** — Comments: single `#` line form, no block, no doc dialect —
  identical shape to Bash's, pure descriptor, trivial. Strings: `"..."`,
  `'...'` (both fit `QuoteSpec` cleanly), and triple-quoted multi-line
  `"""..."""`/`'''...'''` — syntactically identical in shape to Python's
  triple-quoted strings, but a TOML multi-line string is a data value, not
  prose or a docstring; wrapping it at all is questionable (same reasoning
  that makes YAML block scalars non-reflowable by default, below) —
  reasonably scoped out rather than solved. **Tier: comment-only is pure
  descriptor + fixtures, trivial, and — given this project's own
  `pyproject.toml [tool.rewrap-plus]` config precedent
  (`CLAUDE.md`) — directly dogfoodable. Full string support is a
  scope question (should TOML string *values* ever be reflowed?) more
  than an engine-capability question.**

- **YAML** — Grammar didn't load this pass (Finding Y) — full assessment
  blocked on resolving that first. Structurally, YAML's comments are a
  single `#` line form (pure descriptor, trivial, same shape as
  TOML/Bash). YAML's "strings" are better modeled as `'prose'` regions
  (Markdown's region kind) than `'stringLiteral'` ones — plain/quoted
  scalars are freeform text, and block scalars (`|`/`>`) are explicitly
  meant to preserve or fold line structure in ways reflowing could change
  data meaning, the same reasoning TOML's multi-line strings raise above,
  but sharper (a YAML block scalar's exact newlines can be semantically
  significant). **Tier: comment-only is pure descriptor + fixtures once
  Finding Y is resolved; full scalar support is a scope question, likely
  "don't," not an engine gap.**

- **JSON** — See Finding J: the grammar that's actually available doesn't
  parse the dialect (JSONC) anyone would actually want wrapped. **Tier:
  blocked on sourcing, not descriptor-fit — flagged, not scored.**

- **HTML** (+ erb/svelte/vue aliases) — Comments: single `<!-- -->` form,
  no block/doc distinction, pure descriptor, trivial — matches Rewrap's
  own choice to give all four aliases identical treatment. No
  string-literal concept (attribute values aren't string literals in the
  code sense) — same "omit `strings` and `queries.strings` entirely"
  precedent Markdown/LaTeX already established for the `'prose'` region
  kind. Whether HTML text-node content itself should be a `'prose'`
  region (à la Markdown paragraphs) is a real scope question this pass
  didn't investigate — Rewrap's own choice (comment-only) suggests
  "no." **Tier: pure descriptor + fixtures, trivial, if scoped to
  comment-only like Rewrap's own choice.**

- **CSS** — Comments: single `/* */` block form, no line comment at all,
  no doc dialect — simpler than C++'s `plainBlock`-without-`block`
  case (C++ at least has `//`). Strings: `"..."`/`'...'`, no
  interpolation, no concatenation operator or implicit-adjacency
  convention (CSS doesn't concatenate string literals). **Tier: pure
  descriptor + fixtures, trivial, lowest-risk candidate in this entire
  pass.**

- **SCSS** — Comments: **two** node types, `js_comment` for `//` and
  `comment` for `/* */` — the same two-comment-node-type shape
  `docs/adapters.md` already found and solved for Java (`line_comment`/
  `block_comment`), just under different node names; the multi-pattern
  `queries.comments` approach that shape needed for Java applies verbatim.
  Strings: identical to CSS's. **Tier: pure descriptor + fixtures — the
  "new" shape here is new node *names*, not a new *problem*; Java already
  proved the descriptor/query mechanism handles it.**

- **PHP** — Comments: single lumped `comment` node type for `//`, `#`,
  `/* */`, *and* `/** */` PHPDoc alike — the JS/C# hazard again, already-solved
  shape (text sniffing). PHPDoc's tag list (`@param`, `@return`) is
  structurally identical to JSDoc's, but per this project's own precedent
  (`doc-dialect.ts`'s reasoning for why `javadoc` got its own id despite
  near-identical shape to `jsdoc`) it should get its own `phpdoc`
  `DocDialectId` naming the real ecosystem convention, reusing the same
  underlying tag-list parsing logic rather than a new one. Strings:
  `"..."` (interpolated — deferred-shape problem), `'...'` (raw, fits
  cleanly), heredoc/nowdoc (`<<<EOT ... EOT` / `<<<'EOT' ... EOT`) — same
  no-fixed-delimiter shape gap as Bash's heredocs. Concatenation: `.`
  operator — a new operator string but otherwise matches the existing
  `'operator'` style exactly, trivial. **Tier: comment-only is pure
  descriptor + fixtures (once a `phpdoc` dialect id exists, reusing
  existing tag-list logic); full string support needs engine changes
  (interpolation, heredoc/nowdoc shape) — comparable in scope to the JS/TS
  12b effort, for the same underlying reasons.**

- **Lua** — Comments: `--` line, `--[[ ]]` block — but the block form (and
  the equivalent long-bracket string literal below) uses a **level-counted
  bracket delimiter**: `[[`, `[=[`, `[==[`, ... closed by the matching
  `]]`, `]=]`, `]==]`, chosen by the author to safely nest content
  containing `]]`. This is structurally the same *kind* of gap the task
  brief itself calls out for Rust's `r#"..."#` hash-counting — a delimiter
  whose exact text is content-dependent, not fixed — and neither
  `QuoteSpec` nor `RawFormSpec` (both assume a fixed delimiter pair) can
  express it as-is. It affects Lua's block *comment* too, not just its
  raw strings, unlike Rust where the gap is string-only. **Tier: even
  comment support hits an engine gap here (the level-counted block-comment
  delimiter) — may genuinely require engine changes, not pure descriptor,
  despite Lua's line-comment-only case looking trivial in isolation.**

- **SQL** — Blocked on Finding S (the only available grammar isn't
  production-ready on trivial input). **Tier: flagged, not scored.**

- **Dart** — Comments: **three** distinct forms with a clean split —
  `documentation_comment` for `///` Dartdoc, a separate generic `comment`
  for `//` and `/* */` — better-separated than C#/PHP's lumped shape,
  closer to Java's two-type split (though here it's doc-vs-everything-else
  rather than line-vs-block). Dartdoc's own conventions (`[Reference]`
  bracket links, `{@template}` directives) don't match any existing
  `DocDialectId` — needs a new one. Strings: `"..."`/`'...'`
  (interpolated via `$var`/`${expr}` — deferred-shape problem),
  triple-quoted `'''...'''`/`"""..."""` (same shape question as TOML's —
  is a Dart triple-quoted string ever docstring-like, or always a
  data/prose question like TOML's), raw strings `r'...'`/`r"..."` — a
  clean prefix-based form that fits `PrefixSpec` exactly as-is, no gap.
  Concatenation: both implicit adjacency (Python/C++-style) and `+`
  operator are valid — a shape `LanguageDescriptor.strings.concatenation`
  hasn't needed to express yet (one style OR the other, never both as
  independently valid). **Tier: comment-only likely needs a new
  `DocDialectId` (Dartdoc) but is otherwise pure descriptor, on the
  cleanest node-shape split of any of the 13; full string support needs
  engine changes (interpolation, and possibly the dual-concatenation-style
  question) but the raw-string case specifically needs none.**

## Pass 4 — effort and priority table

Priority weighs, per this task's own instructions: how many of the two
competitors already cover it (all candidates below are covered by
**both**, except Zig/CUDA C++, Revived-only — noted); descriptor-fit tier
(pure-descriptor favored, since that's this project's own stated design
goal for what makes a language cheap); and fit with Jarin's actual
cross-platform (Windows/WSL/Linux) dev context over raw popularity alone.
**No candidate here is proposed ahead of 12b (JS/TS full, already shipped)
or 12c (C++, already shipped)** — this table is entirely "what could come
after 12f," per the task's own constraint.

| Language | Competitor support | Grammar/WASM status | Descriptor-fit tier | New doc dialect? | Est. effort (rel. to JS canary/12b) | Priority |
|---|---|---|---|---|---|---|
| TOML | both | Confirmed working (local build, no Emscripten/Docker) | Pure descriptor (comment-only) | No | ~0.2× (Python-shape simple; string-value wrapping deliberately out of scope) | **High** — trivial, dogfoodable via this project's own `pyproject.toml`/`.rewraprc` convention |
| Shell script (Bash) | both | Confirmed working, prebuilt | Pure descriptor (comment-only); full strings need engine work (heredocs) | No | ~0.2× comment-only; string support unscoped for now | **High** — near-universal on Windows/WSL/Linux; comment-only ships cheaply |
| CSS | both | Confirmed working, prebuilt | Pure descriptor | No | ~0.3× (simpler than C++'s plainBlock case) | **High** — lowest technical risk found in this whole pass, real ecosystem demand |
| SCSS | both | Confirmed working (local build) | Pure descriptor (Java's two-comment-type mechanism reused verbatim) | No | ~0.35× | **High** — same low risk as CSS, mechanism already proven by Java |
| PowerShell | both | Confirmed working, prebuilt | Comment-only likely pure descriptor + new dialect id; full strings need engine work | Yes (comment-based help) | ~0.5× comment-only | **High** — the one candidate directly Windows-relevant given Jarin's OS |
| Dart | both | Prebuilt WASM **does not load** with pinned runtime; local rebuild fixes it (Finding D) | Comment-only pure descriptor + new dialect id (cleanest node shape of the 13); full strings need engine work | Yes (Dartdoc) | ~0.6× comment-only | Medium — clean shape, but no signal Jarin's stack touches Dart/Flutter |
| C# | both | Confirmed working, prebuilt | Comment-only pure descriptor + new dialect id; full strings need engine work (interpolation + doubling-escape) | Yes (XmlDoc) | ~1× (comparable to 12b's actual, not predicted, scope) | Medium — very popular language generally, no direct signal from this project's own context |
| PHP | both | Confirmed working, prebuilt | Comment-only pure descriptor + new dialect id (reusing jsdoc-shaped logic); full strings need engine work (interpolation + heredoc/nowdoc) | Yes (phpdoc, structurally reuses jsdoc parsing) | ~1× (comparable to 12b) | Medium — huge install base, but a style of project unlikely to be Jarin's own |
| YAML | both | **Fails to load** (Finding Y — C++ external scanner / wasi-sdk incompatibility, unresolved) | Comment-only likely pure descriptor once unblocked; scalar wrapping is a scope question, not a gap | No | Unknown — blocked | Flagged, not scored — worth revisiting once Finding Y has a resolution path |
| JSON/JSONC | both | No clean grammar for the dialect anyone wants (Finding J) | Blocked on sourcing | N/A | Unknown — blocked | Flagged, not scored |
| SQL | both | Only available grammar errors on trivial input (Finding S) | Blocked on grammar maturity | Unknown | Unknown — blocked | Flagged, not scored — needs its own dialect-scoped dry run before any estimate |
| Lua | both | Confirmed working (local build) | **May genuinely require engine changes** even for comment-only (level-counted bracket delimiter, same shape gap as Rust's `r#"`) | No | Uncertain until the bracket-level gap is resolved | Low-medium — real embedded/config-scripting use, but the one candidate here with a confirmed engine-level blocker on its *comment* form, not just strings |
| HTML (+erb/svelte/vue) | both | Confirmed working, prebuilt | Pure descriptor (comment-only, matching Rewrap's own scope choice) | No | ~0.3× | Low-medium — trivial once scoped to comments, but templating-language text-node wrapping (if ever wanted) is unexplored |
| C/C++ family cousins (Objective-C, Verilog/SystemVerilog, Groovy, Scala) | both | Prebuilt `.wasm` confirmed at registry level, not dry-run parsed | Provisional: likely pure descriptor (Java-style comment precedent already proven 4×) | Likely no (Javadoc/Doxygen probably already cover these ecosystems) | Provisional ~0.3–0.5× each | Low — no signal these are part of Jarin's stack; would need real probing before scoring further |
| CUDA C++ | **Revived only** | `tree-sitter-cuda` exists on npm (not dry-run parsed); **checked and ruled out**: the already-vendored `tree-sitter-cpp.wasm` produces `hasError: true` on a representative `.cu` sample — `__global__` kernel qualifiers and, especially, the `<<<1, 5>>>` kernel-launch syntax get misparsed (`<<<...>>>` is read as a malformed `template_argument_list`) | Not a free reuse of the `cpp` adapter — genuinely needs its own grammar | Unknown | Not near-zero after all; comparable groundwork to any new C-family adapter | Low — single-competitor coverage, narrow audience, and the "maybe free" possibility this row originally flagged is now ruled out by direct evidence |
| Zig | **Revived only** | `tree-sitter-zig` prebuilt, registry-confirmed, not dry-run parsed | Provisional: comments look Java-style-simple (`//[/!]` custom line form per Revived's own definition) | Unknown | Provisional low | Low — single-competitor coverage |
| R | both | Only unofficial single-maintainer packages exist (`@davisvaughan` or `@eagleoutice`, not the `r-lib` org) | Provisional: `#`-only comments look trivial | No | Provisional low, but trust-story risk needs its own evaluation (comparable to LaTeX's self-built provenance, per `SECURITY.md`) | Low — real data-science relevance generally, no signal it's Jarin's stack, and the packaging trust story needs scrutiny before adoption regardless of technical ease |
| HCL/Terraform | both | `@tree-sitter-grammars/tree-sitter-hcl` confirmed to exist (not dry-run parsed) | Unassessed | Unknown | Unknown | Low — infra-as-code relevance is plausible for a cross-platform dev context, but unexplored this pass |
| Everything else in the "registry-checked only" and "not checked" lists above (Perl, Objective-C variants already noted, Julia, MATLAB/Octave, Haskell, Clojure/Scheme/Common Lisp/Emacs Lisp family, Elixir, Elm, PureScript, GraphQL, Protobuf, Makefile, CMake, Dockerfile, XML, Pascal, Prolog, Batch, AsciiDoc/reStructuredText/Textile/Bikeshed, D, AutoHotkey, FIDL, J, Lean, Tcl, Crystal, CoffeeScript, Handlebars/Pug/XAML/templating, Shaderlab, Verilog covered above, Git commit, Configuration/INI, Basic/VB) | both (mostly) | Mixed — see Pass 2's registry table; several have no findable real package at all | Not assessed individually | Unknown | Unknown | Lowest — no individual signal from Jarin's context strong enough to justify spending probe time ahead of the higher-tier candidates above; revisit only if a specific one becomes actually needed |

### What this pass didn't resolve (flagged, per the task's own instruction not to guess past the evidence)

- **YAML** (Finding Y) — WASM builds but won't load; needs either a working
  C++-external-scanner WASI toolchain path or an alternate prebuilt source
  (a GitHub release asset, the way Markdown's was sourced).
- **JSON/JSONC** (Finding J) — the dialect anyone actually wants has no
  clean grammar path found in this pass.
- **SQL** (Finding S) — the only real npm grammar isn't production-ready;
  needs a dialect-scoped dry run (which SQL flavor even matters for this
  project's users) before an effort estimate is possible at all.
- **Lua** — the bracket-level-counting gap affects even its comment form;
  would need its own small engine-design spike (does `QuoteSpec`/
  `RawFormSpec` grow a variant-delimiter mode, or does this stay
  unsupported) before implementation, not just fixtures.
- **CUDA C++** — resolved, not flagged: checked directly, and the
  already-vendored `tree-sitter-cpp.wasm` does *not* parse CUDA's
  `<<<...>>>` kernel-launch syntax cleanly (`hasError: true`). It needs
  its own grammar (`tree-sitter-cuda`, confirmed to exist on npm but not
  dry-run parsed this pass) like any other new C-family candidate — the
  "maybe free" possibility is ruled out, not left open.
- The 53 registry-checked-only candidates' descriptor-fit tiers in the
  table above are **provisional** — syntax-knowledge-based, not
  grammar-probed. Any of them, before a real implementation commitment,
  needs the same conformance-kit-style dry run this pass gave the 13 that
  were actually parsed.
