import type { Atom, Block } from '../types/document.js';
import { decorateFirstLine } from './decorate-block.js';

/**
 * Options controlling `reflowBlock`'s line-breaking strategy.
 */
export interface ReflowOptions {
  /**
   * `'greedy'` (default) — first-fit: fill each line as much as
   * possible before wrapping. Matches Rewrap's behavior and user
   * expectation.
   *
   * `'balanced'` — minimum-raggedness: choose break points that
   * minimize the total squared slack across all lines but the last,
   * the same family of algorithm TeX/Knuth–Plass uses for
   * paragraph justification. Often visibly nicer for short docstrings,
   * where greedy's tendency to cram every line but the last can leave
   * one dramatically shorter final line; balanced spreads the
   * raggedness out instead. Behind `WrapConfig.balancedWrapping`
   * (default off) since it costs more to compute and
   * greedy is the more predictable, more widely-expected default.
   */
  readonly mode?: 'greedy' | 'balanced';

  /**
   * Extra columns the *first* line alone gives up, on top of
   * `availableWidth` — for a caller that's about to prepend marker text
   * to that line after the fact (`../reflow/decorate-block.ts`'s
   * `decorateFirstLine`, for a `listItem`'s bullet or a `fieldEntry`'s
   * label) and needs `reflowBlock` to leave room for it. Defaults to
   * `0`, matching every block type that never gets such a prefix
   * (`paragraph`, `blank`, `verbatim`, `sectionHeader`) — for those,
   * this option simply isn't set by any caller.
   *
   * Deliberately a *separate* knob from `hangingIndent`, not folded into
   * it: `hangingIndent` alone is a general-purpose "indent every line
   * after the first" primitive with its own callers and tests that have
   * nothing to do with marker restoration (see `./reflow-block.test.ts`'s
   * own hanging-indent cases, which pass it for a bare `paragraph` block
   * with no marker involved at all) — conflating the two would make
   * `hangingIndent` on its own reserve first-line space unconditionally,
   * silently breaking every one of those unrelated, legitimate uses. The
   * marker-restoring callers (`../comments/emit-line-comments.ts`,
   * `../comments/emit-block-comments.ts`, `../docs/dialect.ts`'s
   * `reflowDocBlocks`) pass `hangingIndent`'s own value here too, since
   * for `listItem`/`fieldEntry` specifically the two happen to coincide
   * (the marker occupies exactly the same width as the continuation
   * indent) — but that's a property of *those* callers, not something
   * `reflowBlock` should assume generally.
   */
  readonly firstLineReserve?: number;
}

