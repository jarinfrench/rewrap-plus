# Vendored grammars

This directory holds tree-sitter grammar `.wasm` binaries used by
`ParserManager` (see `../src/parser/`). They are checked into the repo
rather than fetched at install time — see `docs/parsing.md` for why.

## `tree-sitter-python.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-python`](https://www.npmjs.com/package/tree-sitter-python) |
| Package version | `0.25.0` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-python |
| Upstream commit | `293fdc02038ee2bf0e2e206711b69c90ac0d413f` |
| npm tarball shasum | `c1c460915cb883feb2d9ecefeb98b3794eba85f5` |
| npm tarball integrity | `sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==` |
| Vendored file sha256 | `16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47` |
| Grammar ABI version | `15` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

This file is the **unmodified `tree-sitter-python.wasm` asset that ships
inside the `tree-sitter-python` npm package itself** — `0.25.0` publishes a
prebuilt WASM binary at its package root, built from the same grammar
source used for its native bindings. No local Emscripten/Docker build step
was needed (see the "grammar WASM: prebuilt or build-it-yourself?" section
of `docs/parsing.md` for how this was confirmed).

### Regenerating / updating

1. `npm view tree-sitter-python versions --json` to see what's published.
2. `npm pack tree-sitter-python@<version>` and extract the tarball.
3. Confirm `tree-sitter-python.wasm` is present at the package root (it has
   been since at least `0.23.x`; if a future release drops it, that's a
   reason to revisit the build-pipeline path this project deliberately
   skipped — see `docs/parsing.md`).
4. Copy that file over this one.
5. Update the table above: package version, upstream commit (`gitHead` in
   the npm registry metadata), tarball shasum/integrity (`npm view
   tree-sitter-python@<version> dist`), the vendored file's own
   `sha256sum`, and the grammar's `abiVersion` (log
   `Language.load(...).then(l => l.abiVersion)` once, or check the
   conformance suite output).
6. Re-run the full suite — `npm ci && npm test && npm run lint && npm run
   typecheck && npm run build` — including anything in
   `src/parser/*.test.ts`, since node type/field names occasionally shift
   between grammar releases (the parser layer's own tests will catch a
   query that no longer compiles; region-discovery tests are what catch a
   node *name* changing under a query that still compiles).

## `tree-sitter-javascript.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-javascript`](https://www.npmjs.com/package/tree-sitter-javascript) |
| Package version | `0.25.0` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-javascript |
| Upstream commit | `44c892e0be055ac465d5eeddae6d3e194424e7de` |
| npm tarball shasum | `2e336b8f128e6e85401eb67667dfd87cfcf153e8` |
| npm tarball integrity | `sha512-1fCbmzAskZkxcZzN41sFZ2br2iqTYP3tKls1b/HKGNPQUVOpsUxpmGxdN/wMqAk3jYZnYBR1dd/y/0avMeU7dw==` |
| Vendored file sha256 | `5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240` |
| Grammar ABI version | `15` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

Vendored for the JavaScript canary adapter
(`../src/languages/javascript/`) — confirming this repeats the same
"prebuilt or build-it-yourself?" question `docs/parsing.md` answered for
Python, and it repeats the same answer: `0.25.0` publishes a prebuilt
`tree-sitter-javascript.wasm` at its package root, same as
`tree-sitter-python` did. No build pipeline needed here either. This is
itself a useful finding on its own terms — see `docs/parsing.md`'s
"consequence for future grammars" note, which flagged this as something
to re-check per grammar rather than assume.

Regenerating/updating follows the identical steps above, substituting
`tree-sitter-javascript` for `tree-sitter-python` throughout.

## `tree-sitter-typescript.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-typescript`](https://www.npmjs.com/package/tree-sitter-typescript) |
| Package version | `0.23.2` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-typescript |
| Upstream commit | `f975a621f4e7f532fe322e13c4f79495e0a7b2e7` |
| npm tarball shasum | `70bc615a2f664a8e9c87c533382beca587f28ab3` |
| npm tarball integrity | `sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==` |
| Vendored file sha256 | `778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d` |
| Grammar ABI version | `14` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

Vendored for the `typescript` language adapter
(`../src/languages/typescript/`). `tree-sitter-typescript` publishes *two*
grammars from one package — `tree-sitter-typescript.wasm` (plain TS) and
`tree-sitter-tsx.wasm` (TS+JSX) below — both prebuilt at the package root,
same "no local Emscripten/Docker build step" finding `docs/parsing.md`
already made for Python and JavaScript, re-verified here rather than
assumed (per that file's own note to check this per grammar rather than
assume). The package's newest release (`0.23.2`) predates Python/JavaScript's
`0.25.0`; no `0.25.x` series exists for this grammar as of this vendoring.

