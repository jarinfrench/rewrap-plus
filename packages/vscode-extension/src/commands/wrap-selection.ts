/**
 * `rewrapPlus.wrapSelection` — each selection expands outward to its
 * encompassing region boundaries (never wrapping half a string/comment)
 * and every fully-or-partially covered region is wrapped. Unlike
 * wrap-at-cursor (commit 5), a selection's actual extent matters here —
 * `vscode.Selection` already *is* a `vscode.Range`, so no collapsing to
 * a point like wrap-at-cursor does.
 */
import * as vscode from 'vscode';
import { getEngine } from '../engine-host.js';
import { computeAndApplyWrap, rangeTargetSpan } from './apply-wrap.js';

export const WRAP_SELECTION_COMMAND = 'rewrapPlus.wrapSelection';

export function registerWrapSelectionCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(WRAP_SELECTION_COMMAND, wrapSelection));
}

async function wrapSelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const { document, selections } = editor;
  const engine = await getEngine();
  const mapper = new engine.PositionMapper(document.getText());

  // A selection spanning several regions wraps all of them —
  // wrapRegions already includes every region overlapping any target
  // span, not just the first match.
  const targets = selections.map((selection) => rangeTargetSpan(mapper, document, selection));

  await computeAndApplyWrap(document, targets);
}
