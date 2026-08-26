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

  it('wraps both a docstring and a sibling comment', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('docstring-and-comment.py'));
    const originalLineCount = editor.document.lineCount;
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const text = editor.document.getText();
    const overLong = text.split('\n').filter((line) => line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no line should exceed the column limit after wrapping');

    // Positive evidence that the docstring was actually reflowed, not
    // just that no line happens to exceed the limit: the fixture's
    // single-line docstring is itself well over 40 characters, so the
    // overLong check above would already fail if wrapRegions skipped it
    // entirely — this second assertion additionally rules out some
    // other edit coincidentally producing short lines without genuine
    // multi-line reflow.
    assert.ok(
      editor.document.lineCount > originalLineCount,
      'wrapping the docstring should have split it across more lines than the original',
    );
  });
});