/**
 * Reflow one `Block`'s content to `availableWidth` columns, indenting
 * every line after the first by `hangingIndent` spaces.
 *
 * Only `paragraph`, `listItem`, and `fieldEntry` have atoms to reflow;
 * the other three `Block` variants pass through basically unchanged,
 * matching how `splitBlocks` already treats them ("`verbatim` is the escape
 * hatch that makes 'preserve formatting' tractable"):
 *
 * - `blank` — a single empty line.
 * - `verbatim` — its `lines`, content untouched (reflowing a fenced code
 *   block, a doctest, or an ASCII table would corrupt it; that's the
 *   entire reason `splitBlocks` routed this content to `verbatim` instead
 *   of `paragraph` in the first place), though every line after the
 *   first still gets `hangingIndent` spaces prepended — a no-op for
 *   every top-level caller (`hangingIndent` is always `0` for a
 *   top-level `verbatim` block; see the `case 'verbatim'` branch's own
 *   comment for why this still matters for `fieldEntry`).
 * - `sectionHeader` — its `text` as one line. Headers ("Args:", a NumPy
 *   underline) are structural markers, not prose to fill; reflowing one
 *   would break whatever fixed relationship it has to its section (see
 *   the NumPy dialect's own handling: "underline length re-synced to header
 *   length if the header is untouched").
 *
 * For `paragraph`/`listItem`, this deliberately reflows only the atom
 * stream — it does **not** prepend a list marker or field label. Those
 * belong to the region's own dissolve/emit step (per-language and, for
 * doc dialects, per-dialect — see `DocDialect.emit`), which is the only
 * code that knows the marker's *display* form (bullet character,
 * renumbered ordinal, dialect-specific field syntax like `:param x:`).
 * Keeping that concern out of this function is what keeps it shared and
 * dependency-free: reflow doesn't need to know anything about Markdown
 * bullets or Sphinx field lists to do its job. `fieldEntry` is the one
 * exception, and only for its *nested* blocks (see `reflowFieldEntry`,
 * below): a nested `listItem`'s own bullet has no other caller left to
 * restore it (unlike a top-level block, nothing outside this function
 * ever sees a `fieldEntry`'s inner `blocks`), so `reflowFieldEntry` calls
 * `decorateFirstLine` on each one directly — that's still just replaying
 * a marker already baked into the block's own `marker`/`label` field,
 * the same dialect-agnostic operation every other caller performs, not
 * new dialect knowledge living in this module. The *outer* `fieldEntry`
 * block's own label is left to the caller exactly as before.
 *
 * `hangingIndent` is spent from the *same* `availableWidth` budget that
 * the first line uses in full by default — continuation lines get
 * `availableWidth - hangingIndent` columns for content, plus
 * `hangingIndent` literal leading spaces, for the same total column
 * budget the caller resolved (`columnLimit - indentColumn`, in the
 * pipeline's terms). A block's own `hangingIndent` field (`listItem`,
 * `fieldEntry`) is *not* read directly here — the caller decides what
 * value to pass, since a doc dialect may want alignment that differs
 * from the raw marker width (e.g. aligning under a parameter name rather
 * than under the bullet).
 *
 * The first line's own budget is `availableWidth -
 * options.firstLineReserve` (default reserve `0`, so full
 * `availableWidth` unless a caller opts in) — see `ReflowOptions.firstLineReserve`'s
 * own doc comment for why this is a separate knob from `hangingIndent`
 * rather than folded into it.
 *
 * **Overflow rule**: an atom wider than its
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
  const firstLineReserve = options.firstLineReserve ?? 0;
  switch (block.type) {
    case 'blank':
      return [''];
    case 'verbatim':
      // `hangingIndent` spaces on every line *after* the first, mirroring
      // `greedyFill`/`balancedFill`'s own continuation-line convention —
      // a no-op (`hangingIndent` is always `0`) for every existing
      // top-level caller (`reflowBlockSequence` and
      // `../comments/emit-line-comments.ts`/`emit-block-comments.ts`
      // never pass a non-zero `hangingIndent` for `verbatim`, since
      // there's nothing to align a top-level block's continuation
      // *under*), but load-bearing for `reflowFieldEntry`, below: a
      // multi-line `verbatim` block sitting in `blocks[0]` (a description
      // opening directly with a fenced sample) shares only its *first*
      // line with the entry's label — lines after that are ordinary
      // continuation and need the same re-basing every other multi-line
      // `blocks[0]` shape already gets from `greedyFill`/`balancedFill`
      // reading this same parameter. Without this, `blocks[0]`-as-
      // `verbatim` printed its second-and-later lines flush left,
      // ignoring both the entry's own continuation column and the
      // region's base indent — confirmed directly during development,
      // not hypothetical (see
      // `docs/planning/nested-field-entry-structure-plan.md`, section 5).
      return block.lines.map((line, index) => (index === 0 ? line : ' '.repeat(hangingIndent) + line));
    case 'sectionHeader':
      return [block.text];
    case 'paragraph':
    case 'listItem':
      return options.mode === 'balanced'
        ? balancedFill(block.atoms, availableWidth, hangingIndent, firstLineReserve)
        : greedyFill(block.atoms, availableWidth, hangingIndent, firstLineReserve);
    case 'fieldEntry':
      return reflowFieldEntry(block.blocks, availableWidth, hangingIndent, firstLineReserve, options);
  }
}

/**
 * Reflow a `fieldEntry`'s nested `blocks` (its description, possibly
 * containing a nested list or a fenced sample rather than just flat
 * prose — see `../types/document.ts`'s own doc comment on `fieldEntry`)
 * into the entry's flat line output.
 *
 * `blocks[0]` shares its first physical line with the entry's own label
 * (restored by the caller via `../reflow/decorate-block.ts`'s
 * `decorateFirstLine`, applied to this function's *return value* — not
 * here, since only the caller knows the label's display form), so it's
 * reflowed at the *entry's* `firstLineReserve`/`hangingIndent` — except
 * when `blocks[0]` itself carries its own marker (a `listItem` opening
 * the description directly, no leading prose), in which case *both*
 * reservations apply to that one shared line: the entry's own label
 * *and* `blocks[0]`'s own marker (glued on right after it, by
 * `decorateFirstLine` here — necessary since nothing else ever sees a
 * `fieldEntry`'s inner `blocks` to do it). Reserving only the entry's
 * own width and letting `blocks[0]`'s marker land afterward,
 * unaccounted, silently let a line run past `availableWidth` by exactly
 * the marker's width — confirmed directly against this function during
 * development, not a hypothetical (see
 * `docs/planning/nested-field-entry-structure-plan.md`'s section 5 for
 * the repro this fixes). For the common case — `blocks[0]` is a bare
 * `paragraph`, still the *only* shape `groupFieldEntries` produces
 * before its `splitBlocks` wiring existed — `firstOwnIndent` is `0` and
 * this reduces to exactly the pre-nested-blocks call, so that case
 * stays byte-identical.
 *
 * Any further blocks are unambiguously past that shared first line, so
 * each is reflowed as its own top-level unit (`reflowBlockSequence`, the
 * same "one block, its own hanging indent, its own decoration" pass
 * `../docs/dialect.ts`'s `reflowDocBlocks` uses for a document's own
 * top-level blocks) at the width remaining inside the entry's
 * `hangingIndent`, then that whole result is indented by `hangingIndent`
 * literally, since none of it sits on the label's own line.
 */
