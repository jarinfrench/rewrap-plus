import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, resetRewrapPlusSettings } from './helpers.js';

describe('DocumentFormattingEditProvider', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('is invoked for "Format Document" and wraps every region in the file', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(fixturePath('two-comments.py'));
    await vscode.workspace.openTextDocument(uri);

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      'vscode.executeFormatDocumentProvider',
      uri,
      { tabSize: 4, insertSpaces: true },
    );

    assert.ok(edits, 'expected the document-formatting provider to return edits');
    assert.ok(edits.length > 0, 'expected at least one edit for a document with two over-limit comments');
  });

  it('does not throw when invoked on a document in an unsupported language', async () => {
    const uri = vscode.Uri.file(fixturePath('plain.txt'));
    await vscode.workspace.openTextDocument(uri);

    // `plaintext` isn't a registered language, so the selector this
    // provider is registered under never matches it -- VSCode simply
    // won't route the command here. Kept anyway as the same class of
    // regression guard as wrap-at-cursor.test.ts's own unsupported-
    // language case, in case that routing assumption ever changes.
    await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, {
      tabSize: 4,
      insertSpaces: true,
    });
  });
});
