/**
 * `rewrapPlus.wrapAtCursor` — expands to the region containing the
 * cursor and wraps it. Multi-cursor: one target span per cursor, using
 * each selection's `.active` position and ignoring any selection
 * extent — `rewrapPlus.wrapSelection` (commit 6) is the command that
 * cares about selection extent instead.
 */
import * as vscode from 'vscode';
import { getEngine } from '../engine-host.js';
import { computeAndApplyWrap, rangeTargetSpan } from './apply-wrap.js';

export const WRAP_AT_CURSOR_COMMAND = 'rewrapPlus.wrapAtCursor';

export function registerWrapAtCursorCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(WRAP_AT_CURSOR_COMMAND, wrapAtCursor));
}

async function wrapAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const { document, selections } = editor;
  const engine = await getEngine();
  const mapper = new engine.PositionMapper(document.getText());

  // wrapRegions dedupes a region touched by more than one target span
  // itself (one filter pass over the regions it discovers), so two
  // cursors landing in the same region never produce a duplicate edit.
  const targets = selections.map((selection) =>
    rangeTargetSpan(mapper, document, new vscode.Range(selection.active, selection.active)),
  );

  await computeAndApplyWrap(document, targets);
}
