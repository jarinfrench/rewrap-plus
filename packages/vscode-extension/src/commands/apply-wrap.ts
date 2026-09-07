/**
 * Shared "compute wrap edits, then apply them" plumbing used by every
 * wrap command (commits 5-7) and the range-formatting provider (commit
 * 6): resolving config, calling `wrapRegions`, converting the result to
 * `vscode.TextEdit`s, and applying them as one atomic `WorkspaceEdit`.
 * Centralized here rather than duplicated per command so "wrap at
 * cursor", "wrap selection", and "wrap document" differ only in what
 * `SourceSpan[] | 'all'` they pass in -- everything downstream of that is
 * identical.
 */
import * as vscode from 'vscode';
import type {
  PositionMapper,
  SourceSpan,
  TextEdit as EngineTextEdit,
  WrapConfig,
  WrapResult,
} from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };
import { getEngine, getParserManager, getSupportedLanguages } from '../engine-host.js';
import { resolveWrapConfigForDocument, type ResolvedWrapConfig } from '../config/resolve-wrap-config.js';
import { reportWrapApplyFailure, reportWrapOutcome } from '../report-wrap-outcome.js';

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

/**
 * Run `wrapRegions` for `document` against `targets`. Returns `undefined`
 * when `rewrapPlus.enable` is `false` (the one check every command needs
 * to make before doing anything else -- `enable` is the setting reached
 * for when debugging a save pipeline with several formatters in it), or
 * when `document.languageId` isn't a registered language.
 *
 * That second check matters because the `"editorLangId in
 * rewrapPlusSupportedLanguages"` `when` clauses gating keybindings/menu
 * entries (`../extension.ts`) only stop *those* invocation paths -- the
 * Command Palette's own filtering aside, nothing stops a command from
 * being invoked directly via `vscode.commands.executeCommand` on an
 * unsupported-language document, and `wrapRegions` itself throws loudly
 * for an unregistered language by design (`ParserManager.adapterFor`'s
 * own "fail loudly... rather than a confusing null downstream" policy --
 * correct for a caller bug, but a command handler letting that throw
 * escape as an unhandled rejection is a real one, surfacing to the user
 * as an error toast for what should just be a silent no-op. Caught by
 * running a wrap command against a plaintext file in a live VSCode host
 * during commit 9's own verification pass -- exactly the class of gap
 * that check exists to prevent.
 */
/**
 * `cancellation` (the large-file guardrails signal) is passed straight
 * through to `engine.wrapRegions` -- `vscode.CancellationToken`'s own
 * `isCancellationRequested: boolean` property already matches the
 * engine's minimal, `vscode`-free `CancellationSignal` shape exactly
 * (see that type's own doc comment on `@rewrap-plus/engine`), so no
 * adapter object is needed here. Omitted entirely by every caller that
 * has no cancellation UI of its own (`wrap-at-cursor`, `wrap-selection`,
 * the range-formatting provider) -- a wrap those commands do is expected
 * to be fast enough that offering to cancel it would be noise, not help
 * (see `wrap-document.ts`'s own `LARGE_DOCUMENT_LINE_THRESHOLD` for the
 * one caller that does pass one, and why only it needs to).
 */
export interface ComputeWrapResultOptions {
  /**
   * Whether to log this call's outcome to the output channel and flash
   * a status-bar summary via `reportWrapOutcome`. Defaults to `true` for
   * every existing caller (command, format-on-save, formatting
   * providers) -- each of those is one discrete, user-initiated event
   * worth reporting on. `../auto-wrap.ts` is the one caller that passes
   * `false`: it calls this once per triggering keystroke while the user
   * types, so both halves of `reportWrapOutcome` (an output-channel line
   * *and* a status-bar flash) would fire continuously rather than for a
   * single discrete action -- noise, not diagnostics, at that frequency.
   * `rewrapPlus.showResolvedConfig` remains the right tool for
   * inspecting what auto-wrap resolved for a document.
   */
  readonly report?: boolean;

  /**
   * When set, overrides `resolveWrapConfigForDocument`'s own
   * `wrapConfig.wrapStrings` for this call only -- the resolved
   * `rewrapPlus.wrapStrings`/`stringWrapInclude` settings are left
   * completely untouched (and still what `rewrapPlus.showResolvedConfig`
   * reports); only what actually gets passed to `wrapRegions` changes.
   * `../auto-wrap.ts` passes `false` unconditionally: it's
   * comment/docstring-only by design (see its own module doc comment for
   * why), independent of whatever the user has `wrapStrings` set to for
   * the explicit wrap commands.
   */
  readonly wrapStrings?: boolean;

