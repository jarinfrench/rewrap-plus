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
 * bullets and fence delimiters becoming ordinary words. This only ever
 * flattens (see `test/fixtures/python/docstrings/012-pathological-google.*`
 * and its NumPy/Sphinx siblings, `013`/`014`, for the current, accepted
 * output); it does not corrupt, *provided* the description has no blank
 * line before the nested content. A blank line *does* end the entry
 * early (blank lines always end continuation, above): everything after
 * it is no longer inside any entry at all, and reaches this function's
 * fallback path one line at a time — each becomes its own top-level,
 * unindented `paragraph` block, positioned as if it belonged to the
 * section rather than the entry it was actually written under. Avoid a
 * blank-line-separated example inside an entry description until this is
 * addressed; an unbroken continuation (no blank line) is safe today.
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
    while (i < lines.length && isEntryContinuation(lines[i]!, entryIndent, matchEntryStart)) {
      atoms.push(...atomizeWords(lines[i]!));
      i++;
    }
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
