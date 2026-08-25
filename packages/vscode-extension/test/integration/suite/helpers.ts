/**
 * Small shared helpers for keeping tests independent of each other: one
 * VSCode instance runs the entire suite (`@vscode/test-electron` launches
 * it once for the whole run, not once per test file), so a setting
 * changed or an editor left open by one test would otherwise leak into
 * the next.
 */
import * as vscode from 'vscode';

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Reset every `rewrapPlus.*` setting this suite touches back to its schema default. */
export async function resetRewrapPlusSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('rewrapPlus');
  await config.update('columnLimit', undefined, vscode.ConfigurationTarget.Global);
  await config.update('enable', undefined, vscode.ConfigurationTarget.Global);
}

export async function openFixture(absolutePath: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(absolutePath);
  return vscode.window.showTextDocument(document);
}

/** Give a just-applied `WorkspaceEdit` a moment to land before reading `document.getText()` back. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}
