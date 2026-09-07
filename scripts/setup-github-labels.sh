#!/usr/bin/env bash
# Creates/updates the repo's label taxonomy via `gh label create --force`.
# Reproducible by design — re-run any time instead of clicking through the
# GitHub UI. Requires `gh auth login` against a token with repo access.
#
# Deliberately omits per-language sub-labels (only >2 language adapters
# justify them — currently would be noise) and labels for explicitly
# deferred work (Marketplace publishing, Doxygen, JSDoc, additional
# languages not yet scheduled) — see the PR/commit that added this script
# for the reasoning.
set -euo pipefail

REPO="jarinfrench/rewrap-plus"

label() {
  local name="$1" color="$2" description="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force
}

# area:*
label "area:engine"              "1d76db" "packages/engine"
label "area:vscode-extension"    "1d76db" "packages/vscode-extension"
label "area:cli"                 "1d76db" "packages/cli"
label "area:language-adapter"    "5319e7" "A specific language descriptor, not the shared engine core"

# type:*
label "type:bug"                 "d73a4a" "Something isn't working"
label "type:feature"             "a2eeef" "New feature or request"
label "type:docs"                "0075ca" "Documentation only"
label "type:perf"                "fbca04" "Performance"
label "type:chore"               "cfd3d7" "Tooling, CI, dependency, or other non-user-facing maintenance"

# invariant / severity — signals, use sparingly
label "invariant:engine-boundary" "b60205" "Touches or risks the 'adding a language changes no engine code' guarantee"
label "severity:string-corruption" "b60205" "A string literal's runtime value changed after wrapping — treat as effectively P0"

# status:*
label "status:needs-repro"       "e4e669" "Waiting on a minimal reproduction"
label "status:blocked"           "e4e669" "Blocked on something outside this issue/PR"

# triage helpers — reuse GitHub's own default labels (spaced names) rather
# than creating hyphenated duplicates; they already exist on the repo and
# count toward its community-profile checklist.
label "good first issue"         "7057ff" "Good for newcomers"
label "help wanted"              "008672" "Extra attention is needed"
