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

Copy that file into `packages/engine/grammars/`, and add an entry to
that directory's `PROVENANCE.md` recording the source package, version,
upstream commit, tarball checksum, vendored-file checksum, and grammar
ABI version — follow the existing entries there exactly; they're the
template.

If no prebuilt WASM exists, you need `tree-sitter build --wasm` with
Emscripten or Docker — `docs/parsing.md` covers why this repo avoided
that so far and what to expect if a grammar forces the issue.

### 2. Scaffold the boilerplate

```bash
npm run new-adapter -- <languageId>
```

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
`emitContext`) once a specific, probed grammar behavior actually needs
one — e.g. JavaScript's `classify` override exists because one grammar
node type (`comment`) covers three different comment forms that need
telling apart by text, not by node type; most languages need nothing
here at all.

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
- Add a documentation dialect (Doxygen, JSDoc, …) — dialects are a
  separate, pluggable layer (`DialectRegistry`), decoupled from language
  adapters specifically so Doxygen (C/C++/Java) or JSDoc (JS/TS/Flow)
  become available to every adapter that declares support for them, not
  reimplemented per language.
- Add string-literal wrapping support — `wrapRegions` only dissolves and
  emits `'stringLiteral'`/`'docstring'` regions for adapters that
  implement it (Python, JavaScript, TypeScript, TSX, and C++ all do); a
  new adapter's strings are reported as skipped, same as an adapter with
  no string support at all, until its own `wrapString`/`wrapDocstring`
  hooks are written.