function reflowFieldEntry(
  blocks: readonly Block[],
  availableWidth: number,
  hangingIndent: number,
  firstLineReserve: number,
  options: ReflowOptions,
): string[] {
  if (blocks.length === 0) {
    return [''];
  }
  const [first, ...rest] = blocks;
  const firstOwnIndent =
    first!.type === 'listItem' || first!.type === 'fieldEntry' ? first!.hangingIndent : 0;
  const lines = decorateFirstLine(
    first!,
    reflowBlock(first!, availableWidth, hangingIndent + firstOwnIndent, {
      ...options,
      firstLineReserve: firstLineReserve + firstOwnIndent,
    }),
  );
  if (rest.length > 0) {
    const indent = ' '.repeat(hangingIndent);
    for (const nested of rest) {
      // A `blank` block stays a genuinely empty line, matching
      // `reflowBlockSequence`'s own top-level convention (a `blank`
      // block's `hangingIndent` is always computed as `0` there too) —
      // *not* indented like every other block here would be. Handled as
      // its own case rather than folded into the uniform indent below:
      // that indent is applied per *line* of `reflowBlockSequence`'s
      // flattened output, which has already lost track of which lines
      // came from a `blank` block versus real content by the time it
      // returns a plain `string[]`. Confirmed as a real bug, not
      // hypothetical, by `test/wrap/nested-field-entry-idempotency.test.ts`
      // (step 5): a blank line *inside* an entry's continuation — between
      // its opening prose and a doctest/table further down — came out
      // with `hangingIndent` columns of trailing whitespace, where the
      // source had none.
      if (nested.type === 'blank') {
        lines.push('');
        continue;
      }
      for (const line of reflowBlockSequence([nested], availableWidth - hangingIndent, options)) {
        lines.push(indent + line);
      }
    }
  }
  return lines;
}

/**
 * Reflow a flat sequence of blocks to plain content lines, restoring each
 * block's own marker/label (`decorateFirstLine`) as it goes — one block,
 * its own hanging indent, its own decoration, repeated. Shared by
 * `../docs/dialect.ts`'s `reflowDocBlocks` (a `LogicalDocument`'s
 * top-level block sequence) and `reflowFieldEntry` above (a field
 * entry's nested description blocks *after* the one sharing the label's
 * own line) — both are exactly this operation and differ only in what
 * `availableWidth` that sequence sits at, which the caller already
 * accounts for. Living here rather than in `dialect.ts` keeps the
 * dependency direction one-way: this module (generic, `Block`-level
 * reflow) has no reason to import anything from `../docs/`, but a
 * `fieldEntry`'s own reflow case, right above, needs precisely this
 * logic for its nested blocks — so it's defined once, here, and
 * `dialect.ts` calls into it rather than the reverse.
 */
