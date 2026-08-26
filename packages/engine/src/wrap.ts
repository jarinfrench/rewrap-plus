import type { ParserManager } from './parser/parser-manager.js';
import { parseWithErrors } from './parser/parse-result.js';
import { discoverRegions } from './discovery/discover-regions.js';
import { sliceSpanText } from './discovery/slice-span.js';
import { applyLineEnding, detectLineEnding } from './detect-line-ending.js';
import type { LanguageDescriptor } from './types/adapter.js';
import type { WrapConfig } from './types/config.js';
import type { SourceSpan, TextEdit } from './types/span.js';
import type { WrappableRegion } from './types/region.js';
import type { ReflowOptions } from './reflow/reflow-block.js';
import { dissolveLineComments } from './comments/dissolve-line-comments.js';
import { emitLineComments } from './comments/emit-line-comments.js';
import { dissolveBlockComments } from './comments/dissolve-block-comments.js';
import { emitBlockComments } from './comments/emit-block-comments.js';
import { looksLikeProse } from './prose-heuristic.js';

/**
 * One region that was found but not wrapped, and why — surfaced so a
 * caller (the extension's output channel, Phase 7) can tell the user
 * *why* nothing changed rather than leaving them to guess.
 */
export interface SkippedRegion {
  readonly region: WrappableRegion;
  readonly reason: string;
}

/**
 * The result of a `wrapRegions` call: every edit needed to apply the
 * wrap, plus every region that was considered but left alone.
 */
export interface WrapResult {
  readonly edits: readonly TextEdit[];
  readonly skipped: readonly SkippedRegion[];
}

/**
 * Dissolve, reflow, and emit every wrappable region in `source` that
 * falls within `targets` (or every region, for `'all'`), producing the
 * `TextEdit`s needed to apply the wrap plus a reason for every region
 * left untouched.
 *
 * ## Generalized in Phase 6b
 *
 * Phase 6 shipped this hardcoded to Python — living under
 * `languages/python/wrap.ts`, validating `languageId` against
 * `pythonDescriptor.id` directly, and importing `pythonAdapter` by name.
 * That function's own doc comment named the generalization done here as
 * exactly the question Phase 6b's canary and conformance kit exist to
 * settle before Phase 7 hardens around a Python-only assumption. With a
 * second adapter (the JavaScript canary) actually needing to call this,
 * the answer turned out to be straightforward: resolve the adapter from
 * `parserManager` — which already holds the `AdapterRegistry` a caller
 * constructed — via its new `adapterFor` method, the same way
 * `parserFor` already resolves a `Parser` from the identical registry
 * lookup. No second registry parameter, no adapter-name imports here at
 * all.
 *
 * ## What's still region-kind-limited, and why that's unrelated
 *
 * `'lineComment'` and `'blockComment'` regions are wrapped —
 * `'blockComment'` added later in Phase 6b alongside
 * `dissolveBlockComments`/`emitBlockComments`, specifically so the
 * JavaScript canary's `/** * /` form has something real to exercise
 * through this same entry point rather than being vacuously skipped.
 * `'docstring'` regions are wrapped too, as of Phase 8, and `'stringLiteral'`
 * regions as of Phase 9 — neither through a generic dissolve/emit pair the
 * way the two comment kinds are: both docstring and string-literal syntax
 * are inherently language-specific (see `LanguageAdapter.wrapDocstring`/
 * `wrapString`'s own doc comments on `./types/adapter.js`), so each
 * dispatches to the adapter's own whole-pipeline hook instead — `undefined`
 * for an adapter that doesn't support the kind at all, same "skip with a
 * reason" outcome as every other not-yet-implemented kind. `'docComment'`
 * is still reported as skipped with a reason naming the missing phase,
 * rather than silently ignored or (worse) crashing. This is a
 * *region-kind* limitation, not a language limitation, and stays true
 * regardless of which adapter is passed in — Python has no block comments
 * to exercise that path itself, but the dispatch here doesn't care which
 * descriptor is driving it.
 *
 * `'stringLiteral'` additionally passes through gates no other kind does
 * before reaching `wrapString` — a master `cfg.wrapStrings`/
 * `cfg.stringPolicy` switch, `isSafeToWrap`'s hard structural refusals,
 * and, under the conservative `'prose'` policy, both the shared
 * `looksLikeProse` text heuristic (`./prose-heuristic.js`) and whatever
 * context signal the adapter's own `isProseEligible` can answer exactly
 * (a dict key, for Python) — see the loop body below rather than
 * `cfg.wrapComments`'s gate, which `'stringLiteral'` does not share.
 *
 * Every candidate region is checked against `errorSpans` before anything
 * else: a region overlapping a parse error is skipped outright ("skip
 * region, warn, never block" — decision of record), regardless of kind,
 * since dissolving text next to malformed syntax risks working from a
 * tree that doesn't reflect what's actually in the file.
 *
 * A region whose wrap would produce byte-identical text (already
 * correctly wrapped) is silently omitted from `edits` rather than
 * included as a no-op replacement — checked against a fresh
 * `sliceSpanText(source, region.span)`, not `region.rawText`, since a
 * merged multi-line comment region's `rawText` is only an approximation
 * of the true source slice (see the Python adapter's `mergeLineCommentRun`).
 */
