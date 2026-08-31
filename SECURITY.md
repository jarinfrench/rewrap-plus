# Security Policy

Rewrap+ is a local VSCode extension that parses and rewrites source
files inside the editor. It has no server component and no
account/auth surface, so this document is less about "how to report a
breach" and more about **stating the trust boundary explicitly** and
tracking the hardening work that backs it up.

<!--
  Fill in bracketed sections as hardening passes complete. Where a
  guarantee is stated, it should be backed by a test or a check in CI —
  link to it. An unverified guarantee is worse than no guarantee.
-->

## Supported versions

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ (please upgrade) |

## Reporting a vulnerability

If you find a security issue (not just a bug — see "what counts"
below), please **do not open a public GitHub issue**. Instead:

- Email: `[security contact email]`
- Expected acknowledgment: `[e.g. within 5 business days]`
- Please include: VSCode version, extension version, a minimal
  reproducing file if possible, and what you observed vs. expected.

Ordinary bugs (bad wrapping, incorrect column resolution, etc.) should
go through normal GitHub issues instead — reserve this channel for
things with actual security impact per the categories below.

## What counts as a security issue here

Given what this extension does (parse + rewrite text in the open
editor), the categories that matter are:

- **Silent string/semantic corruption** — wrapping changes what a
  string literal *evaluates to*, not just how it's formatted. This is
  the top concern for this project specifically, since string rewriting
  is the differentiating feature.
- **Denial of service via crafted file content** — a file (e.g. inside
  a cloned repo) that hangs or crashes the extension host via ReDoS,
  unbounded recursion, or unbounded memory use during parse/wrap.
- **Writes outside the intended scope** — any edit landing outside the
  span/document the user invoked wrapping on, or any filesystem write
  that bypasses VSCode's edit/undo system.
- **Workspace-trust bypass** — a workspace's `.editorconfig` or
  settings causing behavior beyond configuring the wrap itself (e.g.
  influencing which files are touched beyond user intent).
- **Supply-chain integrity** — a tampered or unpinned dependency
  (including vendored grammar `.wasm` binaries) being loaded and
  executed.

Things that are **not** security issues (report as regular bugs
instead): incorrect wrapping decisions, dialect misdetection, style
disagreements, performance that's merely slow rather than hung.

## Trust model / what this extension does and doesn't do

State each of these explicitly once verified — don't leave a line
unchecked without either fixing it or removing the claim.

- [ ] **No network access.** Rewrap+ makes no HTTP/network calls at
      any point, including transitively. Verified by: `[grep/CI check
      reference]`.
- [ ] **No filesystem access outside the active document/workspace.**
      All reads/writes go through VSCode's document and
      `WorkspaceEdit` APIs — no direct `fs.writeFile` calls, no
      following symlinks outside the workspace root.
- [ ] **All edits are undo-able.** Every change the extension makes is
      applied as a `TextEdit`/`WorkspaceEdit` through the standard
      VSCode edit pipeline, never as a raw disk write, so it always
      participates in undo history.
- [ ] **String rewriting preserves semantics.** For every language
      where string wrapping is enabled, an eval-equivalence (or
      equivalent AST-equality) test suite confirms the *value* of a
      wrapped string literal is unchanged. Verified by: `[test file
      reference]`.
      Partial: the eval-equivalence suites already exist per language
      (`packages/engine/test/wrap/{python,javascript,typescript,cpp,java}-string-wrap-fixtures.test.ts`,
      each against a language-specific decode oracle in
      `packages/engine/test/support/`) and now include regression
      fixtures for two confirmed corruption bugs found and fixed
      2026-08-30 (see Hardening changelog) — a real `eval`/decode-based
      check, not a smoke test. Left unchecked because passing tests are
      evidence, not proof: this is a heuristic-driven pipeline, and an
      audit finding two live bugs on its first real pass means more
      likely remain unfound, not that the surface is now exhausted.
- [x] **No dynamic code execution.** File content, query results, and
      configuration values are never `eval`'d, `Function()`-constructed,
      or otherwise executed as code. Verified by: grepped
      `packages/engine/src` and `packages/vscode-extension/src` for
      `eval(`, `new Function`, `child_process`, `vm.Script`/
      `vm.runInContext`, and dynamic `require`/`import()` — no matches
      anywhere (2026-08-30). (The JS/TS eval-equivalence test oracles
      under `packages/engine/test/support/` do call real `eval` — that's
      test-only tooling evaluating a string literal to compare values,
      never shipped in the extension, and never given untrusted input
      beyond what the test itself constructs.)
- [ ] **Workspace Trust respected.** `capabilities.untrustedWorkspaces`
      is declared deliberately in `package.json` (not left to default),
      and `[list which commands, if any, are disabled/limited in
      untrusted workspaces]`.
- [ ] **Bounded resource use on adversarial input.** Parsing/wrapping
      has `[caps on file size / nesting depth / region count, or a
      documented absence of caps and why that's acceptable]`, tested
      against pathological fixtures.
- [ ] **Grammar provenance is pinned and documented.** Each vendored
      `.wasm` grammar (Python, JavaScript, C++) has a recorded upstream
      version, commit SHA, and hash in `docs/parsing.md`, checked
      against the committed binary.
- [ ] **Dependencies pinned; CI hardened.** Lockfile pins exact
      versions; `npm audit` is run in CI; third-party GitHub Actions
      are pinned to commit SHAs, not mutable tags; the packaging
      workflow does not run untrusted PR content with secrets
      available.

## Known limitations (documented, not hidden)

Be honest here — this list is what keeps a security-conscious user
from assuming more than is actually guaranteed.

