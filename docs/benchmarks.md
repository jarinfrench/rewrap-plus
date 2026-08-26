# Performance benchmarks (Phase 10)

Phase 10 ("engine: add performance benchmarks and large-file
guardrails") asked for `wrap-document` to be benchmarked on 1k/10k/50k-
line files, and for `wrap-at-cursor` to "feel instant (< 50 ms after warm
grammar load)." This documents the actual measurements those numbers are
based on, the two real bugs the benchmarking work found along the way,
and the large-file guardrail threshold they informed.

The regression-guard version of this benchmark lives at
`packages/engine/test/hardening/large-file-performance.test.ts` — generous
upper bounds (not tight timing assertions) so ordinary machine variance
doesn't make CI flaky, while still catching a *class* of regression (a
reintroduced quadratic cost) by an order of magnitude, the way both bugs
below did before they were fixed.

## Methodology

A synthetic Python file with a deliberately *unrealistic* density of
wrappable regions: every 10th line a long comment, every 10th line (offset
5) a long string assignment, everything else a short, untouched
assignment. Real code wraps a much smaller fraction of its lines than
this — the benchmark is a worse case than any real file of the same line
count on purpose, so the numbers below have real margin rather than being
tuned to just barely pass. Timed with a plain `Date.now()` bracket around
one `wrapRegions` call, `stringPolicy: 'prose'`, on the author's own
development machine (not dedicated benchmark hardware — treat the
absolute numbers as one data point, not a guarantee).

## Results

### `wrap-document` (every region in the file)

| Lines | Regions | Time (before fixes) | Time (after fixes) |
|---|---|---|---|
| 1,000 | 200 | 112 ms | 82 ms |
| 10,000 | 2,000 | 2.4 s | 0.4 s |
| 50,000 | 10,000 | **62 s** | **7.3 s** |

### `wrap-at-cursor` (one region, targeted span)

A single-region wrap, in a 2,000–5,000 line file, after the grammar is
already warm: **~30 ms**, comfortably inside the plan's own "< 50 ms"
budget, and independent of the surrounding file's size (it was already
this fast before either fix below — the quadratic costs only showed up
when *every* region in a large file was touched in one call).

## Two quadratic-cost bugs found by this benchmarking work

Both are the same *shape* of bug — a function re-deriving
`source.split('\n')` (or an equivalent whole-file scan) on every call,
called once per region — and both are fixed the same way: split once, up
front, and reuse the result.

1. **`sliceSpanText`** (`packages/engine/src/discovery/slice-span.ts`) —
   called at least once per region from `wrapRegions` itself (the
   "already correctly wrapped" comparison), and again from several
   dissolve functions and `isSafeToWrap`. Fixed with a single-entry,
   reference-equality cache of the most recently split `source` — safe
   because every real call site passes the exact same `source` string
   reference for the whole of one `wrapRegions` invocation (never a
   same-content copy), and bounded because a long-lived process (the
   extension host, across many different files over a session) never
   accumulates memory for files it's done with. This was the larger of
   the two contributors to the 50k-line number above (~62s → ~7.3s on its
   own).

2. **`detectLineEndingNear`** (`packages/engine/src/detect-line-ending.ts`,
   added earlier in this same phase for per-region line-ending detection)
   — had the identical bug from the moment it was introduced, caught by
   this benchmarking work before it was ever released rather than as a
   separate regression later. Fixed by changing its signature to take the
   caller's own pre-split `lines` array instead of re-splitting `source`
   internally; `wrap.ts` now splits once per `wrapRegions` call and passes
   the result to every region's `detectLineEndingNear` call.

See each function's own doc comment for the fuller before/after
reasoning.

## The large-file guardrail threshold

`packages/vscode-extension/src/commands/wrap-document.ts` shows a
cancellable progress notification (`vscode.window.withProgress`) rather
than blocking silently, once a document's line count exceeds
`LARGE_DOCUMENT_LINE_THRESHOLD` (2,000 lines — see that file for the
constant and its own reasoning). Chosen well below where the numbers
above show real cost starting to matter (a realistic, much-lower-density
2,000-line file finishes in a small fraction of a second), so the
guardrail's cost — one extra `withProgress` wrapper — is paid on files
that are still fast, trading a small, harmless bit of UI for headroom
against the adversarially dense files this benchmark deliberately
constructs, which real repositories do occasionally contain (a generated
file, a long data-heavy module).
