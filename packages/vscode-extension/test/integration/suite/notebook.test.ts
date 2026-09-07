import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openNotebookCell, resetRewrapPlusSettings, settle } from './helpers.js';

/**
 * `docs/known-gaps.md`'s "Notebook cell support is unverified" entry --
 * a Jupyter notebook code cell is itself a `vscode.TextDocument` with a
 * `languageId`, so every `rewrapPlus.*` command *should* route through it
 * exactly like an ordinary file, but that was only ever a plausible
 * assumption, never actually run against a real notebook editor. This
 * suite is that verification: if it passes, the assumption holds and the
 * gap closes as "confirmed working, not just plausible"; if it doesn't,
 * these failures are the reproduction case for whatever fix is needed.
 *
 * Each test opens its own dedicated `.ipynb` fixture rather than sharing
 * one across both -- `vscode.workspace.openNotebookDocument` returns the
 * same in-memory `NotebookDocument` for a URI that's already been opened
 * in this run, and unlike a plain `TextDocument`,
 * `workbench.action.closeAllEditors` (this suite's own `afterEach`)
 * closes the notebook *editor* tab without disposing that underlying
 * model -- confirmed directly: reusing one fixture across both tests left
 * the second test looking at the first test's already-wrapped cell text
 * (`version: 2`, no wrappable region left), not the fixture's original
 * content. Giving each test its own fixture file sidesteps the cache
 * rather than depending on it not mattering.
 */
describe('notebook cell support', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the comment the cursor sits inside via rewrapPlus.wrapAtCursor', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const { editor } = await openNotebookCell(fixturePath('notebook.ipynb'));
    assert.strictEqual(editor.document.languageId, 'python', 'sanity: the cell should be a Python document');
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

  it('wraps every region in the cell via rewrapPlus.wrapDocument', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const { editor } = await openNotebookCell(fixturePath('notebook-wrap-document.ipynb'));
    const originalText = editor.document.getText();

    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const text = editor.document.getText();
    assert.notStrictEqual(text, originalText, 'wrapping should have changed the cell');
    const overLong = text.split('\n').filter((line) => line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no line in the cell should exceed the column limit after wrapping');
  });
});
