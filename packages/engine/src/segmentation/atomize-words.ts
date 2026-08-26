import type { Atom } from '../types/document.js';
import { displayWidth } from './display-width.js';
import { findUnbreakableSpans } from './unbreakable-spans.js';

/**
 * Split a line of text into `Atom`s, honoring unbreakable units.
 *
 * Atoms are whitespace-delimited words *except* that these are never
 * split internally, even where they contain whitespace of their own
 * (`./unbreakable-spans.ts`):
 *
 * - escape sequences (`\n`, `\t`, `\\`, `\x41`, `\u1234`, `\U0001F600`,
 *   `\N{NAME}`)
 * - format placeholders (`{}`, `{0}`, `{name!r:>10}`, `%s`, `%(key)d`)
 * - f-string interpolations (`{expr}`, including nested braces)
 * - inline code spans (`` `x` ``) and reST roles (`` :func:`x` ``)
 *
 * URLs and filesystem paths need no special handling here: they contain
 * no whitespace by construction, so a maximal non-whitespace run already
 * keeps one whole.
 *
 * A word run that starts with, but isn't wholly consumed by, an
 * unbreakable span (e.g. `{x}.` — the placeholder followed immediately
 * by a period, no space between) is split into two atoms at the span's
 * boundary, and the later atom is tagged `glue: 'none'` rather than left
 * `undefined` ("join with a space") — reflow and re-emission must
 * reproduce the original absence of whitespace there, not insert one.
 *
 * Getting the "never split inside" rule wrong produces *invalid strings*
 * later (a torn f-string interpolation, a mangled escape), not just an
 * ugly wrap.
 *
 * `width` is real display width (`./display-width.ts`): East Asian
 * Wide/Fullwidth characters count as 2 columns, combining marks as 0 —
 * not `text.length`, which over- or under-counts for exactly that text.
 */
export function atomizeWords(line: string): Atom[] {
  const unbreakable = findUnbreakableSpans(line);
  const atoms: Atom[] = [];
  const n = line.length;
  let i = 0;
  let unbreakableIndex = 0;
  let prevEnd = -1; // end index (exclusive) of the previously emitted atom

  const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\t';

  while (i < n) {
    while (i < n && isWhitespace(line[i]!)) {
      i++;
    }
    if (i >= n) {
      break;
    }

    while (unbreakableIndex < unbreakable.length && unbreakable[unbreakableIndex]!.end <= i) {
      unbreakableIndex++;
    }
    const nextSpan = unbreakable[unbreakableIndex];

    let end: number;
    if (nextSpan && nextSpan.start === i) {
      // This atom *is* the unbreakable span: take it whole, whitespace
      // and all.
      end = nextSpan.end;
      unbreakableIndex++;
    } else {
      // Ordinary run: consume non-whitespace characters up to the next
      // whitespace, but stop early if an unbreakable span begins first —
      // that span becomes its own atom on the next iteration, glued to
      // this one (no whitespace separated them in the source).
      const stopAt = nextSpan ? nextSpan.start : n;
      end = i;
      while (end < stopAt && !isWhitespace(line[end]!)) {
        end++;
      }
    }

    const gluedToPrevious = prevEnd === i;
    const text = line.slice(i, end);
    atoms.push({
      text,
      width: displayWidth(text),
      breakBefore: false,
      ...(gluedToPrevious ? { glue: 'none' as const } : {}),
    });
    prevEnd = end;
    i = end;
  }

  return atoms;
}
