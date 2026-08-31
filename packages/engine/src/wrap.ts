import type { ParserManager } from './parser/parser-manager.js';
import { parseWithErrors } from './parser/parse-result.js';
import { discoverRegions } from './discovery/discover-regions.js';
import { sliceSpanText } from './discovery/slice-span.js';
import { applyLineEnding, detectLineEndingNear } from './detect-line-ending.js';
import type { LanguageDescriptor } from './types/adapter.js';
import type { WrapConfig } from './types/config.js';
import type { SourceSpan, TextEdit } from './types/span.js';
import type { WrappableRegion } from './types/region.js';
import type { ReflowOptions } from './reflow/reflow-block.js';
import { dissolveLineComments } from './comments/dissolve-line-comments.js';
import { emitLineComments } from './comments/emit-line-comments.js';
import { dissolveBlockComments } from './comments/dissolve-block-comments.js';
import { emitBlockComments } from './comments/emit-block-comments.js';
import { wrapDocComment } from './comments/wrap-doc-comment.js';
import { looksLikeProse } from './prose-heuristic.js';
import { scanDirectives } from './directives.js';

/**
 * One region that was found but not wrapped, and why — surfaced so a
 * caller (the VSCode extension's output channel) can tell the user
 * *why* nothing changed rather than leaving them to guess.
 */
export interface SkippedRegion {
  readonly region: WrappableRegion;
  readonly reason: string;
}

/**
 * The result of a `wrapRegions` call: every edit needed to apply the
 * wrap, plus every region that was considered but left alone.
 *
 * `cancelled` is `true` only when a `CancellationSignal` passed to
 * `wrapRegions` (part of this engine's large-file guardrails) requested
 * cancellation partway through — `edits`/`skipped` then reflect only the
 * regions processed *before* that happened, never a partial edit of a
 * single region. A caller that cares about the "single atomic edit so
 * one undo reverts everything" property this project's own VSCode
 * commands rely on should treat a cancelled result as nothing to apply
 * at all, not as a partial wrap to apply anyway — seem `wrap-document.ts`
 * for the one caller that currently passes a real cancellation token.
 */
export interface WrapResult {
  readonly edits: readonly TextEdit[];
  readonly skipped: readonly SkippedRegion[];
  readonly cancelled: boolean;
}

/**
 * A minimal, framework-agnostic cancellation check — deliberately just
 * the one property this engine package actually needs, not a full
 * `vscode.CancellationToken` (which this package must never depend on:
 * `packages/engine` importing `vscode` is the one hard rule the whole
 * monorepo is built around). `vscode.CancellationToken` itself exposes
 * `isCancellationRequested` as a plain boolean property with exactly
 * this shape, so a caller in `packages/vscode-extension` can pass a real
 * one straight through with no adapter object needed — TypeScript's
 * structural typing makes the two interchangeable without either side
 * naming the other.
 */
export interface CancellationSignal {
  readonly isCancellationRequested: boolean;
}

/**
 * How often (in wall-clock ms of computation) `wrapRegions`' loop yields to
 * the event loop when a `cancellation` signal is present — see the call site
 * below for why this only happens when one is. Sized against
 * `docs/benchmarks.md`'s worst measured case (50,000 lines / 10,000 regions,
 * ~7.3s, ~0.73ms/region): a 50ms interval yields roughly every ~68 regions
 * there (~146 yields total), adding on the order of 100-300ms of `setTimeout`
 * overhead to a 7.3s computation while keeping a cancellation request
 * responsive to within about 50ms of being set — well inside normal
 * UI-feedback expectations, and a small enough tax to not need its own
 * regression guard the way the quadratic-cost bugs `docs/benchmarks.md`
 * documents did.
 */
const YIELD_INTERVAL_MS = 50;

