# Security Policy

Rewrap+ is local tooling that parses and rewrites source files: a
VSCode extension (`packages/vscode-extension`) that does this inside
the editor, and a standalone CLI (`packages/cli`) that does the same
thing in a terminal/CI pipeline, both built on the shared
`packages/engine` core. Neither has a server component or an
account/auth surface, so this document is less about "how to report a
breach" and more about **stating the trust boundary explicitly** for
each of the two consumers and tracking the hardening work that backs
it up.

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

## Trust model — the VSCode extension (`packages/vscode-extension`)

State each of these explicitly once verified — don't leave a line
unchecked without either fixing it or removing the claim.

- [x] **No network access.** Rewrap+ makes no HTTP/network calls at
      any point, including transitively. Verified by: grepping
      `packages/engine/src` and `packages/vscode-extension/src` for
      `fetch(`, `XMLHttpRequest`, `http(s).request`/`.get`, `WebSocket`,
      `axios`, `node-fetch` (2026-08-30) — no matches (the only hits were
      literal URL *strings* inside test fixture files used by the prose
      heuristic, not executable code). The one runtime dependency that
      could reach the network, `web-tree-sitter`'s Emscripten-generated
      WASM loader, does contain browser-only `fetch`/`XMLHttpRequest`
      fallback paths for loading grammar binaries, but they're gated
      behind `ENVIRONMENT_IS_WEB`/`ENVIRONMENT_IS_WORKER` checks in
      `node_modules/web-tree-sitter/web-tree-sitter.cjs`; this extension
      declares no `browser` entry point in `package.json` (desktop-only,
      Node-based extension host), so `ENVIRONMENT_IS_NODE` is always true
      at runtime and grammar loading always resolves through
      `fs.readFileSync` instead — the fetch/XHR paths are unreachable
      dead code in the shipped product, not merely uncalled today. See
      `packages/vscode-extension/README.md`'s "Privacy" section for the
      user-facing version of this claim.
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
- [x] **Workspace Trust respected.** `capabilities.untrustedWorkspaces.supported`
      is declared `true` deliberately in `package.json` (not left to
      VSCode's own default, which otherwise shows an unverified-extension
      warning). Verified by auditing every workspace-controllable input
      this extension reads: all twelve `rewrapPlus.*` settings are typed
      as `boolean`, `number`, a fixed string `enum`, or (for
      `stringWrapInclude`) a glob-string array — never a path, command,
      or anything the extension would execute — and `.editorconfig`'s
      only consulted property, `max_line_length`, is a single integer.
      `stringWrapInclude`'s glob patterns are compiled through the same
      hardened `globToRegExpSource` (`packages/vscode-extension/src/
      config/glob.ts`, shared with `.editorconfig` section matching) that
      closed a confirmed catastrophic-backtracking ReDoS, so a workspace
      supplying an adversarial pattern here hits the same mitigation, not
      a fresh unaudited regex-construction path; matching is also a pure
      `RegExp#test` against the *already-open* document's own known path,
      never a filesystem walk/glob-expansion, so it can't be used to
      enumerate or probe paths the extension wouldn't otherwise touch.
      Per this document's own "Workspace-trust bypass" category (a
      workspace causing behavior *beyond configuring the wrap itself*),
      nothing reachable from an untrusted workspace's settings or
      `.editorconfig` can do more than change wrap parameters — there's
      no elevated-trust behavior to gate, so full support is the honest
      declaration rather than an unverified default. `activationEvents:
      []` also means opening an untrusted workspace alone triggers no
      extension code at all; every command requires explicit user action
      first.
- [ ] **Bounded resource use on adversarial input.** Parsing/wrapping
      has `[caps on file size / nesting depth / region count, or a
      documented absence of caps and why that's acceptable]`, tested
      against pathological fixtures.
