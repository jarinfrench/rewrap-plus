/**
 * Shared "compute wrap edits, then apply them" plumbing used by every
 * wrap command (commits 5-7) and the range-formatting provider (commit
 * 6): resolving config, calling `wrapRegions`, converting the result to
 * `vscode.TextEdit`s, and applying them as one atomic `WorkspaceEdit`.
 * Centralized here rather than duplicated per command so "wrap at
 * cursor", "wrap selection", and "wrap document" differ only in what
 * `SourceSpan[] | 'all'` they pass in — everything downstream of that is
 * identical.
 */
import * as vscode from 'vscode';
import type {
  PositionMapper,
  SourceSpan,
  TextEdit as EngineTextEdit,
  WrapResult,
} from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };
import { getEngine, getParserManager, getSupportedLanguages } from '../engine-host.js';
import { resolveWrapConfigForDocument, type ResolvedWrapConfig } from '../config/resolve-wrap-config.js';
import { reportWrapOutcome } from '../report-wrap-outcome.js';

export interface WrapOutcome {
  readonly result: WrapResult;
  readonly resolvedConfig: ResolvedWrapConfig;
}

/**
 * Run `wrapRegions` for `document` against `targets`. Returns `undefined`
 * when `rewrapPlus.enable` is `false` (the one check every command needs
 * to make before doing anything else, per the plan's framing of `enable`
 * as the setting reached for when debugging a save pipeline with several
 * formatters in it), or when `document.languageId` isn't a registered
 * language.
 *
 * That second check matters because the `"editorLangId in
 * rewrapPlusSupportedLanguages"` `when` clauses gating keybindings/menu
 * entries (`../extension.ts`) only stop *those* invocation paths — the
 * Command Palette's own filtering aside, nothing stops a command from
 * being invoked directly via `vscode.commands.executeCommand` on an
 * unsupported-language document, and `wrapRegions` itself throws loudly
 * for an unregistered language by design (`ParserManager.adapterFor`'s
 * own "fail loudly... rather than a confusing null downstream" policy —
 * correct for a caller bug, but a command handler letting that throw
 * escape as an unhandled rejection is a real one, surfacing to the user
 * as an error toast for what should just be a silent no-op. Caught by
 * running a wrap command against a plaintext file in a live VSCode host
 * during commit 9's own verification pass — exactly the class of gap
 * that check exists to prevent.
 */
export async function computeWrapResult(
  document: vscode.TextDocument,
  targets: readonly SourceSpan[] | 'all',
): Promise<WrapOutcome | undefined> {
  const resolvedConfig = resolveWrapConfigForDocument(document);
  if (!resolvedConfig.enable) {
    return undefined;
  }

  const supportedLanguages = await getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    return undefined;
  }

  const engine = await getEngine();
  const parserManager = await getParserManager();
  const result = await engine.wrapRegions(
    document.getText(),
    document.languageId,
    targets,
    resolvedConfig.wrapConfig,
    parserManager,
  );

  const outcome: WrapOutcome = { result, resolvedConfig };
  reportWrapOutcome(document, outcome);
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
 * Apply `edits` to `document` as one atomic `WorkspaceEdit` — "single
 * atomic edit so one undo reverts everything" (the plan's own framing
 * for wrap-document, commit 7, applied uniformly here since it's just as
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
 * step — unlike the range-formatting provider (commit 6), which must
 * return its edits for VSCode to apply itself rather than applying them
 * directly. Returns `undefined` in exactly the cases `computeWrapResult`
 * does (`rewrapPlus.enable` is `false`).
 */
export async function computeAndApplyWrap(
  document: vscode.TextDocument,
  targets: readonly SourceSpan[] | 'all',
): Promise<WrapOutcome | undefined> {
  const outcome = await computeWrapResult(document, targets);
  if (!outcome) {
    return undefined;
  }
  await applyWrapEdits(document, outcome.result.edits);
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
 * can never satisfy, even when the cursor plainly sits inside — or right
 * at the edge of — a wrappable region from the user's point of view.
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
