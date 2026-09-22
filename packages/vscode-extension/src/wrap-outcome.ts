/**
 * `WrapOutcome`: the result of one `wrapRegions` call, together with the
 * config that produced it. Lives in its own module, independent of both
 * `./commands/apply-wrap.ts` (which constructs it) and
 * `./report-wrap-outcome.ts` (which consumes it), specifically so neither
 * of those needs to import the other just to share this type. Before this
 * module existed, `WrapOutcome` was declared in `apply-wrap.ts` and
 * `report-wrap-outcome.ts` imported it from there via a type-only import,
 * while `apply-wrap.ts` also imported `reportWrapOutcome`/
 * `reportWrapApplyFailure` (real, value-level imports) from
 * `report-wrap-outcome.ts` -- a two-file cycle. TypeScript itself tolerates
 * that (the back-edge was type-only, erased at build time), but it's still
 * a real edge in the module graph that static analysis tooling reports as
 * circular, and it made the two files' actual responsibilities (computing
 * an outcome vs. reporting one) harder to see from their imports alone.
 * `WrapOutcome` doesn't conceptually belong to either file -- it's the
 * shared shape both sides agree on -- so it moves here instead of into
 * either producer or consumer.
 */
import type { WrapResult } from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };
import type { ResolvedWrapConfig } from './config/resolve-wrap-config.js';

export interface WrapOutcome {
  readonly result: WrapResult;
  readonly resolvedConfig: ResolvedWrapConfig;
  /**
   * `true` when `document.version` at the end of the `wrapRegions` call
   * differs from what it was when `wrapRegions` started -- meaning the live
   * document was edited while this wrap was still computing (now possible
   * for a large document, since the engine yields to the event loop
   * periodically once a cancellation signal is in play; see `wrap.ts`'s own
   * `YIELD_INTERVAL_MS`). `result.edits` in that case is a snapshot of a
   * document that no longer exists: its spans were computed against text
   * that's since changed underneath it, and `vscode.workspace.applyEdit`
   * has no document-version check of its own to catch that -- it would
   * apply those (possibly now-misaligned) positions to whatever the
   * document currently contains. Every consumer of `WrapOutcome` must treat
   * this exactly like `result.cancelled`: nothing to apply or return,
   * consistent with the project's "single atomic edit, never a partial or
   * stale one" policy.
   */
  readonly documentVersionChanged: boolean;
}
