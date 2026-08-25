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
    blocks.push({ type: 'fieldEntry', label: entry.label, hangingIndent, atoms });
  }

  return blocks;
}

function isEntryContinuation(
  line: string,
  entryIndent: number,
  matchEntryStart: (line: string) => EntryStartMatch | null,
): boolean {
  if (line.trim() === '') {
    return false;
  }
  if (matchEntryStart(line)) {
    return false; // a new entry always ends the previous one's continuation
  }
  return leadingWhitespaceLength(line) > entryIndent;
}
