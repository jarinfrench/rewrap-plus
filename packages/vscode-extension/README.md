# Rewrap+

Rewraps comments, docstrings, and string literals to a configured column
limit — preserving formatted structure (lists, doc-comment sections,
fenced code, tables) and emitting language-valid concatenation syntax
when a string literal has to split across lines.

**Language support: Python, JavaScript, TypeScript, TSX, C++, and Java.**
The three wrap commands gray themselves out automatically in any other
language. This isn't a permanent ceiling — the engine's adapter interface
is deliberately data-first (a language is a declarative descriptor plus
fixtures, not new engine code — see the repo root [README](../../README.md)
and `docs/adapters.md`), and more languages are on the roadmap.

## Features

- **Comments.** Python line comments (`#`), grouped by contiguous
  same-indent blocks; JavaScript/TypeScript/TSX/C++/Java `//` line
  comments and both block-comment forms — a plain `/* ... */` comment and
  the JSDoc/Doxygen/Javadoc-marked `/** ... */` one, each through its own
  distinct delimiter. C++ additionally wraps Doxygen's `///`
  repeated-marker doc comments, grouped across contiguous same-indent
  lines the same way Python's `#` comments are. Directive comments
  (`# noqa`, `# type:`, `# pylint:`, `// eslint-disable`,
  `// @ts-expect-error`, `// NOLINT`, `// clang-format on/off`,
  `// NOPMD`, `// NOSONAR`, `// CHECKSTYLE:ON/OFF`, `// noinspection`,
  shebangs, encoding declarations) and anything that looks like
  commented-out code are left untouched rather than reflowed.
- **Docstrings and doc comments**, with structure-preserving reflow
  across six documentation dialects plus plain paragraph reflow:
  - **Google** — `Args:` / `Returns:` / `Raises:` sections, indented entries. (Python)
  - **NumPy** — `Parameters` + `----------` underline sections. (Python)
  - **Sphinx/reST** — `:param x:` / `:returns:` / `:rtype:` field lists. (Python)
  - **JSDoc** — `@param` / `@returns` / `@throws` tags. (JavaScript/TypeScript/TSX)
  - **Doxygen** — `\param` / `@param`, `\return` / `@return`, `\brief`,
    and other tags, either prefix accepted per tag; both `/** ... */` and
    `///` forms. (C++)
  - **Javadoc** — `@param` / `@return` / `@throws` and other tags; inline
    `{@link ...}` / `{@code ...}` tags kept intact automatically. (Java)
  - **Plain** — paragraph reflow only, no section structure.

  Dialect is detected **per docstring/comment**, not per file — mixed
  conventions in one codebase are common, and a file-level guess would
  be wrong somewhere. Lists, fenced code blocks, doctest (`>>>`) blocks,
  and already-indented examples are preserved verbatim rather than
  reflowed, since a wrong reflow guess mangling an aligned example or a
  runnable doctest is a real bug report, not a missed opportunity.
