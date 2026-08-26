# Rewrap+ - Implementation Plan

A VSCode extension that rewraps comments, docstrings, and string literals to a configured
column limit, preserving formatted structure and emitting language-valid concatenation.

---

## 0. Decisions of record

These are settled; the plan assumes them throughout.

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Extension host is Node/JS; you have prior experience |
| Parser | `web-tree-sitter` (WASM) | No native ABI coupling to VSCode's Electron build; portable; browser-capable later |
| Architecture | Monorepo: pure engine + thin VSCode glue | Enables future CLI/pre-commit reuse without rewrite |
| v1 language | Python only | Exercises every hard case (docstrings, 3 doc dialects, implicit concat) |
| v1 triggers | Manual commands only (cursor, selection, whole-file) | Format-on-save deferred to Phase 12 |
| String policy | Prose heuristic + on/off directives | Balances usefulness against mangling SQL/paths/keys |
| Idempotency model | Dissolve → reflow → emit | Same input always yields same output; no incremental line-pair logic |
| Parse errors | Skip region, warn, never block | Especially important once format-on-save lands |
| Tests | Written inside each feature phase; gold-file fixtures | Edge-case coverage lives in checked-in files, not assertions |
| Package name | `rewrap-plus` / display `Rewrap+` / publisher `jarinfrench` | npm+Marketplace naming rules |
| Settings namespace | `rewrapPlus.*` | VSCode camelCase config convention |
| License | MIT (confirmed) | Ecosystem norm; still verify dependency licenses at Phase 11 |
| v1 output | Installable `.vsix` | Marketplace publishing deferred |

### Commit style

Freeform but structured: short imperative subject (≤ 72 chars), optional `scope:` prefix
where it aids scanning (`engine:`, `python:`, `ext:`, `ci:`). Body used for non-obvious
rationale. No strict Conventional Commits.

### The central pipeline

Every phase below serves this one flow. Keep it in mind - it's the spine of the design.

```
source text
  → parse (tree-sitter)
  → discover regions (queries)
  → group into logical units (a concat run = ONE unit)
  → dissolve (strip syntax, unescape, recover logical text + structure)
  → segment (atoms: words, escapes, placeholders - never split inside one)
  → reflow (fit atoms to width, respecting block structure/indents)
  → emit (re-apply syntax, re-escape, insert language-correct concatenation)
  → diff → TextEdit[]
```

Dissolve/emit are per-language. Segment/reflow are shared. That split is the whole
reason the adapter interface can stay small.

---

## Phase 0 - Repository and scaffolding

**Goal:** An empty but correctly structured monorepo that builds, lints, and tests.

### Commits

1. `Initialize repository with license and readme`
   - `LICENSE` (MIT, © Jarin French), `README.md` stub, `.gitignore` (Node, VSCode, `*.vsix`, `dist/`, `out/`).
   - `CONTRIBUTING.md` stub noting commit style.

2. `Set up npm workspaces monorepo`
   - Root `package.json` with `"private": true`, `"workspaces": ["packages/*"]`.
   - `packages/engine/`, `packages/vscode-extension/`.
   - **Hard rule to document in README:** `packages/engine` must never import `vscode`.

3. `Add TypeScript configuration with project references`
   - Root `tsconfig.base.json` - `strict: true`, `noUncheckedIndexedAccess: true`,
     `exactOptionalPropertyTypes: true`, `target: ES2022`, `module: Node16`.
   - Per-package `tsconfig.json` extending base; extension references engine.

4. `Add ESLint and Prettier configuration`
   - Include an ESLint `no-restricted-imports` rule banning `vscode` inside `packages/engine`.
     This mechanically enforces decision #3 rather than relying on discipline.

5. `Add Vitest test harness with coverage reporting`
   - Vitest for the engine (fast, ESM-native, good snapshot support).
   - Root scripts: `build`, `test`, `lint`, `typecheck`.

6. `Add CI workflow for lint, typecheck, and test`
   - GitHub Actions, Node LTS matrix, runs on PR + main.

**Acceptance:** `npm ci && npm run build && npm test && npm run lint` passes on a clean clone.

---

## Phase 1 - Engine core types

**Goal:** The vocabulary of the whole system, with zero behavior.

### Commits

1. `engine: define source span and text edit primitives`
   ```ts
   export interface SourceSpan {
     startByte: number; endByte: number;
     startRow: number; startColumn: number;
     endRow: number;   endColumn: number;
   }
   export interface TextEdit { span: SourceSpan; newText: string; }
   ```
   Byte offsets *and* row/column: tree-sitter speaks bytes, VSCode speaks positions.
   Carry both to avoid lossy reconversion.

   > **UTF-16 vs UTF-8 caveat - decide here, not later.** tree-sitter indexes bytes
   > (UTF-8); VSCode `Position.character` counts UTF-16 code units. For any file with
   > non-ASCII content (em-dashes and smart quotes in docstrings are *extremely* common)
   > these diverge. Build a `PositionMapper` in this commit and use it everywhere.

2. `engine: define region kinds and wrappable region model`
   ```ts
   export type RegionKind =
     | 'lineComment' | 'blockComment' | 'docComment'
     | 'docstring'   | 'stringLiteral';

   export interface WrappableRegion {
     kind: RegionKind;
     span: SourceSpan;          // full extent, including all parts of a concat run
     parts: SourceSpan[];       // >1 only for concat runs
     rawText: string;
     indentColumn: number;      // visual column of the region's start (tabs expanded)
     languageId: string;
   }
   ```

