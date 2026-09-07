/**
 * `rewrapPlus.showResolvedConfig` -- a telemetry-free diagnostic command:
 * dumps the effective column limit and which precedence tier it came
 * from, the active string/doc-dialect policy, whether the current
 * document's language is registered at all, and the extension's own
 * version, to the output channel. Exists specifically so a bug report
 * can include this instead of the reporter having to guess at (or the
 * maintainer having to ask for) what Rewrap+ actually resolved for their
 * file -- it makes bug reports actionable without telemetry.
 *
 * Deliberately not gated behind `rewrapPlusSupportedLanguages` the way
 * the wrap commands' keybindings are (`../extension.ts`): "why doesn't
 * this do anything in a `.foo` file" is itself a question this command
 * should be able to answer (`supported: false`), not a state it refuses
 * to run in.
 */
import * as vscode from 'vscode';
import { getSupportedLanguages } from '../engine-host.js';
import { resolveWrapConfigForDocument } from '../config/resolve-wrap-config.js';
import { getOutputChannel } from '../output-channel.js';

export const SHOW_RESOLVED_CONFIG_COMMAND = 'rewrapPlus.showResolvedConfig';

export function registerShowResolvedConfigCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_RESOLVED_CONFIG_COMMAND, () => showResolvedConfig(context)),
  );
}

async function showResolvedConfig(context: vscode.ExtensionContext): Promise<void> {
  const channel = getOutputChannel();
  const version = String(context.extension.packageJSON.version ?? 'unknown');

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    channel.appendLine(`Rewrap+ ${version}: rewrapPlus.showResolvedConfig -- no active editor.`);
    channel.show(true);
    return;
  }

  const { document } = editor;
  const resolved = resolveWrapConfigForDocument(document);
  const supportedLanguages = await getSupportedLanguages();
  const supported = supportedLanguages.includes(document.languageId);

  channel.appendLine('Rewrap+ resolved configuration');
  channel.appendLine(`  extension version: ${version}`);
  channel.appendLine(`  file: ${document.uri.fsPath}`);
  channel.appendLine(`  languageId: ${document.languageId} (supported: ${supported})`);
  channel.appendLine(`  rewrapPlus.enable: ${resolved.enable}`);
  channel.appendLine(
    `  columnLimit: ${resolved.columnLimit.value} (source: ${resolved.columnLimit.source})`,
  );
  channel.appendLine(`  wrapComments: ${resolved.wrapConfig.wrapComments}`);
  channel.appendLine(
    `  wrapStrings: ${resolved.wrapConfig.wrapStrings} (stringWrapInclude matched: ${resolved.stringWrapIncludeMatched})`,
  );
  channel.appendLine(`  stringPolicy: ${resolved.wrapConfig.stringPolicy}`);
  channel.appendLine(`  docDialect: ${resolved.wrapConfig.docDialect}`);
  channel.appendLine(`  preserveIndentedBlocks: ${resolved.wrapConfig.preserveIndentedBlocks}`);
  channel.appendLine(`  balancedWrapping: ${resolved.wrapConfig.balancedWrapping}`);
  channel.appendLine(`  tabSize: ${resolved.wrapConfig.tabSize}`);
  channel.show(true);
}
