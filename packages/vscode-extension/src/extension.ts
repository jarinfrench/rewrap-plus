/**
 * Rewrap+ VSCode extension entry point.
 *
 * Phase 0 left this empty. Phase 7 wires up real activation: warm the
 * engine host (`./engine-host.ts`), register commands and the
 * range-formatting provider, and set the `rewrapPlusSupportedLanguages`
 * context key every command/keybinding `when` clause gates on.
 */
import * as vscode from 'vscode';
import { getSupportedLanguages } from './engine-host.js';
import { registerWrapAtCursorCommand } from './commands/wrap-at-cursor.js';
import { registerWrapSelectionCommand } from './commands/wrap-selection.js';
import { registerWrapDocumentCommand } from './commands/wrap-document.js';
import { registerShowResolvedConfigCommand } from './commands/show-resolved-config.js';
import { createRangeFormattingProvider } from './range-formatting-provider.js';
import { getOutputChannel } from './output-channel.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(getOutputChannel());

  const languages = await getSupportedLanguages();

  // `"editorLangId in rewrapPlusSupportedLanguages"` (package.json's
  // command/keybinding `when` clauses) is VSCode's native
  // array-membership `when`-clause syntax — set once, here, to the real
  // registered-language list rather than a hardcoded
  // `"editorLangId == python"`, so a future language addition (Phase
  // 12b) needs no change to this file or to any `when` clause: the
  // plan's own "adding a language touches no extension code, only the
  // registry" promise, extended to command visibility.
  await vscode.commands.executeCommand('setContext', 'rewrapPlusSupportedLanguages', languages);

  registerWrapAtCursorCommand(context);
  registerWrapSelectionCommand(context);
  registerWrapDocumentCommand(context);
  registerShowResolvedConfigCommand(context);

  const selector: vscode.DocumentSelector = languages.map((language) => ({ language }));
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      createRangeFormattingProvider(),
    ),
  );
}

export function deactivate(): void {}
