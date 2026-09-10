# Performance

Rewrap+ stays responsive even on large files. This page shows the numbers
behind that, and what to expect if you run it on a big document.

## What's measured

- **Wrap Document** -- every wrappable comment, docstring, and string in the
  file is reflowed in one pass.
- **Wrap at Cursor** (and format-on-save) -- a single region is reflowed at
  your cursor position, or wherever you just saved.

Both were timed against a synthetic file with an unrealistic density of
wrappable content -- roughly one long comment and one long string every 10
lines. Real code wraps a much smaller fraction of its lines than that, so
these numbers are a worst case: a typical file of the same size should do
at least as well, usually noticeably better.

## Results

The two tables immediately below are **Python's** numbers -- the
language this benchmarking work originally profiled, and profiled most
deeply (see the two real quadratic-cost bugs found and fixed while doing
so, described in `packages/engine/test/hardening/large-file-performance.test.ts`'s
own doc comment). JavaScript, TypeScript, C++, and Java each get their
own section further down; so do Markdown and LaTeX, whose wrappable-content
density is a fundamentally different shape from any code language's,
Python included.

### Wrap Document (Python)

| File size | Time |
|---|---|
| 1,000 lines | 82 ms |
| 10,000 lines | 0.4 s |
| 50,000 lines | 7.3 s |

### Wrap at Cursor / format-on-save (Python)

**~30 ms** once the file's language grammar is warm, regardless of the
surrounding file's size -- comfortably under the ~50 ms it takes for a
save or a keystroke-triggered wrap to feel instant rather than laggy.
LaTeX is the one exception to "regardless of file size" -- see its own
section below.

Measured on ordinary development hardware, not dedicated benchmark
hardware -- treat these as representative, not a guarantee for every
machine.

### JavaScript, TypeScript, C++, and Java