Confirmed compatible with this project's pinned `web-tree-sitter@0.26.13`
(`MIN_COMPATIBLE_VERSION` 13, `LANGUAGE_VERSION` 15) — this grammar's own
`abiVersion` is `14`, one older than Python/JavaScript's `15` but still
inside the supported range.

Regenerating/updating follows the same steps as `tree-sitter-python.wasm`
above, substituting `tree-sitter-typescript` throughout — except step 3
("confirm the `.wasm` is present at the package root") must check for
*both* `tree-sitter-typescript.wasm` and `tree-sitter-tsx.wasm`, and step
4 copies both files.

## `tree-sitter-tsx.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-typescript`](https://www.npmjs.com/package/tree-sitter-typescript) (same package as above) |
| Package version | `0.23.2` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-typescript |
| Upstream commit | `f975a621f4e7f532fe322e13c4f79495e0a7b2e7` |
| npm tarball shasum | `70bc615a2f664a8e9c87c533382beca587f28ab3` |
| npm tarball integrity | `sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==` |
| Vendored file sha256 | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` |
| Grammar ABI version | `14` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

Vendored for the `typescriptreact` language adapter — TSX is a
genuinely *separate* grammar from plain TypeScript (a `<T>` type
assertion and a JSX element are ambiguous under one grammar, per
upstream's own package split), not a superset flag on the same one, so it
gets its own vendored `.wasm` and its own `LanguageDescriptor` `id`
(`'typescriptreact'`) even though every comment/string/concatenation
finding below applies identically to both. Probed directly (JSX element
containing a string-concatenation expression) alongside plain TypeScript
in the same session — see `docs/spikes/tree-sitter-typescript-probe.mjs`.

## `tree-sitter-cpp.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-cpp`](https://www.npmjs.com/package/tree-sitter-cpp) |
| Package version | `0.23.4` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-cpp |
| Upstream commit | `f41e1a044c8a84ea9fa8577fdd2eab92ec96de02` |
| npm tarball shasum | `f40dd18f6154012a357e991b757e051cf11ca98f` |
| npm tarball integrity | `sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==` |
| Vendored file sha256 | `174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf` |
| Grammar ABI version | `14` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

Vendored for the `cpp` language adapter
(`../src/languages/cpp/`). `0.23.4` is this package's newest release as of
this vendoring — noticeably behind Python/JavaScript's `0.25.0` and even
`tree-sitter-typescript`'s `0.23.2` (no `0.24.x`/`0.25.x` series exists
yet for this grammar) — same "check per grammar, don't assume" finding
`docs/parsing.md` already flagged when `tree-sitter-typescript` turned up
behind the other two. `0.23.4` publishes a prebuilt `tree-sitter-cpp.wasm`
at its package root, same as every other grammar vendored so far — no
local Emscripten/Docker build step needed here either.

Confirmed compatible with this project's pinned `web-tree-sitter@0.26.13`
(`MIN_COMPATIBLE_VERSION` 13, `LANGUAGE_VERSION` 15) — this grammar's own
`abiVersion` is `14`, the same as `tree-sitter-typescript`'s and one older
than Python/JavaScript's `15`, still inside the supported range.

Regenerating/updating follows the identical steps `tree-sitter-python.wasm`
above documents, substituting `tree-sitter-cpp` throughout.

## `tree-sitter-java.wasm`

| | |
|---|---|
| Source package | [`tree-sitter-java`](https://www.npmjs.com/package/tree-sitter-java) |
| Package version | `0.23.5` |
| Upstream repo | https://github.com/tree-sitter/tree-sitter-java |
| Upstream commit | `94703d5a6bed02b98e438d7cad1136c01a60ba2c` |
| npm tarball shasum | `fb150fdaa9c852b3d71ba3144109008ac6a47ac2` |
| npm tarball integrity | `sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==` |
| Vendored file sha256 | `4fdeac4ca6ca089f06c6f7e562abcac1733cd465728cc7031ebb73c2019122c4` |
| Grammar ABI version | `14` (`Language#abiVersion`) |
| License | MIT (see upstream `LICENSE`) |

Vendored for the `java` language adapter (`../src/languages/java/`) —
Phase 12f's first stretch language. `0.23.5` is this package's newest
release as of this vendoring, one behind Python/JavaScript's `0.25.0` and
Go's `0.25.0`, level with `tree-sitter-ruby`'s `0.23.1` — same "check per
grammar, don't assume" finding every earlier vendoring here already made.
`0.23.5` publishes a prebuilt `tree-sitter-java.wasm` at its package root,
same as every other grammar vendored so far — no local Emscripten/Docker
build step needed here either.

Confirmed compatible with this project's pinned `web-tree-sitter@0.26.13`
(`MIN_COMPATIBLE_VERSION` 13, `LANGUAGE_VERSION` 15) — this grammar's own
`abiVersion` is `14`, the same as `tree-sitter-typescript`'s and
`tree-sitter-cpp`'s, one older than Python/JavaScript's `15`, still inside
the supported range.

