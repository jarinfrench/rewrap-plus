import * as assert from 'node:assert';
import * as vscode from 'vscode';

describe('extension activation', () => {
  it('activates without throwing and registers every wrap command', async () => {
    const ext = vscode.extensions.getExtension('jarinfrench.rewrap-plus');
    assert.ok(ext, 'extension should be discoverable by id');

    await ext.activate();
    assert.strictEqual(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    for (const id of ['rewrapPlus.wrapAtCursor', 'rewrapPlus.wrapSelection', 'rewrapPlus.wrapDocument']) {
      assert.ok(commands.includes(id), `expected command '${id}' to be registered`);
    }
  });
});