3. `engine: define wrap configuration contract`
   ```ts
   export interface WrapConfig {
     columnLimit: number;
     tabSize: number;
     wrapComments: boolean;
     wrapStrings: boolean;
     stringPolicy: 'prose' | 'all' | 'off';
     docDialect: 'auto' | 'google' | 'numpy' | 'sphinx' | 'plain';
     preserveIndentedBlocks: boolean;
     concatStyle?: string;      // adapter-specific override
   }
   ```
   **Plain data only** - no VSCode types. This is the CLI-reuse seam.

4. `engine: define declarative language descriptor and adapter interface`

   **Design rule: an adapter is data first, code second.** Anything expressible as a
   descriptor field must not be a method - that's what keeps "add a language" a
   configuration task rather than a development project.

   ```ts
   export interface LanguageDescriptor {
     readonly id: string;                    // matches VSCode languageId
     readonly aliases?: string[];            // 'typescriptreact', 'cpp' vs 'c'
     readonly grammarWasm: string;

     readonly queries: {
       comments: string;                     // tree-sitter query source
       strings: string;
       concatenations?: string;
     };

     readonly comments: {
       line?: { marker: string; spaceAfter: boolean };
       block?: {
         open: string; close: string;
         continuationPrefix?: string;        // JSDoc '*', Doxygen - Python has none
         alignContinuation?: 'open' | 'indent';
       };
       doc?: { markers: string[]; dialects: DocDialectId[] };
       neverReflow: RegExp[];                // '# noqa', '// eslint-disable', pragmas
     };

     readonly strings: {
       quotes: QuoteSpec[];                  // delimiter, multiline?, escapes?
       prefixes: PrefixSpec[];               // 'r' | 'f' | 'b' | 'L' | 'u8' ...
       rawForms: RawFormSpec[];              // never reflowed
       escapes: EscapeSpec;                  // recognized sequences
       placeholders: RegExp[];               // {}, %s, ${} - atomic units
       concatenation: {
         style: 'implicit' | 'operator';
         operator?: string;
         requiresGrouping?: boolean;         // Python needs parens; C++ doesn't
         operatorPlacement?: 'leading' | 'trailing';
       };
     };
   }
   ```

   Escape hatches, all optional - a language needing none is pure data:
   ```ts
   export interface LanguageAdapter {
     readonly descriptor: LanguageDescriptor;
     classify?(node: SyntaxNode, source: string): RegionKind | null;
     groupRegions?(regions: WrappableRegion[]): WrappableRegion[];
     isSafeToWrap?(region: WrappableRegion, source: string): boolean;
     emitContext?(region: WrappableRegion, tree: Tree): EmitContext;
   }
   ```
   Default implementations of all four live in the engine and are driven entirely by
   the descriptor. Python will override `classify` (docstring-by-position) and
   `emitContext` (paren insertion); most languages should override nothing.

5. `engine: add language adapter registry with lazy resolution`
   ```ts
   export class AdapterRegistry {
     register(adapter: LanguageAdapter): void;
     resolve(languageId: string): LanguageAdapter | undefined;
     supportedLanguages(): string[];
   }
   ```
   - Keyed by `id` + `aliases`; grammar WASM loaded on first resolve, never eagerly.
   - The extension enumerates `supportedLanguages()` to build its activation events and
     to gray out commands in unsupported files - so **adding a language touches no
     extension code**, only the registry.
   - Validate descriptors at registration (queries compile, delimiters non-empty) and
     fail loudly with the adapter id; a malformed descriptor should never surface as a
     mysterious runtime error mid-wrap.

6. `engine: define logical document and block model`
   ```ts
   export type Block =
     | { type: 'paragraph'; atoms: Atom[] }
     | { type: 'listItem'; marker: string; hangingIndent: number; atoms: Atom[] }
     | { type: 'verbatim'; lines: string[] }     // code fences, tables, ASCII art
     | { type: 'blank' }
     | { type: 'sectionHeader'; text: string }   // Google "Args:", NumPy underlines
     | { type: 'fieldEntry'; label: string; hangingIndent: number; atoms: Atom[] };

   export interface LogicalDocument { blocks: Block[]; meta: DocMeta; }
   ```
   `verbatim` is the escape hatch that makes "preserve formatting" tractable -
   anything we can't confidently reflow becomes verbatim and passes through untouched.

7. `engine: add position mapper for utf-8 and utf-16 offsets`
   - Plus unit tests with emoji, CJK, combining characters, and smart quotes.

**Acceptance:** Types compile; `PositionMapper` is tested; no behavior yet.

---

## Phase 2 - Parser layer

**Goal:** Load `web-tree-sitter`, parse Python, expose a clean wrapper.

> **Risk flagged early:** grammar `.wasm` artifacts are the fiddliest part of this
> whole project. Some tree-sitter grammar npm packages ship prebuilt WASM, some don't,
> and building one yourself requires `tree-sitter build --wasm` with Emscripten or
> Docker. Resolve this in commit 1 before building anything on top of it - if the
> prebuilt route works, you save a whole build pipeline; if not, you need commit 2.

### Commits

1. `engine: add web-tree-sitter dependency and grammar loading spike`
   - Determine whether `tree-sitter-python` ships a usable prebuilt `.wasm`.
   - Throwaway script proving a parse works. Document the finding in `docs/parsing.md`.

