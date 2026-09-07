import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

/**
 * Real-host proof that `rewrapPlus.stringWrapInclude` actually reaches
 * `wrapRegions` (via `resolveWrapConfigForDocument` folding it into
 * `WrapConfig.wrapStrings`) -- the glob-matching logic itself is unit
 * tested exhaustively in `../../../src/config/glob.test.ts`; this suite
 * exists to prove the real-`vscode.workspace.asRelativePath`-to-real-edit
 * wiring, not to re-litigate glob semantics (`./helpers.ts`'s own doc
 * comment, on `extractReturnedStringValue`, makes the same "this layer
 * proves wiring, not arithmetic" point about reflow placement -- it
 * applies just as much to glob-matching arithmetic here).
 *
 * This suite's extension host has no workspace folder open
 * (`../runTest.ts` passes none), so `asRelativePath` returns each
 * fixture's absolute, OS-separator path unchanged -- which is itself
 * exactly the "no workspace folder" case `string-wrap-include.ts`'s own
 * doc comment describes: the default `**` still matches (an unanchored
 * `.*`), and a no-separator pattern like the fixture's own basename still
 * matches at "any depth" against that absolute path, but a
 * directory-anchored pattern (containing `/`) cannot match anything real
 * here -- which is exactly why the "excluded" case below uses a pattern
 * that could never match *any* real path, rather than one that merely
 * doesn't happen to match this fixture.
 */
describe('rewrapPlus.stringWrapInclude', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  async function wrapWithStringsEnabled(stringWrapInclude?: readonly string[]): Promise<string> {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 40, vscode.ConfigurationTarget.Global);
    await config.update('wrapStrings', true, vscode.ConfigurationTarget.Global);
    await config.update('stringPolicy', 'all', vscode.ConfigurationTarget.Global);
    if (stringWrapInclude !== undefined) {
      await config.update('stringWrapInclude', stringWrapInclude, vscode.ConfigurationTarget.Global);
    }

    const editor = await openFixture(fixturePath('long-string.py'));
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();
    return editor.document.getText();
  }

  it('wraps a long string literal under the default ["**"] (matches every file)', async () => {
    const text = await wrapWithStringsEnabled();
    const overLong = text.split('\n').filter((line) => line.length > 40);
    assert.strictEqual(overLong.length, 0, 'the string literal should have been split across lines');
  });

  it('wraps a long string literal when a no-separator pattern matches the file at any depth', async () => {
    // No workspace folder is open in this suite (see the suite's own
    // doc comment), so the document's "relative path" is its absolute
    // path -- a pattern with no '/' still matches that at any depth,
    // proving the "any depth, including an absolute path with no
    // workspace root" fallback actually works end to end.
    const text = await wrapWithStringsEnabled(['long-string.py']);
    const overLong = text.split('\n').filter((line) => line.length > 40);
    assert.strictEqual(overLong.length, 0, 'a matching basename-only pattern should still enable string wrapping');
  });

  it('leaves a long string literal untouched when no pattern matches, even with wrapStrings/stringPolicy fully permissive', async () => {
    const text = await wrapWithStringsEnabled(['this-directory-does-not-exist/**']);
    assert.strictEqual(
      text,
      'x = "abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz abcdefghijklmnopqrstuvwxyz"\n',
      'the string literal should be byte-identical to the original fixture: excluded from scope entirely, not merely left short',
    );
  });
});
