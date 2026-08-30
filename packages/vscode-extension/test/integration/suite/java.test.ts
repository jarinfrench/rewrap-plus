import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { fixturePath } from './fixtures.js';
import {
  closeAllEditors,
  extractReturnedStringValue,
  openFixture,
  resetRewrapPlusSettings,
  settle,
} from './helpers.js';

/**
 * The real-host proof for Java — the same loop `./cpp.test.ts` closes for
 * C++: the engine-level gold fixtures already cover string/Javadoc
 * wrapping in detail (`packages/engine/test/wrap/java-*-fixtures.test.ts`),
 * but none of those go through the real VSCode extension host —
 * activation, `AdapterRegistry` wiring (`../../src/engine-host.ts`'s
 * `createRegistry`), command dispatch, and settings resolution all stay
 * untested by the engine suite alone.
 */
describe('rewrapPlus.wrapDocument on a Java file', () => {
  afterEach(async () => {
    await closeAllEditors();
    await resetRewrapPlusSettings();
  });

  it('wraps the Javadoc comment, the line comment, and the string concatenation', async () => {
    const config = vscode.workspace.getConfiguration('rewrapPlus');
    await config.update('columnLimit', 60, vscode.ConfigurationTarget.Global);

    const editor = await openFixture(fixturePath('Greeter.java'));
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
    assert.ok(text.includes('@param name'), 'the Javadoc @param tag should survive wrapping');
    assert.ok(text.includes('@return'), 'the Javadoc @return tag should survive wrapping');
    assert.strictEqual(
      extractReturnedStringValue(text),
      'Hello, there! Welcome to the application, we hope you enjoy your stay here today.',
      'no character (including a trailing space right at a concatenation split point) should be lost when the string is wrapped',
    );
  });
});
