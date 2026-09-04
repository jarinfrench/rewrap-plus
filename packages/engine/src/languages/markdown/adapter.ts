import type { LanguageAdapter } from '../../types/adapter.js';
import { markdownDescriptor } from './descriptor.js';
import { discoverMarkdownProse } from './discover-prose.js';
import { wrapMarkdownProse } from './wrap-prose.js';

/**
 * Markdown's `LanguageAdapter`. `classify`/`groupRegions`/`isSafeToWrap`/
 * `proseText` are all comment/string-region hooks with nothing to
 * override here (this descriptor discovers neither kind at all — see
 * `./descriptor.ts`'s own doc comment). `discoverProse`/`wrapProse` are
 * `./discover-prose.ts`/`./wrap-prose.ts`'s real implementations, the
 * latter now including §5.4 hard-break support (`./hard-break.ts`).
 * Directives need no adapter-level code at all — `wrap.ts` already
 * honors `descriptor.directives.marker` (`'<!--'`, set on
 * `./descriptor.ts`) generically, confirmed by `../../directives.test.ts`'s
 * own Markdown-specific cases.
 */
export const markdownAdapter: LanguageAdapter = {
  descriptor: markdownDescriptor,
  discoverProse: discoverMarkdownProse,
  wrapProse: wrapMarkdownProse,
};