2. `build: add grammar wasm build and vendoring pipeline` *(only if step 1 requires it)*
   - Script producing `tree-sitter-python.wasm` into `packages/engine/grammars/`.
   - Commit the artifact (with a provenance note: grammar version + commit SHA) so
     contributors don't need Emscripten. Document how to regenerate.

3. `engine: add parser manager with lazy async grammar initialization`
   ```ts
   export class ParserManager {
     static async create(opts: { wasmDir: string }): Promise<ParserManager>;
     async parserFor(languageId: string): Promise<Parser>;
   }
   ```
   - `web-tree-sitter` requires `await Parser.init()` before use - this is the async
     step that motivates lazy init rather than doing it at module load.
   - Cache `Language` objects; never reload a grammar twice.

4. `engine: add parse result wrapper exposing error node detection`
   ```ts
   export interface ParseResult {
     tree: Tree;
     hasErrors: boolean;
     errorSpans: SourceSpan[];
   }
   ```
   - Walk for `ERROR` and `MISSING` nodes; record spans.
   - This feeds the "skip region, warn, don't block" policy: a region is skipped only
     if it *overlaps* an error span, so one syntax error elsewhere doesn't disable
     the whole file.

5. `engine: add tests for parser initialization and error detection`
   - Valid Python parses cleanly; deliberately broken Python reports error spans.

**Acceptance:** Engine parses a Python file and reports error spans accurately.

---

## Phase 3 - Region discovery (Python)

**Goal:** Find every wrappable region, correctly grouped.

### Commits

1. `python: add adapter skeleton with comment and string queries`
   - Tree-sitter queries: `(comment) @comment`, `(string) @string`,
     `(concatenated_string) @concat`.
   - Verify capture names against the actual grammar version - node names differ
     between grammar releases; don't trust memory here.

2. `python: classify docstrings by syntactic position`
   - A docstring is a `string` that is the **first statement** of a `module`,
     `function_definition`, or `class_definition` body - *not* merely any triple-quoted
     string. This distinction is exactly your Phase-12-deferred concern: docstrings get
     rich treatment now, arbitrary triple-quoted strings are treated as ordinary
     string literals (and are likely to fail the prose heuristic anyway).
   - Also handle attribute docstrings (a bare string following an assignment) -
     recognized as `docstring` if `docDialect` handling is enabled.

3. `python: group adjacent string literals into concatenation runs`
   - Implicit adjacency: `("a" "b" "c")` → one `concatenated_string` node → one region
     with three `parts`.
   - Explicit `+`: a `binary_expression` tree whose every leaf is a string literal →
     one region. Recurse left-associatively; bail if any operand is a non-literal
     (`"a" + name + "b"` must **not** be treated as one wrappable unit).
   - This grouping is what makes idempotency work - Phase 10 depends on it.

4. `python: detect string prefixes and quote styles`
   - Prefixes: `r`, `b`, `f`, `u`, `rb`, `br`, and case variants.
   - **`r`-strings and `b`-strings must be flagged as non-reflowable by default** -
     raw strings can't have escapes normalized, and byte strings are rarely prose.
   - `f`-strings: reflowable, but interpolations `{...}` are atoms (Phase 6).
   - Mixed prefixes within one concat run → mark run as unsafe, skip.

5. `python: add region discovery tests with fixtures`
   - Fixture Python files covering: nested functions, class docstrings, module
     docstrings, dict-literal strings, f-strings, raw regex strings, multi-line
     implicit concatenation, `+`-concatenation, strings inside comprehensions.

**Acceptance:** For each fixture, discovered regions match a checked-in expected list
(kind, span, part count).

---

## Phase 4 - Block segmentation and structure detection

**Goal:** Turn raw region text into a `LogicalDocument` of blocks. Shared engine logic.

### Commits

