# Changelog

All notable changes to Rewrap+ are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't otherwise follow Semantic Versioning strictly pre-1.0.

## [Unreleased]

The v1 feature set — everything through Phase 11
(`docs/implementation-plan.md`) — not yet tagged. Phase 11's own CI
packaging job (`.github/workflows/ci.yml`) attaches a built `.vsix` to
the GitHub Release for whichever tag eventually ships this.

### Added

- **Comment wrapping** for Python line comments (`#`), grouped by
  contiguous same-indent blocks. Directive comments (`# noqa`,
  `# type:`, `# pylint:`, shebangs, encoding declarations) and
  commented-out code are left untouched.
- **Docstring wrapping** with structure-preserving reflow across three
  documentation dialects — Google, NumPy, Sphinx/reST — plus plain
  paragraph reflow, detected per docstring rather than per file. Lists,
  fenced code, doctest (`>>>`) blocks, and already-indented examples are
  preserved verbatim.
- **String-literal wrapping** — splits long string literals using
  language-valid concatenation (implicit adjacency with parentheses
  inserted where required, or `+` when that's how the literal was
  already joined), gated by a conservative prose heuristic
  (`rewrapPlus.stringPolicy`) so paths, URLs, regexes, dict keys, SQL,
  and format-call arguments are left alone by default.
- **Directive comments** for per-region opt-in/opt-out:
  `# rewrap: off`/`on`/`ignore`/`force`, and `# fmt: off`/`on` honored
  alongside them.
- **VSCode commands**: `rewrapPlus.wrapAtCursor` (default `Alt+Q`),
  `.wrapSelection`, `.wrapDocument` (single atomic edit, with a
  cancellable progress notification above 2000 lines), and
  `.showResolvedConfig` (telemetry-free diagnostic dump of the effective
  column limit, its precedence source, and active policy).
- A `DocumentRangeFormattingEditProvider`, backed by the same wrap path
  as `.wrapSelection`, so "Format Selection" works, plus a
  `DocumentFormattingEditProvider` for "Format Document" and native
  `editor.formatOnSave`/`editor.defaultFormatter` composition.
- **Format on save** (`rewrapPlus.formatOnSave`, Phase 12a, default
  `false`): wraps the whole document immediately before every save via
  its own `onWillSaveTextDocument` hook, independent of
  `editor.defaultFormatter` so it never contends with Black/Prettier/etc.
  for that slot. Never delays a save — a slow wrap or a parse failure is
  skipped with a note in the output channel and the save proceeds
  regardless.
- **Column-limit resolution** with a five-tier precedence chain
  (`rewrapPlus.columnLimit` → language-scoped `editor.rulers` →
  self-parsed `.editorconfig` `max_line_length` → global `editor.rulers`
  → built-in default of 80), re-resolved on every wrap.
- The full `rewrapPlus.*` settings surface — `enable`, `columnLimit`,
  `rulerIndex`, `wrapComments`, `wrapStrings`, `stringPolicy`,
  `docDialect`, `preserveIndentedBlocks`, `respectEditorConfig`,
  `balancedWrapping`, `stringWrapInclude` (declared, not yet consumed).
- **Hardening**: idempotency and round-trip property tests across every
  fixture and generated input; parse-error and pathological-input
  handling (single 100k-char string, deeply nested concatenation, no
  trailing newline, mixed tabs/spaces); per-region line-ending detection
  (CRLF vs LF) and preservation; performance benchmarks and a
  cancellable progress guardrail for large documents
  (`docs/benchmarks.md`).
- A tree-sitter-based **engine/extension architecture**
  (`packages/engine` + `packages/vscode-extension`) with a
  declarative, data-first language adapter interface, proven against a
  second (JavaScript, comments-only) canary adapter and a shared
  conformance test kit before Python-specific assumptions could harden
  around it (`docs/adapters.md`) — the seam a future language addition
  (`docs/adding-a-language.md`, `npm run new-adapter`) builds on.
- **Packaging**: esbuild bundling to a single `dist/extension.js`,
  `vsce`-based `.vsix` packaging, and a CI job that builds and attaches
  the `.vsix` to a GitHub Release on a version-tag push.
