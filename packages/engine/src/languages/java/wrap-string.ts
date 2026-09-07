import type { WrapConfig } from '../../types/config.js';
import type { WrappableRegion } from '../../types/region.js';
import { wrapStringDefault } from '../../strings/wrap-string-default.js';

/**
 * Java's `LanguageAdapter.wrapString`: the shared `strings/wrap-string-default.ts`
 * pipeline (dissolve, normalize quote collisions, emit) with `needsParens`
 * always `false` and `style` always `'operator'` -- the identical `opts`
 * ECMAScript-family adapters pass (`../ecmascript/adapter-support.ts`), for
 * the identical reason: `"a" + "b"` is valid wherever an expression
 * already is, with no enclosing-grouping requirement the way Python's
 * implicit juxtaposition has (`../python/wrap-string.ts`, which resolves
 * both axes per-region from real syntax-tree context instead of using this
 * constant-`opts` helper).
 */
export function wrapJavaString(region: WrappableRegion, source: string, cfg: WrapConfig): string {
  return wrapStringDefault(region, source, cfg, {
    needsParens: false,
    concatenationStyle: 'operator',
  });
}
