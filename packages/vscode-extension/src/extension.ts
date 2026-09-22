/**
 * Rewrap+ VSCode extension entry point.
 *
 * Wires up real activation: warm the engine host (`./engine-host.ts`),
 * register commands and the range-formatting provider, and set the
 * `rewrapPlusSupportedLanguages` context key every command/keybinding
 * `when` clause gates on.
 *
 * `package.json`'s `activationEvents` includes `onStartupFinished`
 * specifically because of that last part: a keybinding's `when` clause
 * is evaluated against whatever context keys already exist, and doesn't
 * itself trigger activation the way invoking a command by ID does. Before
 * this module has run once, `rewrapPlusSupportedLanguages` doesn't exist
 * yet, so `editorLangId in rewrapPlusSupportedLanguages` reads as false
 * and the keybinding never matches -- meaning VSCode never sees a reason
 * to activate the extension, and the default `Alt+Q` binding goes
 * permanently dead in a fresh window until *some* Rewrap+ command is run
 * once via the Command Palette (which isn't gated the same way) to break
 * the deadlock. `onStartupFinished` closes that gap by activating shortly
 * after startup regardless, before a user has a chance to hit the
 * keybinding first.
 */
import * as vscode from 'vscode';
import { getSupportedLanguages, initEngineHost } from './engine-host.js';
import { registerWrapAtCursorCommand } from './commands/wrap-at-cursor.js';
import { registerWrapSelectionCommand } from './commands/wrap-selection.js';
import { registerWrapDocumentCommand } from './commands/wrap-document.js';
import { registerShowResolvedConfigCommand } from './commands/show-resolved-config.js';
import { createRangeFormattingProvider } from './range-formatting-provider.js';
import { createDocumentFormattingProvider } from './document-formatting-provider.js';
import { registerFormatOnSave } from './format-on-save.js';
import { registerAutoWrap } from './auto-wrap.js';
import { registerEditorConfigCacheInvalidation } from './config/editorconfig-cache-invalidation.js';
import { getOutputChannel } from './output-channel.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Must happen before anything below resolves a `ParserManager` -- see
  // `initEngineHost`'s own doc comment for why grammar WASM resolution
  // depends on the extension's real installed location, not on
  // `@rewrap-plus/engine` being resolvable as a package (it isn't, once
  // bundled).
  initEngineHost(context.extensionUri.fsPath);

  context.subscriptions.push(getOutputChannel());

  const languages = await getSupportedLanguages();

  // `"editorLangId in rewrapPlusSupportedLanguages"` (package.json's
  // command/keybinding `when` clauses) is VSCode's native
  // array-membership `when`-clause syntax -- set once, here, to the real
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
  registerFormatOnSave(context);
  registerAutoWrap(context);
  registerEditorConfigCacheInvalidation(context);

  const selector: vscode.DocumentSelector = languages.map((language) => ({ language }));
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      createRangeFormattingProvider(),
    ),
    vscode.languages.registerDocumentFormattingEditProvider(selector, createDocumentFormattingProvider()),
  );
}

export function deactivate(): void {}
