import type { Parser } from 'web-tree-sitter';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';
import type { SourceSpan } from '../types/span.js';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from './span-from-node.js';

/**
 * The result of parsing one source text: the resulting `Tree`, plus a
 * pre-computed summary of where it went wrong, if it did.
 *
 * This is what "skip region, warn, never block" (decision of record) is
 * built on: a region is skipped only if it *overlaps* one of these spans,
 * so one syntax error elsewhere in the file doesn't disable wrapping for
 * the rest of it.
 */
export interface ParseResult {
  readonly tree: Tree;
  readonly hasErrors: boolean;
  readonly errorSpans: readonly SourceSpan[];
}

/**
 * Parse `source` with `parser` and summarize any errors.
 *
 * `errorSpans` covers every `ERROR` node and every `MISSING` node in the
 * tree, each reported once as the outermost span that covers it — an
 * `ERROR` node's descendants are not walked separately, since they
 * describe the same malformed region at redundant or misleading
 * positions, and every consumer of `errorSpans` (Phase 3 onward) only
 * needs to know *whether a region overlaps damage*, not the shape of the
 * damage itself.
 */
export function parseWithErrors(parser: Parser, source: string): ParseResult {
  const tree = parser.parse(source);
  if (!tree) {
    // `Parser#parse` returns `null` only when no language has been
    // assigned, or a progress callback cancelled the parse. This package
    // always configures a language before handing out a `Parser`
    // (`ParserManager.parserFor`) and never installs a cancelling
    // progress callback, so reaching this is a caller bug, not a parse
    // failure to recover from gracefully.
    throw new Error('parseWithErrors: parser.parse returned null — was a language assigned?');
  }

  const mapper = new PositionMapper(source);
  const errorSpans: SourceSpan[] = [];
  collectErrorSpans(tree.rootNode, mapper, errorSpans);

  return {
    tree,
    hasErrors: tree.rootNode.hasError,
    errorSpans,
  };
}

function collectErrorSpans(node: SyntaxNode, mapper: PositionMapper, out: SourceSpan[]): void {
  if (node.isError || node.isMissing) {
    out.push(spanFromNode(node, mapper));
    return;
  }
  for (const child of node.children) {
    if (child) {
      collectErrorSpans(child, mapper, out);
    }
  }
}
