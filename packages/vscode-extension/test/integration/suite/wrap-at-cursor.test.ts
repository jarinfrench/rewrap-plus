import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

describe('rewrapPlus.wrapAtCursor', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the comment the cursor sits inside, respecting rewrapPlus.columnLimit', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('long-comment.py'));
    editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    const lines = editor.document.getText().split('\n');
    const commentLines = lines.filter((line) => line.startsWith('#'));
    assert.ok(commentLines.length > 1, 'expected the comment to be split across multiple lines');
    for (const line of commentLines) {
      assert.ok(line.length <= 40, `line exceeds column limit: ${JSON.stringify(line)}`);
    }
  });

  it('does nothing when the cursor is outside any wrappable region', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('long-comment.py'));
    const originalText = editor.document.getText();
    // Line 1 is `x = 1` — no wrappable region there.
    editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 0));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    assert.strictEqual(editor.document.getText(), originalText);
  });

  it('does nothing when rewrapPlus.enable is false', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);
    await config.update('enable', false, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('long-comment.py'));
    const originalText = editor.document.getText();
    editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    assert.strictEqual(editor.document.getText(), originalText);
  });

  it('does not throw when invoked on a document in an unsupported language', async () => {
    const editor = await openFixture(fixturePath('plain.txt'));
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));

    // Regression test: this used to throw ParserManager's "no adapter
    // registered for language 'plaintext'" as an unhandled rejection —
    // see commands/apply-wrap.ts's computeWrapResult for the fix.
    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
  });
});
