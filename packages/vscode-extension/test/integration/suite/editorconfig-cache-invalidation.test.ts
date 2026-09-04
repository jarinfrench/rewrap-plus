/**
 * Real-host proof that `../../../src/config/editorconfig-cache-invalidation.ts`'s
 * on-save wiring actually reaches `../../../src/config/editorconfig.ts`'s
 * cache: saving a `.editorconfig` document in the editor must make the
 * very next wrap in the same directory observe the new
 * `max_line_length`, not the TTL-stale one. The cache's own hit/miss and
 * TTL bookkeeping is unit tested exhaustively in
 * `../../../src/config/editorconfig.test.ts`; this suite exists to prove
 * the real `onDidSaveTextDocument`-to-cache wiring, not to re-litigate
 * that logic (`./helpers.ts`'s own doc comment, on
 * `extractReturnedStringValue`, makes the same "this layer proves wiring,
 * not arithmetic" point about reflow placement).
 *
 * A real save must never land on a file tracked by this repo, so — same
 * as `./format-on-save.test.ts` — both the Python fixture and the
 * `.editorconfig` live in a fresh OS temp directory per test, cleaned up
 * after.
 *
 * The other invalidation trigger, the window regaining focus
 * (`handleWindowStateChange`), has no equivalent test here: there's no
 * API to make a headless `@vscode/test-electron` host produce a genuine
 * OS-level focus transition, and `vscode.window.state.focused` isn't
 * something a test can set directly. That trigger's dispatch logic is
 * covered by the same unit-test file instead, against the plain
 * `{focused: boolean}` shape `editorconfig-cache-invalidation.ts` passes
 * it — a known, deliberate gap, not an oversight.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { closeAllEditors, resetRewrapPlusSettings, settle } from './helpers.js';

function commentLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('#'));
}

describe('editorconfig cache invalidation (on save)', () => {
  let tempDir: string;
  let pythonFile: string;
  let editorConfigFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rewrap-plus-editorconfig-cache-'));
    pythonFile = path.join(tempDir, 'target.py');
    editorConfigFile = path.join(tempDir, '.editorconfig');

    // 30 short words — comfortably under 200 columns on one line, but
    // guaranteed to need several lines once the limit drops to 40.
    const longComment = `# ${Array.from({ length: 30 }, () => 'word').join(' ')}`;
    fs.writeFileSync(pythonFile, `${longComment}\n`);
    fs.writeFileSync(editorConfigFile, 'root = true\n\n[*]\nmax_line_length = 200\n');
  });

  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("picks up a saved .editorconfig's new max_line_length on the very next wrap, without restarting", async () => {
    // `rewrapPlus.columnLimit` deliberately left unset (`resetRewrapPlusSettings`'s
    // default) — the effective limit must come from tier 3
    // (`.editorconfig`), not tier 1, for this test to actually exercise
    // the path under test.
    const pythonDocument = await vscode.workspace.openTextDocument(pythonFile);
    const pythonEditor = await vscode.window.showTextDocument(pythonDocument);

    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();
    assert.strictEqual(
      commentLines(pythonEditor.document.getText()).length,
      1,
      'the 200-column .editorconfig limit should leave the comment on one line — this also warms the directory cache',
    );

    // Edit and save the .editorconfig in the editor — this is the real
    // `onDidSaveTextDocument` event `editorconfig-cache-invalidation.ts`
    // is wired to, not a raw `fs.writeFileSync`.
    const editorConfigDocument = await vscode.workspace.openTextDocument(editorConfigFile);
    const editorConfigEditor = await vscode.window.showTextDocument(editorConfigDocument);
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      editorConfigDocument.lineAt(editorConfigDocument.lineCount - 1).range.end,
    );
    await editorConfigEditor.edit((editBuilder) =>
      editBuilder.replace(fullRange, 'root = true\n\n[*]\nmax_line_length = 40\n'),
    );
    const saved = await editorConfigDocument.save();
    assert.ok(saved, 'expected .editorconfig save to report success');
    await settle();

    await vscode.window.showTextDocument(pythonDocument);
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const wrapped = commentLines(pythonDocument.getText());
    assert.ok(wrapped.length > 1, 'expected the comment to be re-wrapped under the new 40-column limit');
    for (const line of wrapped) {
      assert.ok(line.length <= 40, `line exceeds the updated column limit: ${JSON.stringify(line)}`);
    }
  });
});
