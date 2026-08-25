import type { DocDialectId } from '../types/doc-dialect.js';
import type { Block } from '../types/document.js';
import { decorateFirstLine } from '../reflow/decorate-block.js';
import { reflowBlock, type ReflowOptions } from '../reflow/reflow-block.js';
import { splitBlocks, type SplitBlocksOptions } from '../segmentation/split-blocks.js';

/**
 * Context `DocDialect.emit` needs to reflow its own blocks — the doc-layer
 * counterpart to the `columnLimit`/`indentColumn` pair every comment emit
 * function threads through today, pre-resolved to a single available-width
 * number here since a dialect never needs to know *why* that number is
 * what it is (region indent, quote overhead, ...) — only Python's own
 * `../languages/python/emit-docstring.ts` does, and it's the one that
 * computes this before calling in.
 */
export interface DocEmitContext {
  readonly availableWidth: number;
  readonly reflowOptions: ReflowOptions;
}

/**
 * A pluggable documentation-comment dialect (Phase 8: "add dialect
 * registry decoupled from language adapters"). Dialects are a
 * cross-cutting concern, not an adapter internal — Google/NumPy/Sphinx
 * conventions are Python-specific today, but the same idea (JSDoc,
 * Doxygen) applies to other languages later (Phase 12b/12c). A
 * `LanguageDescriptor` only *lists* which dialect ids it supports via
 * `comments.doc.dialects`; it never owns detection or reflow logic
 * itself — that's entirely what this module and its per-dialect
 * implementations (`./plain.ts`, `./google.ts`, `./numpy.ts`,
 * `./sphinx.ts`) are for.
 */
export interface DocDialect {
  readonly id: DocDialectId;

  /**
   * Confidence, `0..1`, that `text` (already quote/indent-stripped
   * dissolved content — see `../languages/python/dissolve-docstring.ts`)
   * is written in this dialect. Detection happens per docstring, not per
   * file (a codebase mixing Google and NumPy style in different modules
   * is common, and a file-level guess would be wrong somewhere) — see
   * `DialectRegistry.detectBest`, which calls this once per candidate
   * dialect for a single docstring's text.
   */
  detect(text: string): number;

  /**
   * Turn dissolved docstring text into blocks, this dialect's own way —
   * e.g. Google's `Args:`/`Returns:` section headers and hanging-indent
   * entries, versus `./plain.ts`'s bare `splitBlocks` pass-through. Every
   * dialect's `segment` is expected to already bake its own display
   * form into `fieldEntry.label`/`sectionHeader.text` (e.g. `':param x:'`
   * for Sphinx, `'x (int):'` for Google) — `emit` (below) never needs to
   * know which dialect produced the blocks it's reflowing.
   */
  segment(text: string, options: SplitBlocksOptions): Block[];

  /**
   * Reflow `blocks` to plain content lines, one array entry per physical
   * output line — every dialect shares the same implementation,
   * `reflowDocBlocks` below, since by the time `emit` runs, all the
   * dialect-specific information already lives in the blocks themselves
   * (`fieldEntry.label`, `sectionHeader.text`). Kept as a real interface
   * member (rather than calling `reflowDocBlocks` directly) so a future
   * dialect that genuinely needs different emit behavior — e.g. one
   * whose entries wrap under a different alignment rule — can override
   * it without changing this interface.
   */
  emit(blocks: readonly Block[], ctx: DocEmitContext): string[];
}

/**
 * The shared `DocDialect.emit` implementation every dialect in this
 * package reuses as-is: reflow each block (`reflowBlock`, Phase 5) at
 * its own `hangingIndent`, restoring whatever marker/label
 * `reflowBlock` itself deliberately leaves out (`decorateFirstLine`,
 * `../reflow/decorate-block.ts`).
 */
