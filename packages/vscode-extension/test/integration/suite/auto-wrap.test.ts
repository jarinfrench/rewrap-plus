/**
 * `rewrapPlus.autoWrap.*` / `rewrapPlus.toggleAutoWrap` -- the one suite
 * in this package that can't be driven by applying a `WorkspaceEdit` and
 * checking the result, the way every other command test here does: the
 * whole point of auto-wrap is that it reacts to the document's own live
 * edit stream, so these tests drive real keystroke-shaped commands
 * (`type`, `compositionStart`/`compositionType`/`compositionEnd`) and
 * inspect the result, the same way `../../../../docs/planning/`'s
 * (untracked, now folded into `implementation-plan.md`'s Phase 12g)
 * pre-implementation spike did.
 *
 * `type`/`compositionType` act on `vscode.window.activeTextEditor`, not
 * on a specific `TextEditor` object passed in -- every test here calls
 * `vscode.window.showTextDocument` (via `openScratchDocument`)
 * immediately before typing into a given editor, rather than assuming an
 * earlier `showTextDocument` call is still the active one.
 */
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { closeAllEditors, openScratchDocument, resetRewrapPlusSettings, settle } from './helpers.js';

function commentLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('#'));
}

describe('rewrapPlus.autoWrap', () => {
  before(async () => {
    // Auto-wrap has no command of its own that VSCode's implicit
    // per-command activation would fire on just from opening a document
    // and typing into it (unlike every other suite here, which invokes a
    // `rewrapPlus.*` command directly) -- its `onDidChangeTextDocument`
    // listener only exists once `activate()` has actually run, so it
    // needs to be forced explicitly rather than relying on activation
    // having already happened as a side effect of test file ordering.
    await vscode.extensions.getExtension('jarinfrench.rewrap-plus')?.activate();
  });

  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the comment the cursor is in when a space keystroke crosses the column limit, and one undo removes the wrap', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    await config.update('autoWrap.enabled', true, vscode.ConfigurationTarget.Global);

    // 21 characters -- already past the 20-column limit before the
    // triggering keystroke, same as a real line would be the instant
    // before the keystroke that pushes it over.
    const editor = await openScratchDocument('# aaaa bbbb cccc dddd', 'python');
    const endOfLine = editor.document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(endOfLine, endOfLine);

    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();

    const wrapped = commentLines(editor.document.getText());
    assert.ok(wrapped.length > 1, 'expected auto-wrap to split the comment across multiple lines');
    for (const line of wrapped) {
      assert.ok(line.length <= 20, `line exceeds column limit: ${JSON.stringify(line)}`);
    }

    // The scratch document's initial content isn't itself an undoable
    // edit (there's nothing before it to undo to) -- the triggering space
    // plus the auto-wrap coalesced onto it is the only entry on the undo
    // stack, so one undo should revert all the way back to the original
    // single-line text.
    await vscode.commands.executeCommand('undo');
    await settle();
    assert.strictEqual(
      commentLines(editor.document.getText()).length,
      1,
      'one undo should remove the auto-wrap along with the triggering keystroke',
    );
  });

  it('does nothing when rewrapPlus.autoWrap.enabled is off (the default)', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    // autoWrap.enabled left at its schema default (false).

    const editor = await openScratchDocument('# aaaa bbbb cccc dddd', 'python');
    const endOfLine = editor.document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(endOfLine, endOfLine);

    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();

    assert.strictEqual(commentLines(editor.document.getText()).length, 1, 'auto-wrap should not fire while disabled');
  });

  it('does nothing when rewrapPlus.enable (the global kill switch) is off, even with autoWrap.enabled on', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    await config.update('autoWrap.enabled', true, vscode.ConfigurationTarget.Global);
    await config.update('enable', false, vscode.ConfigurationTarget.Global);

    const editor = await openScratchDocument('# aaaa bbbb cccc dddd', 'python');
    const endOfLine = editor.document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(endOfLine, endOfLine);

    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();

    assert.strictEqual(
      commentLines(editor.document.getText()).length,
      1,
      'the global kill switch should override autoWrap.enabled',
    );
  });

  it('does not trigger on a multi-character insert (e.g. a paste), only a single typed space or Enter', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    await config.update('autoWrap.enabled', true, vscode.ConfigurationTarget.Global);

    const editor = await openScratchDocument('# aaaa bbbb cccc', 'python');
    const endOfLine = editor.document.lineAt(0).range.end;
    // A single edit inserting several characters at once -- the same
    // change-event shape a paste produces, deliberately not routed
    // through the `type` command.
    await editor.edit((editBuilder) => editBuilder.insert(endOfLine, ' dddd'));
    await settle();

    assert.strictEqual(
      commentLines(editor.document.getText()).length,
      1,
      'a multi-character insert should not trigger auto-wrap even though the line is now past the limit',
    );
  });

  it('does not trigger on IME composition, even once the composed text is well past the column limit', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 10, vscode.ConfigurationTarget.Global);
    await config.update('autoWrap.enabled', true, vscode.ConfigurationTarget.Global);

    const editor = await openScratchDocument('# ', 'python');
    const endOfLine = editor.document.lineAt(0).range.end;
    editor.selection = new vscode.Selection(endOfLine, endOfLine);

    // The exact command shape verified against a real Extension
    // Development Host during the pre-implementation spike: `compositionType`'s
    // `replacePrevCharCnt` is what produces genuine replace-in-place
    // composition events, not the final committed text arriving as a
    // single space/newline-shaped change.
    await vscode.commands.executeCommand('compositionStart');
    await vscode.commands.executeCommand('compositionType', {
      text: 'ありがとうございます',
      replacePrevCharCnt: 0,
      replaceNextCharCnt: 0,
      positionDelta: 0,
    });
    await settle();
    await vscode.commands.executeCommand('compositionEnd');
    await settle();

    assert.strictEqual(
      commentLines(editor.document.getText()).length,
      1,
      'IME composition should never trigger auto-wrap, regardless of the composed text length',
    );
  });

  it('rewrapPlus.toggleAutoWrap flips behavior for only the active document', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    // autoWrap.enabled left off globally -- editorA's override is the only
    // thing that should turn it on anywhere.

    const editorA = await openScratchDocument('# aaaa bbbb cccc dddd', 'python');
    await vscode.commands.executeCommand('rewrapPlus.toggleAutoWrap');

    const editorB = await openScratchDocument('# aaaa bbbb cccc dddd', 'python');
    const endOfLineB = editorB.document.lineAt(0).range.end;
    editorB.selection = new vscode.Selection(endOfLineB, endOfLineB);
    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();
    assert.strictEqual(
      commentLines(editorB.document.getText()).length,
      1,
      'a document with no override should stay off while the global setting is off',
    );

    const editorAAgain = await vscode.window.showTextDocument(editorA.document);
    const endOfLineA = editorAAgain.document.lineAt(0).range.end;
    editorAAgain.selection = new vscode.Selection(endOfLineA, endOfLineA);
    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();
    assert.ok(
      commentLines(editorAAgain.document.getText()).length > 1,
      "the toggled document should stay on even though the global setting is off",
    );
  });

  it('never wraps a string literal, even with rewrapPlus.wrapStrings and stringPolicy fully permissive', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 20, vscode.ConfigurationTarget.Global);
    await config.update('autoWrap.enabled', true, vscode.ConfigurationTarget.Global);
    await config.update('wrapStrings', true, vscode.ConfigurationTarget.Global);
    await config.update('stringPolicy', 'all', vscode.ConfigurationTarget.Global);

    const editor = await openScratchDocument('x = "aaaa bbbb cccc dddd"', 'python');
    // Cursor placed just before the closing quote -- inside the string
    // literal, past the column limit.
    const insidePosition = new vscode.Position(0, editor.document.lineAt(0).text.length - 1);
    editor.selection = new vscode.Selection(insidePosition, insidePosition);

    await vscode.commands.executeCommand('type', { text: ' ' });
    await settle();

    const lines = editor.document.getText().split('\n');
    assert.strictEqual(lines.length, 1, 'auto-wrap must never split a string literal, comment/docstring-only for v1');
  });
});
