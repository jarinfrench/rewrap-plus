# Rewrap+ — project context for Claude Code

Read this file, and `docs/implementation-plan.md`, before doing anything else
in a new session. This file is the quick orientation; the plan is the full
phased roadmap.

## What this is

Rewrap+ (`rewrap-plus`, publisher `jarinfrench`) is a VSCode extension that
rewraps comments, docstrings, and string literals to a configured column
limit, preserving formatted structure and emitting language-valid
concatenation syntax on split.

## Architecture

- npm workspaces monorepo: `packages/engine` (framework/VSCode-agnostic core)
  + `packages/vscode-extension` (thin glue).
- **Hard rule: `packages/engine` must never import `vscode`.** Enforced by an
  ESLint `no-restricted-imports` rule. If something VSCode-specific seems
  needed inside the engine, that's a signal the abstraction is wrong, not a
  reason to bypass the rule.
- Parser: `web-tree-sitter` (WASM). Grammars vendored under
  `packages/engine/grammars/`, with provenance (source, version, upstream
  commit, checksums) recorded in `PROVENANCE.md` in that directory.
- Central pipeline (every phase serves this):
  `parse → discover regions → group → dissolve → segment → reflow → emit →
  diff → TextEdit[]`. Dissolve/emit are per-language; segment/reflow are
  shared engine code — that split is why the adapter interface stays small.

## Conventions — treat these as non-negotiable

- **LF line endings throughout the project**, enforced by `.gitattributes`
  (`* text=auto eol=lf`). Originally CRLF; switched project-wide once the
  repo turned out to already be split roughly evenly between the two (every
  JS/TS/C++/Java adapter added after the original decision was written in
  plain `\n`, never CRLF, and nothing caught the drift) — LF is also the
  more standard convention outside Windows-specific tooling. The risk the
  original CRLF policy was defending against is symmetric either way and
  still applies now that LF is the standard: an editing tool that inserts
  new content into an existing file using the *other* line ending than the
  rest of that file leaves it with *mixed* line endings — valid-looking,
  tests may even still pass, but it breaks anything that diffs the file
  expecting one uniform convention, and is easy to miss because `file
  <name>` reports the file's *majority* ending even when only *some* lines
  match it. Before committing, especially after editing an existing file,
  it's worth spot-checking: a text file should be either all `\n` or all
  `\r\n`, never a mix of both.
- Commit style: short imperative subject (≤ 72 chars), optional `scope:`
  prefix where it aids scanning (`engine:`, `python:`, `ext:`, `ci:`,
  `canary:`). Body explains non-obvious rationale, in real depth — this
  project's history leans heavily on commit messages as documentation, not
  just change descriptions. Match that density; a two-line commit message on
  a substantive change reads as under-explained here.
- **CI-equivalent gate before every commit, no broken intermediates:**
  `npm run typecheck && npm test && npm run lint && npm run build` must all
  pass clean. This applies per-commit, not just at the end of a work session
  — someone should be able to check out any single commit in this repo's
  history and have it build and pass.
- **Probe before coding, always, for any tree-sitter grammar work.** Verify
  actual node names/shapes/quirks by writing a throwaway script against the
  vendored WASM directly — don't trust memory, don't trust type declarations.
  `web-tree-sitter`'s own node offsets contradict its type docs (see
  `docs/parsing.md`); a Python `comment` node's span includes a trailing
  `\r` on CRLF-terminated lines, which only direct probing caught (see
  `docs/adapters.md`, "CRLF handling"). Assume every grammar has its own
  version of this waiting to be found.
- **Investigate before implementing.** Read the full relevant file tree,
  existing types, tests, and fixtures before writing production code. This
  project's own history has a cautionary example of skipping this (Phase 2
  ended mid-execution because of it) — don't repeat it.
- Fixture-driven tests: gold-file fixtures under `test/fixtures/` (or
  adjacent `test/` directories), `.in`/`.out` file pairs, tests that walk
  directories and diff actual vs. expected — this is the default shape for
  anything end-to-end, not hand-built inline assertions.
- Deviating from the implementation plan's literal commit list is expected
  when technical reality requires it (several phases already have — e.g.
  Phase 6b generalizing `wrapRegions` before Phase 7 needed it to, once the
  plan's own hard gate flagged the risk). Document the rationale in the
  commit message, in depth, matching the existing convention — don't
  silently diverge and don't silently follow the plan past the point where
  it stops matching reality.
- Known limitations get an explicit comment in source, never a silent
  omission — but not a phase-referenced one. Source comments, like
  `docs/`/README/CHANGELOG prose, describe what a future reader (human or
  Claude) needs to understand the code and its design rationale, not the
  private phased history in `docs/implementation-plan.md`. Don't cite
  "Phase N" or "the plan" in new comments; if you're editing a comment
  that still has one, clean it up as part of that edit rather than adding
  to it.

## How work gets delivered

Everything through Phase 6b was delivered as `git am`-applicable patch
series from a separate `claude.ai` chat session, because that session had no
direct filesystem access to this repo — patches were generated, verified
against a fresh archive extraction, and handed off for manual application.
**That constraint doesn't apply here.** Commit directly to this repo. No
patch files, no archive round-trips.

## Where things actually stand — verify, don't assume

Phases 0 through 6b are complete, verified, and committed to this repo's
history. Don't redo them. Start any new session with:

```
git log --oneline -15
npm run typecheck && npm test && npm run lint && npm run build
```

to confirm the real current state before doing anything else. 

`docs/adapters.md` records every cross-cutting engine finding from Phase
6b — leaked Python-only assumptions found and fixed before they could harden
further, the JavaScript canary's own grammar findings, and deliberate scope
limits worth distinguishing from oversights. Read it before starting Phase 7,
since Phase 7 (VSCode integration) is exactly the kind of phase where a
similar Python-only or engine/extension-boundary assumption could leak in
unnoticed otherwise.

Next per the plan: **Phase 7 — VSCode integration and manual commands**
(`docs/implementation-plan.md`, search for "Phase 7").
