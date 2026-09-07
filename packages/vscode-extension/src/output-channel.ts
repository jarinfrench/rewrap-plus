/**
 * The extension's single `OutputChannel`, lazily created and cached like
 * `engine-host.ts`'s registry/`ParserManager` -- cheap to call repeatedly,
 * created at most once per extension host process.
 */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  const existing = channel;
  if (existing) {
    return existing;
  }
  const created = vscode.window.createOutputChannel('Rewrap+');
  channel = created;
  return created;
}
