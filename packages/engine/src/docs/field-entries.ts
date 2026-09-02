import type { Atom, Block } from '../types/document.js';
import { atomizeWords } from '../segmentation/atomize-words.js';
import { leadingWhitespaceLength } from '../segmentation/verbatim.js';

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
 * **Known limitation:** an entry's continuation lines are atomized
 * directly (`atomizeWords`, below) rather than run back through
 * `../segmentation/split-blocks.ts`, so a nested list or a fenced code
 * sample inside a field-entry's own description (e.g. a Google `Args:`
 * entry whose text includes a bulleted sub-list or a ` ``` ` example) is
 * *not* recognized as such — it degrades to plain reflowed prose, its
 * bullets and fence delimiters becoming ordinary words, and a blank line
 * that was structurally meaningful (separating two bullets, surrounding a
 * fenced block) atomizes to nothing and simply vanishes, silently
 * merging what were two visually-separated chunks into one continuous
 * run of prose. This only ever flattens (see
 * `test/fixtures/python/docstrings/012-pathological-google.*` and its
 * NumPy/Sphinx siblings, `013`/`014`, for the current, accepted output);
 * it does not corrupt, and does not require avoiding a blank line inside
 * the description — a blank line no longer ends the entry early
 * (`collectEntryBody`, below, collects it as long as further entry
 * content follows), only a genuine dedent or a new sibling entry does.
 */
export function groupFieldEntries(
  lines: readonly string[],
  matchEntryStart: (line: string) => EntryStartMatch | null,
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
    const atoms: Atom[] = atomizeWords(entry.rest);
    i++;
    const { body, nextIndex } = collectEntryBody(lines, i, entryIndent, matchEntryStart);
    for (const bodyLine of body) {
      atoms.push(...atomizeWords(bodyLine));
    }
    i = nextIndex;
    blocks.push({
      type: 'fieldEntry',
      label: entry.label,
      hangingIndent,
      blocks: [{ type: 'paragraph', atoms }],
    });
  }

  return blocks;
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
 * first blank line appears — see this file's own "Known limitation"
 * above for what still happens to that content once collected (it still
 * flattens; only *which* lines get collected changes here).
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
 * regardless of depth. A field entry's flattened description (this
 * file's own "Known limitation" above) can legitimately contain a
 * `word:` substring — a nested bullet's own "label: description"
 * shape, or plain prose with a colon in it — and reflow is free to
 * break a line right before that word on any given wrap. When it did,
 * the old code read it as a brand-new sibling entry despite sitting at
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
