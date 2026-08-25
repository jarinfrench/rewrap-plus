import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

describe('rewrapPlus.wrapDocument', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps every comment in the document as a single atomic edit', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('two-comments.py'));
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const overLong = editor.document
      .getText()
      .split('\n')
      .filter((line) => line.startsWith('#') && line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no comment line should exceed the column limit');
  });

  it('leaves a docstring untouched (not yet implemented) while still wrapping a sibling comment', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('docstring-and-comment.py'));
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const text = editor.document.getText();
    assert.ok(
      text.includes(
        '"""A module docstring that is going to be skipped since docstrings are not implemented yet in this phase."""',
      ),
      'docstring should be byte-identical — wrapRegions does not act on docstring regions yet',
    );
    const overLongComments = text
      .split('\n')
      .filter((line) => line.trim().startsWith('#') && line.length > 40);
    assert.strictEqual(overLongComments.length, 0, 'the sibling comment should still have been wrapped');
  });
});
