import type { LanguageDescriptor } from '../types/adapter.js';
import type { LogicalDocument } from '../types/document.js';
import { reflowBlock, type ReflowOptions } from '../reflow/reflow-block.js';

/**
 * Re-apply a language's block-comment delimiters (and, for multi-line
 * output, its continuation-line convention) to a dissolved-and-reflowed
 * `LogicalDocument`, producing the region's replacement source text.
 * The block-comment counterpart to `./emit-line-comments.ts`.
 *
 * ## Single-line vs. multi-line
 *
 * If reflow produces at most one output line *and* the resulting
 * `open text close` fits within `columnLimit` at the region's own
 * indent, it's emitted as a single physical line (`/** text * /`) —
 * matching how a short block comment is conventionally written, and
 * avoiding turning every short comment into a needlessly tall
 * three-line block. Anything longer expands to the multi-line form.
 *
 * ## Multi-line layout
 *
 * ```
 * /**
 *  * content, continuation-prefixed and reflowed
 *  * /
 * ```
 *
 * (JSDoc/Doxygen/Javadoc shape — `descriptor.comments.block.open` is
 * `'/**'`, `continuationPrefix` is `'*'`.) The open delimiter always
 * sits alone on the first line; the close delimiter always sits alone
 * on the last, aligned with the continuation column rather than the
 * region's own indent — matching the conventional look where the `*`s
 * line up vertically, closing delimiter included. A language with no
 * `continuationPrefix` (plain `/* * /` multi-line, no per-line marker)
 * gets the same shape minus the marker: continuation lines are just
 * reflowed content at the continuation column.
 *
 * ## Column budget
 *
 * `alignContinuation`: `'open'` (or unset — the common convention)
 * aligns continuation lines and the close delimiter one column past the
 * region's own indent, matching a `/**` comment's `*`s lining up one
 * column right of the leading `/`; `'indent'` aligns flush with the
 * region's own indent instead. Continuation lines additionally pay for
 * `continuationPrefix.length + 1` (the prefix plus its separating
 * space) before content starts, mirroring `emitLineComments`'s
 * `markerOverhead`.
 */
export function emitBlockComments(
  document: LogicalDocument,
  columnLimit: number,
  descriptor: LanguageDescriptor,
  options: ReflowOptions = {},
): string {
  const block = descriptor.comments.block;
  if (!block) {
    throw new Error(`emitBlockComments: descriptor '${descriptor.id}' declares no comments.block`);
  }

  const indentColumn = document.meta.indentColumn;
  const continuationColumn = block.alignContinuation === 'indent' ? indentColumn : indentColumn + 1;
  const prefixOverhead = block.continuationPrefix ? block.continuationPrefix.length + 1 : 0;
  // Never let a deeply-indented, long-markered region compute a
  // negative or zero budget — `reflowBlock`'s own overflow rule already
  // handles "this atom doesn't fit" gracefully, but it still needs a
  // positive width to reason about.
  const availableWidth = Math.max(1, columnLimit - continuationColumn - prefixOverhead);

  const contentLines: string[] = [];
  for (const docBlock of document.blocks) {
    const hangingIndent =
      docBlock.type === 'listItem' || docBlock.type === 'fieldEntry' ? docBlock.hangingIndent : 0;
    contentLines.push(...reflowBlock(docBlock, availableWidth, hangingIndent, options));
  }

  const singleLine = tryEmitSingleLine(contentLines, block, indentColumn, columnLimit);
  if (singleLine !== null) {
    return singleLine;
  }

  return emitMultiLine(contentLines, block, continuationColumn);
}

function tryEmitSingleLine(
  contentLines: readonly string[],
  block: NonNullable<LanguageDescriptor['comments']['block']>,
  indentColumn: number,
  columnLimit: number,
): string | null {
  if (contentLines.length > 1) {
    return null;
  }
  const only = contentLines[0] ?? '';
  const candidate = only.length === 0 ? `${block.open}${block.close}` : `${block.open} ${only} ${block.close}`;
  return indentColumn + candidate.length <= columnLimit ? candidate : null;
}

function emitMultiLine(
  contentLines: readonly string[],
  block: NonNullable<LanguageDescriptor['comments']['block']>,
  continuationColumn: number,
): string {
  const continuationIndent = ' '.repeat(continuationColumn);
  const lines: string[] = [block.open];

  for (const content of contentLines) {
    lines.push(continuationLine(content, block.continuationPrefix, continuationIndent));
  }
  lines.push(`${continuationIndent}${block.close}`);

  return lines.join('\n');
}

function continuationLine(
  content: string,
  continuationPrefix: string | undefined,
  continuationIndent: string,
): string {
  if (!continuationPrefix) {
    return content.length === 0 ? '' : `${continuationIndent}${content}`;
  }
  return content.length === 0
    ? `${continuationIndent}${continuationPrefix}`
    : `${continuationIndent}${continuationPrefix} ${content}`;
}
