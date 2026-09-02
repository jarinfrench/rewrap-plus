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

## Large files

Wrapping an entire document over 2,000 lines shows a progress
notification you can cancel, rather than the editor appearing to hang.
Ordinary files — including the large majority of real source files, well
past 2,000 lines at realistic (much lower) wrappable-content density —
finish with no visible delay at all.

Format-on-save never delays a save either: if a wrap can't finish quickly,
it's skipped for that save with a note in the "Rewrap+" output channel,
and the save proceeds normally.
