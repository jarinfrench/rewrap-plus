import type { LanguageAdapter } from '../../types/adapter.js';
import { markdownDescriptor } from './descriptor.js';

/**
 * Markdown's `LanguageAdapter`. `classify`/`groupRegions`/`isSafeToWrap`/
 * `emitContext` are all comment/string-region hooks with nothing to
 * override here (this descriptor discovers neither kind at all — see
 * `./descriptor.ts`'s own doc comment). `discoverProse`/`wrapProse` are
 * where this adapter's real work lives; scaffolded here as
 * `{ descriptor: markdownDescriptor }` only, with both hooks added in
 * their own commits (`docs/planning/markdown-latex-plan.md` §9 Phase C
 * commits 9/10) once the discovery/wrap logic each needs is actually
 * written, rather than stubbed out ahead of that.
 */
export const markdownAdapter: LanguageAdapter = {
  descriptor: markdownDescriptor,
};
