import type { LanguageAdapter } from '../../types/adapter.js';
import { shellscriptDescriptor } from './descriptor.js';

/**
 * Shell script (Bash)'s `LanguageAdapter` -- pure descriptor data, no
 * overrides at all, the same shape as `../toml/adapter.ts`.
 *
 * No `classify`: one comment node type, default `'lineComment'` fallback
 * is already correct (see `./descriptor.ts`'s own doc comment). No
 * `groupRegions`: adjacent `#` comments aren't merged, the same open
 * question left for every other line-comment-only adapter here.
 *
 * No `strings`/`queries.strings` declared at all -- deliberately out of
 * scope for this pass, not an oversight. `docs/language-candidates.md`'s
 * Pass 3 findings for Bash: `"..."` is interpolated (the same deferred-
 * shape problem as every other language's string interpolation in this
 * project), `'...'` is fully raw and would fit `QuoteSpec` cleanly on its
 * own, but heredocs (`<<'MARKER' ... MARKER`) have no fixed open/close
 * delimiter pair -- the marker is caller-chosen -- so neither `QuoteSpec`
 * nor `RawFormSpec` can express them, and Bash has no `+`-style
 * concatenation operator at all (bare juxtaposition, which isn't
 * `'implicit'` in the Python/C++ enclosing-expression sense either).
 * Attempting partial string support (e.g. `'...'` alone) without solving
 * the heredoc gap would leave real, common Bash source
 * (`cat <<EOF ... EOF`) silently unhandled by a "supports strings"
 * descriptor in a way that could be mistaken for a bug rather than a
 * scope limit -- comment-only is the honest, complete feature for this
 * pass.
 */
export const shellscriptAdapter: LanguageAdapter = {
  descriptor: shellscriptDescriptor,
};
