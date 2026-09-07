import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, openScratchDocument, resetRewrapPlusSettings, settle } from './helpers.js';

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

  it('reports a failure — not a false "N wrapped" success — when applyEdit returns false', async () => {
    // Adversarial-audit finding #1: `computeAndApplyWrap` used to discard
    // `vscode.workspace.applyEdit`'s return value, so any document VSCode
    // declines to edit — `applyEdit`'s own documented contract is a
    // `Thenable<boolean>` precisely because it *can* fail — left the user
    // with only `reportWrapOutcome`'s already-emitted "N wrapped" message:
    // true of the *computed* result, false of what actually happened.
    //
    // Getting a *real* document into a state where VSCode's own
    // `applyEdit` naturally returns `false` turned out to be its own
    // finding: neither a `FileSystemProvider` registered with `isReadonly:
    // true` (per microsoft/vscode#57032's description of this exact
    // shape) plus explicit `FilePermission.Readonly` on its `stat()`, nor
    // `workbench.action.files.setActiveEditorReadonlyInSession`, nor
    // closing every editor on a document mid-wrap (`document.isClosed ===
    // true`) actually made `applyEdit` refuse the edit in this project's
    // pinned `@vscode/test-electron` version (1.134-1.136) — confirmed by
    // direct probe in each case, the edit went through regardless. Whatever
    // VSCode's own real refusal conditions are in this version, none of
    // this project's own document-state levers reach them, so this test
    // exercises the code under audit directly instead: `applyEdit` is
    // stubbed to return `false` (its own documented, real possible
    // outcome, whatever triggers it in practice), isolating exactly the
    // "what does `computeAndApplyWrap` do when told the edit failed"
    // question finding #1 is actually about, rather than depending on
    // VSCode-version-specific internals this project doesn't control.
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);

    const warnings: string[] = [];
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalApplyEdit = vscode.workspace.applyEdit;
    // Standard extension-test spying/stubbing technique: `vscode.window`/
    // `vscode.workspace`'s exported functions are plain, writable object
    // properties in the real extension host, not locked-down accessors —
    // both swapped back in `finally` below regardless of assertion outcome.
    (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage = ((
      message: string,
    ) => {
      warnings.push(message);
      return Promise.resolve(undefined);
    }) as typeof vscode.window.showWarningMessage;
    (vscode.workspace as { applyEdit: typeof vscode.workspace.applyEdit }).applyEdit = (() =>
      Promise.resolve(false)) as typeof vscode.workspace.applyEdit;

    try {
      const longComment = `# ${Array.from({ length: 30 }, () => 'word').join(' ')}`;
      const originalContent = `${longComment}\n`;
      const editor = await openScratchDocument(originalContent, 'python');

      await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
      await settle();

      assert.strictEqual(
        editor.document.getText(),
        originalContent,
        'the document must be left untouched when applyEdit reports failure',
      );
      assert.ok(
        warnings.some((message) => /could not apply changes/i.test(message)),
        `expected a warning toast about the failed apply, got: ${JSON.stringify(warnings)}`,
      );
    } finally {
      (vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage }).showWarningMessage =
        originalShowWarningMessage;
      (vscode.workspace as { applyEdit: typeof vscode.workspace.applyEdit }).applyEdit = originalApplyEdit;
    }
  });

  it('shows the cancellable large-document guardrail for one pathologically long line, not just a high line count', async () => {
    // Adversarial-audit finding #4: `LARGE_DOCUMENT_LINE_THRESHOLD` alone
    // missed this shape entirely — a single 500,000-character line
    // (minified/generated content) has `lineCount === 1` regardless of
    // how many characters it holds, so it used to skip the
    // cancellable-progress guardrail no matter how large it actually
    // was. This document is two lines total (one huge line plus the
    // trailing-newline's own empty final line) — proof the character
    // count, not the line count, is what triggers the guardrail here.
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 60, vscode.ConfigurationTarget.Global);

    let withProgressCalled = false;
    const originalWithProgress = vscode.window.withProgress;
    (vscode.window as { withProgress: typeof vscode.window.withProgress }).withProgress = ((
      options: vscode.ProgressOptions,
      task: Parameters<typeof vscode.window.withProgress>[1],
    ) => {
      withProgressCalled = true;
      return originalWithProgress.call(vscode.window, options, task);
    }) as typeof vscode.window.withProgress;

    try {
      // ~440,000 characters, comfortably over LARGE_DOCUMENT_CHAR_THRESHOLD
      // (200,000) — see that constant's own doc comment in
      // ../../src/commands/wrap-document.ts for where 200,000 came from.
      const words = Array.from({ length: 45_000 }, (_, i) => `word${i}`).join(' ');
      const editor = await openScratchDocument(`# ${words}\n`, 'python');
      assert.strictEqual(
        editor.document.lineCount,
        2,
        'sanity: still a tiny line count despite the huge character count',
      );
      assert.ok(editor.document.getText().length > 200_000, 'sanity: comfortably over the character threshold');

      await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
      await settle();

      assert.ok(
        withProgressCalled,
        'expected the cancellable progress guardrail to trigger for a pathologically long single line',
      );
    } finally {
      (vscode.window as { withProgress: typeof vscode.window.withProgress }).withProgress = originalWithProgress;
    }
  });
});
