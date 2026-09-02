import type { Block } from '../types/document.js';
import { atomizeWords } from '../segmentation/atomize-words.js';
import type { SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';
import { segmentLines } from './dialect.js';

/** One recognized field-entry start, as matched by a dialect's own regex. */
export interface EntryStartMatch {
  /** Exact display text before the colon, colon included — e.g. `'param1 (int):'` or `':param x:'`. */
  readonly label: string;
  /** Description text starting on the entry's own line; may be empty. */
  readonly rest: string;
}

/**
 * Group a section body's lines into `fieldEntry`/`paragraph`/`blank`
 * blocks, given a per-dialect `matchEntryStart` recognizer.
 *
 * Shared by Google-style (`./google.ts`) and Sphinx-style (`./sphinx.ts`)
 * entries, whose shape is the same — "label: description, possibly
 * continuing on further-indented lines" — differing only in what a label
 * looks like (`'param1 (int):'` vs `':param x:'`). NumPy's own entries
 * (`./numpy.ts`) never put a label and its description on the same
 * physical line at all, so that dialect implements its own loop instead
 * of reusing this one.
 *
 * A non-blank line that doesn't match `matchEntryStart` continues the
 * current entry if it's indented further than that entry's own label
 * line (mirroring `../segmentation/list-item.ts`'s `isListContinuation`);
 * with no entry open yet, it's folded in as an ordinary paragraph line —
 * reachable only for malformed/hand-edited sections, since a real
 * dialect's own `detect` wouldn't have routed well-formed input here in
 * the first place, but "assume paragraph" is a safer failure mode than
 * dropping the line outright.
 *
 * An entry's description is segmented for real structure — a nested
 * list, a fenced sample, a table — via `../segmentation/split-blocks.ts`,
 * not flattened into one atom stream (see `dedentBody` and the
 * `segmentLines` call, below, for exactly how; `./numpy.ts`'s
 * `segmentFieldSection` is the same idea, independently implemented,
 * for NumPy's own entries).
 *
 * **Known limitation, now much narrower than before this file's own
 * `splitBlocks` wiring landed:** `splitBlocks` recognizes a fixed,
 * specific set of structured shapes — a fenced/indented code block, a
 * doctest, a Markdown table, a `-`/`*`/ordered-marker list — and nothing
 * outside that set, however visually structured it looks to a human (a
 * hand-drawn ASCII diagram with no fence around it, an indented-but-
 * unmarked outline that isn't quite a recognized list). That was never
 * in scope for this plan, isn't a field-entry-specific gap (the exact
 * same set of recognized shapes applies at the top level of any other
 * section body), and still degrades to reflowed prose exactly as it
 * always has. The other residual gap is genuinely field-entry-specific,
 * not shared with top-level content: a `listItem` recognized *inside* a
 * description has no nested-`blocks` field of its own (unlike
 * `fieldEntry`) — a further Markdown-indented sub-bullet still becomes
 * its own sibling `listItem` at a deeper `hangingIndent` (not a
 * flattening; confirmed in `./field-entries.test.ts`'s own
 * "Markdown-indented sub-bullet" case), but anything that *isn't* itself
 * a recognized list-marker line, nested inside a `listItem`'s own
 * continuation, folds into that item's flat `atoms` same as it always
 * has (see `../types/document.ts`'s own doc comment on `Block`, and
 * `docs/planning/nested-field-entry-structure-plan.md`'s "Scope"
 * section, for why `listItem` was deliberately left out of this
 * change).
 */
export function groupFieldEntries(
  lines: readonly string[],
  matchEntryStart: (line: string) => EntryStartMatch | null,
  options: SplitBlocksOptions = {},
  continuationIndentWidth = 4,
): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      blocks.push({ type: 'blank' });
      i++;
      continue;
    }

    const entry = matchEntryStart(line);
    if (!entry) {
      blocks.push({ type: 'paragraph', atoms: atomizeWords(line) });
      i++;
      continue;
    }

    const entryIndent = leadingWhitespaceLength(line);
    // At least wide enough for the label itself plus one separating
    // space — `../reflow/decorate-block.ts`'s `markerPrefix` needs
    // `hangingIndent > label.length` to place that space at all, and a
    // label longer than the conventional `continuationIndentWidth` (a
    // longer parameter name, a Sphinx `:raises SomeLongException:`) is
    // entirely normal input, not an edge case worth falling back to
    // `markerPrefix`'s own defensive "no room" branch for.
    const hangingIndent =
      entryIndent + Math.max(continuationIndentWidth, entry.label.length + 1);
    i++;
    const { body, nextIndex } = collectEntryBody(lines, i, entryIndent, matchEntryStart);
    i = nextIndex;
    const dedented = dedentBody(body);
    // `entry.rest` is already at relative column 0 by construction
    // (`EntryStartMatch`'s own doc comment: captured text, no leading
    // whitespace) — prepending it unconditionally when it's empty would
    // inject a synthetic leading blank line into the segmented body that
    // was never actually there (nothing was written on the label's own
    // physical line at all, which isn't the same thing as "a blank line
    // separates the label from its description").
    const bodyLines = entry.rest === '' ? dedented : [entry.rest, ...dedented];
    blocks.push({
      type: 'fieldEntry',
      label: entry.label,
      hangingIndent,
      blocks: segmentLines(bodyLines, options),
    });
  }

  return blocks;
}

