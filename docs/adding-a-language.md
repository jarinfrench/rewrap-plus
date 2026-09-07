# Adding a language

The whole point of the adapter conformance kit (built alongside the
JavaScript canary) was to make this true: **a new language means writing
a descriptor plus fixtures and calling `runAdapterConformance`, not
designing a test strategy from scratch — and not discovering mid-way
through that dissolve/emit secretly assumed Python.** If you find
yourself needing to change anything under `packages/engine/src/core`
(comment/reflow/segment/emit shared logic, the adapter interface itself)
to add a language, **stop** — that's a bug in the adapter interface, not
a normal step, and it's worth a GitHub issue before working around it.
`docs/adapters.md` records the leaks that investigation itself found and
fixed this way; read it before starting, and add to it if you find a new
one.

## Before you start

Read, in this order:

1. **This file**, for the step-by-step.
2. **`docs/parsing.md`** — how grammar WASM gets sourced (prebuilt vs.
   built-it-yourself) and the "probe before coding" finding that drives
   step 3 below.
3. **`docs/adapters.md`** — every cross-cutting engine finding recorded so
   far: leaked Python-only assumptions that were found and fixed, the
   JavaScript canary's own grammar findings, and deliberate scope limits
   worth distinguishing from oversights. A second reader hitting an
   undocumented leak is far more likely to abandon than one who was
   warned.
4. **`packages/engine/src/languages/javascript/`** — the smallest real
   example in the repo (comments only, no strings/dialects/docstrings).
   `packages/engine/src/languages/python/` is the fullest example, for
   when a hook genuinely needs overriding.

## Steps

### 1. Obtain and vendor the grammar WASM

Check whether the language's `tree-sitter-<language>` npm package ships
a prebuilt `.wasm` at its package root (true for both `tree-sitter-python`
and `tree-sitter-javascript` as of the versions vendored here — see
`docs/parsing.md` for how that was confirmed, and don't assume it holds
for a new grammar without checking). If so:

```bash
npm view tree-sitter-<language> versions --json
npm pack tree-sitter-<language>@<version>
# extract the tarball, confirm tree-sitter-<language>.wasm is at its root
```

If no prebuilt WASM exists, you need `tree-sitter build --wasm` with
Emscripten or Docker — `docs/parsing.md` covers why this repo avoided
that so far and what to expect if a grammar forces the issue.

