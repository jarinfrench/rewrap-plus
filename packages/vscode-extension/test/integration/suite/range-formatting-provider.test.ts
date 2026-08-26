import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, resetRewrapPlusSettings } from './helpers.js';

describe('DocumentRangeFormattingEditProvider', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('is invoked for "Format Selection" over a range spanning multiple regions', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(fixturePath('two-comments.py'));
    await vscode.workspace.openTextDocument(uri);
    // Line 0 and line 2 are the fixture's two over-limit comments; the
    // range spans both, the same way wrap-selection.test.ts's own
    // "spans, not just the first" case does.
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(2, 10));

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
      'vscode.executeFormatRangeProvider',
      uri,
      range,
      { tabSize: 4, insertSpaces: true },
    );

    assert.ok(edits, 'expected the range-formatting provider to return edits');
    assert.ok(edits.length > 1, 'expected an edit for each of the two over-limit comments in range');
  });
});