/**
 * Strip the common leading whitespace shared by every non-blank line in
 * `body` before segmenting it — the same "compute common indentation,
 * strip it" move PEP 257 prescribes and
 * `../languages/python/dissolve-docstring.ts`'s `dissolveDocstring`
 * already performs for a *whole docstring's* body, applied here one
 * level down, to a single entry's own collected continuation. Without
 * this, a nested list or fenced sample one level deeper than the rest of
 * the entry's continuation would carry `splitBlocks`'s own
 * `hangingIndent`/verbatim-line indentation as a large, source-column-
 * dependent number (however many columns the whole docstring happens to
 * sit at) instead of the small, meaningful "how much deeper than this
 * entry's own continuation" delta that `reflowFieldEntry`
 * (`../reflow/reflow-block.ts`) actually needs to reproduce the nesting
 * relative to wherever the entry itself ends up.
 *
 * Exported for `./numpy.ts`'s own `segmentFieldSection` to reuse: this
 * particular piece has nothing dialect-specific about it (unlike the
 * entry-*recognition* loop above, which NumPy deliberately reimplements
 * on its own — see `groupFieldEntries`'s own doc comment for why), so
 * there's no reason for NumPy to duplicate this exact "compute common
 * indentation, strip it" logic just because its collection loop differs.
 */
export function dedentBody(body: readonly string[]): readonly string[] {
  let commonIndent: number | null = null;
  for (const line of body) {
    if (line.trim() === '') {
      continue;
    }
    const indent = leadingWhitespaceLength(line);
    commonIndent = commonIndent === null ? indent : Math.min(commonIndent, indent);
  }
  if (!commonIndent) {
    return body;
  }
  return body.map((line) => (line.trim() === '' ? '' : line.slice(commonIndent)));
}

/**
 * Collect an entry's continuation lines starting at `start`, look-ahead
 * style rather than stopping at the first blank line: a blank line is
 * tentatively included, but only actually kept if some later line still
 * satisfies `isEntryContinuation` — mirroring
 * `../segmentation/verbatim.ts`'s `matchIndentedRun` ("blank lines inside
 * are fine, trailing blanks aren't"), the same shape of look-ahead scan,
 * just walked against `isEntryContinuation`'s dedent/sibling-entry rule
 * instead of `matchIndentedRun`'s flat "indent above zero" one. This is
 * what lets a blank-line-separated nested list or fenced sample inside a
 * description stay part of the entry instead of ending it the moment the
 * first blank line appears — `groupFieldEntries`'s own doc comment,
 * above, covers what happens to the collected result (`dedentBody`, then
 * `segmentLines`); this function only decides *which* lines belong to
 * the entry in the first place.
 *
 * Trailing blank lines are deliberately excluded from `body` (and so
 * never atomized) and instead left where the caller's own top-level loop
 * will pick them up as ordinary `blank` blocks between entries — the
 * *entry* doesn't own the blank line that merely separates it from
 * whatever comes next, only blank lines genuinely nested inside its own
 * continuation.
 */
