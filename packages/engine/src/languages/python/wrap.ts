import type { ParserManager } from '../../parser/parser-manager.js';
import { parseWithErrors } from '../../parser/parse-result.js';
import { discoverRegions } from '../../discovery/discover-regions.js';
import { sliceSpanText } from '../../discovery/slice-span.js';
import { applyLineEnding, detectLineEnding } from '../../detect-line-ending.js';
import type { WrapConfig } from '../../types/config.js';
import type { SourceSpan, TextEdit } from '../../types/span.js';
import type { WrappableRegion } from '../../types/region.js';
import { pythonAdapter } from './adapter.js';
import { pythonDescriptor } from './descriptor.js';
import { dissolveLineComments } from './line-comment-dissolve.js';
import { emitLineComments } from './line-comment-emit.js';

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
 * Dissolve, reflow, and emit every wrappable `'lineComment'` region in
 * `source` that falls within `targets` (or every region, for `'all'`),
 * producing the `TextEdit`s needed to apply the wrap plus a reason for
 * every region left untouched.
 *
 * Scoped to Python only for this phase — hence living under
 * `languages/python/` and validating `languageId` against
 * `pythonDescriptor.id` rather than dispatching through an
 * `AdapterRegistry` the way a real multi-language entry point eventually
 * will. Generalizing this into an engine-level, adapter-driven dispatch
 * across every wrappable `RegionKind` is exactly the kind of question
 * Phase 6b's canary JavaScript adapter and conformance kit exist to
 * settle *before* it hardens around Python-only assumptions — see that
 * phase's hard gate. Doing that generalization now, with only one
 * adapter and only one region kind (comments) implemented, would be
 * designing the abstraction from a sample size of one.
 *
 * Only `'lineComment'` regions are actually wrapped this phase, matching
 * the plan's own stated scope ("Python comment wrapping works end-to-end
 * in the engine, no VSCode yet"): `'docstring'`/`'stringLiteral'`/
 * `'docComment'` regions are reported as skipped with a reason naming
 * the missing phase, rather than silently ignored or (worse) crashing —
 * a caller iterating `skipped` sees exactly what's not implemented yet
 * instead of wondering why a docstring in the target range produced no
 * edit.
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
 * of the true source slice (see `./adapter.ts`'s `mergeLineCommentRun`).
 */
export async function wrapRegions(
  source: string,
  languageId: string,
  targets: readonly SourceSpan[] | 'all',
  cfg: WrapConfig,
  parserManager: ParserManager,
): Promise<WrapResult> {
  if (languageId !== pythonDescriptor.id) {
    throw new Error(
      `wrapRegions (python): unsupported language '${languageId}' — this phase only ` +
        `supports '${pythonDescriptor.id}'; multi-language dispatch is deferred to Phase 6b/7.`,
    );
  }

  const parser = await parserManager.parserFor(languageId);
  const { tree, errorSpans } = parseWithErrors(parser, source);
  const lineEnding = detectLineEnding(source);

  const allRegions = discoverRegions(pythonAdapter, tree, source, languageId, {
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

    if (region.kind !== 'lineComment') {
      skipped.push({
        region,
        reason: `wrapping for region kind '${region.kind}' is not implemented until a later phase`,
      });
      continue;
    }

    if (!cfg.wrapComments) {
      skipped.push({ region, reason: 'comment wrapping disabled (wrapComments is false)' });
      continue;
    }

    const dissolved = dissolveLineComments(region, source, pythonDescriptor);
    const marker = pythonDescriptor.comments.line?.marker ?? '#';
    const emitted = emitLineComments(
      dissolved.document,
      cfg.columnLimit,
      marker,
      dissolved.spaceAfterMarker,
    );
    // `emitLineComments` always joins its own output lines with a bare
    // `\n` (see that function's doc comment) — rewritten here to match
    // the source file's own convention, since this is where the result
    // actually becomes editable text (`detect-line-ending.ts`'s own doc
    // comment explains why this substitution belongs at this layer
    // rather than inside emit itself).
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
