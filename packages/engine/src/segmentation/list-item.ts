/**
 * A line's list marker, once matched. `indent` and `hangingIndent` are
 * plain character-column counts into the (already-dissolved, un-expanded)
 * line — not the tab-expanded visual columns `visualIndentColumn` produces
 * for a region's own base indent (`../discovery/visual-indent-column.ts`).
 * Dissolved comment/docstring text is overwhelmingly space-indented in
 * practice, and treating this internally-consistent character count as a
 * column is enough to detect and align list continuations; genuine tab
 * handling inside dissolved text is deferred to display-width's own
 * work, same as word width itself (see `./atomize-words.ts`).
 */
export interface ListMarkerMatch {
  /** Leading whitespace before the marker, verbatim. */
  readonly indent: string;
  /** The marker itself, e.g. `'-'`, `'1.'`, `'iv)'`, `'a.'`. */
  readonly marker: string;
  /**
   * Character column where the item's content begins: `indent.length +
   * marker.length` plus the whitespace separating the marker from its
   * text. Continuation lines are expected to align here.
   */
  readonly hangingIndent: number;
  /** Text on the marker's own line, after the marker and its spacing. */
  readonly rest: string;
}

/**
 * Recognized bullet markers: `-`, `*`, `+`, `•`.
 *
 * Recognized ordered markers (`1.`, `1)`, `a.`, `i.`):
 * digits, a single letter, or a short (1-4 character) run of roman-
 * numeral letters. The roman alternative is tried before the bare
 * single-letter one so a multi-letter roman numeral like `iv.` or `xii.`
 * matches in full rather than being truncated to its first letter —
 * `[a-zA-Z]` alone would still accept the single-letter case (`i.`, `a.`)
 * either way, so nothing is lost by trying roman first.
 */
const LIST_MARKER = /^([ \t]*)(\d+[.)]|[ivxlcdmIVXLCDM]{1,4}[.)]|[a-zA-Z][.)]|[-*+•])(\s*)(.*)$/;

/**
 * Match `line` against the list-marker grammar above. Bullets need no
 * trailing whitespace to count (an item can be immediately followed by
 * end of line, e.g. a blank list item); the marker and its separating
 * whitespace still both count toward `hangingIndent` when present.
 *
 * Returns `null` for a line that isn't a list marker at all — including
 * plain paragraph text, so callers can use this both to *start* a list
 * item and (via a second call) to recognize where the *next* item begins,
 * ending the previous one's continuation lines.
 */
export function matchListMarker(line: string): ListMarkerMatch | null {
  const match = LIST_MARKER.exec(line);
  if (!match) {
    return null;
  }
  const [, indent = '', marker = '', spacing = '', rest = ''] = match;
  return {
    indent,
    marker,
    hangingIndent: indent.length + marker.length + spacing.length,
    rest,
  };
}

/**
 * Whether `line` continues the list item that started with `item`, rather
 * than starting a new block.
 *
 * A continuation line must be non-blank, must not itself be a list marker
 * (a marker line always starts a fresh `listItem` — including a *nested*
 * one, which this module represents simply as another top-level
 * `listItem` block with a deeper `hangingIndent`: `Block` is
 * a flat sequence, so nesting is encoded positionally rather than as a
 * tree), and must be indented further than the marker itself — i.e. it
 * sits visually "under" the item, not back out at the marker's own
 * indent or shallower.
 */
export function isListContinuation(line: string, item: ListMarkerMatch): boolean {
  if (line.trim() === '') {
    return false;
  }
  if (matchListMarker(line)) {
    return false;
  }
  const leading = /^[ \t]*/.exec(line)?.[0].length ?? 0;
  return leading > item.indent.length;
}
