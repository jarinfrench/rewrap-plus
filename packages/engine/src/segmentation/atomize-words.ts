import type { Atom } from '../types/document.js';

/**
 * Split a line of text into whitespace-delimited `Atom`s.
 *
 * This is a deliberately provisional word splitter, not the real thing —
 * `Atom` is defined in Phase 1 only because `Block` needs to reference its
 * shape (see `../types/document.ts`), and the actual segmentation rules
 * ("never split inside an escape sequence, format placeholder, f-string
 * interpolation, URL, path, or inline code span") are Phase 5's job
 * ("add atom segmentation with unbreakable unit support"). Phase 5 also
 * replaces `width: text.length` below with real display-width
 * calculation (East Asian Wide/Fullwidth as 2 columns, combining marks as
 * 0) — see that phase's "add display width calculation" commit.
 *
 * Block splitting (this phase) only needs *some* faithful, round-trippable
 * atom stream to populate `Block.paragraph`/`.listItem`/`.fieldEntry`'s
 * `atoms` field with — plain whitespace splitting is sufficient for that,
 * and correct for the common case (plain ASCII prose) besides.
 *
 * Every atom's `glue` is left `undefined`, meaning "join to the previous
 * atom with a space" — the ordinary case for word-splitting. Phase 5
 * introduces `'none'` for atoms that must sit flush against their
 * neighbor (e.g. a placeholder immediately followed by punctuation);
 * nothing in this phase's splitting needs it.
 */
export function atomizeWords(line: string): Atom[] {
  const words = line.match(/\S+/g) ?? [];
  return words.map((text) => ({ text, width: text.length, breakBefore: false }));
}