- No cap on file size, string-literal size, or region count anywhere in
  `packages/engine`. A pathologically large single file (or single
  string/comment region within an otherwise normal file) parses and
  wraps in time proportional to its own size, with no upper bound and no
  separate worker thread — a large-enough adversarial file will still be
  slow even after the specific quadratic-time regexes fixed 2026-08-30
  (see Hardening changelog) are no longer the bottleneck. Not tracked in
  an issue yet.
- `LanguageDescriptor.strings.escapes.sequences` (declared per-language
  in every `languages/*/descriptor.ts`, e.g. C++'s correctly
  variable-length `\x` hex escape) is descriptive data only — nothing at
  runtime reads it. The one place escape-sequence *shape* actually
  matters for correctness, `packages/engine/src/segmentation/unbreakable-spans.ts`'s
  `ESCAPE_SEQUENCE`, is a single hardcoded pattern shared by every
  language, deliberately widened (2026-08-30) into a generous union of
  every supported language's real escape grammar rather than being
  wired per-language — see that constant's own doc comment for the full
  rationale. Erring toward recognizing *more* escape shapes than a given
  language actually has is safe by construction (worst case: a slightly
  more conservative wrap, never a corrupted one), but this remains an
  architectural mismatch between what descriptors declare and what
  actually executes, worth resolving properly if a language with a
  genuinely conflicting escape grammar is ever added.
- Regex-based heuristics (`prose-heuristic.ts`, `unbreakable-spans.ts`,
  the per-dialect field-entry patterns under `docs/*.ts`) were audited
  once, end to end, for catastrophic/quadratic backtracking on
  2026-08-30 (see Hardening changelog) — every pattern found vulnerable
  at that time was fixed and given a timing-based regression test, but
  "audited once" is not "provably safe forever": a future edit to any of
  these patterns needs the same adversarial-input timing check redone,
  not just ordinary correctness tests, since a regex can look completely
  ordinary and still hide this class of bug (two of the four bugs found
  in this pass were missed on a first read and only surfaced by directly
  timing every remaining regex against a long adversarial input).

## Hardening changelog

Track fixes here as the audit passes land, so the guarantees above
stay honest over time rather than becoming stale claims.

| Date | Finding | Fix | Verified by |
|---|---|---|---|
| 2026-08-30 | Exponential ReDoS in `.editorconfig` glob matching (`packages/vscode-extension/src/config/editorconfig.ts`): consecutive `*` characters in a `[glob]` section header compiled to several adjacent `[^/]*`/`.*` regex quantifiers, confirmed to take 100+ seconds against a non-matching path with only ~25 stars. Reachable from a workspace-supplied `.editorconfig`, resolved on every "Wrap Document" invocation. | `globToRegExpSource` now collapses an entire run of `*` into exactly one quantifier, eliminating the adjacent-quantifier ambiguity. | `packages/vscode-extension/src/config/editorconfig.test.ts` ("treats a run of 3+ stars the same as \*\*, not as adjacent quantifiers") |
| 2026-08-30 | Quadratic-backtracking ReDoS in the prose heuristic (`packages/engine/src/prose-heuristic.ts`): three regexes (`{n,m}` detection, printf-flag placeholder detection, URL detection) each had either two adjacent quantifiers over overlapping character classes or one unbounded quantifier immediately followed by a required-but-possibly-absent literal — confirmed to take seconds-to-tens-of-seconds against ~100-200K-character adversarial single-line strings, with no size cap anywhere in the engine and no worker thread to isolate the hang. Reachable via any string/docstring's own text under the default `stringPolicy: 'prose'`. | Rewrote the ambiguous quantifier sequences to remove the overlap (`\d+(?:,\d*)?` instead of `\d+,?\d*`), bounded the printf-flag quantifier (`{0,5}` instead of `*`), and bounded the URL scheme quantifier (`{1,32}`/`\w{1,32}` instead of unbounded). | `packages/engine/src/prose-heuristic.test.ts` ("quadratic-backtracking regressions") |
| 2026-08-30 | The same unbounded-quantifier-plus-required-literal URL-detection bug, independently, in `packages/engine/src/segmentation/unbreakable-spans.ts`'s `URL` pattern — a hotter path than the prose heuristic, since this runs on every comment/docstring/string line `atomizeWords` ever segments, not once per string. | Bounded the URL scheme quantifier the same way (`{0,31}` after the required first letter). | `packages/engine/src/segmentation/unbreakable-spans.test.ts` ("stays fast on a long letter run with no colon anywhere") |
| 2026-08-30 | Silent string-value corruption: `unbreakable-spans.ts`'s shared `ESCAPE_SEQUENCE` pattern (used by every language) was shaped after Python's own escape grammar specifically, so C++'s variable-length `\x` hex escape (`\x1234`) only had its first 2 digits recognized — a wrap could split it into `\x12` + literal `34`, changing the string's value. JavaScript/TypeScript's ES2015 `\u{1F600}`-style code-point escape had no representation at all — a split there produces a `SyntaxError`, not just a wrong value. Both reproduced directly against the real `wrapCppString`/`wrapEcmaScriptString` pipelines; `isSafeToWrap` does not gate either shape. | Widened `ESCAPE_SEQUENCE` into a deliberately generous union of every supported language's real escape grammar (unbounded `\x` hex, 1-3-digit octal, `\u{...}` code-point form, `\?`) — see that constant's own doc comment for why over-recognizing is always the safe direction. | `packages/engine/test/wrap/cpp-string-wrap-fixtures.test.ts` (`004-multi-digit-hex-escape`) and `packages/engine/test/wrap/javascript-string-wrap-fixtures.test.ts` (`004-codepoint-escape`), each confirmed to fail against the pre-fix code by temporarily reverting it; also `packages/engine/src/segmentation/unbreakable-spans.test.ts` |