- **String literals** — the differentiating feature. Long string
  literals are split across multiple lines using whatever concatenation
  form the language actually needs: adjacent-literal implicit
  concatenation for Python (`"foo " "bar"`, adding enclosing parentheses
  when the surrounding syntax doesn't already provide grouping) and
  always for C++ (`"foo " "bar"`, which never needs its own grouping
  either way — C++ has no valid `+` string concatenation at all); or `+`
  operators for Python (when that's how the literal was already joined)
  and always for JavaScript/TypeScript/TSX/Java (which likewise never
  need their own grouping). Gated by a conservative **prose heuristic**
  (`rewrapPlus.stringPolicy`, default `prose`) so paths, URLs, regexes,
  dict/object keys, SQL, and `logging.info("%s failed", x)`-style format
  strings are left alone by default — see
  [What this won't touch](#what-this-wont-touch). Template literals
  (`` `...` ``) aren't wrapped in JavaScript/TypeScript/TSX yet, raw
  string literals (`R"(...)"`) aren't wrapped in C++, and text blocks
  (`"""..."""`) aren't wrapped in Java.
- **Directive comments** for per-region opt-in/opt-out, honored
  alongside comment wrapping and string wrapping alike:
  - `# rewrap: off` / `# rewrap: on` — toggle a range.
  - `# rewrap: ignore` — skip the next region only.
  - `# rewrap: force` — wrap even if the prose heuristic says no.
  - `# fmt: off` / `# fmt: on` — honored too, since Black users already
    have them (sets the same disabled state as `# rewrap: off`/`on`).

## Commands and keybindings

| Command | Keybinding | Notes |
|---|---|---|
| **Rewrap+: Wrap at Cursor** (`rewrapPlus.wrapAtCursor`) | `Alt+Q` (`Cmd+Alt+Q` on macOS) | Expands to the region containing the cursor. Multi-cursor wraps each region once, deduped. **Collides with stkb/Rewrap's own default `Alt+Q`** — rebind one of them (`Preferences: Open Keyboard Shortcuts`) if you have both installed. |
| **Rewrap+: Wrap Selection** (`rewrapPlus.wrapSelection`) | — | Each selection expands outward to its encompassing region(s); a selection spanning several regions wraps all of them. Also reachable via `Format Selection`. |
| **Rewrap+: Wrap Document** (`rewrapPlus.wrapDocument`) | — | Every wrappable region, applied as one atomic edit — a single undo reverts everything. Also reachable via `Format Document` when no other formatter is registered for the language. Shows a cancellable progress notification above 2000 lines. |
| **Rewrap+: Show Resolved Configuration** (`rewrapPlus.showResolvedConfig`) | — | Dumps the effective column limit (and which precedence tier it came from), active string/doc-dialect policy, and extension version for the current file to the "Rewrap+" output channel — a telemetry-free way to answer "why did it wrap at N?" or attach real diagnostics to a bug report. Works even in an unsupported language. |

## Settings

All settings live under `rewrapPlus.*` and are resource-scoped (so
`"[python]": { "rewrapPlus.columnLimit": 79 }`-style per-language
overrides work).

| Setting | Default | Description |
|---|---|---|
| `rewrapPlus.enable` | `true` | Global kill switch — disables every wrap command and the range-formatting provider at once. The setting to reach for when debugging a save pipeline with several formatters in it. |
| `rewrapPlus.columnLimit` | `null` | Column to wrap at. `null` falls through the [precedence chain](#column-limit-precedence) below. |
| `rewrapPlus.rulerIndex` | `0` | Which entry of `editor.rulers` to use when several are configured and `columnLimit` is `null`. Out of range falls back to the first ruler. |
| `rewrapPlus.wrapComments` | `true` | Wrap line and block comments. |
| `rewrapPlus.wrapStrings` | `true` | Wrap eligible string literals, subject to `stringPolicy`. |
| `rewrapPlus.stringPolicy` | `prose` | `off` never wraps strings. `prose` (the conservative default) wraps only strings that score as prose-like under the heuristic. `all` wraps every eligible string, ignoring the heuristic. |
| `rewrapPlus.docDialect` | `auto` | `auto` detects the dialect per docstring/doc comment. `google` / `numpy` / `sphinx` / `jsdoc` / `doxygen` / `javadoc` / `plain` forces that dialect regardless of its own shape. |
| `rewrapPlus.preserveIndentedBlocks` | `true` | Treat an already-indented block inside a comment/docstring (beyond a paragraph's first line) as verbatim rather than reflowing it. |
| `rewrapPlus.respectEditorConfig` | `true` | Consult `.editorconfig`'s `max_line_length` as a precedence tier, parsed directly by this extension — independent of whether the separate EditorConfig extension is installed. |
| `rewrapPlus.balancedWrapping` | `false` | Use minimum-raggedness (balanced) line breaking instead of greedy first-fit. Often visibly nicer for short comments/docstrings, at the cost of more computation. |
| `rewrapPlus.stringWrapInclude` | `["**"]` | **Not yet implemented.** Intended to scope string wrapping to specific path globs, letting it be trialled on one package before trusting it repo-wide; currently read but has no effect. |
| `rewrapPlus.formatOnSave` | `false` | Wrap the whole document automatically before every save. See [Format on save](#format-on-save) below. |

### Column limit precedence

Re-resolved on every wrap (never cached), highest priority first:

1. `rewrapPlus.columnLimit` (including a language-scoped override).
2. Language-scoped `editor.rulers` for the document's language.
3. `.editorconfig`'s `max_line_length`, if `rewrapPlus.respectEditorConfig` is on.
4. Global `editor.rulers` (`rewrapPlus.rulerIndex` picks which entry, if several are configured).
5. Built-in default: **80**.

`editor.rulers` entries may be a plain number or `{ column, color }` —
both are handled. Run **Rewrap+: Show Resolved Configuration** any time
the resolved limit is a surprise; it names the exact tier that produced it.

### Format on save

Two independent ways to wrap on save, because they solve different problems:

- **`rewrapPlus.formatOnSave`** (default `false`) — flip this on and
  Rewrap+ wraps the whole document immediately before every save, no
  further setup required. It fires regardless of what
  `editor.defaultFormatter` is set to for the language, so it composes
  cleanly with Black, Prettier, or any other formatter already running
  on save — Rewrap+ never contends with them for the "default formatter"
  slot. Never delays a save: a wrap that doesn't finish quickly (roughly
  1.5s — see `docs/benchmarks.md` for the numbers that bound is based
  on), or a parse failure, is skipped with a note in the "Rewrap+" output
  channel, and the save proceeds either way.
- **VSCode's own `editor.formatOnSave`** — Rewrap+ also registers a
  standard `DocumentFormattingEditProvider`, so setting
  `"[python]": { "editor.defaultFormatter": "jarinfrench.rewrap-plus" }`
  and `"editor.formatOnSave": true` works too, the same as any other
  formatter extension. Use this instead of `rewrapPlus.formatOnSave` if
  you want VSCode's native `editor.formatOnSaveMode` and
  `editor.codeActionsOnSave` ordering controls to apply to Rewrap+ as
  well — that ordering is entirely VSCode's own to configure; Rewrap+
  doesn't try to control it.

If Black/Prettier/etc. also run on save via `editor.defaultFormatter`,
they're unaffected by `rewrapPlus.formatOnSave` — it's a separate
`onWillSaveTextDocument` hook, not a competing default-formatter claim.
If instead you've set Rewrap+ *as* the default formatter for a language,
its ordering relative to other save-time actions (`editor
.codeActionsOnSave`, for instance) follows VSCode's usual rules for that
setting, same as it would for any formatter.

## What this won't touch

Left byte-identical, deliberately, rather than risk mangling behavior:

- **Raw strings** — Python's `r"..."`/byte strings `b"..."`, and C++'s
  `R"(...)"` — escapes can't be safely normalized in the former, and the
  latter is rarely prose (Python), or is simply a different grammar node
  the wrap engine never looks at in the first place (C++). A
  concatenation run with mixed prefixes (Python's `r`/`b`/`f`, or C++'s
  `L`/`u`/`U`/`u8` encoding prefixes) is treated the same way.
- **Paths, URLs, regexes, SQL, dict/object/i18n keys, and format-call
  arguments** (`logging.info("%s failed", x)`, the sole argument to
  `re.compile`/`open`/`Path`/`subprocess.*`) — the prose heuristic scores
  these low and leaves them alone under the default `prose` policy.
- **Doctest blocks** (`>>>` / `...`) inside docstrings — reflowing one
  would break the test it documents.
- **Commented-out code** — detected via punctuation density and
  Python's own keyword shapes, left verbatim rather than reflowed as prose.
- **Template literals** (`` `...` ``) in JavaScript/TypeScript/TSX —
  deferred the same way Python's own triple-quoted non-docstring strings
  are, given `${}` interpolation and significant internal whitespace.
- **Text blocks** (`"""..."""`, Java 15+) — the same node type as an
  ordinary string in Java's grammar, but never wrapped: a text block's
  own common-indentation-stripping and trailing-newline conventions have
  no representation in the wrap engine's syntax-strip-and-reflow model.
- **Anything inside a C++ `#define` macro body** — never reflowed, since
  the parser itself treats a macro's body as opaque, unparsed text.
- **Any region overlapping a parse error** — skipped with a reason
  (visible via the output channel), never partially edited.
- **File-final newline, trailing whitespace, and line endings** (LF vs
  CRLF, detected per region) — preserved exactly as found.

Two things worth naming as **known, deliberate limitations** rather than
bugs to report: continuation-line indentation for a split string literal
always uses the enclosing statement's indent **+4** (matching Black's
convention), with no setting yet to choose "align to the opening
delimiter" instead; and `rewrapPlus.stringWrapInclude` (above) is
declared but not yet consumed.

## Language coverage and related extensions

The table below compares Rewrap+ against the other actively-installable
general-purpose comment/text wrappers on the Marketplace, as of this
writing. It's deliberately not all wins for Rewrap+ — a table that only
lists advantages reads as marketing, and the honest gaps are exactly
what should steer a Markdown/LaTeX-heavy or non-Python user toward one
of the others instead of filing a bug here.

| Capability | [Rewrap](https://marketplace.visualstudio.com/items?itemName=stkb.rewrap) (stkb) | [Rewrap Revived](https://marketplace.visualstudio.com/items?itemName=dnut.rewrap-revived) (dnut) | [Reflow Markdown](https://marketplace.visualstudio.com/items?itemName=marvhen.reflow-markdown) | **Rewrap+** |
|---|---|---|---|---|
| Wrap line/block comments | Yes | Yes | No | Yes |
| Wrap doc comments (dialect-aware sections) | Yes | Yes | No | Yes (Python: Google/NumPy/Sphinx; JS/TS/TSX: JSDoc; C++: Doxygen; Java: Javadoc) |
| **Wrap string literals** | **No** | **No** | **No** | **Yes** |
| **Language-valid concatenation on split** | **No** | **No** | **No** | **Yes** |
| **Prose-vs-code string heuristic** | **No** | **No** | **No** | **Yes** |
| Parser | Line/regex-based | Line/regex-based | Markdown-aware | **tree-sitter AST** |
| Language coverage | Many | Many | Markdown only | Python, JavaScript, TypeScript, TSX, C++, Java |
| Markdown / LaTeX / plain-text files | Yes | Yes | Yes | **No** |
| Visual Studio (not just VS Code) support | Yes | Yes | No | **No** |
| `.editorconfig` support (in VS Code) | No¹ | No¹ | — | Direct, self-parsed |
| Format-on-save | No | No | — | Yes |

¹ Neither reads `.editorconfig` directly in VS Code; both fall back to
`editor.rulers`/`editor.wordWrapColumn`, which a user (or a separate
editorconfig-syncing extension) has to populate themselves. Rewrap's
Visual Studio build (not its VS Code build) can pick up rulers generated
from `.editorconfig` by a third extension, Editor Guidelines — a
narrower, VS-only, third-extension-dependent path worth naming precisely
rather than folding into a blanket "indirect support" claim.

Rewrap+ is also the newest and least battle-tested of the four by a wide
margin — Rewrap and its Rewrap Revived fork both have a long track
record across many languages; that maturity is a real advantage this
table's feature rows don't capture. This project's actual differentiator
is narrower and deeper: string-literal wrapping with language-valid
concatenation, which none of the alternatives above attempt at all
(hence the risk-management framing throughout this README's [What this
won't touch](#what-this-wont-touch) section — string wrapping is the
one feature here with no prior art to lean on).

Two related, deliberately-excluded items, worth a mention rather than a
row: [farre/rewrapper](https://github.com/farre/rewrapper) is a range
formatter for Wattsi (HTML Standard) formatting specifications, not a
general comment wrapper, and
[NextFaze/vscode-comment-wrap](https://github.com/NextFaze/vscode-comment-wrap)
is deprecated by its own author, whose README redirects users to Rewrap
— neither is a real alternative for the same job, so a comparison row
would just be padding this table with straw men.

Also worth tracking: [microsoft/vscode#237357](https://github.com/microsoft/vscode/issues/237357),
a request for native text reflow in VSCode itself, closed as "not
planned" — if that ever changes, it would overlap the comment/docstring
side of this extension's feature set, though not string wrapping.

## Development

See the repo root [README](../../README.md) for the monorepo layout,
build/test/lint commands, and how to add a new language.

## License

MIT — see [LICENSE](../../LICENSE). Third-party licenses for what this
extension actually bundles (`web-tree-sitter`, the vendored tree-sitter
grammars) are in
[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).
