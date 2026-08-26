import type { LanguageDescriptor } from '../types/adapter.js';
import type { Block, LogicalDocument } from '../types/document.js';
import type { WrappableRegion } from '../types/region.js';
import { sliceSpanText } from '../discovery/slice-span.js';
import { splitBlocks, type SplitBlocksOptions } from '../segmentation/split-blocks.js';
import { looksLikeCommentedOutCode } from './looks-like-code.js';

/**
 * The result of dissolving a `'lineComment'` `WrappableRegion`: the
 * shared `LogicalDocument` model that `reflowBlock` and this module's
 * `emitLineComments` counterpart operate on, plus one piece of
 * line-comment-specific state that doesn't belong on the shared
 * `DocMeta` — see `spaceAfterMarker`'s own doc comment.
 *
 * Fully generic, driven entirely by a `LanguageDescriptor` — nothing
 * here is Python-specific, despite Python being the first (and, for a
 * while, only) adapter that exercises it. Originally implemented under
 * `languages/python/` and promoted here once the canary JavaScript
 * adapter confirmed nothing about this module's own logic actually
 * depended on Python (the one thing that did — commented-out-code
 * detection's leading-keyword list — was split out to
 * `LanguageDescriptor.comments.codeLikeKeywords`; see
 * `./looks-like-code.ts`).
 */
export interface DissolvedLineComments {
  readonly document: LogicalDocument;

  /**
   * Whether this region's reflowable comment lines, as observed in
   * source, put a space after `#` (`# comment`) or not (`#comment`).
   * Preserves the original spacing convention as observed — rather
   * than always normalizing to `descriptor.comments.line.spaceAfter`'s
   * default, emit reproduces whatever convention the block itself used.
   *
   * Observed from the first non-empty *reflowable* line (directive lines
   * keep their exact original text regardless, so they don't inform
   * this, and a blank `#` line has no marker-to-content spacing to
   * observe). Falls back to the descriptor's own default spacing when no
   * reflowable line has any content to observe it from — e.g. a region
   * that's nothing but blank `#` separator lines.
   */
  readonly spaceAfterMarker: boolean;
}

interface ReflowableLine {
  readonly verbatim: false;
  readonly content: string;
  readonly hadSpace: boolean;
}

interface VerbatimLine {
  readonly verbatim: true;
  readonly raw: string;
}

type ClassifiedLine = ReflowableLine | VerbatimLine;

/**
 * Split one comment line's raw source text (e.g. `'# hello'`, `'#hello'`,
 * or a bare `'#'`) into its marker and content, recording whether a
 * space separated them — the per-line half of what `spaceAfterMarker`
 * (region-level) is derived from.
 */
function stripMarker(raw: string, marker: string): { content: string; hadSpace: boolean } {
  const rest = raw.startsWith(marker) ? raw.slice(marker.length) : raw;
  const hadSpace = rest.startsWith(' ');
  return { content: hadSpace ? rest.slice(1) : rest, hadSpace };
}

/**
 * Classify every physical line of `region` (one entry in `region.parts`
 * per source line, per the grouping commit's contract — see
 * `../languages/python/adapter.ts`'s `groupRegions`) as either a
 * directive line to carry through verbatim, or reflowable content with
 * its marker stripped.
 *
 * Directive detection tests `descriptor.comments.neverReflow` against
 * each line's *raw* text (Python's own patterns are shebangs, coding
 * declarations, `# type:`, `# noqa`, `# pylint:`, `# fmt:` — see
 * `pythonDescriptor` for the concrete list): "moving one of these to a
 * different line can change program behavior," so they're
 * never candidates for reflow regardless of how the rest of the block is
 * classified.
 */
function classifyLines(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
): ClassifiedLine[] {
  const marker = descriptor.comments.line?.marker ?? '#';
  const neverReflow = descriptor.comments.neverReflow;

  return region.parts.map((part): ClassifiedLine => {
    const raw = sliceSpanText(source, part);
    if (neverReflow.some((pattern) => pattern.test(raw))) {
      return { verbatim: true, raw };
    }
    const { content, hadSpace } = stripMarker(raw, marker);
    return { verbatim: false, content, hadSpace };
  });
}