  /**
   * A `PositionMapper` the caller already built from this same
   * `document`'s text -- every caller that's about to pass a span-shaped
   * `targets` (as opposed to `'all'`) needs one of these first, to turn a
   * cursor position or selection into that `SourceSpan` via
   * `rangeTargetSpan`. Threaded straight through to `engine.wrapRegions`
   * below so it can reuse that instance instead of building its own
   * second copy of the same document's checkpoint table (see
   * `wrapRegions`'s own doc comment on its `mapper` parameter). Omitted by
   * `wrapDocument`/`document-formatting-provider.ts`, whose `targets` is
   * always `'all'` and so never need one in the first place.
   */
  readonly mapper?: PositionMapper;

  /**
   * Skip re-deriving `../config/resolve-wrap-config.ts`'s
   * `ResolvedWrapConfig` from scratch and use this one instead. Every
   * caller but `../auto-wrap.ts` omits this -- unchanged behavior, resolve
   * it internally exactly as before this option existed. Auto-wrap
   * already has to resolve it itself, before this function is ever
   * called, just to answer "did this keystroke cross the column limit?"
   * (`resolveWrapConfigForDocument` is the one step in that check that
   * can touch the filesystem, via `.editorconfig` -- see
   * `../config/editorconfig.ts`). Without this option, that same
   * resolution ran a second time in here, once per triggering keystroke,
   * purely because this function had no way to know the caller already
   * had one. Used exactly as if this function had derived it itself --
   * `options.wrapStrings` below still overrides
   * `resolvedConfig.wrapConfig.wrapStrings` the same way either way.
   */
  readonly resolvedConfig?: ResolvedWrapConfig;
}

export async function computeWrapResult(
  document: vscode.TextDocument,
  targets: readonly SourceSpan[] | 'all',
  cancellation?: vscode.CancellationToken,
  options?: ComputeWrapResultOptions,
): Promise<WrapOutcome | undefined> {
  const resolvedConfig = options?.resolvedConfig ?? resolveWrapConfigForDocument(document);
  if (!resolvedConfig.enable) {
    return undefined;
  }

  const supportedLanguages = await getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    return undefined;
  }

  const wrapConfig: WrapConfig =
    options?.wrapStrings === undefined
      ? resolvedConfig.wrapConfig
      : { ...resolvedConfig.wrapConfig, wrapStrings: options.wrapStrings };

  const engine = await getEngine();
  const parserManager = await getParserManager();
  const capturedVersion = document.version;
  const result = await engine.wrapRegions(
    document.getText(),
    document.languageId,
    targets,
    wrapConfig,
    parserManager,
    cancellation,
    options?.mapper,
  );
  const documentVersionChanged = document.version !== capturedVersion;

  // `resolvedConfig.wrapConfig` is replaced with the actual `wrapConfig`
  // just passed to `wrapRegions` above, so `WrapOutcome` never disagrees
  // with what really produced `result` -- `resolvedConfig.enable` and
  // `.columnLimit` (the fields every existing consumer actually reads)
  // are untouched either way.
  const outcome: WrapOutcome = {
    result,
    resolvedConfig: { ...resolvedConfig, wrapConfig },
    documentVersionChanged,
  };
  if (options?.report ?? true) {
    reportWrapOutcome(document, outcome);
  }
  return outcome;
}

function toVSCodeTextEdit(edit: EngineTextEdit): vscode.TextEdit {
  const range = new vscode.Range(
    new vscode.Position(edit.span.startRow, edit.span.startColumn),
    new vscode.Position(edit.span.endRow, edit.span.endColumn),
  );
  return vscode.TextEdit.replace(range, edit.newText);
}

export function toVSCodeTextEdits(edits: readonly EngineTextEdit[]): vscode.TextEdit[] {
  return edits.map(toVSCodeTextEdit);
}

/**
 * Apply `edits` to `document` as one atomic `WorkspaceEdit` -- "single
 * atomic edit so one undo reverts everything" (the design goal for
 * wrap-document, commit 7, applied uniformly here since it's just as
 * true for a multi-cursor wrap-at-cursor or a selection spanning several
 * regions). Returns `true` when there was nothing to apply, matching
 * `WorkspaceEdit.apply`'s own "vacuously successful" convention rather
 * than treating "no edits needed" as a failure.
 */
export async function applyWrapEdits(
  document: vscode.TextDocument,
  edits: readonly EngineTextEdit[],
): Promise<boolean> {
  if (edits.length === 0) {
    return true;
  }
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.set(document.uri, toVSCodeTextEdits(edits));
  return vscode.workspace.applyEdit(workspaceEdit);
}

