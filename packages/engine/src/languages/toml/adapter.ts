import type { LanguageAdapter } from '../../types/adapter.js';
import { tomlDescriptor } from './descriptor.js';

/**
 * TOML's `LanguageAdapter` — pure descriptor data, no overrides at all.
 *
 * No `classify`: TOML's grammar produces exactly one comment node type
 * (`comment`), and `discoverRegions`'s default fallback already assigns
 * `'lineComment'` to every `@comment` capture when no override is
 * declared — correct here since `tomlDescriptor.comments` declares no
 * `block`/`doc` form for anything else a capture could resolve to. No
 * `groupRegions`: adjacent `#` comments aren't merged, the same open
 * question left for every other line-comment-only adapter in this
 * package. No `strings`-related hooks: `tomlDescriptor` declares no
 * `strings`/`queries.strings` at all — see `./descriptor.ts`'s own doc
 * comment for why TOML string *values* (including its triple-quoted
 * multi-line form) are out of scope for this pass, the same "is this
 * really prose, or a data value that shouldn't be reflowed" question that
 * already scoped out YAML's block scalars and TOML's own multi-line
 * strings in `docs/language-candidates.md`'s Pass 3.
 */
export const tomlAdapter: LanguageAdapter = {
  descriptor: tomlDescriptor,
};
