/**
 * `rewrapPlus.wrapDocument`'s large-file path (`LARGE_DOCUMENT_LINE_THRESHOLD`,
 * `./wrap-document.ts`) is the one command that runs long enough for the
 * document to plausibly change while a wrap is still computing -- engine
 * cancellation now actually yields to the event loop mid-computation
 * (`packages/engine/test/hardening/cancellation.test.ts`), which is exactly
 * what makes that possible. This proves the corollary handled in
 * `../../src/commands/apply-wrap.ts` (`WrapOutcome.documentVersionChanged`):
 * a wrap computed against a stale snapshot of the document must never be
 * applied once the live document has moved on, since its edit positions no
 * longer describe what's actually there.
 */
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { closeAllEditors, resetRewrapPlusSettings, settle } from './helpers.js';

/**
 * Same unrealistically dense shape as
 * `packages/engine/test/hardening/large-file-performance.test.ts`'s own
 * generator -- every 10th line a long comment, every 10th (offset 5) a long
 * string, so a whole-document wrap has real work to do and isn't done
 * before the concurrent edit below has a chance to land. Measured directly
 * against the engine (`packages/engine/test/hardening/cancellation.test.ts`'s
 * own doc comment): parse + region discovery alone take under a second on a
 * file this size, and the full wrap takes several seconds -- the 1.5s delay
 * below sits well inside that window.
 */
function generateDenseFile(lineCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    if (i % 10 === 0) {
      lines.push(
        `# This is a fairly long comment line number ${i} that will likely need wrapping around`,
      );
    } else if (i % 10 === 5) {
      lines.push(
        `x_${i} = "a string value number ${i} that is reasonably long and might need wrapping too"`,
      );
    } else {
      lines.push(`y_${i} = ${i}`);
    }
  }
  return lines.join('\n') + '\n';
}

describe('rewrapPlus.wrapDocument concurrent-edit safety', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('discards a wrap computed before a concurrent edit landed, keeping the concurrent edit intact', async function () {
    this.timeout(30_000);

    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 60, vscode.ConfigurationTarget.Global);

    const originalContent = generateDenseFile(50_000);
    const document = await vscode.workspace.openTextDocument({
      language: 'python',
      content: originalContent,
    });
    const editor = await vscode.window.showTextDocument(document);

    // Fire-and-await-later: kick off the large-file wrap (which passes a
    // real cancellation token through `withProgress`, so the engine yields
    // periodically -- see `wrap-document.ts`), then edit the same document
    // ourselves while it's still computing.
    const wrapCommand = vscode.commands.executeCommand('rewrapPlus.wrapDocument');

    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const marker = '# CONCURRENT_EDIT_MARKER\n';
    const inserted = await editor.edit((editBuilder) =>
      editBuilder.insert(new vscode.Position(0, 0), marker),
    );
    assert.ok(inserted, 'the concurrent edit itself should apply successfully');

    await wrapCommand;
    await settle();

    const text = document.getText();
    assert.ok(
      text.startsWith(marker),
      'the concurrent edit should survive at the top of the document',
    );
    assert.strictEqual(
      text.slice(marker.length),
      originalContent,
      'the wrap computed before the concurrent edit must be discarded entirely, ' +
        'leaving the rest of the document exactly as the concurrent edit left it ' +
        '(still unwrapped) rather than applying stale, misaligned edit positions',
    );
  });
});