/**
 * Hand control back to the event loop once. Deliberately a macrotask
 * (`setTimeout`), not a microtask (`queueMicrotask`/`Promise.resolve().then`):
 * a caller's cancellation signal (in the VSCode extension, a
 * `vscode.CancellationToken` flipped by a UI event delivered over IPC to the
 * extension host) arrives on the same footing as other I/O, which only gets
 * a chance to run between event-loop turns, not between microtasks — a
 * microtask-only yield would drain immediately without ever letting that
 * delivery happen, silently fixing nothing. `setTimeout` (unlike `setImmediate`)
 * exists in both Node and browser-like environments, keeping this
 * `vscode`-free and portable, consistent with `CancellationSignal`'s own
 * minimal, framework-agnostic design just above.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Dissolve, reflow, and emit every wrappable region in `source` that
 * falls within `targets` (or every region, for `'all'`), producing the
 * `TextEdit`s needed to apply the wrap plus a reason for every region
 * left untouched.
 *
 * ## Generalized from a Python-only original
 *
 * This function originally shipped hardcoded to Python — living under
 * `languages/python/wrap.ts`, validating `languageId` against
 * `pythonDescriptor.id` directly, and importing `pythonAdapter` by name.
 * That function's own doc comment named the generalization done here as
 * exactly the question a second adapter's canary and conformance kit
 * exist to settle before other code hardens around a Python-only
 * assumption. With a second adapter (the JavaScript canary) actually
 * needing to call this, the answer turned out to be straightforward:
 * resolve the adapter from `parserManager` — which already holds the
 * `AdapterRegistry` a caller constructed — via its new `adapterFor`
 * method, the same way `parserFor` already resolves a `Parser` from the
 * identical registry lookup. No second registry parameter, no
 * adapter-name imports here at all.
 *
 * ## What's still region-kind-limited, and why that's unrelated
 *
 * `'lineComment'` and `'blockComment'` regions are wrapped —
 * `'blockComment'` added alongside that same generalization, alongside
 * `dissolveBlockComments`/`emitBlockComments`, specifically so the
 * JavaScript canary's `/** * /` form has something real to exercise
 * through this same entry point rather than being vacuously skipped.
 * `'docstring'` and `'stringLiteral'` regions are wrapped too — neither
 * through a generic dissolve/emit pair the way the two comment kinds
 * are: both docstring and string-literal syntax are inherently
 * language-specific (see `LanguageAdapter.wrapDocstring`/
 * `wrapString`'s own doc comments on `./types/adapter.js`), so each
 * dispatches to the adapter's own whole-pipeline hook instead — `undefined`
 * for an adapter that doesn't support the kind at all, same "skip with a
 * reason" outcome as every other not-yet-implemented kind.
 *
 * `'docComment'` regions are wrapped too, and unlike
 * `'docstring'`/`'stringLiteral'`, *through* a generic function
 * (`./comments/wrap-doc-comment.js`'s `wrapDocComment`, called directly
 * below) rather than an adapter hook: a `'docComment'` region
 * uses the exact same `comments.block` open/close/continuation-prefix
 * delimiter syntax a plain `'blockComment'` region already does (JSDoc's
 * `/** ... * /` is the same delimiter shape, just content a dialect
 * additionally understands), so nothing about *emitting* it is
 * language-specific the way a docstring's or string's own quoting/
 * concatenation syntax is. A `'docComment'` region only ever appears when
 * the descriptor that discovered it declares `comments.doc` (mirroring
 * `'blockComment'`'s own `comments.block` precondition), so no
 * adapter-agnostic fallback is needed for it beyond that check. This is a
 * *region-kind* limitation, not a language limitation, and stays true
 * regardless of which adapter is passed in — Python has no block comments
 * to exercise either path itself, but the dispatch here doesn't care which
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
 * else: a region overlapping a parse error is skipped outright (this
 * project's "skip region, warn, never block" posture), regardless of kind,
 * since dissolving text next to malformed syntax risks working from a
 * tree that doesn't reflect what's actually in the file.
 *
 * A region whose wrap would produce byte-identical text (already
 * correctly wrapped) is silently omitted from `edits` rather than
 * included as a no-op replacement — checked against a fresh
 * `sliceSpanText(source, region.span)`, not `region.rawText`, since a
 * merged multi-line comment region's `rawText` is only an approximation
 * of the true source slice (see `./comments/group-adjacent-regions.ts`'s
 * `mergeRegionRun`).
 */
