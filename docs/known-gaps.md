# Known gaps — tracked, not forgotten

A short tracking list for real gaps found during project self-review that
are deliberately deferred rather than fixed, distinct from `CHANGELOG.md`'s
"Known limitations" (release-scoped, user-facing) and from
`docs/adapters.md`/`docs/parsing.md` (findings already resolved, with the
fix recorded alongside the leak). This document is the opposite of a design
proposal: each entry is what the gap is, why it's deferred, and the
concrete next step that would close it — nothing more.

## Notebook cell support is unverified

**What's missing.** Whether Rewrap+'s commands and formatting providers
actually work correctly against a Jupyter notebook (`.ipynb`) code cell —
a very plausible place for a Python-focused wrapping extension to get
used — has never been tested or documented. `packages/vscode-extension/src`
has no reference to notebooks anywhere: the document/range-formatting
providers register with a plain `{language}` `DocumentSelector`
(`../packages/vscode-extension/src/extension.ts`), and every command's
`when` clause gates on `editorLangId in rewrapPlusSupportedLanguages`
(`package.json`), neither of which is written with cell documents in mind
one way or the other.

**Why deferred.** VS Code very likely routes a focused Python cell's
"Format Cell"/`rewrapPlus.wrapAtCursor` through the same APIs as an
ordinary file, since a notebook cell is itself a `TextDocument` with a
`languageId` — but "very likely" is exactly the kind of unverified
assumption this project's own `CLAUDE.md` says not to trust for anything
parser- or host-API-adjacent. There is no evidence either way yet, only an
untested plausibility, and no known bug report driving this — nothing
justifies spending implementation effort here before finding out whether
there's actually a problem to solve.

**Next step.** Add an `@vscode/test-electron` integration test that opens
a `.ipynb` fixture, selects a Python code cell, and runs
`rewrapPlus.wrapAtCursor` / `rewrapPlus.wrapDocument` against it — the same
shape `packages/vscode-extension/test/integration/suite/wrap-at-cursor.test.ts`
already uses for ordinary files, adapted to the notebook API surface
(`vscode.workspace.openNotebookDocument`, `vscode.window.showNotebookDocument`).
If it works, document that explicitly in the README's feature list. If it
doesn't, that test becomes the reproduction case for whatever fix is
needed.

## No internationalization (`vscode.l10n`)

**What's missing.** Every user-facing string — command titles, setting
descriptions in `package.json`'s `contributes.configuration`, output
channel lines, status bar messages, and the one warning toast added by
finding #1 above — is hardcoded English. Nothing in this repository uses
`vscode.l10n`, `package.nls.json`, or `vscode-nls`.

**Why deferred.** Reasonable to leave at this project's current scale
(alpha, unreleased, single maintainer): adding a translation pipeline
before there's a real userbase to translate for is speculative work with
no one asking for it yet. `vscode.l10n` (the current VS Code API for this,
superseding the older `vscode-nls`) is comparatively low-cost boilerplate
when it *is* worth doing, so this isn't a "hard to retrofit later"
situation that argues for doing it early.

**Next step.** When there's a concrete reason to prioritize this (a
non-English user request, or nearing a real Marketplace publish where
discoverability matters more): wrap every user-facing string in
`package.json` with `%key%` placeholders backed by `package.nls.json` (and
a `vscode.l10n.t(...)` call for the smaller set of runtime-constructed
messages in `src/`), then add at least one translated locale end to end to
prove the scaffolding actually works before calling it done.