Unlike Python's numbers above -- each individually profiled, with real
quadratic-cost bugs found and fixed along the way -- the numbers below are
what the engine's own performance-regression suite
(`packages/engine/test/hardening/large-file-performance.test.ts`) measures
directly, timing the identical worst-case synthetic file shape described
under "What's measured" above (one long comment and one long string every
10 lines) through the identical `wrapRegions` pipeline every language
shares. They're a real one-time measurement (`npx vitest run
test/hardening/large-file-performance.test.ts --reporter=verbose` from
`packages/engine`, reading each test's own reported wall time), not a
placeholder -- but that suite exists as a regression guard first and a
benchmark second, so its actual asserted bounds are deliberately far
looser than these numbers (generous headroom for machine variance and
future feature work, not a tight SLA -- see that file's own doc comment).

**Wrap Document**

| File size | JavaScript | TypeScript | C++ | Java |
|---|---|---|---|---|
| 1,000 lines | 32 ms | 65 ms | 88 ms | 28 ms |
| 10,000 lines | 0.5 s | 0.5 s | 0.6 s | 0.4 s |
| 50,000 lines | 8.3 s | 8.4 s | 8.6 s | 7.9 s |

**Wrap at Cursor / format-on-save**, warm grammar, measured on the same
5,000-line file used for every language in that test file: **~90 ms**
(JavaScript), **~125 ms** (TypeScript), **~125 ms** (C++), **~75 ms**
(Java) -- all, like Python's ~30 ms above, independent of the surrounding
file's size. Higher than Python's own ~30 ms, but still comfortably under
the ~50-500 ms range that suite's own `nearCursorBoundMs` treats as
"near-instant" for every language before LaTeX; the gap against Python is
consistent with these being a single one-time measurement run rather than
Python's own more heavily profiled and re-verified number, not evidence
of a real per-language difference. The bound itself is wider than these
isolated numbers alone would need (200 ms would already cover ~125 ms
with margin) because the suite runs every language's near-cursor case,
plus its 1k/10k/50k-line cases, back to back in one CI job -- real CPU
contention pushed the 200 ms version of this bound past 260 ms on
GitHub-hosted runners for languages well under that in isolation, the
same effect the LaTeX override's own doc comment describes measuring
directly for its much larger bound.

### Markdown

Markdown flips the density story above: in a real Markdown document,
nearly every line *is* wrappable prose, so there's no "unrealistic worst
case" to construct -- an ordinary document already looks like one.

| File size | Time |
|---|---|
| 1,000 lines | 87 ms |
| 10,000 lines | 0.4 s |
| 50,000 lines | 1.9 s |

Wrap at Cursor stays the same **regardless of file size** as every other
language -- ~140 ms warm, in a 5,000-line file.

Two edge cases worth naming specifically, since they're shapes no code
file produces: a paragraph nested 200 block quotes deep still wraps in
under 30 ms, with every level of `>` preserved on each rewrapped line; a
single 10,000-line paragraph with no blank lines anywhere in it (one
region covering the whole file, rather than many small ones) wraps in
about 120 ms.

### LaTeX

Like Markdown, an ordinary LaTeX document is already close to
worst-case wrappable-content density -- mostly prose, not "mostly code
with the occasional comment" -- so these numbers use the same kind of
realistic, not artificially inflated, source.

| File size | Time |
|---|---|
| 1,000 lines | 160 ms |
| 10,000 lines | 0.6 s |
| 50,000 lines | 2.4 s |

**Wrap at Cursor is the one exception to "regardless of file size"
above**, and worth calling out plainly rather than glossing over: LaTeX
has no paragraph node in its grammar at all (`docs/parsing.md` Finding
8), so `discoverProse` is a masked line scan rather than the single
native tree-sitter query pass every other language (including Markdown)
uses. That scan runs in full before a cursor-wrap request is narrowed
down to the one region it actually touches, so unlike every other
language, LaTeX's Wrap at Cursor time **does grow with file size**.

Two real, once-significant costs inside that scan were found and
fixed while investigating this. First: the scan originally made
sixteen separate whole-tree `descendantsOfType` calls (one per node
type it cares about -- masked-environment kinds, sectioning commands,
`\item`s, ...); `web-tree-sitter`'s own `descendantsOfType` accepts an
array of types and does the equivalent of one combined walk for all of
them at once, so replacing sixteen single-type calls with one
sixteen-type call measured **~17x faster** on its own (a 50,000-line
file: ~1.7s -> ~0.1s for that portion alone) -- this was the dominant
cost in the whole scan, well ahead of parsing the same file (~0.7s).
Second, found while chasing this same "still scales with file size"
concern further: a separate, redundant `Query.captures` pass the scan
made to classify each `%` comment as whole-line or trailing
(`(line_comment) @comment`, the identical query `discoverRegions`'s
own shared comment-discovery pass already runs once) cost a further
~200-350ms of its own on a 50,000-line file -- confirmed, by direct
profiling, to cost that much **regardless of match count** (even with
zero actual comments in the file), meaning `web-tree-sitter` query
*execution* here scales with tree size, not result size, unlike the
`descendantsOfType` walk above. Folding that same `line_comment`
classification into the already-combined `descendantsOfType` walk (a
plain tree walk, not a compiled-query execution, so it has no
comparable per-call floor) removed that second pass entirely.

Wrap at Cursor dropped as a result of both fixes combined: ~80 ms at
1,000 lines, ~230 ms at 5,000, ~800 ms at 20,000, ~1.7 s at 50,000 --
still confirmed linear, not quadratic, and still a real, user-visible
cost for a very large single `.tex` file, now dominated by parse time
itself (a cost every language pays, not LaTeX-specific) plus
`discoverRegions`'s own always-whole-file discovery pass (shared
architecture, not this adapter's own overhead) rather than by
anything specific to this adapter's discovery logic. Most real LaTeX
documents (a single chapter, an article, even a long thesis chapter)
are well under a thousand lines, where this stays comfortably fast; a
single file in the tens of thousands of lines is the case where it's
still noticeable, and a further fix would mean touching how
`wrapRegions` scopes discovery to a target in the first place -- a
larger, cross-cutting change affecting every adapter, not something
specific to this one. (Incremental parsing -- reusing a previous parse
tree via `web-tree-sitter`'s own `Tree.edit`/edit-aware `Parser.parse`
-- was investigated as an alternative and set aside: profiled directly
with correctly-computed edit positions, it measured only ~1.7-2x
faster than a full reparse here, and, tellingly, an edit near the
start of a 50,000-line file was no faster than one near the end -- this
grammar/binding isn't achieving the "cost independent of file size"
behavior incremental parsing is supposed to provide, so it wasn't a
productive lever for the size of change it would require.)

Two edge cases worth naming specifically, both also improved by these
fixes: 2,000 small masked environments (`\begin{verbatim}`/`\end{verbatim}`)
interspersed with 2,000 wrapped paragraphs -- deliberately the worst
realistic shape for `isRowMasked`'s per-row mask scan -- wraps in about
1.1 s (was ~1.5 s before either fix); 5,000 separate `\item` entries in
one list (5,000 individually-wrapped regions, a meaningfully different
cost shape from one giant region) take about 1.6 s (was ~2.1 s),
confirmed linear rather than quadratic in item count by direct
measurement across several sizes.

## Large files

Wrapping an entire document over 2,000 lines shows a progress
notification you can cancel, rather than the editor appearing to hang.
Ordinary files -- including the large majority of real source files, well
past 2,000 lines at realistic (much lower) wrappable-content density --
finish with no visible delay at all.

Format-on-save never delays a save either: if a wrap can't finish quickly,
it's skipped for that save with a note in the "Rewrap+" output channel,
and the save proceeds normally.