- [x] **Grammar provenance is pinned and documented, and enforced in CI.**
      All six vendored `.wasm` grammars (Python, JavaScript, TypeScript,
      TSX, C++, Java) have a recorded source package/version, upstream
      repo and commit, npm tarball shasum/integrity, and vendored-file
      sha256 in `packages/engine/grammars/PROVENANCE.md` (referenced from
      `docs/parsing.md`). `scripts/verify-grammar-provenance.mjs`,
      wired in as a root `pretest` hook so it runs as part of every
      `npm test` (every CI run, every commit's local gate), recomputes
      each vendored file's sha256 and diffs it against `PROVENANCE.md`
      in both directions — a swapped/tampered binary, a doc entry edited
      without the binary changing, an undocumented new grammar, or a
      stale entry for a removed one, all fail the build now rather than
      going unnoticed. Previously the hash was recorded but never
      re-checked; this closes that gap.
- [x] **Dependencies pinned; CI hardened.** `package-lock.json`
      (`lockfileVersion: 3`) is committed and installed via `npm ci` in
      every CI job; all 657 third-party entries resolve from
      `registry.npmjs.org` with `resolved`/`integrity` fields (0
      git/tarball-URL dependencies). Third-party GitHub Actions in
      `.github/workflows/ci.yml` are pinned to commit SHAs (with a
      trailing `# vX.Y.Z` comment for readability), not mutable tags;
      `.github/dependabot.yml` keeps both the npm tree and those pins
      current. The `ci` job declares `permissions: contents: read`
      explicitly rather than inheriting repo-default token permissions.
      The `package` job (which holds the publish secrets and
      `contents: write`) only ever runs on a `v*` tag push
      (`if: startsWith(github.ref, 'refs/tags/v')`) and never on
      `pull_request`, so untrusted PR content is never evaluated with
      secrets available — and the workflow uses the safe `pull_request`
      trigger, not `pull_request_target`, so forked-PR runs get no
      secrets regardless.

      `npm audit` is not yet wired into CI as an automated gate — run
      manually as of 2026-08-30, it found 3 vulnerabilities (1 high: RCE
      in `serialize-javascript` via CVSS 8.1 GHSA-5c6j-r48x-rmvq; 1
      moderate: `serialize-javascript` DoS; 1 low: `diff`/jsdiff DoS),
      all transitive through `mocha` (devDependency, drives
      `test:integration` only — never bundled into the packaged
      `.vsix`, and not part of the `npm test` CI actually runs). Fixed
      by pinning `diff@^9.0.0`/`serialize-javascript@^7.1.1` via root
      `package.json`'s `overrides` field, since `mocha`'s own stable
      releases cap those transitive ranges below the patched versions
      (only the `12.0.0` pre-release line bumped them) — verified with a
      full clean reinstall (`found 0 vulnerabilities`), the full CI gate
      (`typecheck && test && lint && build`), and a direct `mocha` smoke
      run confirming its diff-output rendering still works against
      `diff@9`.

## Trust model — the CLI (`packages/cli`)

The CLI is a different consumer of `packages/engine` with a different
job: it's meant to rewrite files on disk directly, in bulk, so several
of the extension's claims above don't apply to it and shouldn't be
read as if they did. Stated explicitly here rather than left implicit.

- [x] **Writes files directly, by design — not a gap.**
      `packages/cli/src/apply.ts`'s `processFile` reads a file, wraps it,
      and (in the default `write` mode) calls `writeFileSync` straight
      back to the same path — there's no undo/edit system for a CLI to
      route through the way the extension routes every change through
      `WorkspaceEdit`. `--check` (`mode: 'check'`) exists as the
      read-only alternative: it reports which files *would* change
      without touching disk, for anyone who wants to review before
      trusting `--write`/the default mode against a target they haven't
      inspected — the same pattern `black --check`/`prettier --check`
      use.
- [x] **Only ever touches paths it was explicitly pointed at.**
      `file-discovery.ts`'s `discoverFiles` resolves each positional
      argument via `path.resolve` and, for a directory argument,
      recursively walks it (`walkDirectory`) — no path is ever read from
      file content, config values, or anything other than the CLI's own
      argv. Config resolution (`.rewraprc`/`.rewraprc.json`,
      `pyproject.toml`) walks upward from each target file's directory
      toward the filesystem root looking for the nearest match, the same
      "nearest ancestor config" convention Black/ESLint/Prettier all use
      — worth stating plainly since it means running this CLI from a
      deeply nested directory with no project-root marker can pick up a
      config file above the directory you actually pointed it at.
- [x] **Config values are strictly typed and allow-listed, never paths or
      code.** `.rewraprc`'s `pickKnownFields` and `pyproject.toml`'s
      `numberField`/`booleanField`/`stringField` helpers each check a
      known key against an expected primitive type or a fixed string
      `enum` before accepting it; an unrecognized key or wrong-shaped
      value is silently dropped, never coerced or evaluated. `.rewraprc`
      is parsed with `JSON.parse`; `pyproject.toml` with this project's
      own minimal `toml-subset.ts` parser (not a general TOML
      implementation, only the value shapes this feature needs) — neither
      path involves `eval`, `Function()`, or any other code execution.
      The worst a malicious `.rewraprc`/`pyproject.toml`/`.editorconfig`
      can do is set a bad column limit or wrap policy, the same
      "workspace-trust bypass" ceiling the extension's settings are held
      to above.
- [x] **Symlinks are not followed during a directory walk.**
      `walkDirectory` uses `readdirSync(dir, { withFileTypes: true })`
      and only recurses into / wraps entries whose `Dirent` reports
      `isDirectory()`/`isFile()` true; a `Dirent`'s type reflects the raw
      directory entry itself, not a followed symlink, so a symlinked file
      or directory inside a walked tree is silently skipped — avoiding
      both an unbounded/cyclic walk from a symlink loop and a walk
      escaping the target directory tree via a symlink pointing outside
      it. Documented in that file's own "Known limitations" comment.
- [x] **Not `.gitignore`-aware — a fixed ignore list only.**
      `DEFAULT_IGNORED_DIR_NAMES` (`node_modules`, `dist`, `out`,
      `coverage`) plus any dot-directory are the only names a directory
      walk skips; a project-specific `.gitignore` rule beyond that isn't
      consulted. Not a vulnerability — the CLI never touches a file
      outside the target(s) it was given regardless — but worth knowing
      before pointing `--write` at a whole repository root rather than a
      specific subtree.

## Known limitations (documented, not hidden)

Be honest here — this list is what keeps a security-conscious user
from assuming more than is actually guaranteed.

- No cap on file size, string-literal size, or region count anywhere in
  `packages/engine`. A pathologically large single file (or single
  string/comment region within an otherwise normal file) parses and
  wraps in time proportional to its own size, with no upper bound and no
  separate worker thread — a large-enough adversarial file will still be
  slow even after the specific quadratic-time regexes fixed 2026-08-30
  (see Hardening changelog) are no longer the bottleneck. Cancellation
  (the "Cancel" action on the large-file progress notification) and
  format-on-save's 1500ms timeout do now actually interrupt an
  in-progress wrap, within about one yield interval (~50ms) of being
  requested (fixed 2026-08-30, see Hardening changelog) — before that fix
  the guardrail was inert against a computation already underway, since
  the per-region loop never yielded to the event loop on its own. Neither
  path caps how much work can be requested before the first yield,
  though. Not tracked in an issue yet.
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
| 2026-08-30 | Dependency/build-chain audit: high-severity RCE in `serialize-javascript` (GHSA-5c6j-r48x-rmvq, CVSS 8.1) plus a moderate DoS in the same package and a low DoS in `diff`, all transitive through the `mocha` devDependency (`test:integration` only, never shipped in the `.vsix`). GitHub Actions in `ci.yml` were pinned to mutable version tags (`@v5`, `@v4`) rather than commit SHAs. The `ci` job had no explicit `permissions:` block, inheriting whatever the repo's default `GITHUB_TOKEN` scope was while running `npm ci` against PR-supplied `package.json`/lockfile content. No automated mechanism (Dependabot/Renovate) surfaced new advisories between manual audits. | Pinned `diff@^9.0.0`/`serialize-javascript@^7.1.1` via root `package.json`'s `overrides` field (mocha's own stable releases cap those ranges below the patched versions). Repinned all three actions in `ci.yml` to commit SHAs with a `# vX.Y.Z` comment. Added `permissions: contents: read` to the `ci` job. Added `.github/dependabot.yml` covering both the `npm` and `github-actions` ecosystems on a weekly schedule. | `npm audit` (`found 0 vulnerabilities` after a clean reinstall), full CI gate (`typecheck && test && lint && build`), and a direct `mocha` smoke run confirming diff-output rendering against `diff@9` |
| 2026-08-30 | Inert cancellation guardrail: `wrapRegions`' per-region loop (`packages/engine/src/wrap.ts`) checked `cancellation.isCancellationRequested` once per iteration, but the loop body was 100% synchronous with no `await`, so it never yielded to the event loop on its own — the flag could only ever be true if it was already set *before* the call started. Clicking "Cancel" on the large-file progress notification, or `format-on-save.ts`'s 1500ms timeout firing, delivers the signal asynchronously and could never actually interrupt a computation already in progress, defeating the one guardrail meant to bound a long/adversarial wrap. Found while auditing every `TextEdit`/`WorkspaceEdit`-producing path for edit-safety. | The loop now yields via a macrotask (`setTimeout(resolve, 0)`, deliberately not a microtask) every 50ms of elapsed computation, but only when a caller passes a `cancellation` signal — scoping the added overhead to the two callers that already opt into cancellation (`wrap-document.ts`, `format-on-save.ts`) with zero behavior change for callers that never pass a token (e.g. the CLI's bulk-apply loop). | `packages/engine/test/hardening/cancellation.test.ts`; existing `large-file-performance.test.ts` (no token passed) still passing unchanged |
| 2026-08-30 | Stale-wrap corruption: once cancellation can actually interrupt mid-computation, the live document can genuinely change while `wrapRegions` is still running against an earlier text snapshot. `vscode.workspace.applyEdit` has no document-version check of its own — it applies a `WorkspaceEdit`'s row/column positions to whatever the document currently contains — so a wrap computed before a concurrent edit landed could apply misaligned positions on top of it, silently corrupting or misplacing text the user just typed. A "writes outside the intended scope" issue by this document's own definition. Found as the direct corollary of the cancellation fix above, same audit pass. | Added `WrapOutcome.documentVersionChanged`, computed by comparing `document.version` immediately before/after `wrapRegions`. Every consumer (`apply-wrap.ts`, both formatting providers, `format-on-save.ts`, `report-wrap-outcome.ts`) now treats it identically to the existing `result.cancelled` case: nothing is applied or returned, and the status bar/output channel reports "document changed during wrap" rather than stale edit/skip counts. Not configurable — same fixed-safety-default treatment as `cancelled`. | `packages/vscode-extension/src/test/suite/wrap-document-concurrent-edit.test.ts`, run in a real Extension Development Host: started a wrap on a 50,000-line file, edited the same document 1.5s into the computation, confirmed the concurrent edit survived and the rest of the document came back byte-for-byte identical to the pre-wrap original |
| 2026-08-30 | Grammar provenance was recorded in `PROVENANCE.md` but never re-verified — nothing recomputed a vendored `.wasm` file's sha256 and compared it against the doc on any run, so a swapped/tampered binary or a stale/falsified doc entry would go unnoticed indefinitely (this document's own "supply-chain integrity" category). | Added `scripts/verify-grammar-provenance.mjs` (dependency-free, matching `packages/vscode-extension/scripts/verify-vsix-contents.mjs`'s style): parses every `## \`filename\`` section's "Vendored file sha256" row out of `PROVENANCE.md`, recomputes each file's actual sha256, and fails on any mismatch or on a file/entry existing without its counterpart. Wired in as a root `pretest` hook so `npm test` runs it automatically, everywhere it already runs. | Ran directly against the current tree (all 6 grammars match); sanity-checked all three failure modes (hash mismatch, orphaned doc entry, undocumented file) against a throwaway copy before wiring it in |
| 2026-08-30 | `capabilities.untrustedWorkspaces` was left undeclared in `packages/vscode-extension/package.json`, leaving VSCode's own unverified-extension default in place instead of a deliberate, audited statement. | Audited every workspace-controllable input the extension reads (all `rewrapPlus.*` settings, `.editorconfig`'s `max_line_length`) and confirmed none can cause behavior beyond configuring the wrap itself; declared `capabilities.untrustedWorkspaces.supported: true`. | Manual audit recorded in this document's VSCode-extension trust-model checklist above |