**Before this file is trusted or vendored — mandatory, regardless of
which path produced it:** load it with this project's actual pinned
`web-tree-sitter` version and parse a representative snippet of the
target language. A prebuilt `.wasm` existing at the expected package
path, or a local build completing without error, is evidence the
artifact *exists* — it is not evidence it *loads* with this project's
runtime, and those turned out to be two separate facts in practice:
`tree-sitter-dart`'s npm-published prebuilt `.wasm` throws a `dylink
metadata` error under this project's pinned `web-tree-sitter`, despite
being shaped identically to every grammar vendored successfully so far,
while rebuilding from the same tarball's `src/` with this project's
pinned `tree-sitter-cli` fixed it immediately (see
`docs/language-candidates.md`, Finding D, for the full writeup). The
minimal check:

```js
import { Parser, Language } from 'web-tree-sitter';
await Parser.init();
const language = await Language.load('<path-to-the-new-.wasm>');
const parser = new Parser();
parser.setLanguage(language); // throws here if the ABI is incompatible
const tree = parser.parse('<a small real snippet of the target language>');
console.log(tree.rootNode.toString()); // throws before this if the file won't load at all
```

`docs/spikes/tree-sitter-wasm-loading.mjs` is the original throwaway
script this pattern comes from — copy its shape rather than writing
this from scratch.

Only once this succeeds should you copy the file into
`packages/engine/grammars/` and add an entry to that directory's
`PROVENANCE.md` recording the source package, version, upstream commit,
tarball checksum, vendored-file checksum, and grammar ABI version —
follow the existing entries there exactly; they're the template, and
that file's own general vendoring guidance repeats this load-check as a
standing requirement, not a one-off.

Step 3 below goes further than this smoke test — it probes real node
shapes, not just "does it load at all" — but don't skip straight there
without this cheaper check first: it's the fast, unambiguous signal
that something is wrong with the artifact itself, before spending time
writing descriptor code against it.

### 2. Scaffold the boilerplate

```bash
npm run new-adapter -- <languageId>
```

This step assumes step 1's grammar WASM has already been vendored *and*
load-verified — `new-adapter` is pure codegen over descriptor/adapter/
test-stub files, it never touches the grammar `.wasm` itself and
performs no loadability check of its own. (The generated
`descriptor.test.ts` stub below does call `Language.load` against the
vendored file, so a broken WASM will still fail loudly the first time
`npm test` runs — but that's a regression check for *later*, not a
substitute for verifying the file before you've written provenance for
it and built on top of it.)

`<languageId>` should match the real VSCode `languageId` (e.g. `ruby`,
`rust`, `typescriptreact`). This creates, under `packages/engine`:

- `src/languages/<languageId>/descriptor.ts` — a placeholder
  `LanguageDescriptor`, structurally valid (passes `validateDescriptor`
  as scaffolded) but not a real one — every field is a TODO-marked stand-in.
- `src/languages/<languageId>/descriptor.test.ts` — a stub that loads
  the grammar and confirms the queries compile; a starting point for
  real node-name/shape assertions, not a finished suite.
- `src/languages/<languageId>/adapter.ts` — a `LanguageAdapter` with no
  hooks overridden (the engine's descriptor-driven defaults apply).
  Most languages should stay this way; see step 4.
- `test/conformance/<languageId>-conformance.test.ts` — pre-wired to
  call `runAdapterConformance` against the new adapter, with a
  TODO-marked placeholder source.
- `test/fixtures/<languageId>/README.md` — a placeholder for gold-file
  fixtures, if this adapter eventually grows past what the conformance
  kit's inline sources cover.

None of this can safely guess the language's actual comment/string
syntax or grammar node names — that's step 3.

### 3. Probe the grammar directly

**Don't trust memory, type declarations, or the scaffold's placeholder
queries.** Write a throwaway script (see `docs/spikes/` for the pattern
used to investigate Python and JavaScript originally) that loads the
vendored WASM and parses a small real snippet, then inspects the actual
tree: node types for comments and strings, whether a `comment` node's
span includes a trailing `\r` on CRLF input, whether template-literal-
style or multi-part string forms are separate node types, and anything
else that looks surprising. `docs/adapters.md`'s "JavaScript canary —
grammar findings" section is a worked example of exactly this kind of
investigation and what it turned up for one real grammar — expect your
language to have its own version of at least one surprise, not
JavaScript's specific ones.

### 4. Fill in the descriptor, then the adapter (only if needed)

Replace the scaffold's placeholder `queries`/`comments`/`strings` with
what step 3 actually found. **An adapter is data first, code second** —
anything expressible as a descriptor field must not be a method,
because that's what keeps "add a language" a configuration task. Only
add a hook to `adapter.ts` (`classify`, `groupRegions`, `isSafeToWrap`,
`proseText`) once a specific, probed grammar behavior actually needs
one — e.g. JavaScript's `classify` override exists because one grammar
node type (`comment`) covers three different comment forms that need
telling apart by text, not by node type; most languages need nothing
here at all.

#### Prose languages

A language where the prose *is* the document — Markdown, LaTeX, a
future plain-text adapter — doesn't fit the comment/string model above
at all: there's no marker to strip, and often no strings or comments
worth wrapping either. For that shape, `queries.strings`/`.comments`
and the `strings` block are optional (omit whichever your language has
none of), and two more hooks exist alongside the four above:
`discoverProse` (produce every `'prose'` region in the tree — one
reflowable paragraph-shaped unit per region) and `wrapProse` (dissolve,
reflow, and emit one, given the whole-document `tree` since a
continuation prefix is usually a property of the region's container
ancestry, not the region alone). `languages/markdown/` is the smallest
real example: `discoverProse` is a twelve-line wrapper over a
`(paragraph) @prose` capture (`queries.prose`, a plain descriptor query
like `comments`/`strings`), because the grammar already resolved block
structure. `languages/latex/` is the harder shape worth knowing exists:
its grammar has no paragraph-level node at all, so `discoverProse` is a
masked line scan that uses the tree only for exclusion spans, comment
spans, and structural anchors — proof that `discoverProse` doesn't need
a query to be legal, only a real implementation of the hook. The shared
`prose/` directory (`dissolve-prose.ts`/`emit-prose.ts`) handles
dissolve/emit for both, the same way `comments/`/`strings/` do for
every comment/string-shaped language. `docs/adapters.md`'s "Markdown"
and "LaTeX" real-adapter sections are the full write-up of what each of
these two adapters actually found building on this design, including
the one real algorithmic-cost bug and the one real corruption bug prose
work turned up that a comment/string adapter wouldn't have hit the same
way.

### 5. Fill in the conformance test and run it

Replace the scaffolded placeholder source with a real snippet in the new
language containing at least one comment block long enough to overflow
the test's column limit, in both a CRLF and an LF variant (the
line-ending-preservation check needs both — see
`test/conformance/javascript-conformance.test.ts` for the worked
example this pattern is copied from). Then:

```bash
npm test --workspace=@rewrap-plus/engine
```

A clean pass — **with no change needed under `packages/engine/src/core`**
— is the acceptance bar. If you did need one, that's the signal this
guide opens with: stop, and treat it as a bug in the adapter interface,
not a workaround to route around quietly.

### 6. Register the adapter (only once it's meant to be user-facing)

The conformance suite runs against the adapter directly and needs no
registration. Making it actually usable inside the VSCode extension is a
separate, deliberate step: `packages/vscode-extension/src/engine-host.ts`'s
`createRegistry()` is the **one place** that decides which adapters are
user-facing — the JavaScript canary was deliberately left unregistered
there for a long stretch despite existing in the engine, precisely so
that "exists in the engine" and "user-facing" could stay two separate
questions. Add your adapter to that function once it's ready to be
user-facing, not before — an adapter registered
before it's ready would advertise support (via
`getSupportedLanguages()`, which drives which files the wrap commands
gray themselves out in) that doesn't actually work yet.

## What this process won't do for you

- Decide the language's actual comment/string syntax — that's step 3,
  and it's the part every step above depends on being right.
- Add a documentation dialect (Doxygen, JSDoc, Javadoc, …) — dialects are
  a separate, pluggable layer (`DialectRegistry`), decoupled from
  language adapters specifically so Doxygen (C/C++), JSDoc (JS/TS/Flow),
  or Javadoc (Java) become available to every adapter that declares
  support for them, not reimplemented per language. Two languages'
  ecosystems using the same *shape* of tag list (a flush-left `@tag`
  marker) doesn't mean they share a dialect id, though — `'doxygen'`,
  `'jsdoc'`, and `'javadoc'` are each their own id despite near-identical
  parsing logic, since each names a real, distinct convention its own
  ecosystem actually uses (see `docs/adapters.md`'s Java section for why
  Javadoc got its own id rather than reusing `'jsdoc'`).
- Add string-literal wrapping support — `wrapRegions` only dissolves and
  emits `'stringLiteral'`/`'docstring'` regions for adapters that
  implement it (Python, JavaScript, TypeScript, TSX, C++, and Java all
  do); a new adapter's strings are reported as skipped, same as an
  adapter with no string support at all, until its own `wrapString`/
  `wrapDocstring` hooks are written.
