# Changelog

All notable changes to Rewrap+ are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project doesn't otherwise follow Semantic Versioning strictly pre-1.0.

## [Unreleased]

Not yet tagged. The CI packaging job (`.github/workflows/ci.yml`)
attaches a built `.vsix` to the GitHub Release for whichever tag
eventually ships this.

### Added

- **Comment wrapping** for Python line comments (`#`), grouped by
  contiguous same-indent blocks. Directive comments (`# noqa`,
  `# type:`, `# pylint:`, shebangs, encoding declarations) and
  commented-out code are left untouched.
- **Docstring wrapping** with structure-preserving reflow across three
  documentation dialects -- Google, NumPy, Sphinx/reST -- plus plain
  paragraph reflow, detected per docstring rather than per file. Lists,
  fenced code, doctest (`>>>`) blocks, and already-indented examples are
  preserved verbatim.
- **String-literal wrapping** -- splits long string literals using
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
- **Format on save** (`rewrapPlus.formatOnSave`, default `false`): wraps
  the whole document immediately before every save via
  its own `onWillSaveTextDocument` hook, independent of
  `editor.defaultFormatter` so it never contends with Black/Prettier/etc.
  for that slot. Never delays a save -- a slow wrap or a parse failure is
  skipped with a note in the output channel and the save proceeds
  regardless.
- **Column-limit resolution** with a five-tier precedence chain
  (`rewrapPlus.columnLimit` -> language-scoped `editor.rulers` ->
  self-parsed `.editorconfig` `max_line_length` -> global `editor.rulers`
  -> built-in default of 80), re-resolved on every wrap.
- The full `rewrapPlus.*` settings surface -- `enable`, `columnLimit`,
  `rulerIndex`, `wrapComments`, `wrapStrings`, `stringPolicy`,
  `docDialect`, `preserveIndentedBlocks`, `respectEditorConfig`,
  `balancedWrapping`.
- **`rewrapPlus.stringWrapInclude`**: glob patterns (default `["**"]`)
  scoping string-literal wrapping to specific paths, matched against
  each file's path relative to its workspace folder -- lets string
  wrapping (which edits actual program values, not just formatting) be
  trialled on one package or `docs/` before trusting it repo-wide. A
  file matching none of the patterns has string wrapping disabled
  regardless of `wrapStrings`; comment/docstring wrapping is unaffected.
  Reuses the same hardened glob engine as `.editorconfig` section
  matching (`packages/vscode-extension/src/config/glob.ts`).
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
  around it (`docs/adapters.md`) -- the seam a future language addition
  (`docs/adding-a-language.md`, `npm run new-adapter`) builds on.
- **Packaging**: esbuild bundling to a single `dist/extension.js`,
  `vsce`-based `.vsix` packaging, and a CI job that builds and attaches
  the `.vsix` to a GitHub Release on a version-tag push.
