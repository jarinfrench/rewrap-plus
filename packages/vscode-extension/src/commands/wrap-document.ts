/**
 * `rewrapPlus.wrapDocument` — every wrappable region in the document,
 * applied as one atomic `WorkspaceEdit` (via `computeAndApplyWrap`) so a
 * single undo reverts everything.
 */
import * as vscode from 'vscode';
import { computeAndApplyWrap } from './apply-wrap.js';

export const WRAP_DOCUMENT_COMMAND = 'rewrapPlus.wrapDocument';

export function registerWrapDocumentCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(WRAP_DOCUMENT_COMMAND, wrapDocument));
}

async function wrapDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  await computeAndApplyWrap(editor.document, 'all');
}
