import type { SyntaxNode } from '../../types/tree-sitter-types.js';

/**
 * Container node types whose first statement can be a docstring:
 * `module` (the whole file), and a `function_definition`/`class_definition`
 * body's `block` node -- decorators (`decorated_definition`) and `async`
 * wrap `function_definition` transparently, so no separate handling is
 * needed for either.
 */
const DEFINITION_TYPES = new Set(['function_definition', 'class_definition']);

/**
 * True if `node` (expected to be a `string` node, per
 * `pythonDescriptor.queries.strings`) is a real Python docstring by
 * position: the sole content of an `expression_statement` that is itself
 * the first statement of a `module`, or of a `function_definition`/
 * `class_definition`'s body block.
 *
 * Deliberately position-only: a docstring is a `string` that is the first
 * statement of a module/function/class body -- not merely any
 * triple-quoted string. A triple-quoted string anywhere else (e.g. as a
 * block-comment substitute mid-function) is an ordinary `stringLiteral`,
 * and is likely to fail the prose heuristic applied to such strings
 * elsewhere in this adapter.
 *
 * A concatenated or `+`-joined multi-part run is *not* eligible here, even
 * if the whole run sits in first-statement position: CPython's own
 * `__doc__` mechanism only recognizes a single bare string literal, not a
 * concatenation, as a docstring. That falls out for free from the check
 * below without any special-casing -- a string that's one part of a
 * `concatenated_string` or `binary_operator` has that construct as its
 * parent, never `expression_statement` directly, so it never satisfies
 * `isSoleExpressionStatementContent`.
 */
export function isDocstringPosition(node: SyntaxNode): boolean {
  const exprStmt = soleExpressionStatementFor(node);
  if (!exprStmt) {
    return false;
  }

  const container = exprStmt.parent;
  if (!container) {
    return false;
  }

  if (container.type === 'module') {
    return firstNonCommentNamedChild(container)?.id === exprStmt.id;
  }

  if (container.type === 'block') {
    const definition = container.parent;
    if (!definition || !DEFINITION_TYPES.has(definition.type)) {
      return false; // e.g. an `if`/`while`/`for` block -- not a docstring host
    }
    return firstNonCommentNamedChild(container)?.id === exprStmt.id;
  }

  return false;
}

/**
 * True if `node` is an *attribute* docstring: a bare string, alone in its
 * own statement, immediately following an assignment statement in the
 * same container (module, class body, or function body) -- the informal
 * convention (recognized by Sphinx and other doc tooling) for documenting
 * a module-level constant, class attribute, or instance variable:
 *
 * ```python
 * RETRIES: int = 3
 * """Number of times to retry a failed request."""
 * ```
 *
 * "Immediately following" skips over any comments in between (a `#`
 * explaining the assignment, directly above its attribute docstring, is a
 * realistic thing to write) but not over another statement -- only a
 * comment is transparent to this check.
 */
export function isAttributeDocstringPosition(node: SyntaxNode): boolean {
  const exprStmt = soleExpressionStatementFor(node);
  if (!exprStmt) {
    return false;
  }

  let sibling = exprStmt.previousNamedSibling;
  while (sibling && sibling.type === 'comment') {
    sibling = sibling.previousNamedSibling;
  }

  if (!sibling || sibling.type !== 'expression_statement') {
    return false;
  }

  // Only a plain or annotated assignment counts -- both parse as the same
  // `assignment` node type in this grammar (`x = 1` and `x: int = 1`
  // alike). An augmented assignment (`z += 1`) is deliberately excluded:
  // it can only exist if `z` was already assigned earlier, so a string
  // immediately after it would be documenting the *update*, not
  // introducing a new attribute -- not the convention this check targets.
  const assigned = sibling.namedChild(0);
  return assigned !== null && assigned.type === 'assignment';
}

/**
 * If `node`'s parent is an `expression_statement` with no other named
 * content (i.e. `node` is the statement's entire expression, not one
 * operand among several), return that `expression_statement`; otherwise
 * `null`.
 *
 * This is what makes both position checks above naturally exclude a
 * string that's part of a concatenation run -- such a string's parent is
 * `concatenated_string` or `binary_operator`, never `expression_statement`
 * -- without either function needing to know those node types exist.
 */
function soleExpressionStatementFor(node: SyntaxNode): SyntaxNode | null {
  const parent = node.parent;
  if (!parent || parent.type !== 'expression_statement' || parent.namedChildCount !== 1) {
    return null;
  }
  return parent;
}

/**
 * The first named child of `container` that isn't a `comment` -- comments
 * are extras that can appear as ordinary children of `module` (though not,
 * per the grammar's own behavior, inside a `block`; see the probe findings
 * referenced from `descriptor.ts`), so "first statement" has to skip past
 * any leading ones to mean what it says.
 */
function firstNonCommentNamedChild(container: SyntaxNode): SyntaxNode | null {
  for (const child of container.namedChildren) {
    if (child.type !== 'comment') {
      return child;
    }
  }
  return null;
}