export async function wrapRegions(
  source: string,
  languageId: string,
  targets: readonly SourceSpan[] | 'all',
  cfg: WrapConfig,
  parserManager: ParserManager,
  cancellation?: CancellationSignal,
): Promise<WrapResult> {
  const adapter = parserManager.adapterFor(languageId);
  const { descriptor } = adapter;

  const parser = await parserManager.parserFor(languageId);
  const { tree, errorSpans } = parseWithErrors(parser, source);
  // Split once, up front, and reused by every `detectLineEndingNear`
  // call below — see that function's own doc comment for why re-
  // splitting `source` per region (this function's first version) made
  // wrapping every region in a large file quadratic in file size.
  const sourceLines = source.split('\n');

  const allRegions = discoverRegions(adapter, tree, source, languageId, {
    tabSize: cfg.tabSize,
  });
  const candidates =
    targets === 'all'
      ? allRegions
      : allRegions.filter((region) => overlapsAny(region.span, targets));

  const directives = scanDirectives(source, descriptor.comments.line?.marker);
  const edits: TextEdit[] = [];
  const skipped: SkippedRegion[] = [];
  let lastYieldAt = Date.now();

  for (const region of candidates) {
    if (cancellation?.isCancellationRequested) {
      return { edits, skipped, cancelled: true };
    }

    // Only yield when a caller actually passed a cancellation signal —
    // gating on that keeps this loop's hot path unchanged (no `Date.now()`
    // calls, no macrotask overhead) for callers that never opted into
    // cancellation, most importantly the CLI (`packages/cli/src/apply.ts`),
    // which calls `wrapRegions` with no token in a loop over potentially
    // thousands of files, and for whom periodic `setTimeout` yields would be
    // pure cumulative cost with no benefit (no cancellation UI, no
    // concurrent editor to interleave with).
    if (cancellation && Date.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
      await yieldToEventLoop();
      lastYieldAt = Date.now();
    }

    if (errorSpans.some((errorSpan) => spansOverlap(region.span, errorSpan))) {
      skipped.push({ region, reason: 'region overlaps a parse error' });
      continue;
    }

    // Directive comments (`# rewrap: off/on/ignore/force`, `# fmt: off/on`
    // — `./directives.ts`) are a cross-cutting, region-kind-agnostic
    // override, checked ahead of every kind-specific gate below: a region
    // disabled or ignored by one never reaches the string-specific
    // wrapStrings/isSafeToWrap/prose checks or the comment-specific
    // wrapComments check at all. `isForcedAt` is consulted further down,
    // inline with the one gate it's actually meant to bypass (the
    // 'prose' policy's eligibility check) rather than here, since forcing
    // isn't itself a reason to skip.
    if (directives.isDisabledAt(region.span.startRow)) {
      skipped.push({ region, reason: 'region disabled by a rewrap:off/fmt:off directive' });
      continue;
    }
    if (directives.isIgnoredAt(region.span.startRow)) {
      skipped.push({ region, reason: 'region skipped by a rewrap:ignore directive' });
      continue;
    }

    if (
      region.kind !== 'lineComment' &&
      region.kind !== 'blockComment' &&
      !(region.kind === 'docComment' && descriptor.comments.doc) &&
      !(region.kind === 'docstring' && adapter.wrapDocstring) &&
      !(region.kind === 'stringLiteral' && adapter.wrapString)
    ) {
      skipped.push({
        region,
        reason: `wrapping for region kind '${region.kind}' is not implemented`,
      });
      continue;
    }

    if (region.kind === 'stringLiteral') {
      // `'stringLiteral'` gets its own gates entirely separate from
      // `cfg.wrapComments` below: a master `wrapStrings` switch,
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
      if (cfg.stringPolicy === 'prose' && !directives.isForcedAt(region.span.startRow)) {
        // A `# rewrap: force` directive is specifically the escape hatch
        // that makes a conservative default acceptable for *this* gate —
        // it bypasses the heuristic, not the
        // wrapStrings/stringPolicy master switch or isSafeToWrap's hard
        // structural refusals above, which stay in effect regardless.
        const textToScore = adapter.proseText
          ? adapter.proseText(region, source)
          : sliceSpanText(source, region.span);
        const eligible =
          looksLikeProse(textToScore) &&
          (adapter.isProseEligible?.(region, source, tree, cfg) ?? true);
        if (!eligible) {
          skipped.push({ region, reason: "string doesn't score as prose under stringPolicy 'prose'" });
          continue;
        }
      }
    } else if (!cfg.wrapComments) {
      // Docstrings share this gate rather than getting a separate config
      // key: they're Python's own form of documentation comment
      // ("docstrings get rich treatment," as opposed to an arbitrary
      // string), and `WrapConfig` has no dedicated `wrapDocstrings` field
      // for the extension's settings schema to expose one through.
      skipped.push({ region, reason: 'comment wrapping disabled (wrapComments is false)' });
      continue;
    }

    const reflowOptions: ReflowOptions = { mode: cfg.balancedWrapping ? 'balanced' : 'greedy' };
    const emitted =
      region.kind === 'lineComment'
        ? emitWrappedLineComment(region, source, descriptor, cfg.columnLimit, reflowOptions)
        : region.kind === 'blockComment'
          ? emitWrappedBlockComment(region, source, descriptor, cfg.columnLimit, reflowOptions)
          : region.kind === 'docComment'
            ? wrapDocComment(region, source, descriptor, cfg, reflowOptions)
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
    //
    // Detected per region (`detectLineEndingNear`), not once for the
    // whole file — a file with genuinely mixed line endings (a named
    // pathological input in this package's hardening tests) gets each
    // edit matching whatever convention actually surrounds *that*
    // region, rather than every edit in the file uniformly adopting
    // whichever convention happened to appear first.
    const lineEnding = detectLineEndingNear(sourceLines, region.span.startRow);
    const newText = applyLineEnding(emitted, lineEnding);

    if (newText === sliceSpanText(source, region.span)) {
      continue; // already correctly wrapped — no edit needed
    }

    edits.push({ span: region.span, newText });
  }

  return { edits, skipped, cancelled: false };
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
 * introduced alongside `dissolveBlockComments`/`emitBlockComments`
 * themselves. A region only ever classifies as
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
  return emitBlockComments(
    document,
    columnLimit,
    descriptor,
    reflowOptions,
    descriptor.comments.plainBlock,
  );
}
