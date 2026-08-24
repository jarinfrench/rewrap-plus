import type { Atom, Block } from '../types/document.js';

/**
 * Options controlling `reflowBlock`'s line-breaking strategy.
 */
export interface ReflowOptions {
  /**
   * `'greedy'` (default) — first-fit: fill each line as much as
   * possible before wrapping. Matches Rewrap's behavior and user
   * expectation, per the plan.
   *
   * `'balanced'` — minimum-raggedness: choose break points that
   * minimize the total squared slack across all lines but the last
   * (Phase 5, "add optional balanced (minimum-raggedness) reflow
   * mode"), the same family of algorithm TeX/Knuth–Plass uses for
   * paragraph justification. Often visibly nicer for short docstrings,
   * where greedy's tendency to cram every line but the last can leave
   * one dramatically shorter final line; balanced spreads the
   * raggedness out instead. Behind `WrapConfig.balancedWrapping`
   * (default off, wired in Phase 7) since it costs more to compute and
   * greedy is the more predictable, more widely-expected default.
   */
  readonly mode?: 'greedy' | 'balanced';
}

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
 * lone 90-column URL survive intact instead of being mangled. Holds
 * under both `mode`s.
 */
export function reflowBlock(
  block: Block,
  availableWidth: number,
  hangingIndent: number,
  options: ReflowOptions = {},
): string[] {
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
      return options.mode === 'balanced'
        ? balancedFill(block.atoms, availableWidth, hangingIndent)
        : greedyFill(block.atoms, availableWidth, hangingIndent);
  }
}

/**
 * Greedy first-fit line breaking (matches the plan's stated goal: "match
 * Rewrap's behavior and user expectation"). Walks the atom stream once,
 * adding each atom to the current line if it fits and starting a new
 * line otherwise; never looks ahead or reconsiders a placed atom (that's
 * what distinguishes this from `balancedFill`, below).
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
 * Balanced (minimum-raggedness) line breaking: a Knuth–Plass-lite
 * dynamic program that chooses break points minimizing the sum, over
 * every line but the last, of the squared slack (unused width) that
 * line leaves — the standard formulation for "spread the raggedness out
 * evenly" rather than greedy's "cram every line except the last."
 *
 * `dp[i]` is the minimum achievable cost for laying out `atoms[i..n)`
 * as a run of lines starting fresh at `i`; `choice[i]` records the `j`
 * (exclusive end) of the best first line from `i`. Only line `0` (the
 * one starting at atom index `0`) is special-cased to the full
 * `availableWidth` budget — *every* other line, wherever it starts, is
 * a continuation line at `availableWidth - hangingIndent`, since only
 * the block's very first line is ever not a continuation. That
 * collapses what would otherwise be a line-*number*-dependent budget
 * into a line-*start-index*-dependent one, which is all the DP needs.
 *
 * Constraints mirrored from `greedyFill`, so both modes obey the same
 * invariants:
 * - a line that overflows its budget is only ever valid if it's a
 *   single atom (the overflow rule) — an unavoidable, unpenalized cost
 *   of `0`; a multi-atom line that overflows is simply not considered,
 *   enforced by breaking out of the inner loop the moment accumulated
 *   width exceeds budget, since width only grows as the candidate line
 *   extends;
 * - a single atom that *does* fit within budget is not automatically
 *   free — it competes on its actual squared-slack cost against being
 *   merged with a neighbor, the same as any other line;
 * - an atom with `breakBefore` set may never appear as a non-first atom
 *   of a candidate line — mirroring greedy's forced line break — which
 *   also bounds the inner loop's extension.
 *
 * `O(n²)` in the number of atoms, which is fine at the scale this
 * operates on (one comment/docstring/string region's atoms, not a
 * whole file) — this is not the place for a segment-tree speedup.
 */
function balancedFill(
  atoms: readonly Atom[],
  availableWidth: number,
  hangingIndent: number,
): string[] {
  const n = atoms.length;
  if (n === 0) {
    return [''];
  }

  const budgetFor = (lineStart: number): number =>
    lineStart === 0 ? availableWidth : availableWidth - hangingIndent;

  const dp: number[] = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
  const choice: number[] = new Array(n).fill(-1);
  dp[n] = 0;

  for (let i = n - 1; i >= 0; i--) {
    const lineBudget = budgetFor(i);
    let width = atoms[i]!.width;

    for (let j = i + 1; j <= n; j++) {
      if (j > i + 1) {
        const atom = atoms[j - 1]!;
        if (atom.breakBefore) {
          break; // this and every larger j would place it mid-line
        }
        width += (atom.glue === 'none' ? 0 : 1) + atom.width;
      }

      const isSingleAtomLine = j === i + 1;
      const fits = width <= lineBudget;
      if (!isSingleAtomLine && !fits) {
        break; // multi-atom overflow is never a valid line; width only grows from here
      }

      const isLastLine = j === n;
      // A line costs 0 if it's the last line (a ragged final line is
      // normal, not penalized) or if it's a single atom that simply
      // can't fit no matter what (the overflow rule: unavoidable, so
      // not penalized either). Otherwise — including a single atom that
      // *does* fit — it's a real packing choice and costs its squared
      // slack, exactly like a multi-atom line. Treating a fitting
      // single atom as automatically free was the bug this comment
      // replaces: it made the DP prefer one-atom-per-line over any
      // merge, every time, regardless of actual raggedness.
      const cost = isLastLine || !fits ? 0 : (lineBudget - width) ** 2;

      const total = cost + dp[j]!;
      // `<=`, not `<`: prefer the *largest* valid `j` among ties (fewer,
      // fuller lines) rather than the first one found. Ties are common
      // — every candidate ending at the final atom costs 0 regardless of
      // its raggedness ("a ragged last line is normal"), so without this
      // the DP would arbitrarily prefer the shortest last line it
      // happened to consider first.
      if (total <= dp[i]!) {
        dp[i] = total;
        choice[i] = j;
      }
    }
  }

  const lines: string[] = [];
  let i = 0;
  let isFirstLine = true;
  while (i < n) {
    const j = choice[i]!;
    const indent = isFirstLine ? '' : ' '.repeat(hangingIndent);
    lines.push(indent + renderAtoms(atoms.slice(i, j)));
    isFirstLine = false;
    i = j;
  }
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