Regenerating/updating follows the identical steps `tree-sitter-python.wasm`
above documents, substituting `tree-sitter-java` throughout.

## `tree-sitter-markdown.wasm`

| | |
|---|---|
| Source | GitHub release asset (block grammar only — see below) |
| Upstream repo | https://github.com/tree-sitter-grammars/tree-sitter-markdown |
| Release tag | `v0.5.3` |
| Release tag commit | `f969cd3ae3f9fbd4e43205431d0ae286014c05b5` |
| Asset URL | https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.3/tree-sitter-markdown.wasm |
| Built by | `tree-sitter/workflows` reusable `release.yml`, via `tree-sitter/setup-action/cli@v2` + `tree-sitter build --wasm` |
| Attestation | `actions/attest-build-provenance@v4`, verified against `sha256:dd9fc12ac2804d7c7da787e4774125b32e4fb3c244e5e7031a77cb7dd8036020` via `GET /repos/tree-sitter-grammars/tree-sitter-markdown/attestations/sha256:<hash>` (`gh` not installed on the vendoring machine — see `docs/parsing.md` Finding 7 for the verification steps actually taken, including a partial `sigstore-python` run and manual Fulcio-certificate SAN decoding, both of which confirmed the workflow/repo/tag/commit identity above) |
| Vendored file sha256 | `dd9fc12ac2804d7c7da787e4774125b32e4fb3c244e5e7031a77cb7dd8036020` |
| Grammar ABI version | `15` (`Language#abiVersion`) |
| License | MIT (author MDeiml, per `tree-sitter.json`) |

This is the first grammar vendored from a GitHub release asset rather than
an npm tarball — `@tree-sitter-grammars/tree-sitter-markdown` on npm ships
no `.wasm` at all (only native `prebuilds/*.node` and grammar sources;
**verified** with `npm pack --dry-run`) and lags upstream by two minor
versions, so the release asset is both the only prebuilt option and the
more current one. This is a genuinely different trust story from every
other entry in this file: those are all *unmodified files that ship
inside an npm package*, verified by npm's own tarball integrity; this one
is a build artifact GitHub Actions produced and cryptographically attested
to (Sigstore/Fulcio + Rekor transparency log), verified independently of
npm's supply chain entirely. See `SECURITY.md`'s supply-chain section for
why that's called out explicitly rather than treated as equivalent.

Only the **block** grammar is vendored (this repo's `RegionKind: 'prose'`
only needs block structure — see `docs/planning/markdown-latex-plan.md`
§3.1). The same release also publishes a `tree-sitter-markdown_inline.wasm`
(426,117 bytes) for the companion inline grammar, deliberately *not*
vendored: everything the wrap engine needs from a Markdown paragraph is
already block-level (paragraph/list/quote structure), and inline concerns
(inline code spans, URLs, hard-break detection) are already handled
text-side by `segmentation/unbreakable-spans.ts` and a regex over each
line's raw text. A future pass could vendor the inline grammar too, to
keep `[link text](url)` whole under reflow via `Language.load` +
`Parser#setIncludedRanges` — see `docs/planning/markdown-latex-plan.md`
§11's "the inline grammar" open question.

Default compile-time extensions confirmed active in this release build
(directly, not assumed from the README): `EXTENSION_GFM` (pipe tables,
task lists, strikethrough) and both YAML (`EXTENSION_MINUS_METADATA`) and
TOML (`EXTENSION_PLUS_METADATA`) front matter — see `docs/parsing.md`
Finding 7.

### Regenerating / updating

1. Check https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases
   for a newer tag; confirm it still attaches a `tree-sitter-markdown.wasm`
   asset (the block grammar) built by the same `release.yml` workflow.
2. Download the asset and verify its attestation — `gh attestation verify
   <file> --repo tree-sitter-grammars/tree-sitter-markdown` if `gh` is
   available; otherwise `GET
   https://api.github.com/repos/tree-sitter-grammars/tree-sitter-markdown/attestations/sha256:<hash>`
   plus a manual Fulcio-certificate SAN decode, as this vendoring did (see
   `docs/parsing.md` Finding 7 for the exact steps and why a full
   `sigstore-python` verification didn't complete cleanly on this
   machine).
3. Re-run `docs/spikes/tree-sitter-markdown-probe.mjs` against the new
   file (`WASM_PATH=<new file> node docs/spikes/tree-sitter-markdown-probe.mjs`)
   before replacing the vendored one — a grammar update can rename node
   types or shift geometry the way any grammar bump can.
4. Copy the file over this one; update the table above (tag, tag commit,
   asset URL, attestation hash, vendored file sha256, ABI version).
