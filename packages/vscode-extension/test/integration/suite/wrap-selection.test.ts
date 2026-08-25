import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

describe('rewrapPlus.wrapSelection', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps every region a selection spans, not just the first', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('two-comments.py'));
    // Selection covers from inside the first comment (line 0) to inside
    // the second comment (line 2), spanning the `x = 1` line between them.
    editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(2, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapSelection');
    await settle();

    const overLong = editor.document
      .getText()
      .split('\n')
      .filter((line) => line.startsWith('#') && line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no comment line should exceed the column limit');
  });
});