/**
 * Dissolve a `'lineComment'` `WrappableRegion` into a `LogicalDocument`.
 *
 * Walks the region's classified lines (`classifyLines`) and, in order:
 *
 * - buffers up consecutive reflowable lines and, on flush, either routes
 *   the whole run to a single `verbatim` block (`looksLikeCommentedOutCode`
 *   says it reads as commented-out code — "bias toward verbatim when
 *   uncertain," the same principle applied to indented/fenced/table
 *   content) or runs it through `splitBlocks` to get real
 *   paragraph/list/blank structure. A blank `#` line's content is `''`,
 *   which `splitBlocks` naturally turns into a `blank` block and a
 *   paragraph break — no special-casing needed for the common
 *   "blank comment line separates two paragraphs" pattern;
 * - buffers up consecutive directive lines and, on flush, emits them as
 *   one multi-line `verbatim` block carrying their exact raw text.
 *
 * `region.indentColumn` becomes the document's `DocMeta.indentColumn`
 * directly — grouping guarantees every part of a `'lineComment'`
 * region shares one indent column (see `./adapter.ts`), so there's only
 * one value to carry.
 */
export function dissolveLineComments(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  options: SplitBlocksOptions = {},
): DissolvedLineComments {
  const lines = classifyLines(region, source, descriptor);

  const blocks: Block[] = [];
  let reflowableBuffer: ReflowableLine[] = [];
  let verbatimBuffer: string[] = [];

  const flushReflowable = (): void => {
    if (reflowableBuffer.length === 0) {
      return;
    }
    const contents = reflowableBuffer.map((line) => line.content);
    if (looksLikeCommentedOutCode(contents, descriptor.comments.codeLikeKeywords)) {
      // Preserve the block exactly as it read in source, marker/spacing
      // and all — reflowing commented-out code risks producing text
      // that no longer round-trips to valid source if uncommented.
      blocks.push({
        type: 'verbatim',
        lines: reflowableBuffer.map((line) => sourceLineFor(line, descriptor)),
      });
    } else {
      blocks.push(...splitBlocks(contents.join('\n'), options));
    }
    reflowableBuffer = [];
  };

  const flushVerbatim = (): void => {
    if (verbatimBuffer.length === 0) {
      return;
    }
    blocks.push({ type: 'verbatim', lines: verbatimBuffer });
    verbatimBuffer = [];
  };

  for (const line of lines) {
    if (line.verbatim) {
      flushReflowable();
      verbatimBuffer.push(line.raw);
    } else {
      flushVerbatim();
      reflowableBuffer.push(line);
    }
  }
  flushReflowable();
  flushVerbatim();

  return {
    document: { blocks, meta: { indentColumn: region.indentColumn } },
    spaceAfterMarker: observedSpaceAfterMarker(lines, descriptor),
  };
}

/**
 * Reconstruct a reflowable line's original raw source text (marker plus
 * whatever spacing/content it had) — used only when a whole reflowable
 * run turns out to be commented-out code and needs to be emitted
 * byte-for-byte rather than through the marker-plus-content
 * reconstruction `emitLineComments` normally does for reflowed content.
 */
function sourceLineFor(line: ReflowableLine, descriptor: LanguageDescriptor): string {
  const marker = descriptor.comments.line?.marker ?? '#';
  if (line.content.length === 0) {
    return marker;
  }
  return line.hadSpace ? `${marker} ${line.content}` : `${marker}${line.content}`;
}

/**
 * See `DissolvedLineComments.spaceAfterMarker`'s doc comment for the
 * policy this implements.
 */
function observedSpaceAfterMarker(
  lines: readonly ClassifiedLine[],
  descriptor: LanguageDescriptor,
): boolean {
  const observed = lines.find(
    (line): line is ReflowableLine => !line.verbatim && line.content.length > 0,
  );
  return observed ? observed.hadSpace : (descriptor.comments.line?.spaceAfter ?? true);
}