function collectEntryBody(
  lines: readonly string[],
  start: number,
  entryIndent: number,
  matchEntryStart: (line: string) => EntryStartMatch | null,
): { body: readonly string[]; nextIndex: number } {
  let end = start;
  for (; end < lines.length; end++) {
    const line = lines[end]!;
    if (line.trim() === '') {
      continue; // tentatively included; trimmed below if trailing
    }
    if (!isEntryContinuation(line, entryIndent, matchEntryStart)) {
      break;
    }
  }
  let trimmedEnd = end;
  while (trimmedEnd > start && lines[trimmedEnd - 1]!.trim() === '') {
    trimmedEnd--;
  }
  return { body: lines.slice(start, trimmedEnd), nextIndex: trimmedEnd };
}

/**
 * A candidate line only ends the current entry's continuation if it
 * matches `matchEntryStart` *and* sits at `entryIndent` or shallower —
 * the depth every genuine sibling entry shares, since a dialect's own
 * entries are always a flat list, never nested. A deeper match is
 * folded into the current entry as ordinary continuation content
 * instead, on the same "indented further than the label" basis as any
 * other continuation line.
 *
 * **Regression, confirmed as a real idempotency bug while building
 * `test/fixtures/python/docstrings/012-pathological-google.*`:** the
 * indent check used to be applied only to a *non*-matching line, so any
 * line matching `matchEntryStart` ended continuation outright,
 * regardless of depth. A field entry's description can legitimately
 * contain a `word:` substring — a nested bullet's own "label:
 * description" shape, or plain prose with a colon in it — and reflow is
 * free to break a line right before that word on any given wrap. At the
 * time this was fixed, a description always flattened to one atom
 * stream regardless of what it contained; the same risk applies just as
 * well now that a description segments for real structure (a nested
 * `listItem`'s own text can contain the identical `word:` substring).
 * When it did, the old code read it as a brand-new sibling entry despite sitting at
 * the *continuation* indent, not the entries' own shared indent —
 * splitting one logical entry into several and, since the split
 * doesn't happen at a section boundary, discarding everything after it
 * into orphaned top-level `paragraph` blocks. Reproduced directly: a
 * flattened nested list using `'- verbose: ...'`/`'- strict: ...'`-
 * style colon-labeled bullets wrapped correctly once, but a *second*
 * wrap of that first output relocated `'strict:'` to the start of a
 * physical line at the continuation depth and misread it as a new
 * entry there, breaking `wrap(wrap(x)) === wrap(x)` — caught by
 * `test/wrap/idempotency-all-fixtures.test.ts`'s repo-wide property
 * check, not by any single dialect's own narrower fixture suite.
 * Requiring the match to *also* sit at `entryIndent` or shallower
 * closes this precisely: a genuine sibling entry is unaffected (it's
 * always written at the shared indent), while a coincidental `word:`
 * anywhere deeper — wherever reflow happens to have broken a line —
 * now stays part of the entry that's still open.
 */
function isEntryContinuation(
  line: string,
  entryIndent: number,
  matchEntryStart: (line: string) => EntryStartMatch | null,
): boolean {
  if (line.trim() === '') {
    return false;
  }
  const indent = leadingWhitespaceLength(line);
  if (matchEntryStart(line) && indent <= entryIndent) {
    return false; // a genuine sibling entry, at the entries' own shared indent
  }
  return indent > entryIndent;
}
