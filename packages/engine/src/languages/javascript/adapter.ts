import type { LanguageAdapter } from '../../types/adapter.js';
import type { RegionKind } from '../../types/region.js';
import type { SyntaxNode } from '../../types/tree-sitter-types.js';
import { javascriptDescriptor } from './descriptor.js';
import {
  classifyEcmaScriptNode,
  ecmaScriptEmitContext,
  isEcmaScriptStringSafeToWrap,
  wrapEcmaScriptString,
} from '../ecmascript/adapter-support.js';

function classify(node: SyntaxNode): RegionKind | null {
  return classifyEcmaScriptNode(node, javascriptDescriptor);
}

/**
 * JavaScript's `LanguageAdapter` — a full adapter.
 *
 * `classify` distinguishes `//`/JSDoc-shaped `/**`/plain `/* * /`
 * comments (excluding the last, per `../ecmascript/adapter-support.ts`'s
 * own doc comment) and marks every `string` node `'stringLiteral'`.
 * `isSafeToWrap`, `emitContext`, and `wrapString` are the shared
 * ECMAScript-family implementations — nothing about JavaScript itself
 * needs its own version of any of them. No `proseText` override either:
 * the engine's own default (`../../types/adapter.ts`'s own doc comment)
 * already does the same `dissolveString` lookup every quote-delimited
 * string syntax needs. No `groupRegions`
 * override: JavaScript's `//` comments still aren't merged across
 * adjacent lines the way Python's are, left as a genuine open question
 * this adapter doesn't need to resolve either. No `wrapDocstring`:
 * JavaScript has no string-literal-as-documentation convention.
 */
export const javascriptAdapter: LanguageAdapter = {
  descriptor: javascriptDescriptor,
  classify,
  isSafeToWrap: isEcmaScriptStringSafeToWrap,
  emitContext: ecmaScriptEmitContext,
  wrapString: wrapEcmaScriptString,
};
