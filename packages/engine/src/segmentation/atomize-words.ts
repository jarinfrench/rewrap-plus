import type { Atom } from '../types/document.js';
import { displayWidth } from './display-width.js';
import { findUnbreakableSpans } from './unbreakable-spans.js';

const SENTENCE_END_CHARS = new Set(['.', '!', '?']);

export interface AtomizeWordsOptions {
  /**
   * Extra never-split patterns for this call only, merged ahead of the
   * shared built-in set (`./unbreakable-spans.ts`'s `UNBREAKABLE_PATTERN`)
   * — see `findUnbreakableSpans`'s own doc comment for the merge order
   * and the constraints a pattern here must satisfy (self-contained,
   * non-global, no adjacent unbounded quantifiers). Used by
   * `../prose/dissolve-prose.ts` for a prose language's own true
   * never-split forms, e.g. LaTeX's `\verb`/`\lstinline`
   * (`docs/planning/markdown-latex-plan.md` §4.3) — content the grammar
   * itself doesn't protect from being torn at internal whitespace.
   */
  readonly extraUnbreakable?: readonly RegExp[];
}

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
 *
 * **Sentence spacing is preserved, not imposed.** If the source already
 * has *exactly* two spaces immediately after a `.`/`!`/`?` that ends the
 * previous atom, the next atom is tagged `glue: 'double'`
 * (`../reflow/reflow-block.ts` renders that as two spaces and budgets it
 * as two columns) instead of the ordinary single-space join — so a
 * paragraph the author already double-spaces keeps reading that way
 * through a rewrap, the same as it would if nothing had touched it.
 * Deliberately narrow, in two ways: the *count* of an ordinary run isn't
 * kept in general (any whitespace run that isn't exactly this shape —
 * one space, or three-or-more, anywhere — still collapses to one join,
 * same as always; that collapsing is the intended cosmetic
 * normalization for prose), and the *position* is scoped to right after
 * sentence-ending punctuation specifically, not "any run of 2 spaces."
 * A wider rule (preserving any multi-space run verbatim, or treating
 * "2 or more" as double) would also preserve or half-preserve incidental
 * noise — a stray extra space from a copy-paste, misaligned padding —
 * that prose reflow exists to clean up everywhere else. Requiring an
 * exact match on the one shape that's an unambiguous, well-known
 * typographic convention (a deliberate sentence-spacing double-space)
 * keeps the rule a clean yes/no rather than an arbitrary cutoff for how
 * many extra spaces still "count".
 */
export function atomizeWords(line: string, options: AtomizeWordsOptions = {}): Atom[] {
  const unbreakable = findUnbreakableSpans(line, options.extraUnbreakable);
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
    const whitespaceRun = i - prevEnd;

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

    const gluedToPrevious = whitespaceRun === 0;
    const previousAtom = atoms[atoms.length - 1];
    const doubleSpaced =
      whitespaceRun === 2 &&
      previousAtom !== undefined &&
      SENTENCE_END_CHARS.has(previousAtom.text.at(-1) ?? '');
    const text = line.slice(i, end);
    atoms.push({
      text,
      width: displayWidth(text),
      breakBefore: false,
      ...(gluedToPrevious ? { glue: 'none' as const } : {}),
      ...(doubleSpaced ? { glue: 'double' as const } : {}),
    });
    prevEnd = end;
    i = end;
  }

  return atoms;
}
