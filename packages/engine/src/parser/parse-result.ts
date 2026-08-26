import type { Parser } from 'web-tree-sitter';
import type { SyntaxNode, Tree } from '../types/tree-sitter-types.js';
import type { SourceSpan } from '../types/span.js';
import { PositionMapper } from '../types/position-mapper.js';
import { spanFromNode } from './span-from-node.js';

/**
 * The result of parsing one source text: the resulting `Tree`, plus a
 * pre-computed summary of where it went wrong, if it did.
 *
 * This is what this project's "skip region, warn, never block" posture is
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
 * positions, and every consumer of `errorSpans` only needs to know
 * *whether a region overlaps damage*, not the shape of the damage
 * itself.
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

/**
 * Iterative (explicit-stack) tree walk — not the recursive one-node-per-
 * call-frame version this started as. A deeply left-associative
 * expression (e.g. several thousand `+`-chained operands, real Python
 * that `tree-sitter-python` happily parses) produces a syntax tree whose
 * depth scales with operand count, and a recursive walk blew the actual
 * JS call stack on exactly that input (`RangeError: Maximum call stack
 * size exceeded`, caught by dedicated pathological-input hardening
 * before it shipped as a real bug) — well before this package's own
 * `WrapConfig`/region-discovery logic ever saw the file. This project's
 * "skip region, warn, never block" posture presumes `parseWithErrors`
 * itself can't crash the whole invocation; a stack overflow here breaks
 * that promise for *any* file with one sufficiently long chained
 * expression, not just the string-concatenation case that motivated the
 * fix.
 */
function collectErrorSpans(root: SyntaxNode, mapper: PositionMapper, out: SourceSpan[]): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.isError || node.isMissing) {
      out.push(spanFromNode(node, mapper));
      continue;
    }
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) {
        stack.push(child);
      }
    }
  }
}