1. `engine: add paragraph and blank-line block splitter`
   - Blank line separates paragraphs. Within a paragraph, all line breaks are soft
     (they'll be re-flowed).

2. `engine: add list item detection with hanging indent`
   - Bullets: `-`, `*`, `+`, `•`. Ordered: `1.`, `1)`, `a.`, `i.`.
   - Hanging indent = marker width + following whitespace; continuation lines align there.
   - Nested lists by leading indentation depth.

3. `engine: add verbatim block detection`
   - Fenced code (```` ``` ````, `~~~`), reST literal blocks (`::` + indented),
     doctest blocks (`>>>` / `...`), Markdown tables (`|`-delimited),
     and indented blocks when `preserveIndentedBlocks` is on.
   - **Bias toward verbatim when uncertain.** A missed reflow opportunity is invisible;
     a mangled ASCII table is a bug report.

4. `engine: add block splitter tests with gold fixtures`
   - Fixture directory `packages/engine/test/fixtures/blocks/` - input `.txt`,
     expected block JSON.

**Acceptance:** Blocks round-trip: a document with no over-limit lines produces identical
output through segment → reflow → emit.

---

## Phase 5 - Atom segmentation and the reflow algorithm

**Goal:** The core wrapping engine. Pure functions, heavily tested.

### Commits

1. `engine: add atom segmentation with unbreakable unit support`
   ```ts
   export interface Atom {
     text: string;
     width: number;          // display width, not char count
     breakBefore: boolean;
     glue?: 'none' | 'space';
   }
   ```
   Atoms are whitespace-delimited words **except** that these are never split internally:
   - escape sequences (`\n`, `\t`, `\\`, `\x41`, `\u1234`, `\U0001F600`, `\N{NAME}`)
   - format placeholders (`{}`, `{0}`, `{name!r:>10}`, `%s`, `%(key)d`)
   - f-string interpolations `{expr}` - including nested braces and format specs
   - URLs and filesystem paths (kept whole; they're the classic overflow case)
   - inline code spans (`` `x` ``), reST roles (`` :func:`x` ``)

   This is the concrete implementation of "never break inside an escape or placeholder."
   Getting it wrong produces *invalid strings*, not just ugly ones.

2. `engine: add display width calculation for wide and combining characters`
   - East Asian Wide/Fullwidth count as 2 columns; combining marks as 0.
   - Matters for CJK comments and any emoji in docstrings.

3. `engine: implement greedy reflow with width and indent constraints`
   ```ts
   export function reflowBlock(
     block: Block, availableWidth: number, hangingIndent: number
   ): string[];
   ```
   - Greedy first-fit (matches Rewrap's behavior and user expectation).
   - **Overflow rule:** an atom wider than the available width is placed alone on its
     line and allowed to exceed the limit - never force-split. (Your decision #5.)

4. `engine: add optional balanced (minimum-raggedness) reflow mode`
   - Knuth–Plass-style dynamic programming behind a setting, default off.
   - Cheap to add once greedy exists; genuinely nicer for short docstrings.
   - Defer if time-constrained - mark as optional in v1.

5. `engine: add reflow tests including overflow and width edge cases`
   - Long URL alone; long URL mid-paragraph; atom exactly at limit; atom at limit+1;
     hanging indent leaving < 10 columns; CJK text; zero-width limit guard.

**Acceptance:** Gold fixtures for reflow pass; no output line exceeds the limit unless it
is a single unbreakable atom.

---

## Phase 6 - Python comment wrapping (first end-to-end path)

**Goal:** The first vertical slice that actually changes a file.

### Commits

1. `python: implement line comment dissolve`
   - Consecutive `#` comments at the same indent = one logical block.
   - Strip `#` and one following space; preserve shebangs (`#!`), encoding
     declarations, `# type:` comments, `# noqa`, `# pylint:` - all pass through verbatim.
   - **Directive comments must never be reflowed** - moving `# noqa` to another line
     changes program behavior. Treat as verbatim.

2. `python: implement line comment emit with prefix restoration`
   - Re-apply `# ` at correct indentation; preserve original spacing convention
     (`#comment` vs `# comment`) as observed.

3. `python: wire dissolve, reflow, and emit into a wrap entry point`
   ```ts
   export async function wrapRegions(
     source: string, languageId: string,
     targets: SourceSpan[] | 'all', cfg: WrapConfig
   ): Promise<WrapResult>;
   ```
   `WrapResult` carries `edits: TextEdit[]` plus `skipped: SkippedRegion[]` (with
   reasons) - the extension needs the skip reasons for its warnings.

4. `python: add end-to-end comment wrapping gold tests`
   - `test/fixtures/python/comments/NNN-description.{in,out}.py`, driven by a
     directory-walking test that diffs actual vs `.out`.
   - Include: trailing comments after code, comment blocks at varying indents,
     comments inside function bodies, a comment already correctly wrapped (must be
     byte-identical output), commented-out code (should be verbatim - detect via
     high punctuation density / parseability).

**Acceptance:** Python comment wrapping works end-to-end in the engine, no VSCode yet.

---

## Phase 6b - Adapter conformance kit and canary language

**Goal:** Prove the adapter seam holds *before* Python-specific work hardens around it.

This phase exists purely to answer "can a new language be added without touching the
engine?" - and to answer it at the cheapest possible moment. Skipping it doesn't save
work; it defers the same work to a point where the fix is far more expensive.

### Commits

1. `engine: add shared adapter conformance test kit`
   ```ts
   export function runAdapterConformance(
     adapter: LanguageAdapter, fixtures: ConformanceFixtures
   ): void;
   ```
   A parameterized suite every adapter must pass, asserting language-independent
   invariants:
   - Descriptor validates; all tree-sitter queries compile against the grammar.
   - Every declared comment and string form is discovered in a probe file.
   - Wrapping is idempotent across all of the adapter's fixtures.
   - Output re-parses with zero error nodes.
   - Already-wrapped input is byte-identical after wrapping.
   - No line exceeds the limit except a lone unbreakable atom.
   - Line endings, trailing whitespace, and file-final newline preserved.

   **This is the deliverable that makes new languages cheap.** Adding a language means
   writing a descriptor plus fixtures and calling one function - not designing a test
   strategy from scratch.

2. `engine: add block comment continuation prefix support`
   Python has no block comments, so nothing in Phase 6 exercises this - and it's the
   single most likely gap when JS/TS and C++ arrive. Build it now, driven by the
   descriptor's `continuationPrefix` / `alignContinuation`:
   - `/** ... */` with leading `*` on each line (JSDoc, Doxygen, Javadoc)
   - `/* ... */` with no continuation marker
   - repeated line-doc markers (`///`, `//!`)
   - correct handling of the open/close delimiters when reflow changes line count

3. `canary: add minimal javascript adapter for comments only`
   - Descriptor only - `//`, `/* */`, `/** */`. **No strings, no dialects, no
     docstrings.** Deliberately thin; it's a probe, not a feature.
   - Grammar: `tree-sitter-javascript` WASM (also validates that the Phase 2 grammar
     pipeline generalizes past one grammar, which is itself worth knowing early).

4. `canary: run conformance kit against python and javascript adapters`
   - **Hard gate: if this commit requires any change under `engine/src/core`, stop and
     fix the abstraction before proceeding to Phase 7.** Engine changes here are the
     signal you asked about - cheap now, expensive after Phases 8–9.
   - Record any engine changes that *were* needed in `docs/adapters.md` as
     known-leaked assumptions.

**Acceptance:** Both adapters pass the identical conformance suite. The JS adapter
contains no imperative code - descriptor and fixtures only.

---

## Phase 7 - VSCode integration and manual commands

**Goal:** A usable extension. This is the first installable milestone.

### Commits

1. `ext: add extension manifest and activation`
   - `package.json`: `displayName: "Rewrap+"`, `name: "rewrap-plus"`,
     `publisher: "jarinfrench"`, `categories: ["Formatters"]`.
   - **`engines.vscode`: `^1.122.0`**, with `@types/vscode` pinned to `1.122.x`.
     Rationale: current release is 1.134 (Aug 2026), so ~1.122 is roughly a year back -
     wide compatibility without giving up modern APIs. Critically, it sits *below* the
     local dev install (1.125), so the extension is runnable/dogfoodable locally; a
     floor above your own VSCode version would make it uninstallable for you.
     `engines.vscode` must always be ≥ `@types/vscode`.
   - Activation: `onCommand:*` only (do **not** use `*`; it slows every window start).
     Add `onStartupFinished` later only if format-on-save needs it.

2. `ext: implement column limit resolution with documented precedence`
   Resolution order (highest → lowest), re-resolved per wrap invocation (not cached):
   1. `rewrapPlus.columnLimit` - including language-scoped (`"[python]": {...}`)
   2. Language-scoped `editor.rulers` for the document's language
   3. `.editorconfig` `max_line_length` (parsed directly - see commit 3)
   4. Global `editor.rulers`
   5. Built-in default: `80`
   - `editor.rulers` entries may be `number` or `{ column, color }` - handle both.
   - `rewrapPlus.rulerIndex` (default `0`) selects which ruler when several exist.
   - Emit the resolved limit + its source in the output channel; "why did it wrap at
     N?" will otherwise be your most common issue.

3. `ext: add self-contained editorconfig parsing`
   - Walk up from the file to the nearest `root = true`; apply `[*.py]`-style globs.
   - **Parse it yourself** rather than depending on the EditorConfig extension being
     installed - otherwise precedence tier 3 silently disappears for some users, which
     is worse than not supporting it at all.

4. `ext: add configuration schema and defaults`
   - `rewrapPlus.enable` (`boolean`, default `true`) - global kill switch. Sounds
     redundant next to per-feature toggles, but it's the setting users reach for when
     debugging a save pipeline with three formatters in it (prior art:
     `farre/rewrapper` justifies its equivalent exactly this way).
   - `rewrapPlus.columnLimit` (`number | null`, default `null` = fall through)
   - `rewrapPlus.rulerIndex`, `.wrapComments`, `.wrapStrings`, `.stringPolicy`,
     `.docDialect`, `.preserveIndentedBlocks`, `.respectEditorConfig`,
     `.balancedWrapping`
   - `rewrapPlus.stringWrapInclude` (`string[]` of globs, default `["**"]`) - scopes
     *string* wrapping to specific paths. A cheap de-risking lever for Phase 9: users
     can enable string wrapping on one package or `docs/` before trusting it
     repo-wide, rather than facing an all-or-nothing choice on a feature that edits
     program values.
   - Every key gets a `markdownDescription`; enums get `enumDescriptions`.

5. `ext: implement wrap-at-cursor command`
   - `rewrapPlus.wrapAtCursor`, keybinding `alt+q` (`cmd+alt+q`… see note) when
     `editorTextFocus`.
   - Expands to the region containing the cursor. Multi-cursor: wrap each region once,
     dedupe overlaps, apply as one edit.
   - **Document the `Alt+Q` collision with stkb/Rewrap in the README** and note that
     both can't sensibly be bound at once.

6. `ext: implement wrap-selection command with region expansion`
   - Selection expands outward to encompassing region boundaries (your requirement:
     never wrap half a string).
   - Selection spanning several regions wraps all fully-or-partially covered ones.
   - **Also register a `DocumentRangeFormattingProvider`** backed by the same code path
     (prior art: `farre/rewrapper`). This gives "Format Selection" integration for
     free, and VSCode supplies the full document range automatically when nothing is
     selected - so the provider covers both selection and whole-document wrapping
     without duplicated logic. Keep the explicit commands too, for keybinding.

7. `ext: implement wrap-document command`
   - All regions, single atomic `WorkspaceEdit` so one undo reverts everything.

8. `ext: add output channel and non-blocking warning surface`
   - Skipped regions reported with reasons; parse errors warn without blocking.
   - Status-bar message for "N regions wrapped, M skipped".

9. `ext: add integration tests with @vscode/test-electron`
   - Open fixture, run command, assert buffer contents.

**Acceptance:** `vsce package` produces a `.vsix`; installing it gives working comment
wrapping in Python with correct column resolution. **This is the first demo-able build.**

---

## Phase 8 - Docstrings and documentation dialects

**Goal:** Rich, structure-preserving docstring reflow.

### Commits

1. `python: implement docstring dissolve with quote and indent handling`
   - Detect `"""` / `'''`; preserve the chosen style.
   - Compute common indentation (PEP 257 style) and strip it for reflow; restore on emit.
   - Preserve the summary-line convention: first line stays on its own line, and
     whether the closing `"""` sits on its own line is preserved as observed.

2. `docs: add dialect registry decoupled from language adapters`
   **Dialects are their own pluggable layer, not adapter internals.** Doxygen spans
   C++/C/Java; JSDoc spans JS/TS/Flow. If dialect logic lives inside a language
   adapter it gets reimplemented per language.
   ```ts
   export interface DocDialect {
     readonly id: DocDialectId;
     detect(text: string): number;                    // 0..1 confidence
     segment(text: string): Block[];
     emit(blocks: Block[], ctx: DocEmitContext): string[];
   }
   export class DialectRegistry { register(d: DocDialect): void; /* ... */ }
   ```
   A descriptor lists which dialect ids apply (`comments.doc.dialects`); the engine
   picks among them by confidence. Adding Doxygen later makes it instantly available
   to every C-family adapter.

3. `docs: add dialect detection for google, numpy, and sphinx styles`
   - Google: `Args:` / `Returns:` / `Raises:` headers, indented entries.
   - NumPy: `Parameters` + `----------` underline.
   - Sphinx/reST: `:param x:` / `:returns:` / `:rtype:` field lists.
   - **Detect per docstring, not per file** - mixed conventions in one codebase are
     common and a file-level guess will be wrong somewhere.
   - Confidence scoring; ambiguous → `plain` (paragraph reflow only).

4. `docs: implement google-style section reflow`
   - Section headers verbatim; entries as `fieldEntry` with hanging indent aligned
     under the parameter name.

5. `docs: implement numpy-style section reflow`
   - Header + underline treated as an atomic unit; underline length re-synced to
     header length if the header is untouched.

6. `docs: implement sphinx field list reflow`
   - `:param name: description` → `fieldEntry` with label `:param name:`, continuation
     lines indented consistently.

7. `python: preserve doctest and code blocks inside docstrings verbatim`
   - `>>>` / `...` blocks never reflowed - reflowing a doctest breaks the test.

8. `docs: add docstring gold fixtures across all dialects`
   - Per dialect: minimal, typical, pathological (very long param names, nested lists
     inside descriptions, code fence inside a param description, unicode).
   - Include an "already correctly wrapped" case per dialect asserting byte-identical output.

**Acceptance:** All docstring fixtures pass; no dialect's structural markers are lost.

---

## Phase 9 - String literal wrapping

**Goal:** The differentiating feature. Highest risk - gate it carefully.

### Commits

1. `python: implement string dissolve with unescaping`
   - Concat run → single logical string; record original quote style, prefixes, and
     the concatenation form used (implicit vs `+`).
   - Unescape to logical text; **remember which escapes were present** so emit can
     restore them faithfully rather than re-escaping by rule.
   - Refuse (mark unsafe): raw strings, byte strings, mixed prefixes, strings with
     line continuations, anything overlapping a parse error.

2. `python: implement string emit with implicit concatenation`
   - Default Python style: adjacent literals inside parentheses.
   - **Add parentheses when required** - a bare multi-part literal is only valid where
     grouping already exists. Detect the enclosing context (call argument, assignment
     RHS, return, subscript) and insert parens if absent.
   - Continuation lines indented to the opening delimiter or +4, per setting.
   - Preserve the trailing space at split points - `"foo " "bar"` not `"foo" "bar"`.
     This is the single most likely source of silent behavior change; test it hard.

3. `python: add plus-operator concatenation emit mode`
   - For runs that were originally `+`-joined, preserve `+`. Operator placement
     (trailing vs leading) follows a setting; default trailing to match PEP 8 tolerance
     and existing-code convention.

4. `engine: implement prose heuristic for string wrap eligibility`
   Score a string as prose-like; wrap only above threshold. Signals:
   - **Positive:** multiple spaces; words are mostly dictionary-shaped; sentence
     punctuation; length well over the limit.
   - **Negative:** looks like a path (`/`, `\`, drive letters); a URL; a regex
     (character classes, quantifiers, anchors - especially in an `r`-string); SQL
     keywords; an identifier-like key (`snake_case`, `dotted.name`) with no spaces;
     high symbol density; contains `\n` used as a record separator; a single long token.
   - **Context signals:** string is a dict key → skip. String is the sole argument to
     `re.compile`, `open`, `Path`, `subprocess.*`, or a logging call's format slot →
     skip or downgrade.
   - Expose `rewrapPlus.stringPolicy`: `off` | `prose` (default) | `all`.

5. `engine: add directive comment support for opt-in and opt-out`
   - `# rewrap: off` / `# rewrap: on` - region toggles.
   - `# rewrap: ignore` - skip the next region.
   - `# rewrap: force` - wrap even if the heuristic says no (the escape hatch that
     makes a conservative default acceptable).
   - `# fmt: off` / `# fmt: on` honored as well, since Black users already have them.

6. `python: add string wrapping gold fixtures and negative cases`
   - **Positive:** long prose message split across lines; existing 2-part concat
     re-balanced; f-string with interpolations; string needing parens inserted.
   - **Negative (must be untouched):** SQL query, regex, URL, dict keys, i18n keys,
     `logging.info("%s failed", x)`, path literals, raw strings.
   - **Behavior-preservation test:** for every positive fixture, `eval` the string
     expression before and after and assert equality. This is the strongest possible
     guard against silent corruption and is worth the effort.

**Acceptance:** All string fixtures pass; the eval-equivalence test passes for every
wrapped string; every negative fixture is byte-identical after wrapping.

---

## Phase 10 - Hardening

**Goal:** Correctness invariants, performance, and failure behavior.

### Commits

1. `engine: add idempotency property tests`
   - `wrap(wrap(x)) === wrap(x)` across **every** fixture in the repo.
   - Wire into CI as a blocking check. This is the invariant most likely to regress
     silently as adapters grow.

2. `engine: add round-trip property tests with generated input`
   - Fast-check generators for comments/docstrings/strings; assert: idempotent, no
     line over limit except lone atoms, output still parses, string values unchanged.

3. `engine: harden parse error and unsafe region handling`
   - Region overlapping an error span → skip with reason, never partial-edit.
   - Guard against pathological inputs: single 100k-char string, deeply nested concat,
     file with no trailing newline, CRLF line endings, mixed tabs/spaces.

4. `engine: add line ending and trailing whitespace preservation`
   - Detect and preserve CRLF vs LF per file. Never introduce trailing whitespace.

5. `ext: add performance benchmarks and large-file guardrails`
   - Benchmark wrap-document on 1k / 10k / 50k-line files.
   - If wrap-document exceeds a threshold, run with progress notification and
     cancellation support.
   - Budget: wrap-at-cursor should feel instant (< 50 ms after warm grammar load).

6. `ext: add telemetry-free diagnostic command`
   - `rewrapPlus.showResolvedConfig` - dumps effective limit, its source, active
     dialect, adapter version. Makes bug reports actionable without telemetry.

**Acceptance:** Idempotency and property tests green in CI; benchmarks documented.

---

## Phase 11 - Packaging and release

**Goal:** A distributable `.vsix`.

### Commits

1. `build: add esbuild bundling for the extension`
   - Bundle TS to a single `dist/extension.js`.
   - **Mark `vscode` external, and do not bundle `.wasm`** - copy grammar WASM as
     assets and resolve at runtime via `context.extensionUri`. Bundlers mangling WASM
     paths is a classic packaging failure.

2. `build: add vsce packaging configuration`
   - `.vscodeignore` excluding sources, tests, fixtures - but **explicitly including
     `grammars/*.wasm`**. Verify the packaged `.vsix` contains them.

3. `docs: write user-facing readme with settings and precedence table`
   - Feature list, the column-limit precedence chain, all settings, directive syntax,
     the `Alt+Q` collision note, and an explicit "what this won't touch" section
     (raw strings, regexes, doctests) - setting expectations prevents most bug reports.

4. `docs: add comparison table against Rewrap and related extensions`
   - **Be honest about the gaps, not just the wins.** A table that only lists Rewrap+
     advantages reads as marketing; showing where the mature alternatives are still
     better is what makes the comparison credible - and steers users who need
     Markdown/LaTeX wrapping to the right tool instead of filing bugs here.

   Draft (verify each cell against current versions before publishing):

   | Capability | Rewrap (stkb) | Rewrap Revived (dnut) | Reflow Markdown | **Rewrap+** |
   |---|---|---|---|---|
   | Maintained | No | Yes | - | Yes |
   | Wrap line/block comments | Yes | Yes | No | Yes |
   | Wrap doc comments (JSDoc/XMLDoc tags) | Yes | Yes | No | Yes (Python dialects v1) |
   | **Wrap string literals** | **No** | **No** | **No** | **Yes** |
   | **Language-valid concatenation on split** | **No** | **No** | **No** | **Yes** |
   | **Prose-vs-code string heuristic** | **No** | **No** | **No** | **Yes** |
   | Parser | Line/regex-based | Line/regex-based | Markdown | **tree-sitter AST** |
   | Language coverage | Many | Many | Markdown only | Python only (v1) |
   | Markdown / LaTeX / plain-text files | Yes | Yes | Yes | **No (v1)** |
   | Visual Studio support | Yes | Yes | No | **No** |
   | Per-language settings | Yes | Yes | - | Yes |
   | `.editorconfig` support | Indirect (via rulers) | Indirect | - | Direct, self-parsed |
   | Format-on-save | No | No | - | Planned (12a) |
   | OpenVSX distribution | - | Yes | - | Planned (see below) |

   - Link to [microsoft/vscode#237357](https://github.com/microsoft/vscode/issues/237357)
     (open request for native reflow) in a "prior art / related" section. Worth
     tracking: native comment reflow would overlap the Phase 6–8 feature set, though
     not the string wrapping in Phase 9.

   - **Deliberately excluded from the table** (mention in prose only, if at all -
     listing them as competitors would be padding the comparison with straw men):
     - `farre/rewrapper` - not a general comment wrapper. A range formatter for Wattsi
       formatting specifications, aimed at HTML Standard contributors; wraps a
       third-party engine. Different problem entirely.
     - `NextFaze/vscode-comment-wrap` - deprecated by its own author, whose README
       redirects users to Rewrap. Self-described 15-minute proof of concept; no Python
       support.

5. `docs: write adding-a-language contributor guide with scaffold script`
   - Step-by-step: obtain grammar WASM → write descriptor → add fixtures → call
     `runAdapterConformance` → register. Explicitly state that **no engine changes
     should be required**, and that needing one is a bug report, not a normal step.
   - `npm run new-adapter -- <languageId>` scaffolds the descriptor stub, fixture
     directories, and conformance test file.
   - Document the current known-leaked assumptions from `docs/adapters.md` honestly -
     a contributor hitting an undocumented leak is far more likely to abandon than one
     who was warned.

6. `legal: verify and document third-party license compatibility`
   - Confirm the licenses of `web-tree-sitter` and the Python grammar; add
     `THIRD-PARTY-NOTICES.md`. Do this before publishing, not after.
   - Revisit MIT vs Apache 2.0 here if any dependency pushes the decision.

7. `ci: add packaging job producing a vsix artifact`
   - Build `.vsix` on tags; attach to GitHub Releases.

8. `docs: add changelog`

**Acceptance:** A downloaded `.vsix` installs cleanly on a machine with no toolchain and
wraps Python comments, docstrings, and prose strings correctly.

---

## Phase 12 - Post-v1 roadmap

Sequenced by value-to-risk ratio.

### 12a - Format-on-save
- `rewrapPlus.formatOnSave` (default **off**).
- Register as a `DocumentFormattingEditProvider` so it composes with other formatters
  rather than fighting them, and honor `editor.formatOnSave` semantics.
- **Never block or delay a save.** Parse failure → warn asynchronously, save proceeds.
- Interaction note: if Black/Prettier also runs on save, ordering is user-controlled
  via `editor.defaultFormatter` + `editor.codeActionsOnSave`; document the recommended
  configuration rather than trying to control it.

### 12b - JavaScript/TypeScript adapter (full)
- The comment-only canary from Phase 6b already exists; this phase extends it.
- Grammar: `tree-sitter-typescript` (note: TSX is a *separate* grammar from TS).
- JSDoc as a registered dialect (`@param`/`@returns`) - reusable by Flow, and
  structurally similar to Doxygen for 12c.
- Strings: `'`, `"`, template literals. **Template literals are hard** - `${}`
  interpolations and significant internal whitespace. Consider deferring templates the
  way triple-quoted code strings were deferred in Python.
- Concatenation: `operator` style, `+`, no implicit adjacency, no grouping requirement.
- **Expected engine changes: zero.** If the descriptor can't express it, that's a
  finding to fix in the engine, not to work around in the adapter.

### 12c - C++ adapter
- Grammar: `tree-sitter-cpp`. Comments `//`, `/* */`, Doxygen (`///`, `/** */`, `\param`).
- Strings: implicit adjacent concatenation (like Python), raw strings `R"(...)"`
  (never wrap), wide/UTF prefixes `L`, `u8`, `u`, `U`.
- Preprocessor line continuations (`\` at EOL in macros) are a genuine hazard - skip
  strings inside macro definitions in the first pass.

### 12d - CLI and pre-commit
- `packages/cli` consuming `packages/engine` unchanged.
- Config from `.rewraprc` / `pyproject.toml` `[tool.rewrap-plus]` / flags.
- `--check` mode (non-zero exit on changes needed) for CI and pre-commit hooks.
- **This phase is the proof that the engine/glue separation held.** If the CLI needs
  engine changes, the seam leaked.

### 12e - Marketplace and OpenVSX publishing
- Create the `jarinfrench` publisher via Azure DevOps; store a PAT as a CI secret;
  `vsce publish` on tagged releases.
- **Also publish to OpenVSX** (`ovsx publish`). Rewrap Revived does this, and it's how
  VSCodium, Gitpod, Cursor, and other non-Microsoft builds install extensions - a
  meaningful audience for roughly one extra CI step.

### 12f - Stretch
- Triple-quoted non-docstring code strings (the deferred case).
- Additional languages: Rust, Go, Java, Ruby.
- `web-tree-sitter` already being WASM means browser VSCode (`vscode.dev`) support is
  mostly a manifest change - worth revisiting once stable.

---

## Critical risks

| Risk | Phase | Mitigation |
|---|---|---|
| Grammar WASM build/packaging friction | 2, 11 | Spike it *first*; vendor the artifact; verify `.vsix` contents |
| Silent string corruption | 9 | Eval-equivalence tests; conservative prose heuristic; extensive negative fixtures |
| Missing parens on Python implicit concat | 9 | Context detection; every emit fixture must re-parse |
| Dialect misdetection mangling docstrings | 8 | Per-docstring detection; fall back to `plain` when ambiguous |
| UTF-16/UTF-8 offset drift | 1 | `PositionMapper` built before any editing code |
| Idempotency regressions as adapters grow | 10 | Blocking CI property test across all fixtures |
| Adapter interface leaking Python assumptions | **6b**, 12b | Canary JS adapter + conformance kit *before* Phase 7; engine change at the 6b gate blocks progress |
| New language requires engine changes | 1, 6b, 11 | Descriptor-first design; conformance kit; scaffold script; leaks documented in `docs/adapters.md` |

## Suggested milestones

- **M1 (end of Phase 7):** installable `.vsix`, Python comment wrapping - first demo.
- **M2 (end of Phase 8):** docstrings across three dialects - the "better than existing
  extensions" moment.
- **M3 (end of Phase 9):** string wrapping - the genuinely novel capability.
- **M4 (end of Phase 11):** hardened, documented, releasable v1.
