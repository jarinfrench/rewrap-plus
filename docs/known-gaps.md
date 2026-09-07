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

## GitHub Pages must be enabled once, manually

**What's missing.** The `pages` job added to `.github/workflows/ci.yml`
builds and deploys `site/` to GitHub Pages on every push to `main`, but
GitHub Pages itself has to be switched on for this repository once,
by hand, before that job's `actions/deploy-pages` step can succeed --
Settings > Pages > Source: GitHub Actions. No commit or workflow run can
do this on its own; it's a repository-dashboard setting, not something
version-controlled.

**Why deferred.** Not really a deferrable gap so much as a one-time
manual step that simply hasn't happened yet as of this entry, recorded
here so it isn't mistaken for something the CI wiring itself forgot.

**Next step.** In the repo's GitHub Settings, open the Pages section and
set Source to "GitHub Actions" (not "Deploy from a branch"). After that,
the next push to `main` that clears `ci` will deploy automatically via
the `pages` job; no further manual step is needed afterward.

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
