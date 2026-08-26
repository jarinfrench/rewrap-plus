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

### Known limitations

- **v1 language scope is Python only** — every wrap command grays
  itself out in any other language (JavaScript/TypeScript, C++, and
  others are on the roadmap; see
  `packages/vscode-extension/README.md`'s comparison table).
- Split-string continuation-line indent is always the enclosing
  statement's indent **+4** (matching Black's convention) — no setting
  yet to choose "align to the opening delimiter" instead.
- `rewrapPlus.stringWrapInclude` is declared but not yet consumed.
- Markdown/LaTeX/plain-text support, a full JavaScript/TypeScript
  adapter, a CLI, and Marketplace/OpenVSX publishing are not yet
  implemented — see `docs/implementation-plan.md`'s Phase 12 roadmap
  (12b–12e; 12a, format-on-save, is now done).
