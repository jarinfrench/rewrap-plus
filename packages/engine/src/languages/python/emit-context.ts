import type { EmitContext } from '../../types/adapter.js';
import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import type { SyntaxNode, Tree } from '../../types/tree-sitter-types.js';
import { nodeAtSpan } from '../../parser/node-at-span.js';
import type { ConcatenationStyle } from '../../strings/emit-string.js';
import { pythonDescriptor } from './descriptor.js';

/**
 * Python's emit-time context for a `'stringLiteral'` region: whether
 * splitting it across multiple physical lines needs its own inserted
 * parentheses, and which concatenation syntax to emit with.
 */
export interface StringEmitContext extends EmitContext {
  readonly needsParens: boolean;
  readonly concatenationStyle: ConcatenationStyle;
  /**
   * Whether this region is a dictionary literal's key, e.g. the `"k"` in
   * `{"k": "v"}` — one of the named "context signals" for string-wrap
   * eligibility ("string is a dict key → skip"), alongside the shared
   * text-only `looksLikeProse` heuristic (`../../prose-heuristic.ts`).
   * A dict key is virtually never prose regardless of its own shape, and
   * unlike the *sole-argument-to-a-known-call* context signal also named
   * (`re.compile`/`open`/`Path`/`subprocess.*`/a logging format slot),
   * this one is answerable exactly from the tree already available here,
   * via the `pair` node's own `key` field — no heuristic text-matching
   * needed. The sole-argument signal is *not* implemented here: it would
   * need matching against an open-ended set of call names textually or
   * resolving imports to know `re.compile` really means the `re` module,
   * which is real additional work that isn't strictly required given the
   * shared prose heuristic already rejects the motivating example for it
   * (`logging.info("%s failed", x)` — its placeholder-density signal
   * alone scores that text below the eligibility threshold). Documented
   * here, rather than silently dropped, as a deliberate scope limit.
   */
  readonly isDictKey: boolean;
}

/**
 * Node types whose own grammar rule is *always* delimited by a real
 * `(`/`[`/`{` pair already present in the source — probed directly against
 * the vendored grammar (see this module's own commit message for the full
 * probe transcript, following `docs/parsing.md`'s "don't trust memory
 * here" discipline): call arguments, parameter defaults, every literal
 * collection and comprehension form, an explicit parenthesized expression,
 * and a subscript's own brackets. A concatenation run already sitting
 * inside one of these can be split across new lines with no parens of its
 * own — Python's implicit line-joining rule only requires *some* enclosing
 * bracket, not one belonging to the string itself.
 *
 * Deliberately excludes constructs that are only *sometimes* bracketed
 * (`named_expression`/walrus, which may or may not sit inside an explicit
 * `parenthesized_expression` depending on where it's used) — those are
 * handled correctly anyway by continuing the ancestor walk past them: if
 * a real enclosing bracket exists further up, it's still found; if not,
 * `needsParens` correctly comes back `true`.
 */
const GROUPING_ANCESTOR_TYPES: ReadonlySet<string> = new Set([
  'parenthesized_expression',
  'tuple',
  'list',
  'set',
  'dictionary',
  'argument_list',
  'parameters',
  'subscript',
  'list_comprehension',
  'set_comprehension',
  'dictionary_comprehension',
  'generator_expression',
]);

/**
 * Walk every ancestor of `node`, all the way to the tree's root, looking
 * for one of `GROUPING_ANCESTOR_TYPES`.
 *
 * Walking past a statement/block/`module` boundary rather than stopping
 * there is deliberate, not an oversight: a compound statement (`def`,
 * `class`, `if`, `for`, ...) can never itself appear as an expression
 * inside a bracketed construct — `foo(def f(): ...)` isn't valid Python —
 * so once the walk reaches `block`/`function_definition`/`class_definition`/
 * `module` (none of which are grouping types), there is no way for
 * anything *further* up to retroactively supply brackets that apply to
 * the statement being walked from. Continuing the walk anyway is
 * harmless: it can only ever encounter more non-grouping ancestors before
 * reaching the root, never a false-positive match. Stopping early would
 * save a handful of pointer hops on a syntax tree that's never more than
 * a few hundred nodes deep for one file — not worth the extra
 * boundary-detection logic and its own chance of getting a node-type list
 * wrong.
 */
function hasGroupingAncestor(node: SyntaxNode | null): boolean {
  let current = node?.parent ?? null;
  while (current) {
    if (GROUPING_ANCESTOR_TYPES.has(current.type)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Resolve which concatenation syntax to emit with.
 *
 * `cfg.concatStyle` (opaque, adapter-interpreted per `WrapConfig`'s own
 * doc comment) forces a style outright when it names one Python
 * recognizes. Otherwise, a region that was *already* a multi-part
 * concatenation run preserves whichever style its own source used — the
 * plan's own wording: "for runs that were originally +-joined, preserve
 * +" — determined from the node's real grammar type
 * (`concatenated_string` vs. `binary_operator`), not re-derived from
 * `region.parts` alone, since nothing on `WrappableRegion` itself records
 * which query captured it. A region with only one part has no original
 * style to preserve (nothing was ever concatenated) and falls back to
 * `pythonDescriptor`'s own declared default (`'implicit'`).
 */
function resolveConcatenationStyle(
  node: SyntaxNode | null,
  region: WrappableRegion,
  cfg: WrapConfig,
): ConcatenationStyle {
  if (cfg.concatStyle === 'implicit' || cfg.concatStyle === 'operator') {
    return cfg.concatStyle;
  }
  if (region.parts.length > 1 && node) {
    if (node.type === 'binary_operator') {
      return 'operator';
    }
    if (node.type === 'concatenated_string') {
      return 'implicit';
    }
  }
  // Non-null: `strings` is optional on `LanguageDescriptor` only for a
  // prose-only language with no string-literal syntax at all (Markdown,
  // LaTeX — `docs/planning/markdown-latex-plan.md` §3.2); Python always
  // declares it.
  return pythonDescriptor.strings!.concatenation.style;
}

/**
 * Python's `LanguageAdapter.emitContext` implementation for
 * `'stringLiteral'` regions — see `./adapter.ts` for how this is wired in,
 * and `../../types/adapter.ts`'s own doc comment anticipating exactly this
 * ("Python... emitContext (paren insertion)").
 *
 * `nodeAtSpan` returning `null` (defensive: shouldn't happen for a region
 * that really came from `discoverRegions` against this same `tree`) falls
 * back to the conservative answer on both axes — `needsParens: true` is
 * always syntactically safe (an extra, technically-redundant paren pair
 * never breaks valid Python), and the descriptor's own default
 * concatenation style is as reasonable a guess as any when the real
 * originating node can't be identified.
 */
export function emitContext(region: WrappableRegion, tree: Tree, cfg: WrapConfig): StringEmitContext {
  const node = nodeAtSpan(tree, region.span);
  return {
    needsParens: !hasGroupingAncestor(node),
    concatenationStyle: resolveConcatenationStyle(node, region, cfg),
    isDictKey: isDictKeyNode(node),
  };
}

function isDictKeyNode(node: SyntaxNode | null): boolean {
  const parent = node?.parent;
  if (!node || !parent || parent.type !== 'pair') {
    return false;
  }
  return parent.childForFieldName('key')?.id === node.id;
}
