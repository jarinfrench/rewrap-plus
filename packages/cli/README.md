# @rewrap-plus/cli

Command-line and pre-commit interface for [Rewrap+](../../README.md),
built on `@rewrap-plus/engine` unchanged — see
[`docs/adapters.md`](../../docs/adapters.md)'s CLI section for what
that separation looked like in practice.

## Usage

```bash
rewrap-plus [options] <path...>
```

`<path...>` is one or more files and/or directories. A directory is
walked recursively; files are wrapped based on their extension (see
"Supported languages" below). `node_modules`, dot-directories (`.git`,
`.vscode`, ...), `dist`, `out`, and `coverage` are skipped automatically
during a directory walk.

By default, matching files are rewrapped **in place**. Pass `--check` for
a dry run — nothing is written, and the process exits non-zero if any
file would change, which is what a CI job or pre-commit hook wants:

```bash
rewrap-plus --check src/
```

### Options

| Flag | Description |
| --- | --- |
| `--check` | Report what would change; exit non-zero if anything would, without writing. |
| `--language <id>` | Force a `languageId` for an explicit file argument whose extension isn't recognized. Ignored for files found via a directory walk. |
| `--column-limit <n>` | Override the resolved column limit. |
| `--tab-size <n>` | Override the resolved tab size. |
| `--wrap-comments` / `--no-wrap-comments` | |
| `--wrap-strings` / `--no-wrap-strings` | |
| `--string-policy <prose\|all\|off>` | |
| `--doc-dialect <auto\|google\|numpy\|sphinx\|jsdoc\|doxygen\|javadoc\|plain>` | |
| `--preserve-indented-blocks` / `--no-preserve-indented-blocks` | |
| `--balanced-wrapping` / `--no-balanced-wrapping` | |
| `--editorconfig` / `--no-editorconfig` | Enable/disable the `.editorconfig` `max_line_length` tier. |
| `-h`, `--help` | |
| `-v`, `--version` | |

### Supported languages

The same seven the VSCode extension registers: Python (`.py`, `.pyi`),
JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`), TypeScript (`.ts`, `.mts`,
`.cts`), TSX (`.tsx`), C++ (`.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`,
`.hh`, `.hxx`, `.h++`, `.h`), Java (`.java`), and Markdown (`.md`,
`.markdown`). See [`src/language-detection.ts`](src/language-detection.ts)
for the exact table, including the `.h` ambiguity note (there's no
separate C adapter, so a plain `.h` file is assumed to be C++).

**Markdown changes this tool's blast radius, worth knowing before running
it over an existing tree.** Every prior language here is *comments and
strings inside code* — a directory walk mostly leaves ordinary code lines
untouched. Markdown inverts that: the prose *is* the document, so a bare
`rewrap-plus .` now rewraps every `README.md` and every `docs/*.md` it
finds, and `--check` starts failing on any of them whose paragraphs
aren't already wrapped at the resolved column limit. There's no opt-out
flag for this — the existing `--language`, explicit path arguments, and
`<!-- rewrap: off/ignore -->` directive comments are the tools for
narrowing scope if a bare directory walk is too broad for a given repo.

## Configuration

Every option above can also come from a config file, in this precedence
order (highest to lowest):

1. The command-line flag.
2. The nearest `.rewraprc` or `.rewraprc.json`, walking up from the file
   being wrapped. Plain JSON, keyed exactly like the VSCode extension's
   `rewrapPlus.*` settings (camelCase, no prefix):

   ```json
   {
     "columnLimit": 88,
     "stringPolicy": "all"
   }
   ```

3. The nearest `pyproject.toml`'s `[tool.rewrap-plus]` table — kebab-case
   keys, matching Black/Ruff's own `[tool.*]` convention:

   ```toml
   [tool.rewrap-plus]
   column-limit = 88
   string-policy = "all"
   ```

4. `.editorconfig`'s `max_line_length` — **column limit only**, and only
   when `respectEditorConfig`/`respect-editor-config` (itself resolved
   through tiers 1–3 above) is `true` (the default).
5. Built-in defaults, matching the VSCode extension's own:
   `columnLimit: 80`, `tabSize: 4`, `wrapComments: true`,
   `wrapStrings: true`, `stringPolicy: 'prose'`, `docDialect: 'auto'`,
   `preserveIndentedBlocks: true`, `balancedWrapping: false`,
   `respectEditorConfig: true`.

Only the *nearest* `.rewraprc`/`pyproject.toml` is consulted (unlike
`.editorconfig`, which layers every ancestor file it finds) — the same
"nearest is the project config" convention Black and Ruff themselves use
for `pyproject.toml`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Nothing needed changing (or everything was rewritten cleanly). |
| `1` | `--check` found at least one file that would change. |
| `2` | A hard error: bad arguments, a missing path, an explicit file with an unrecognized extension and no `--language`, or a per-file processing error. |

## Known limitations

- Not `.gitignore`-aware beyond the fixed default-ignored directory list
  above — a project-specific ignore rule isn't consulted.
- Symlinked directories are not followed during a recursive walk.
- Only the nearest `.rewraprc`/`pyproject.toml` on the way up from each
  file is used; there's no layered-override chain the way
  `.editorconfig` has.
