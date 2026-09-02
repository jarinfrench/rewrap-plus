import type { LanguageAdapter } from '../../types/adapter.js';
import { markdownDescriptor } from './descriptor.js';
import { discoverMarkdownProse } from './discover-prose.js';
import { wrapMarkdownProse } from './wrap-prose.js';

/**
 * Markdown's `LanguageAdapter`. `classify`/`groupRegions`/`isSafeToWrap`/
 * `emitContext` are all comment/string-region hooks with nothing to
 * override here (this descriptor discovers neither kind at all — see
 * `./descriptor.ts`'s own doc comment). `discoverProse`/`wrapProse` are
 * `./discover-prose.ts`/`./wrap-prose.ts`'s real implementations —
 * `wrapMarkdownProse` doesn't yet support hard line breaks (Phase C
 * commit 11) or directives (also commit 11; `wrap.ts` itself already
 * honors `descriptor.directives`, so no adapter-level change is needed
 * there once directives.test.ts confirms `<!--` works).
 */
export const markdownAdapter: LanguageAdapter = {
  descriptor: markdownDescriptor,
  discoverProse: discoverMarkdownProse,
  wrapProse: wrapMarkdownProse,
};
