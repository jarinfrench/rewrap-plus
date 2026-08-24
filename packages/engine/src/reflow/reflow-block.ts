import type { Atom, Block } from '../types/document.js';

/**
 * Reflow one `Block`'s content to `availableWidth` columns, indenting
 * every line after the first by `hangingIndent` spaces (Phase 5,
 * "implement greedy reflow with width and indent constraints").
 *
 * Only `paragraph`, `listItem`, and `fieldEntry` have atoms to reflow;
 * the other three `Block` variants pass through basically unchanged,
 * matching how Phase 4 already treats them ("`verbatim` is the escape
 * hatch that makes 'preserve formatting' tractable"):
 *
 * - `blank` — a single empty line.
 * - `verbatim` — its `lines`, untouched. Reflowing a fenced code block,
 *   a doctest, or an ASCII table would corrupt it; that's the entire
 *   reason `splitBlocks` (Phase 4) routed this content to `verbatim`
 *   instead of `paragraph` in the first place.
 * - `sectionHeader` — its `text` as one line. Headers ("Args:", a NumPy
 *   underline) are structural markers, not prose to fill; reflowing one
 *   would break whatever fixed relationship it has to its section (see
 *   Phase 8's NumPy commit: "underline length re-synced to header
 *   length if the header is untouched").
 *
 * For `paragraph`/`listItem`/`fieldEntry`, this deliberately reflows
 * only the atom stream — it does **not** prepend a list marker or field
 * label. Those belong to the region's own dissolve/emit step (Phase 6+,
 * per-language and, for doc dialects, per-dialect — see Phase 8's
 * `DocDialect.emit`), which is the only code that knows the marker's
 * *display* form (bullet character, renumbered ordinal, dialect-specific
 * field syntax like `:param x:`). Keeping that concern out of this
 * function is what keeps it shared and dependency-free: reflow doesn't
 * need to know anything about Markdown bullets or Sphinx field lists to
 * do its job.
 *
 * `hangingIndent` is spent from the *same* `availableWidth` budget that
 * the first line uses in full — continuation lines get
 * `availableWidth - hangingIndent` columns for content, plus
 * `hangingIndent` literal leading spaces, for the same total column
 * budget the caller resolved (`columnLimit - indentColumn`, in the
 * pipeline's terms). A block's own `hangingIndent` field (`listItem`,
 * `fieldEntry`) is *not* read directly here — the caller decides what
 * value to pass, since Phase 8 dialects may want alignment that differs
 * from the raw marker width (e.g. aligning under a parameter name rather
 * than under the bullet).
 *
 * **Overflow rule** (the plan's decision #5): an atom wider than its
 * line's available width is placed alone on that line and allowed to
 * exceed the limit — never force-split mid-atom. This is what makes a
 * lone 90-column URL survive intact instead of being mangled.
 */
export function reflowBlock(block: Block, availableWidth: number, hangingIndent: number): string[] {
  switch (block.type) {
    case 'blank':
      return [''];
    case 'verbatim':
      return [...block.lines];
    case 'sectionHeader':
      return [block.text];
    case 'paragraph':
    case 'listItem':
    case 'fieldEntry':
      return greedyFill(block.atoms, availableWidth, hangingIndent);
  }
}

/**
 * Greedy first-fit line breaking (matches the plan's stated goal: "match
 * Rewrap's behavior and user expectation"). Walks the atom stream once,
 * adding each atom to the current line if it fits and starting a new
 * line otherwise; never looks ahead or reconsiders a placed atom (that's
 * what distinguishes this from the optional balanced mode added
 * alongside this function).
 */
function greedyFill(
  atoms: readonly Atom[],
  availableWidth: number,
  hangingIndent: number,
): string[] {
  if (atoms.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current: Atom[] = [];
  let currentWidth = 0;
  let isFirstLine = true;

  const budget = (): number => (isFirstLine ? availableWidth : availableWidth - hangingIndent);

  const flush = (): void => {
    const indent = isFirstLine ? '' : ' '.repeat(hangingIndent);
    lines.push(indent + renderAtoms(current));
    current = [];
    currentWidth = 0;
    isFirstLine = false;
  };

  for (const atom of atoms) {
    if (current.length === 0) {
      // A line always takes at least one atom, however wide — the
      // overflow rule. `breakBefore` is moot here: there's nothing on
      // this line yet to break away from.
      current.push(atom);
      currentWidth = atom.width;
      continue;
    }

    if (atom.breakBefore) {
      flush();
      current.push(atom);
      currentWidth = atom.width;
      continue;
    }

    const glueWidth = atom.glue === 'none' ? 0 : 1;
    const projected = currentWidth + glueWidth + atom.width;
    if (projected <= budget()) {
      current.push(atom);
      currentWidth = projected;
    } else {
      flush();
      current.push(atom);
      currentWidth = atom.width;
    }
  }
  flush();

  return lines;
}

/**
 * Join a line's atoms back into text, respecting `glue`: `'none'` means
 * flush against the previous atom (no space), anything else — including
 * the ordinary `undefined` case — means one space.
 */
function renderAtoms(atoms: readonly Atom[]): string {
  let out = '';
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    if (i > 0 && atom.glue !== 'none') {
      out += ' ';
    }
    out += atom.text;
  }
  return out;
}
