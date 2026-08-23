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
   conformance suite output once Phase 6b exists).
6. Re-run the full suite — `npm ci && npm test && npm run lint && npm run
   typecheck && npm run build` — including anything in
   `src/parser/*.test.ts`, since node type/field names occasionally shift
   between grammar releases (the parser layer's own tests will catch a
   query that no longer compiles; region-discovery tests, added in
   Phase 3, are what catch a node *name* changing under a query that still
   compiles).