- **JavaScript, TypeScript, and TSX support** (Phase 12b), extending the
  Phase 6b comments-only JavaScript canary into full adapters: `//` and
  `/**...*/` (JSDoc) comment wrapping, string-literal wrapping with
  `+`-operator concatenation (no grouping/parens ever required, unlike
  Python's implicit-adjacency form), and a new JSDoc documentation
  dialect (`@param`/`@returns`/`@throws`/...) detected per doc comment
  the same way Python's docstring dialects are detected per docstring.
  `rewrapPlus.docDialect` gains a `jsdoc` option alongside Python's
  existing three. TSX registers as its own adapter (a genuinely separate
  tree-sitter grammar from plain TypeScript, not an alias); `.jsx` files
  are supported via `javascript`'s own alias.
- **C++ support** (Phase 12c), a full adapter from its first commit
  (unlike JavaScript's canary-then-real path): `//`/`///`/`/* */`/`/** */`
  comment discovery (only `//` and `/**...*/` are wrapped — see Known
  limitations), bare-adjacency string-literal concatenation (`"foo "
  "bar"`, never requiring inserted grouping — C++ has no valid `+`
  string concatenation at all, unlike every other adapter), and a new
  Doxygen documentation dialect (`\param`/`@param`, `\return`/`@return`,
  `\brief`, ... — either prefix accepted per tag) detected per doc
  comment. `rewrapPlus.docDialect` gains a `doxygen` option. Raw strings
  (`R"(...)"`), wide/UTF-prefixed strings (`L`/`u`/`U`/`u8`), and
  `#define` macro bodies are all handled correctly without any wrap
  engine changes — see `docs/adapters.md`'s Phase 12c section for why.

- **CLI and pre-commit support** (Phase 12d): `packages/cli`, a new
  `@rewrap-plus/cli` package (bin name `rewrap-plus`) consuming
  `packages/engine` completely unchanged — no engine changes were needed,
  confirming the plan's own acceptance criterion for this phase
  (`docs/adapters.md`'s Phase 12d section). Detects language from file
  extension, walks directory arguments (skipping `node_modules`,
  dot-directories, `dist`, `out`, `coverage` by default), and wraps every
  file in place. `--check` reports what would change and exits non-zero
  without writing, for CI and pre-commit hooks. Configuration comes from
  `--flags`, a `.rewraprc`/`.rewraprc.json` (camelCase, mirroring
  `rewrapPlus.*`), and `pyproject.toml`'s `[tool.rewrap-plus]` table
  (kebab-case, matching Black/Ruff's own `[tool.*]` convention), in that
  precedence order; the column limit alone gets a further
  `.editorconfig` `max_line_length` tier between `pyproject.toml` and the
  built-in default of 80, via a self-contained parser independent of the
  extension's own copy (two independent glue-layer peers of the engine,
  not a shared dependency between them).

### Known limitations

- Template literals (`` `...` ``) are not wrapped — deferred the same way
  Python defers triple-quoted non-docstring strings; a plain
  single-star `/* ... */` block comment (no JSDoc/Doxygen marker) is
  discovered but not wrapped, for JavaScript/TypeScript/TSX/C++.
- C++'s `///`-style triple-slash Doxygen comments are discovered but not
  wrapped — a genuinely different delimiter shape (no single open/close
  pair) from the supported `/** ... */` form; use the latter instead.
- C++ raw string literals (`R"(...)"`) are never wrapped — excluded from
  discovery entirely, since they parse as a separate grammar node the
  wrap engine never queries for.
- Split-string continuation-line indent is always the enclosing
  statement's indent **+4** (matching Black's convention) — no setting
  yet to choose "align to the opening delimiter" instead.
- `rewrapPlus.stringWrapInclude` is declared but not yet consumed.
- The CLI has no `.gitignore` awareness beyond a fixed default-ignored
  directory list, and doesn't follow symlinked directories during a
  recursive walk.
- Markdown/LaTeX/plain-text support, a plain-C adapter, and
  Marketplace/OpenVSX publishing are not yet implemented — see
  `docs/implementation-plan.md`'s Phase 12 roadmap (12e; 12a, 12b, 12c,
  and 12d are now done).
