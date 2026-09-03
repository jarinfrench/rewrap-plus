# Performance

Rewrap+ stays responsive even on large files. This page shows the numbers
behind that, and what to expect if you run it on a big document.

## What's measured

- **Wrap Document** — every wrappable comment, docstring, and string in the
  file is reflowed in one pass.
- **Wrap at Cursor** (and format-on-save) — a single region is reflowed at
  your cursor position, or wherever you just saved.

Both were timed against a synthetic file with an unrealistic density of
wrappable content — roughly one long comment and one long string every 10
lines. Real code wraps a much smaller fraction of its lines than that, so
these numbers are a worst case: a typical file of the same size should do
at least as well, usually noticeably better.

## Results

### Wrap Document

| File size | Time |
|---|---|
| 1,000 lines | 82 ms |
| 10,000 lines | 0.4 s |
| 50,000 lines | 7.3 s |

### Wrap at Cursor / format-on-save

**~30 ms** once the file's language grammar is warm, regardless of the
surrounding file's size — comfortably under the ~50 ms it takes for a
save or a keystroke-triggered wrap to feel instant rather than laggy.
LaTeX is the one exception to "regardless of file size" — see its own
section below.

Measured on ordinary development hardware, not dedicated benchmark
hardware — treat these as representative, not a guarantee for every
machine.

### Markdown

Markdown flips the density story above: in a real Markdown document,
nearly every line *is* wrappable prose, so there's no "unrealistic worst
case" to construct — an ordinary document already looks like one.

| File size | Time |
|---|---|
| 1,000 lines | 87 ms |
| 10,000 lines | 0.4 s |
| 50,000 lines | 1.9 s |

Wrap at Cursor stays the same **regardless of file size** as every other
language — ~140 ms warm, in a 5,000-line file.

Two edge cases worth naming specifically, since they're shapes no code
file produces: a paragraph nested 200 block quotes deep still wraps in
under 30 ms, with every level of `>` preserved on each rewrapped line; a
single 10,000-line paragraph with no blank lines anywhere in it (one
region covering the whole file, rather than many small ones) wraps in
about 120 ms.

### LaTeX

Like Markdown, an ordinary LaTeX document is already close to
worst-case wrappable-content density — mostly prose, not "mostly code
with the occasional comment" — so these numbers use the same kind of
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

A real, once-significant cost inside that scan was found and fixed
while investigating this: the scan originally made sixteen separate
whole-tree `descendantsOfType` calls (one per node type it cares
about — masked-environment kinds, sectioning commands, `\item`s, ...);
`web-tree-sitter`'s own `descendantsOfType` accepts an array of types
and does the equivalent of one combined walk for all of them at once,
so replacing sixteen single-type calls with one sixteen-type call
measured **~17× faster** on its own (a 50,000-line file: ~1.7s → ~0.1s
for that portion alone) — this was the dominant cost in the whole
scan, well ahead of parsing the same file (~0.7s). Wrap at Cursor
roughly halved as a result: ~160 ms at 1,000 lines, ~270 ms at 5,000,
~900 ms at 20,000, ~1.9 s at 50,000 — still confirmed linear, not
quadratic, and still a real, user-visible cost for a very large single
`.tex` file, now dominated by parse time itself (a cost every language
pays, not LaTeX-specific) rather than by this adapter's own discovery
overhead on top of it. Most real LaTeX documents (a single chapter, an
article, even a long thesis chapter) are well under a thousand lines,
where this stays comfortably fast; a single file in the tens of
thousands of lines is the case where it's still noticeable, and a
further fix would mean touching how `wrapRegions` scopes discovery to
a target in the first place — a larger, cross-cutting change, not
something specific to this adapter.

Two edge cases worth naming specifically, both also improved by the
same fix: 2,000 small masked environments (`\begin{verbatim}`/`\end{verbatim}`)
interspersed with 2,000 wrapped paragraphs — deliberately the worst
realistic shape for `isRowMasked`'s per-row mask scan — wraps in about
1.1 s (was ~1.5 s); 5,000 separate `\item` entries in one list (5,000
individually-wrapped regions, a meaningfully different cost shape from
one giant region) take about 1.6 s (was ~2.1 s), confirmed linear
rather than quadratic in item count by direct measurement across
several sizes.

## Large files

Wrapping an entire document over 2,000 lines shows a progress
notification you can cancel, rather than the editor appearing to hang.
Ordinary files — including the large majority of real source files, well
past 2,000 lines at realistic (much lower) wrappable-content density —
finish with no visible delay at all.

Format-on-save never delays a save either: if a wrap can't finish quickly,
it's skipped for that save with a note in the "Rewrap+" output channel,
and the save proceeds normally.
