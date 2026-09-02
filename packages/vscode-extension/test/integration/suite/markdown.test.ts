import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

/**
 * The real-host proof for Markdown — the same loop `./java.test.ts`/
 * `./cpp.test.ts` close for their own languages: the engine-level gold
 * fixtures already cover paragraph/prefix/hard-break/directive wrapping
 * in detail (`packages/engine/test/wrap/markdown-*-fixtures.test.ts`),
 * but none of those go through the real VSCode extension host —
 * activation, `AdapterRegistry` wiring (`../../src/engine-host.ts`'s
 * `createRegistry`), command dispatch, and settings resolution all stay
 * untested by the engine suite alone.
 *
 * Markdown is also the first language where "does nothing here" needs
 * its own real-host cases beyond the generic ones `wrap-at-cursor.test.ts`
 * already covers (outside any region, `rewrapPlus.enable: false`,
 * unsupported language) — a heading and a fenced code block are both
 * real Markdown constructs a cursor lands in constantly, and neither is
 * ever a `'prose'` region (§5.6), so `rewrapPlus.wrapAtCursor` there
 * should behave identically to "outside any region" even though, unlike
 * that generic case, there's a good deal of real Markdown structure
 * immediately surrounding the cursor.
 */
describe('rewrapPlus.wrapAtCursor on a Markdown file', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the paragraph the cursor sits inside, respecting rewrapPlus.columnLimit', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('README-style.md'));
    // Row 2: the introductory paragraph.
    editor.selection = new vscode.Selection(new vscode.Position(2, 5), new vscode.Position(2, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    const text = editor.document.getText();
    // Not a substring check against the original phrase — at this column
    // limit, reflow necessarily breaks the line somewhere *inside* it, so
    // asserting the whole phrase survives intact would be asserting
    // wrapping didn't happen. Compare word-for-word instead, ignoring
    // exactly where the line breaks landed.
    const originalWords = 'This is a fairly long paragraph of introductory prose'.split(' ');
    const wrappedWords = text.split(/\s+/).filter((w) => w.length > 0);
    for (const word of originalWords) {
      assert.ok(wrappedWords.includes(word), `expected word "${word}" to survive wrapping`);
    }
    const paragraphLines = text
      .split('\n')
      .slice(0, text.split('\n').findIndex((line) => line.startsWith('```')));
    for (const line of paragraphLines) {
      assert.ok(line.length <= 40, `line exceeds column limit: ${JSON.stringify(line)}`);
    }
  });

  it('does nothing when the cursor is on a heading', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('README-style.md'));
    const originalText = editor.document.getText();
    editor.selection = new vscode.Selection(new vscode.Position(0, 5), new vscode.Position(0, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    assert.strictEqual(editor.document.getText(), originalText);
  });

  it('does nothing when the cursor is inside a fenced code block', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('README-style.md'));
    const originalText = editor.document.getText();
    // Row 5: inside the fenced code block, deliberately a line longer
    // than the column limit that must stay untouched.
    editor.selection = new vscode.Selection(new vscode.Position(5, 10), new vscode.Position(5, 10));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    assert.strictEqual(editor.document.getText(), originalText);
  });

  it('does nothing when the cursor is inside a <!-- rewrap: off --> range', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('README-style.md'));
    const originalText = editor.document.getText();
    // Row 10: the paragraph between "<!-- rewrap: off -->" and
    // "<!-- rewrap: on -->".
    editor.selection = new vscode.Selection(new vscode.Position(10, 5), new vscode.Position(10, 5));

    await vscode.commands.executeCommand('rewrapPlus.wrapAtCursor');
    await settle();

    assert.strictEqual(editor.document.getText(), originalText);
  });
});
