/**
 * `rewrapPlus.formatOnSave` is exercised against a real save (`document
 * .save()`), not just an applied `WorkspaceEdit` like the other command
 * suites — the whole point is that it fires from `onWillSaveTextDocument`.
 * That means the fixture has to be a real file `save()` can write to, so
 * unlike every other suite here (which opens a checked-in fixture
 * directly from `test/integration/fixtures/`), this one copies
 * `long-comment.py` into a fresh OS temp directory per test and cleans
 * up after — a real save must never land on a file tracked by this repo.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, resetRewrapPlusSettings, settle } from './helpers.js';

describe('rewrapPlus.formatOnSave', () => {
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewrap-plus-format-on-save-'));
    tempFile = path.join(tempDir, 'long-comment.py');
    fs.copyFileSync(fixturePath('long-comment.py'), tempFile);
  });

  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('wraps the document on save when enabled', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);
    await config.update('formatOnSave', true, vscode.ConfigurationTarget.Global);

    const document = await vscode.workspace.openTextDocument(tempFile);
    const editor = await vscode.window.showTextDocument(document);
    // Real edit so the document is actually dirty — document.save() is a
    // no-op (and never fires onWillSaveTextDocument) on a clean document.
    // Appending a trailing newline at the very end leaves every existing
    // line's content and index untouched.
    await dirtyWithTrailingNewline(editor, document);

    const saved = await document.save();
    await settle();

    assert.ok(saved, 'expected document.save() to report success');
    const overLong = document
      .getText()
      .split('\n')
      .filter((line) => line.startsWith('#') && line.length > 40);
    assert.strictEqual(overLong.length, 0, 'no comment line should exceed the column limit after save');

    // Positive evidence the on-disk file (not just the in-memory buffer)
    // ended up wrapped, since format-on-save's whole purpose is what
    // lands on disk.
    const onDisk = fs.readFileSync(tempFile, 'utf8');
    assert.ok(
      onDisk.split(/\r?\n/).every((line) => !line.startsWith('#') || line.length <= 40),
      'the saved file on disk should have the wrapped comment, not the original long one',
    );
  });

  it('leaves the document untouched on save when disabled (the default)', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const document = await vscode.workspace.openTextDocument(tempFile);
    const editor = await vscode.window.showTextDocument(document);
    await dirtyWithTrailingNewline(editor, document);

    const originalOverLongLine = document.lineAt(0).text;
    await document.save();
    await settle();

    assert.strictEqual(document.lineAt(0).text, originalOverLongLine, 'the long comment should be untouched');
  });
});

function dirtyWithTrailingNewline(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
): Thenable<boolean> {
  const lastLine = document.lineAt(document.lineCount - 1);
  return editor.edit((editBuilder) => editBuilder.insert(lastLine.range.end, '\n'));
}
