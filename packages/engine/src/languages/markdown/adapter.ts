import type { LanguageAdapter } from '../../types/adapter.js';
import { markdownDescriptor } from './descriptor.js';
import { discoverMarkdownProse } from './discover-prose.js';

/**
 * Markdown's `LanguageAdapter`. `classify`/`groupRegions`/`isSafeToWrap`/
 * `emitContext` are all comment/string-region hooks with nothing to
 * override here (this descriptor discovers neither kind at all — see
 * `./descriptor.ts`'s own doc comment). `discoverProse` is
 * `./discover-prose.ts`'s real implementation; `wrapProse` is still
 * unset, added in its own commit (`docs/planning/markdown-latex-plan.md`
 * §9 Phase C commit 10) once the continuation-prefix logic it needs is
 * written, rather than stubbed out ahead of that.
 */
export const markdownAdapter: LanguageAdapter = {
  descriptor: markdownDescriptor,
  discoverProse: discoverMarkdownProse,
};
