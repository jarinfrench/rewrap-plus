import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

describe('rewrapPlus.wrapDocument', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps every comment in the document as a single atomic edit — one undo reverts both regions', async () => {
    // Adversarial-audit finding #2: this test used to only check the
    // wrapped *result*, never the "single atomic edit" claim its own
    // title makes — the one thing that actually distinguishes "one
    // WorkspaceEdit" from "one edit per region" is what one `undo` does
    // afterward. `two-comments.py` has two independent comment regions
    // specifically so this exercises the multi-region case, not just the
    // single-region shape `auto-wrap.test.ts`'s own undo test already
    // covers.
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('two-comments.py'));
    const originalText = editor.document.getText();

    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const overLong = editor.document
      .getText()
      .split('\n')
      .filter((line) => line.startsWith('#') && line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no comment line should exceed the column limit');
    assert.notStrictEqual(
      editor.document.getText(),
      originalText,
      'the wrap should have changed the document — otherwise the undo assertion below would trivially pass',
    );

    await vscode.commands.executeCommand('undo');
    await settle();

    assert.strictEqual(
      editor.document.getText(),
      originalText,
      'one undo should revert both wrapped regions back to the original document — proof of the "single atomic edit" claim, not just an assertion of it',
    );
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
