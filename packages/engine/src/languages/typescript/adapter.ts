import type { LanguageAdapter, LanguageDescriptor } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { typescriptDescriptor, typescriptReactDescriptor } from './descriptor.js';
import {
  classifyEcmaScriptNode,
  ecmaScriptEmitContext,
  isEcmaScriptStringSafeToWrap,
  wrapEcmaScriptString,
} from '../ecmascript/adapter-support.js';

/**
 * Build a `LanguageAdapter` for one ECMAScript-family descriptor —
 * shared by both `typescriptAdapter` and `typescriptReactAdapter` below,
 * which differ only in which descriptor (and therefore which grammar)
 * `classify` closes over; every other hook is the identical shared
 * `../ecmascript/adapter-support.ts` implementation `../javascript/adapter.ts`
 * also uses, verbatim.
 */
function buildAdapter(descriptor: LanguageDescriptor): LanguageAdapter {
  const classify = (node: SyntaxNode): RegionKind | null => classifyEcmaScriptNode(node, descriptor);

  return {
    descriptor,
    classify,
    isSafeToWrap: isEcmaScriptStringSafeToWrap,
    emitContext: ecmaScriptEmitContext,
    wrapString: wrapEcmaScriptString,
  };
}

/**
 * TypeScript's `LanguageAdapter` — see `./descriptor.ts` for why TSX gets
 * its own sibling adapter (`typescriptReactAdapter`) rather than an
 * alias of this one.
 */
export const typescriptAdapter: LanguageAdapter = buildAdapter(typescriptDescriptor);

/** TSX's `LanguageAdapter` — same shared logic, `tree-sitter-tsx.wasm` grammar. */
export const typescriptReactAdapter: LanguageAdapter = buildAdapter(typescriptReactDescriptor);