export function reflowBlockSequence(
  blocks: readonly Block[],
  availableWidth: number,
  options: ReflowOptions = {},
): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    const hangingIndent =
      block.type === 'listItem' || block.type === 'fieldEntry' ? block.hangingIndent : 0;
    const reflowed = reflowBlock(block, availableWidth, hangingIndent, {
      ...options,
      firstLineReserve: hangingIndent,
    });
    lines.push(...decorateFirstLine(block, reflowed));
  }
  return lines;
}

/**
 * Group an atom stream into clusters: a cluster is one atom plus every
 * atom immediately after it tagged `glue: 'none'` — i.e. a maximal run
 * joined with no space in between. Both fill algorithms below break
 * lines only *between* clusters, never inside one, so a `glue: 'none'`
 * atom can never be stranded alone at the start of a continuation line.
 *
 * A `glue: 'none'` atom exists specifically to record "no whitespace
 * separated this from what came before it" (`../segmentation/atomize-words.ts`'s
 * own doc comment: a placeholder or inline-code span glued directly to
 * trailing punctuation, e.g. `` `code`. ``). Line-breaking atom-by-atom
 * treated that glue purely as a same-line rendering hint — it decided
 * whether to print a space, not whether a break could fall there — so
 * the greedy/balanced fitters could still split a cluster across two
 * lines the moment it didn't quite fit, leaving the glued half (often a
 * single trailing character) orphaned alone on its own continuation
 * line. Clustering first makes "never break inside a glued run" a
 * structural property of the atom stream both fitters walk, rather than
 * a case either one has to remember to check.
 */
function groupIntoClusters(atoms: readonly Atom[]): Atom[][] {
  const clusters: Atom[][] = [];
  for (const atom of atoms) {
    if (atom.glue === 'none' && clusters.length > 0) {
      clusters[clusters.length - 1]!.push(atom);
    } else {
      clusters.push([atom]);
    }
  }
  return clusters;
}

/** Sum of a cluster's atom widths — internal joins are all `glue: 'none'`, so no gap columns. */
function clusterWidth(cluster: readonly Atom[]): number {
  return cluster.reduce((sum, atom) => sum + atom.width, 0);
}

/**
 * Columns a join contributes to a line's width: 0 for `'none'` (glued),
 * 2 for `'double'` (a preserved double space after a sentence — see
 * `../segmentation/atomize-words.ts`), 1 otherwise (the ordinary case).
 */
function glueWidth(glue: Atom['glue']): number {
  if (glue === 'none') {
    return 0;
  }
  return glue === 'double' ? 2 : 1;
}

/**
 * Greedy first-fit line breaking (matches the stated goal: "match
 * Rewrap's behavior and user expectation"). Walks the atom stream, grouped
 * into clusters (see `groupIntoClusters`) so a glued run is never split,
 * adding each cluster to the current line if it fits and starting a new
 * line otherwise; never looks ahead or reconsiders a placed cluster
 * (that's what distinguishes this from `balancedFill`, below).
 */
