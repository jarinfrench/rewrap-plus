import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import { closeAllEditors, openFixture, resetRewrapPlusSettings, settle } from './helpers.js';

/**
 * The real-host proof for TypeScript: the engine-level gold fixtures
 * already cover string/JSDoc wrapping in detail
 * (`packages/engine/test/wrap/typescript-*-fixtures.test.ts`), but none
 * of those go through the real VSCode extension host — activation,
 * `AdapterRegistry` wiring (`../../src/engine-host.ts`'s `createRegistry`),
 * command dispatch, and settings resolution all stay untested by the
 * engine suite alone. This closes that loop for TypeScript the same way
 * `./wrap-document.test.ts` already does for Python.
 */
describe('rewrapPlus.wrapDocument on a TypeScript file', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the JSDoc comment, the line comment, and the string concatenation', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 60, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('greet.ts'));
    const originalLineCount = editor.document.lineCount;
    await vscode.commands.executeCommand('rewrapPlus.wrapDocument');
    await settle();

    const text = editor.document.getText();
    const overLong = text.split('\n').filter((line) => line.length > 60);
    assert.strictEqual(overLong.length, 0, 'no line should exceed the column limit after wrapping');

    assert.ok(
      editor.document.lineCount > originalLineCount,
      'wrapping should have split the doc comment and/or string across more lines',
    );
    assert.ok(text.includes('@param name'), 'the JSDoc @param tag should survive wrapping');
    assert.ok(text.includes('@returns'), 'the JSDoc @returns tag should survive wrapping');
    assert.ok(text.includes('"Hello, "'), 'the trailing space before "Hello, " must be preserved');
  });
});