export async function wrapRegions(
  source: string,
  languageId: string,
  targets: readonly SourceSpan[] | 'all',
  cfg: WrapConfig,
  parserManager: ParserManager,
): Promise<WrapResult> {
  const adapter = parserManager.adapterFor(languageId);
  const { descriptor } = adapter;

  const parser = await parserManager.parserFor(languageId);
  const { tree, errorSpans } = parseWithErrors(parser, source);
  const lineEnding = detectLineEnding(source);

  const allRegions = discoverRegions(adapter, tree, source, languageId, {
    tabSize: cfg.tabSize,
  });
  const candidates =
    targets === 'all'
      ? allRegions
      : allRegions.filter((region) => overlapsAny(region.span, targets));

  const edits: TextEdit[] = [];
  const skipped: SkippedRegion[] = [];

  for (const region of candidates) {
    if (errorSpans.some((errorSpan) => spansOverlap(region.span, errorSpan))) {
      skipped.push({ region, reason: 'region overlaps a parse error' });
      continue;
    }

    if (
      region.kind !== 'lineComment' &&
      region.kind !== 'blockComment' &&
      !(region.kind === 'docstring' && adapter.wrapDocstring) &&
      !(region.kind === 'stringLiteral' && adapter.wrapString)
    ) {
      skipped.push({
        region,
        reason: `wrapping for region kind '${region.kind}' is not implemented until a later phase`,
      });
      continue;
    }

    if (region.kind === 'stringLiteral') {
      // `'stringLiteral'` gets its own gates entirely separate from
      // `cfg.wrapComments` below (Phase 9): a master `wrapStrings` switch,
      // `isSafeToWrap`'s hard structural refusals (raw/byte/mixed-prefix/
      // triple-quoted/line-continuation — `./languages/python/adapter.ts`),
      // and, for the conservative `'prose'` policy, both the shared
      // text-only heuristic and whatever context signal the adapter can
      // answer exactly (`isProseEligible` — a dict key, for Python).
      if (!cfg.wrapStrings || cfg.stringPolicy === 'off') {
        skipped.push({ region, reason: 'string wrapping disabled (wrapStrings/stringPolicy)' });
        continue;
      }
      if (adapter.isSafeToWrap && !adapter.isSafeToWrap(region, source)) {
        skipped.push({ region, reason: 'string is not safe to wrap' });
        continue;
      }
      if (cfg.stringPolicy === 'prose') {
        const eligible =
          looksLikeProse(sliceSpanText(source, region.span)) &&
          (adapter.isProseEligible?.(region, source, tree, cfg) ?? true);
        if (!eligible) {
          skipped.push({ region, reason: "string doesn't score as prose under stringPolicy 'prose'" });
          continue;
        }
      }
    } else if (!cfg.wrapComments) {
      // Docstrings share this gate rather than getting a separate config
      // key: they're Python's own form of documentation comment (Phase
      // 3's own framing — "docstrings get rich treatment," as opposed to
      // an arbitrary string), and `WrapConfig` has no dedicated
      // `wrapDocstrings` field for the extension's settings schema to
      // expose one through.
      skipped.push({ region, reason: 'comment wrapping disabled (wrapComments is false)' });
      continue;
    }

    const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };
    const emitted =
      region.kind === 'lineComment'
        ? emitWrappedLineComment(region, source, descriptor, cfg.columnLimit, reflowOptions)
        : region.kind === 'blockComment'
          ? emitWrappedBlockComment(region, source, descriptor, cfg.columnLimit, reflowOptions)
          : region.kind === 'stringLiteral'
            ? adapter.wrapString!(region, source, cfg, tree)
            : adapter.wrapDocstring!(region, source, cfg);

    // `emitLineComments`/`emitBlockComments` always join their own
    // output lines with a bare `\n` (see each function's own doc
    // comment) — rewritten here to match the source file's own
    // convention, since this is where the result actually becomes
    // editable text (`./detect-line-ending.ts`'s own doc comment
    // explains why this substitution belongs at this layer rather than
    // inside emit itself).
    const newText = applyLineEnding(emitted, lineEnding);

    if (newText === sliceSpanText(source, region.span)) {
      continue; // already correctly wrapped — no edit needed
    }

    edits.push({ span: region.span, newText });
  }

  return { edits, skipped };
}

function spansOverlap(a: SourceSpan, b: SourceSpan): boolean {
  return a.startByte < b.endByte && b.startByte < a.endByte;
}

function overlapsAny(span: SourceSpan, targets: readonly SourceSpan[]): boolean {
  return targets.some((target) => spansOverlap(span, target));
}

/**
 * Dissolve, reflow, and emit one `'lineComment'` region, returning the
 * bare-`\n`-joined replacement text `emitLineComments` always produces
 * (see that function's own doc comment) — line-ending matching happens
 * once, centrally, back in `wrapRegions`.
 */
function emitWrappedLineComment(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  columnLimit: number,
  reflowOptions: ReflowOptions,
): string {
  const dissolved = dissolveLineComments(region, source, descriptor);
  const marker = descriptor.comments.line?.marker ?? '#';
  return emitLineComments(
    dissolved.document,
    columnLimit,
    marker,
    dissolved.spaceAfterMarker,
    reflowOptions,
  );
}

/**
 * Dissolve, reflow, and emit one `'blockComment'` region — the
 * `'blockComment'` counterpart to `emitWrappedLineComment` above,
 * introduced in Phase 6b alongside `dissolveBlockComments`/
 * `emitBlockComments` themselves. A region only ever classifies as
 * `'blockComment'` when the descriptor that discovered it declares
 * `comments.block` (see `dissolveBlockComments`'s own throw for the
 * contract this relies on), so no adapter-agnostic fallback is needed
 * here beyond what those two functions already provide.
 */
function emitWrappedBlockComment(
  region: WrappableRegion,
  source: string,
  descriptor: LanguageDescriptor,
  columnLimit: number,
  reflowOptions: ReflowOptions,
): string {
  const document = dissolveBlockComments(region, source, descriptor);
  return emitBlockComments(document, columnLimit, descriptor, reflowOptions);
}