function greedyFill(
  atoms: readonly Atom[],
  availableWidth: number,
  hangingIndent: number,
  firstLineReserve: number,
): string[] {
  if (atoms.length === 0) {
    return [''];
  }
  const clusters = groupIntoClusters(atoms);

  const lines: string[] = [];
  let current: Atom[] = [];
  let currentWidth = 0;
  let isFirstLine = true;

  const budget = (): number =>
    isFirstLine ? availableWidth - firstLineReserve : availableWidth - hangingIndent;

  const flush = (): void => {
    const indent = isFirstLine ? '' : ' '.repeat(hangingIndent);
    lines.push(indent + renderAtoms(current));
    current = [];
    currentWidth = 0;
    isFirstLine = false;
  };

  for (const cluster of clusters) {
    const width = clusterWidth(cluster);

    if (current.length === 0) {
      // A line always takes at least one cluster, however wide — the
      // overflow rule. `breakBefore` is moot here: there's nothing on
      // this line yet to break away from.
      current.push(...cluster);
      currentWidth = width;
      continue;
    }

    if (cluster[0]!.breakBefore) {
      flush();
      current.push(...cluster);
      currentWidth = width;
      continue;
    }

    const projected = currentWidth + glueWidth(cluster[0]!.glue) + width;
    if (projected <= budget()) {
      current.push(...cluster);
      currentWidth = projected;
    } else {
      flush();
      current.push(...cluster);
      currentWidth = width;
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
 * one starting at atom index `0`) is special-cased to the
 * `availableWidth - firstLineReserve` budget — *every* other line,
 * wherever it starts, is a continuation line at `availableWidth -
 * hangingIndent`, since only the block's very first line is ever not a
 * continuation. That collapses what would otherwise be a
 * line-*number*-dependent budget into a line-*start-index*-dependent
 * one, which is all the DP needs.
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
 * `O(n²)` in the number of clusters, which is fine at the scale this
 * operates on (one comment/docstring/string region's atoms, not a
 * whole file) — this is not the place for a segment-tree speedup.
 *
 * Operates over clusters (`groupIntoClusters`), not raw atoms, for the
 * same reason `greedyFill` does — a `glue: 'none'` run must never be
 * split across a line break, so `j` (a candidate line's exclusive end)
 * only ever lands on a cluster boundary.
 */
function balancedFill(
  atoms: readonly Atom[],
  availableWidth: number,
  hangingIndent: number,
  firstLineReserve: number,
): string[] {
  if (atoms.length === 0) {
    return [''];
  }
  const clusters = groupIntoClusters(atoms);
  const n = clusters.length;

  const budgetFor = (lineStart: number): number =>
    lineStart === 0 ? availableWidth - firstLineReserve : availableWidth - hangingIndent;

  const dp: number[] = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
  const choice: number[] = new Array(n).fill(-1);
  dp[n] = 0;

  for (let i = n - 1; i >= 0; i--) {
    const lineBudget = budgetFor(i);
    let width = clusterWidth(clusters[i]!);

    for (let j = i + 1; j <= n; j++) {
      if (j > i + 1) {
        const cluster = clusters[j - 1]!;
        if (cluster[0]!.breakBefore) {
          break; // this and every larger j would place it mid-line
        }
        width += glueWidth(cluster[0]!.glue) + clusterWidth(cluster);
      }

      const isSingleClusterLine = j === i + 1;
      const fits = width <= lineBudget;
      if (!isSingleClusterLine && !fits) {
        break; // multi-cluster overflow is never a valid line; width only grows from here
      }

      const isLastLine = j === n;
      // A line costs 0 if it's the last line (a ragged final line is
      // normal, not penalized) or if it's a single cluster that simply
      // can't fit no matter what (the overflow rule: unavoidable, so
      // not penalized either). Otherwise — including a single cluster
      // that *does* fit — it's a real packing choice and costs its
      // squared slack, exactly like a multi-cluster line. Treating a
      // fitting single cluster as automatically free was the bug this
      // comment replaces: it made the DP prefer one-cluster-per-line
      // over any merge, every time, regardless of actual raggedness.
      const cost = isLastLine || !fits ? 0 : (lineBudget - width) ** 2;

      const total = cost + dp[j]!;
      // `<=`, not `<`: prefer the *largest* valid `j` among ties (fewer,
      // fuller lines) rather than the first one found. Ties are common
      // — every candidate ending at the final cluster costs 0 regardless
      // of its raggedness ("a ragged last line is normal"), so without
      // this the DP would arbitrarily prefer the shortest last line it
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
    lines.push(indent + renderAtoms(clusters.slice(i, j).flat()));
    isFirstLine = false;
    i = j;
  }
  return lines;
}

/**
 * Join a line's atoms back into text, respecting `glue`: `'none'` means
 * flush against the previous atom (no space), `'double'` means two
 * spaces (a preserved sentence-spacing gap — see `glueWidth` above),
 * anything else — including the ordinary `undefined` case — means one
 * space.
 */
function renderAtoms(atoms: readonly Atom[]): string {
  let out = '';
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]!;
    if (i > 0) {
      out += ' '.repeat(glueWidth(atom.glue));
    }
    out += atom.text;
  }
  return out;
}