export function reflowDocBlocks(blocks: readonly Block[], ctx: DocEmitContext): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    const hangingIndent =
      block.type === 'listItem' || block.type === 'fieldEntry' ? block.hangingIndent : 0;
    // `firstLineReserve` matches `hangingIndent` here: `decorateFirstLine`
    // is about to prepend exactly `hangingIndent` columns of marker/label
    // text to line 1 (`../reflow/decorate-block.ts`'s `markerPrefix`
    // always returns a string exactly `hangingIndent` columns wide), so
    // `reflowBlock` needs to reserve that same width — see
    // `ReflowOptions.firstLineReserve`'s own doc comment for why this
    // isn't just `hangingIndent` reused directly.
    const reflowed = reflowBlock(block, ctx.availableWidth, hangingIndent, {
      ...ctx.reflowOptions,
      firstLineReserve: hangingIndent,
    });
    lines.push(...decorateFirstLine(block, reflowed));
  }
  return lines;
}

/**
 * Run `splitBlocks` over a *line array* that a dialect's `segment` has
 * already carved out as one contiguous sub-region of dissolved text (a
 * prose preamble before a section/field list, a prose section's body,
 * ...), preserving a genuine trailing blank line that would otherwise be
 * lost.
 *
 * The hazard: `splitBlocks` (via `../segmentation/to-lines.ts`) treats a
 * string's own trailing `\n` as ending its last line, not as introducing
 * an empty one after it — the standard, correct convention for a whole
 * region's text (matching git diff/editors/`wc -l`), but indistinguishable
 * from "this line array's last element genuinely was a blank line" once
 * `lines.join('\n')` collapses it back to a plain string. A dialect that
 * slices `lines` at a section/field-list boundary (e.g. Sphinx separating
 * prose from its `:param:` block, `./sphinx.ts`) commonly ends that slice
 * on exactly such a deliberate blank separator line — the ordinary
 * "blank line between the description and the field list" convention —
 * so silently losing it here would be a real, unexceptional-input bug,
 * not an edge case. Working from the *line array* (unambiguous — a
 * genuine trailing blank is simply `lines[lines.length - 1] === ''`)
 * rather than the string `splitBlocks` itself receives is what makes the
 * two cases distinguishable at all.
 */
export function segmentLines(lines: readonly string[], options: SplitBlocksOptions): Block[] {
  const trailingBlank = lines.length > 0 && lines[lines.length - 1]!.trim() === '';
  const content = trailingBlank ? lines.slice(0, -1) : lines;
  const blocks = splitBlocks(content.join('\n'), options);
  if (trailingBlank) {
    blocks.push({ type: 'blank' });
  }
  return blocks;
}

/**
 * Registry mapping `DocDialectId`s to their `DocDialect` implementation,
 * plus confidence-based selection among a language descriptor's declared
 * candidates (`comments.doc.dialects`).
 */
export class DialectRegistry {
  private readonly byId = new Map<DocDialectId, DocDialect>();

  register(dialect: DocDialect): void {
    this.byId.set(dialect.id, dialect);
  }

  resolve(id: DocDialectId): DocDialect | undefined {
    return this.byId.get(id);
  }

  /**
   * Pick the best-fitting dialect among `candidates` for `text`, by
   * highest `detect` confidence — the mechanism behind
   * `WrapConfig.docDialect: 'auto'`. Ties (including "every candidate
   * scored 0") favor whichever candidate sorts first in `candidates`'
   * own order, so a descriptor listing `'plain'` last, as every shipped
   * descriptor does, means an unrecognizable/ambiguous docstring falls
   * back to `'plain'` — "ambiguous → plain," per the plan.
   *
   * Throws if a named candidate isn't registered, or if `candidates` is
   * empty — both are configuration errors (a descriptor listing a
   * dialect id nothing ever registered, or listing none at all), not
   * data conditions this should quietly paper over.
   */
  detectBest(text: string, candidates: readonly DocDialectId[]): DocDialectId {
    if (candidates.length === 0) {
      throw new Error('DialectRegistry.detectBest: candidates must be non-empty');
    }

    let best: DocDialectId | null = null;
    let bestScore = -Infinity;
    for (const id of candidates) {
      const dialect = this.byId.get(id);
      if (!dialect) {
        throw new Error(`DialectRegistry.detectBest: no dialect registered for '${id}'`);
      }
      const score = dialect.detect(text);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best!;
  }
}
