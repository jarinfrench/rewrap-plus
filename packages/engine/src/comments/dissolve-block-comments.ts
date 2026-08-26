import type { LanguageDescriptor } from '../types/adapter.js';
import type { LogicalDocument } from '../types/document.js';
import type { WrappableRegion } from '../types/region.js';
import { sliceSpanText } from '../discovery/slice-span.js';
import { splitBlocks, type SplitBlocksOptions } from '../segmentation/split-blocks.js';

/**
 * Dissolve a `'blockComment'` `WrappableRegion` into a `LogicalDocument`,
 * driven entirely by `descriptor.comments.block` — the counterpart to
 * `./dissolve-line-comments.ts` for languages whose comment syntax
 * wraps content in an open/close delimiter pair rather than repeating a
 * marker per line.
 *
 * Nothing here is Python-specific (Python has no block comments to
 * exercise this at all — it's introduced in Phase 6b specifically so
 * the JavaScript canary, C++, and every future C-family adapter don't
 * hit this as their first engine gap). Unlike `dissolveLineComments`,
 * there's no `groupRegions` merging step to worry about: a block
 * comment's delimiters make it naturally one region with a single
 * `span` covering the whole thing, whatever its shape:
 *
 * - **Single physical line** — `/* text * /` all on one line. Both
 *   delimiters are stripped and the remainder, trimmed, becomes the
 *   region's entire content.
 * - **Multi-line** — first line is the open delimiter (optionally
 *   followed by leading content, e.g. `/** Summary`); last line is the
 *   close delimiter (optionally preceded by trailing content); every
 *   line in between has `continuationPrefix` stripped, if the
 *   descriptor declares one (JSDoc/Doxygen/Javadoc's leading `*`) — a
 *   line without the prefix still has its own leading whitespace
 *   stripped, so a malformed or manually-edited continuation line
 *   doesn't leak stray indentation into reflowed content.
 *
 * A first or last line that's *only* its delimiter (the overwhelmingly
 * common shape — an open line with nothing after `/**`, a close line
 * with nothing before `* /`) contributes no content line at all, rather
 * than an empty one, so it doesn't register as a spurious blank-line
 * paragraph break.
 *
 * No directive-line or commented-out-code detection here, unlike
 * `dissolveLineComments` — those are concerns this phase's plan doesn't
 * ask block comments to carry, and Python (the only adapter with
 * directive comments defined) has none to test against anyway. A later
 * phase can add them the same way, per-descriptor, if a real adapter
 * needs it.
 */
export function dissolveBlockComments(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  options: SplitBlocksOptions = {},
): LogicalDocument {
  const text = dissolveBlockCommentText(region, source, descriptor);
  return { blocks: splitBlocks(text, options), meta: { indentColumn: region.indentColumn } };
}

/**
 * Strip a `'blockComment'`/`'docComment'` region's delimiters and
 * continuation-prefix decoration, returning its merged logical text —
 * everything `dissolveBlockComments` above does, short of the final
 * `splitBlocks` call.
 *
 * Split out in Phase 12b for `../comments/wrap-doc-comment.ts`, which
 * needs this exact same delimiter-stripping (a `'docComment'` region uses
 * the identical `comments.block` open/close/continuationPrefix syntax a
 * plain `'blockComment'` does — JSDoc's `/** ... * /` is not a different
 * delimiter shape, just different *content*) but must segment the result
 * through a `DocDialect`'s own `segment` (tag-aware, e.g. `@param`/
 * `@returns` grouping) instead of the generic paragraph-only `splitBlocks`
 * this function calls. A pure extraction — `dissolveBlockComments`'s own
 * behavior for `'blockComment'` regions is unchanged, still exercised by
 * this file's own tests.
 */
export function dissolveBlockCommentText(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
): string {
  const block = descriptor.comments.block;
  if (!block) {
    throw new Error(
      `dissolveBlockCommentText: descriptor '${descriptor.id}' declares no comments.block`,
    );
  }

  const raw = sliceSpanText(source, region.span);
  const physicalLines = raw.split(/\r?\n/);

  return physicalLines.length === 1
    ? dissolveSingleLine(physicalLines[0] ?? '', block)
    : dissolveMultiLine(physicalLines, block);
}

function dissolveSingleLine(
  line: string,
  block: NonNullable<LanguageDescriptor['comments']['block']>,
): string {
  let content = line;
  if (content.startsWith(block.open)) {
    content = content.slice(block.open.length);
  }
  if (content.endsWith(block.close)) {
    content = content.slice(0, content.length - block.close.length);
  }
  return content.trim();
}

function dissolveMultiLine(
  physicalLines: readonly string[],
  block: NonNullable<LanguageDescriptor['comments']['block']>,
): string {
  const contentLines: string[] = [];
  const lastIndex = physicalLines.length - 1;

  physicalLines.forEach((rawLine, index) => {
    const isFirst = index === 0;
    const isLast = index === lastIndex;
    let line = rawLine;

    if (isFirst && line.startsWith(block.open)) {
      line = line.slice(block.open.length);
    }
    if (isLast) {
      const trimmedEnd = line.replace(/\s+$/, '');
      if (trimmedEnd.endsWith(block.close)) {
        line = trimmedEnd.slice(0, trimmedEnd.length - block.close.length);
      }
    }

    if (!isFirst) {
      const leadingWhitespace = /^\s*/.exec(line)?.[0] ?? '';
      const afterIndent = line.slice(leadingWhitespace.length);
      if (block.continuationPrefix && afterIndent.startsWith(block.continuationPrefix)) {
        const rest = afterIndent.slice(block.continuationPrefix.length);
        line = rest.startsWith(' ') ? rest.slice(1) : rest;
      } else {
        line = afterIndent;
      }
    }

    // A first/last line that's nothing but its own delimiter (the
    // common case) contributes no content line — an empty one would
    // register as a spurious blank-line paragraph break.
    if ((isFirst || isLast) && line.trim().length === 0) {
      return;
    }
    contentLines.push(line);
  });

  return contentLines.join('\n');
}
