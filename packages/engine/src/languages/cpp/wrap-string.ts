import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import { wrapStringDefault } from '../../strings/wrap-string-default.js';

/**
 * C++'s `LanguageAdapter.wrapString`: the shared `strings/wrap-string-default.ts`
 * pipeline (dissolve, normalize quote collisions, emit) with `needsParens`
 * always `false` and `style` always `'implicit'`.
 *
 * Bare adjacency (`"foo" "bar"`) is C++'s *only* real concatenation syntax,
 * and it's valid wherever a single string literal already is -- no
 * enclosing grouping construct to detect or insert the way Python's
 * implicit juxtaposition needs (`../python/wrap-string.ts`, which resolves
 * both axes per-region from real syntax-tree context instead of using this
 * constant-`opts` helper). C++ needs no `tree` lookup at all for either
 * axis.
 */
export function wrapCppString(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  return wrapStringDefault(region, source, cfg, {
    needsParens: false,
    concatenationStyle: 'implicit',
  });
}