- **JavaScript, TypeScript, and TSX support**, extending the original
  comments-only JavaScript canary into full adapters: `//` and
  `/**...*/` (JSDoc) comment wrapping, string-literal wrapping with
  `+`-operator concatenation (no grouping/parens ever required, unlike
  Python's implicit-adjacency form), and a new JSDoc documentation
  dialect (`@param`/`@returns`/`@throws`/...) detected per doc comment
  the same way Python's docstring dialects are detected per docstring.
  `rewrapPlus.docDialect` gains a `jsdoc` option alongside Python's
  existing three. TSX registers as its own adapter (a genuinely separate
  tree-sitter grammar from plain TypeScript, not an alias); `.jsx` files
  are supported via `javascript`'s own alias.
- **C++ support**, a full adapter from its first commit (unlike
  JavaScript's canary-then-real path): `//`/`///`/`/* */`/`/** */`
  comment discovery -- every form is wrapped, including a plain `/* */`
  block comment and Doxygen's `///` repeated-marker style -- bare-adjacency
  string-literal concatenation (`"foo " "bar"`, never requiring inserted
  grouping -- C++ has no valid `+` string concatenation at all, unlike
  every other adapter), and a new Doxygen documentation dialect
  (`\param`/`@param`, `\return`/`@return`, `\brief`, ... -- either prefix
  accepted per tag) detected per doc comment, including for `///`.
  `rewrapPlus.docDialect` gains a `doxygen` option. Raw strings
  (`R"(...)"`), wide/UTF-prefixed strings (`L`/`u`/`U`/`u8`), and
  `#define` macro bodies are all handled correctly without any wrap
  engine changes -- see `docs/adapters.md`'s C++ section for why.
- **Plain (non-doc-marked) block comments** -- `/* ... */` in
  JavaScript/TypeScript/TSX, in addition to C++ above -- now wrap through
  a distinct `comments.plainBlock` delimiter, separate from the JSDoc/
  Doxygen-marked `/** ... */` form the engine already supported. Doxygen's
  `///` repeated-marker doc comments (C++ only) wrap through the same
  per-line machinery a line comment uses, segmented through the `doxygen`
  dialect exactly like the `/** ... */` form -- see `docs/adapters.md`'s
  C++ section for the engine design this needed (a `groupRegions`
  adjacency merge shared with Python's own line-comment grouping, plus a
  second dissolve/emit path for the repeated-marker delimiter shape).

- **Java support**, a full adapter from its first commit (unlike
  JavaScript's canary-then-real path): `//`/`/* */`/`/** */` comment
  discovery -- Java's grammar produces two distinct comment node types
  (`line_comment`, `block_comment`), the first adapter in this project
  needing more than one `queries.comments` pattern -- `+`-operator
  string-literal concatenation (no grouping/parens ever required, the
  same shape JS/TS use), and a new Javadoc documentation dialect
  (`@param`/`@return`/`@throws`/... -- inline `{@link ...}`/`{@code ...}`
  tags kept intact automatically) detected per doc comment.
  `rewrapPlus.docDialect` gains a `javadoc` option. Text blocks
  (`"""..."""`, Java 15+) are never wrapped -- unlike every other
  excluded string form in this project, a text block shares its grammar
  node type with an ordinary string rather than being a separate node
  the query never captures, so the exclusion happens in `classify`
  rather than at the query level -- see `docs/adapters.md`'s Java section
  for the full finding.

- **CLI and pre-commit support**: `packages/cli`, a new
  `@rewrap-plus/cli` package (bin name `rewrap-plus`) consuming
  `packages/engine` completely unchanged -- no engine changes were needed
  (`docs/adapters.md`'s CLI section). Detects language from file
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

- **Marketplace and Open VSX publishing** on tagged releases, as a separate
  `publish` job gated behind the `marketplace-publish` GitHub Environment's
  required-reviewer approval -- a `v*` tag push builds and attaches the
  `.vsix` to the GitHub Release unattended (the `package` job), but
  `vsce publish`/`ovsx publish` (authenticated via the `VSCE_PAT`/`OVSX_PAT`
  repo secrets) only run after a reviewer approves the pending deployment in
  the Actions UI. `publish` downloads the exact workflow artifact `package`
  produced rather than rebuilding, so what a user downloads from the release
  and what ships to each registry are byte-identical. Marketplace publishing
  is deferred for v1 regardless (`docs/planning/implementation-plan.md`,
  12e) -- the approval gate exists so a tag push can't produce an unintended
  real Marketplace listing before that's actually decided.

- **Auto-wrap** (`rewrapPlus.autoWrap.enabled`, default `false`): wraps
  the comment/docstring the cursor is in the moment a space or Enter
  keystroke crosses `rewrapPlus.columnLimit`, mid-typing -- matching
  upstream Rewrap's own live `rewrap.autoWrap.enabled`. Comment/docstring
  only (never a string literal, regardless of `wrapStrings`). Applied so
  it merges into the same undo entry as the triggering keystroke, rather
  than becoming its own undo step. Structurally immune to IME composition
  noise -- a composing candidate's text is never a bare space/newline, the
  one shape the trigger detection reacts to. `rewrapPlus.toggleAutoWrap`
  overrides it per file, independent of the setting; `rewrapPlus.autoWrap.notification`
  (`icon`, the default, or `text`) controls how the current on/off state
  is surfaced, both matching upstream Rewrap's own values exactly.

- **Markdown support**, the first language where the prose *is* the
  document rather than something living inside a comment or string -- a
  new `'prose'` region kind and `discoverProse`/`wrapProse` adapter hooks
  (`docs/adapters.md`'s "Markdown and LaTeX -- prose languages" section),
  gated on neither `wrapComments` nor `wrapStrings`. Paragraphs (inside
  plain text, block quotes at any nesting depth, and ordered/unordered/
  task list items, including combinations like a quote inside a list)
  wrap with a freshly-computed, canonical continuation prefix rather than
  whatever the source happened to use -- a lazy continuation line with no
  `>` in source gains one on wrap. Hard line breaks (a trailing
  backslash, two-or-more trailing spaces, `<br>`/`<br/>`) are preserved
  exactly. Directives use an HTML comment (`<!-- rewrap: off/on/ignore -->`)
  since Markdown has no line-comment marker of its own. Headings (ATX and
  setext), fenced/indented code blocks, tables, front matter (YAML/TOML),
  thematic breaks, HTML blocks, link reference and footnote definitions,
  and a `$$` display-math paragraph are all left untouched. `.md`/
  `.markdown` recognized by the CLI; note its own README's "blast radius"
  callout -- a bare directory walk over an existing repo now touches every
  Markdown file it finds, which no prior language here did.

- **LaTeX support**, the second prose-is-the-document language after
  Markdown -- but a structurally different one: this grammar has no
  paragraph node at all, so `discoverProse` is a masked line scan over
  `source`'s own physical lines rather than a query capture
  (`docs/adapters.md`'s "Markdown and LaTeX -- prose languages" section).
  `%` comment paragraphs wrap through the same `'lineComment'` machinery
  Python's `#` comments use, needing no LaTeX-specific dissolve/emit code
  at all. A line beginning `\item` starts a fresh region at the item's
  own content column, with continuation lines aligned under the marker
  itself rather than the text. Every sectioning command
  (`\part`/`\chapter`/.../`\subparagraph`), generic command/
  `\newtheorem`-style declaration, and display-math delimiter is
  recognized as structural and never wrapped as prose -- including a
  *chain* of them on one line (`\section{Title}\label{sec:foo}`, an
  extremely common idiom, recognized as a unit rather than swallowed
  into surrounding prose). `\\`, `\newline`, `\linebreak`, `\break`, and
  `\hline` are hard breaks, preserved exactly. `\verb`/`\lstinline`
  spans are never split internally regardless of delimiter character. A
  trailing `%` comment on an otherwise-prose line is carried forward
  with that line rather than reflowed, since wrapping the text before it
  could silently change what the comment applies to. Verbatim-like
  environments (`verbatim`, `Verbatim`, `BVerbatim`, `lstlisting`/
  `listing`, `alltt`, `tikzpicture`, `tabular`/`tabular*`/`tabularx`,
  the `comment` package's block environment, `\iffalse ... \fi`) and
  every math environment (`equation`, `align`, `gather`, `multline`,
  `displaymath`, `$$...$$`, `\[...\]`) are preserved byte-for-byte,
  never discovered as prose at all. Directives use `%` directly
  (`% rewrap: off`/`on`/`ignore`/`force`) -- unlike Markdown, LaTeX
  already has its own line-comment marker, so this needed no HTML-
  comment-style workaround. `.tex`/`.latex` recognized by the CLI,
  subject to the same "blast radius" note as Markdown.

- **Comment-only support for TOML, Shell script (Bash), CSS, SCSS, and
  PowerShell** -- five adapters shipped as a batch, none needing an engine
  change (`docs/language-candidates.md`'s Pass 4 "High" priority row).
  TOML and Bash each have a single `#` line-comment form, no block/doc
  convention. CSS has a single `/* */` block form and no line-comment
  syntax at all -- the first descriptor in this package with nothing for
  `comments.line` to describe. SCSS has two distinct comment node types
  (`//` and `/* */`), the same shape Java's `line_comment`/`block_comment`
  split already proved out. PowerShell has `#` line comments, `<# ... #>`
  block comments, and comment-based help (`.SYNOPSIS`/`.DESCRIPTION`/
  `.PARAMETER` tags inside a `<# ... #>` block, per Microsoft's
  `about_Comment_Based_Help`) -- a new `commentBasedHelp` documentation
  dialect, told apart from a plain block comment by tag vocabulary rather
  than a distinct grammar node or literal marker prefix, since PowerShell
  gives both forms the identical delimiter and node type. None of the
  five declares string-literal support -- see "Known limitations" below.

### Known limitations

- Template literals (`` `...` ``) are not wrapped -- `${}` interpolation
  and significant internal whitespace make them a different case from
  Python's triple-quoted strings (see below), which *are* wrapped.
- Python's non-docstring triple-quoted strings (a single-part literal
  that looks like prose, e.g. `message = """..."""`) are wrapped under
  the default `prose` string policy, reusing the same structure-preserving
  reflow a docstring gets -- but the resulting wrap is not
  value-preserving the way other string-literal wraps are: PEP-257
  indent-stripping and paragraph-whitespace normalization can change the
  string's actual contents. A multi-part triple-quoted concatenation run
  is still left alone.
- C++ raw string literals (`R"(...)"`) are never wrapped -- excluded from
  discovery entirely, since they parse as a separate grammar node the
  wrap engine never queries for.
- Java text blocks (`"""..."""`) are never wrapped -- a real future
  feature (common-indentation stripping, a trailing-newline convention),
  not yet attempted; see `docs/adapters.md`'s Java section.
- Split-string continuation-line indent is always the enclosing
  statement's indent **+4** (matching Black's convention) -- no setting
  yet to choose "align to the opening delimiter" instead.
- The CLI has no `.gitignore` awareness beyond a fixed default-ignored
  directory list, and doesn't follow symlinked directories during a
  recursive walk.
- Plain-text prose support, and a plain-C adapter, are not yet
  implemented.
- TOML, Bash, CSS, SCSS, and PowerShell wrap comments only -- no
  string-literal support. TOML/Bash/PowerShell string interpolation and
  Bash/PowerShell here-docs/here-strings have no fixed open/close
  delimiter pair the way `QuoteSpec`/`RawFormSpec` both assume; CSS/SCSS
  string *values* were scoped out as a "should this even be reflowed"
  question rather than an engine gap
  (`docs/language-candidates.md`'s Pass 3).
- Markdown setext headings' own text is never wrapped (v1 canonicalizes
  everything else about a paragraph's continuation but leaves this one
  form alone -- "bias toward verbatim when uncertain"); link reference and
  footnote definitions are left alone rather than wrapped with their own
  4-space continuation indent.
- LaTeX's Wrap at Cursor (and auto-wrap, and format-on-save) grows with
  file size, unlike every other language here -- its masked-line-scan
  `discoverProse` has no cheaper way yet to scope discovery to a single
  requested region before scanning the whole file (`docs/benchmarks.md`'s
  "LaTeX" section, `docs/planning/implementation-plan.md`'s Phase 12f).
  Comfortably fast (well under 100ms) for any real LaTeX document under a
  few thousand lines; only noticeable on a single file in the tens of
  thousands of lines.