/**
 * `computeWrapResult` followed by `applyWrapEdits`, for the two commands
 * (wrap-at-cursor, wrap-selection) that both compute *and* apply in one
 * step -- unlike the range-formatting provider (commit 6), which must
 * return its edits for VSCode to apply itself rather than applying them
 * directly. Returns `undefined` in exactly the cases `computeWrapResult`
 * does (`rewrapPlus.enable` is `false`).
 *
 * A cancelled result (`outcome.result.cancelled`) applies
 * nothing at all, even though `edits` may already hold some real edits
 * computed before cancellation fired: the "single atomic edit so one
 * undo reverts everything" property this function exists to provide
 * would otherwise become "a *partial*, silently-incomplete wrap of the
 * document," which is a worse outcome than doing nothing -- the user
 * asked to cancel specifically because they didn't want to wait for the
 * whole thing. A result where `outcome.documentVersionChanged` is `true`
 * applies nothing for the same reason, but a different cause: the document
 * itself changed while this wrap was still computing, so `edits`' spans no
 * longer describe the document as it currently exists (see
 * `WrapOutcome.documentVersionChanged`'s own doc comment).
 *
 * `mapper` is forwarded to `computeWrapResult` as-is -- see
 * `ComputeWrapResultOptions.mapper`'s own doc comment. Both existing
 * callers (`wrap-at-cursor.ts`, `wrap-selection.ts`) already build one to
 * turn their own cursor/selection into `targets` via `rangeTargetSpan`
 * before calling in here, so passing it through costs them nothing extra.
 *
 * `applyWrapEdits`'s own return value is checked here (unlike before this
 * check existed): `computeWrapResult` already reported a "N wrapped"
 * outcome based on the *computed* result, before this function ever
 * attempts to apply it, so a `false` return -- VSCode declining the edit
 * outright, most commonly because `document` isn't editable at all (a
 * `git show`/diff-view virtual document, one backed by a read-only
 * `TextDocumentContentProvider`) -- would otherwise leave that premature
 * success message as the user's only signal, with no actual change made
 * and no indication anything went wrong. `reportWrapApplyFailure`
 * (`../report-wrap-outcome.ts`) exists specifically to correct that.
 */
export async function computeAndApplyWrap(
  document: vscode.TextDocument,
  targets: readonly SourceSpan[] | 'all',
  cancellation?: vscode.CancellationToken,
  mapper?: PositionMapper,
): Promise<WrapOutcome | undefined> {
  const outcome = await computeWrapResult(document, targets, cancellation, {
    ...(mapper ? { mapper } : {}),
  });
  if (!outcome) {
    return undefined;
  }
  if (!outcome.result.cancelled && !outcome.documentVersionChanged) {
    const applied = await applyWrapEdits(document, outcome.result.edits);
    if (!applied) {
      reportWrapApplyFailure(document, outcome.result.edits.length);
    }
  }
  return outcome;
}

/**
 * Turn a `vscode.Range` into the byte-offset `SourceSpan` `wrapRegions`
 * needs, via `mapper` (a fresh `engine.PositionMapper` built from the
 * same document text the caller is about to call `wrapRegions` with).
 *
 * An *empty* range (a bare cursor, or an empty selection) is widened by
 * one character on each side rather than passed through as a zero-width
 * span: `wrapRegions`' overlap test (`a.startByte < b.endByte &&
 * b.startByte < a.endByte`) is a strict interior test a zero-width span
 * can never satisfy, even when the cursor plainly sits inside -- or right
 * at the edge of -- a wrappable region from the user's point of view.
 * `document.offsetAt`/`positionAt` (not manual character arithmetic)
 * handle document-boundary clamping safely in both directions, including
 * right at the start or end of the file.
 */
export function rangeTargetSpan(
  mapper: PositionMapper,
  document: vscode.TextDocument,
  range: vscode.Range,
): SourceSpan {
  if (!range.isEmpty) {
    const startByte = mapper.positionToByteOffset({
      line: range.start.line,
      character: range.start.character,
    });
    const endByte = mapper.positionToByteOffset({
      line: range.end.line,
      character: range.end.character,
    });
    return mapper.spanFromByteRange(startByte, endByte);
  }

  const offset = document.offsetAt(range.start);
  const before = document.positionAt(Math.max(0, offset - 1));
  const after = document.positionAt(offset + 1);
  const startByte = mapper.positionToByteOffset({ line: before.line, character: before.character });
  const endByte = mapper.positionToByteOffset({ line: after.line, character: after.character });
  return mapper.spanFromByteRange(startByte, endByte);
}
