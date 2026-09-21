# Known gaps -- tracked, not forgotten

A short tracking list for real gaps found during project self-review that
are deliberately deferred rather than fixed, distinct from `CHANGELOG.md`'s
"Known limitations" (release-scoped, user-facing) and from
`docs/adapters.md`/`docs/parsing.md` (findings already resolved, with the
fix recorded alongside the leak). This document is the opposite of a design
proposal: each entry is what the gap is, why it's deferred, and the
concrete next step that would close it -- nothing more.

## GitHub Pages project site has no demo screenshot/GIF, and no Marketplace links yet

**What's missing.**

- **No before/after demo screenshot or GIF** of Rewrap+ actually wrapping
  something in a real editor. `site/index.html` has a
  `<!-- TODO: before/after demo screenshot or GIF, see follow-up -->`
  marker where one belongs (right after the hero section) -- this is
  genuinely the highest-value thing the page is currently missing, since
  every other section is prose/tables a reader has to take on faith
  without one.
- **No `og:image` meta tag**, for the same reason -- there's no image
  asset yet worth pointing one at. A link to the site shared elsewhere
  (Slack, a README, an issue) renders with only the `og:title`/
  `og:description` text until this is added.
- **No Marketplace/Open VSX install links** in the site's "Getting it"
  section -- it currently only links to GitHub Releases (`.vsix`) and the
  CLI's own README, matching this project's actual publish state
  (`docs/planning/implementation-plan.md`'s 12e is still deferred; see
  `CHANGELOG.md`'s Marketplace/Open VSX publishing entry for the gated
  `publish` job that isn't live yet).

**Why deferred.** The demo capture needs an actual interactive editor
session to record from, which isn't something this working session could
produce -- a placeholder comment marking exactly where it belongs was the
honest alternative to either fabricating one or silently shipping the page
without it. The Marketplace links are correctly absent, not incomplete --
adding them before `publish` actually ships (12e) would advertise an
install path that doesn't exist yet.

**Next step.** Record a short before/after capture (VSCode wrapping a
long Python docstring or a JS string literal is the clearest example of
the string-wrapping differentiator) and replace the TODO comment in
`site/index.html` with an `<img>`/`<video>` element plus a matching
`og:image` tag. Once `publish` (implementation plan 12e) actually ships
a Marketplace/Open VSX listing, add install badges/links to the site's
"Getting it" section in the same commit that flips the CLI/extension's
own README claims.

## VSCode integration suite runs in CI but isn't a merge gate yet

**What's missing.** `.github/workflows/ci.yml`'s `integration` job now runs
the real-VSCode-host suite (`packages/vscode-extension/test/integration/`,
16 spec files covering command registration, activation, and edit
application in an actual Extension Host) on every PR and push, under
Xvfb (`coactions/setup-xvfb`) on `ubuntu-latest`. It is not, however, a
required check in branch protection, and the job carries
`continue-on-error: true` -- a failing run shows as a clearly visible
warning on the PR checks list, but cannot block a merge.

**Why deferred.** This is new CI automation with no track record yet on
a hosted runner (display-server quirks, Extension Host download
flakiness, and timing sensitivity are all plausible failure modes that
only show up under real CI load, not locally). Making it a required
check before it's demonstrated it can pass reliably would risk blocking
merges on infrastructure flakiness rather than real regressions -- the
opposite of what a release-readiness gate should do.

**Next step.** Once this job has a run of green (or at least
understood-and-triaged) results across enough PRs to trust it, promote
it to a required status check in the repository's branch protection
settings and drop `continue-on-error` from the job.

## `@types/vscode` can drift ahead of `engines.vscode` without CI or auto-merge noticing

**What's missing.** Nothing in `.github/workflows/ci.yml` or
`.github/workflows/dependabot-auto-merge.yml` checks that
`packages/vscode-extension/package.json`'s `devDependencies["@types/vscode"]`
stays within `engines.vscode`. `vsce package` is the only thing in this
repo that enforces that constraint (it refuses to package when the ambient
types claim a newer minimum VS Code version than `engines.vscode`
declares), and `vsce package` isn't run anywhere in CI -- only manually, by
whoever runs `npm run package` to build a `.vsix`. A routine
`@types/vscode` devDependency bump is exactly the shape of PR this repo's
auto-merge workflow is designed to wave through unattended (`npm_and_yarn`,
`direct:development`, semver patch/minor) -- and did: dependabot's
1.134.0 -> 1.137.0 bump (`d3f804d`) auto-merged clean while
`engines.vscode` stayed at `^1.122.0`, and the mismatch surfaced only when
`vsce package --no-dependencies` was run by hand afterward, well after the
PR had already merged.

**Why deferred.** Fixing this properly means either running `vsce package`
(at least a dry-run/`--no-dependencies` invocation) in `ci.yml` so the
mismatch fails CI directly, or adding a dedicated version-comparison check
-- both are a deliberate CI change, not something to bolt on silently while
fixing one instance of the drift (see `dd386d5`, which just pins
`@types/vscode` back down to `^1.122.0` for now). The vitest/
`@vitest/coverage-v8` gap documented in `dependabot-auto-merge.yml`'s own
top-of-file comment is the same shape of problem (a devDependency pair
whose compatibility constraint isn't visible to any required check), and
both point at the same underlying fix: CI's `test`/`build` jobs don't
actually exercise everything `npm run test:coverage` and `npm run package`
would.

**Next step.** Add a step to `ci.yml` that runs
`npm run package --workspace packages/vscode-extension` (discarding the
`.vsix` output, the same dry-run pattern already used for
`generate-site-data.mjs`) so an `@types/vscode`/`engines.vscode` mismatch
fails CI on the PR that introduces it, before dependabot auto-merge (or a
human) ever gets a chance to merge it. Once that's in place and proven
stable, it's a natural candidate for a required check.

## No internationalization (`vscode.l10n`)

**What's missing.** Every user-facing string -- command titles, setting
descriptions in `package.json`'s `contributes.configuration`, output
channel lines, status bar messages, and the one warning toast added by
finding #1 above -- is hardcoded English. Nothing in this repository uses
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
