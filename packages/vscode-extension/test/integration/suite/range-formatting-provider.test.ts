import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, resetRewrapPlusSettings } from './helpers.js';

describe('DocumentRangeFormattingEditProvider', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('is invoked for "Format Document" as the fallback when no whole-document formatter is registered', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(fixturePath('two-comments.py'));
    await vscode.workspace.openTextDocument(uri);

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      'vscode.executeFormatDocumentProvider',
      uri,
      { tabSize: 4, insertSpaces: true },
    );

    assert.ok(edits, 'expected the range-formatting provider to return edits');
    assert.ok(edits.length > 0, 'expected at least one edit for a document with two over-limit comments');
  });
});