5. Re-run the full suite — `npm ci && npm test && npm run lint && npm run
   typecheck && npm run build` — the Markdown adapter's own descriptor/
   fixture tests are what catch a node name or geometry shift under a
   query that still compiles.

## `tree-sitter-latex.wasm`

| | |
|---|---|
| Source package | [`@pfoerster/tree-sitter-latex`](https://www.npmjs.com/package/@pfoerster/tree-sitter-latex) |
| Package version | `0.6.0` |
| Upstream repo | https://github.com/latex-lsp/tree-sitter-latex |
| Upstream commit (`gitHead`, = `v0.6.0` tag) | `7e0ecdc02926c7b9b2e0c76003d4fe7b0944f957` |
| npm tarball shasum | `a51fd660b8f17b4619457e0570df5bc759d589ff` |
| npm tarball integrity | `sha512-j9V0Zh5bFoEu6ZLqbLAB+2+NWm/gsPkoKgtOf2Gbn6mikuJ5MyxMmKgwQvPIxPYC57tHcIj9oKaT4jBdN86R1Q==` |
| Built with | `tree-sitter-cli@0.26.13` (`tree-sitter build --wasm`), pinned to match this project's `web-tree-sitter@0.26.13` |
| wasi-sdk version used by the CLI | `29.0` (`wasi-sdk-29.0-x86_64-windows`, auto-downloaded by the CLI — no Emscripten/Docker step) |
| Build host OS | Windows 10 (the vendoring machine) |
| Vendored file sha256 | `4178504425e5576092735bed9190f2bf5f127ba3573988c016e086ae76d01855` |
| Grammar ABI version | `14` (`Language#abiVersion`) |
| License | MIT (Patrick Förster, per upstream `LICENSE`) |

**This is self-built provenance, not an unmodified upstream artifact —**
`latex-lsp/tree-sitter-latex`'s GitHub releases attach no assets at all
(**verified**), so there is no upstream `.wasm` to vendor as-is. The
tarball above does contain the generated `src/parser.c` (43.9 MB) and
`src/scanner.c`, so no `tree-sitter generate` step was needed — just
`tree-sitter build --wasm` against the extracted tarball. Trust here rests
on: the npm tarball's own recorded integrity (verifiable via `npm view
@pfoerster/tree-sitter-latex@0.6.0 dist`), the pinned and reproducible
`tree-sitter-cli` version, the wasi-sdk version that CLI resolved (printed
during the build, recorded above), and this vendored file's own sha256 —
a *stronger* trust story than "we trust an opaque binary someone else
built," precisely because every input to reproducing it is pinned and
recorded here. See `SECURITY.md`'s supply-chain section for why this is
called out as a different shape from the Markdown entry's GitHub-attested
one, not a lesser one.

Despite the 43.9 MB `parser.c` input, the output WASM is 3,710,264 bytes
(3.54 MB) — comparable to `tree-sitter-cpp.wasm` above, not the "several
MB, maybe much larger" this project's own planning flagged as a size risk
for the `.vsix`. See `docs/parsing.md` Finding 8 for the full build log
and node-shape probe results.

No `workflow_dispatch` Linux-builder fallback (described in
`docs/planning/markdown-latex-plan.md` §3.1, for the case where wasi-sdk's
Windows auto-download fails) was needed for this vendoring — the download
and build succeeded on the first attempt on this Windows machine. Add
`.github/workflows/grammar-wasm.yml` only if a future regeneration
attempt actually hits that failure.

### Regenerating / updating

1. `npm view @pfoerster/tree-sitter-latex versions --json` for what's
   published; confirm the tarball still ships a generated `src/parser.c`
   (`npm pack --dry-run`) so no `tree-sitter generate` step is needed.
2. `npm pack @pfoerster/tree-sitter-latex@<version>` and extract the
   tarball.
3. `npx --package tree-sitter-cli@0.26.13 tree-sitter build --wasm
   <extracted dir> -o tree-sitter-latex.wasm` — keep the CLI version
   pinned to match this project's `web-tree-sitter` version (currently
   `0.26.13`); a CLI/runtime version mismatch can emit a dynamic-linking
   format the runtime can't load even when the ABI number is supported
   (see `docs/parsing.md` Finding 2).
4. Re-run `docs/spikes/tree-sitter-latex-probe.mjs` against the new file
   before replacing the vendored one — this grammar assigns dedicated node
   types to many individual macros (environments, `\item`,
   `\newtheorem`, …), any of which a version bump could rename.
5. Copy the file over this one; update the table above (package version,
   `gitHead`, tarball shasum/integrity, CLI version if it changed, the
   wasi-sdk version the build printed, the vendored file's own sha256, and
   `abiVersion`).
6. Re-run the full suite — `npm ci && npm test && npm run lint && npm run
   typecheck && npm run build`.
