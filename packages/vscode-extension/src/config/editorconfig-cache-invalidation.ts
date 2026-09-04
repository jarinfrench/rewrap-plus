/**
 * Wires `./editorconfig.ts`'s two invalidation triggers to real VSCode
 * events: saving a `.editorconfig` document, and the window regaining
 * focus. Kept separate from `editorconfig.ts` itself so that module can
 * stay `vscode`-free and unit-testable under plain `vitest` (its own
 * `vitest.config.mts` excludes anything that imports `vscode` — see that
 * config's own comment) — this file is thin glue only, not unit tested
 * directly, exercised by the @vscode/test-electron integration suite
 * instead (matches `../config/resolve-wrap-config.ts`'s own rationale for
 * the same split).
 */
import * as vscode from 'vscode';
import { handleEditorConfigSave, handleWindowStateChange } from './editorconfig.js';

export function registerEditorConfigCacheInvalidation(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => handleEditorConfigSave(document.uri)),
    vscode.window.onDidChangeWindowState(handleWindowStateChange),
  );
}
