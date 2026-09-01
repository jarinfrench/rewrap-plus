/**
 * Small shared helpers for keeping tests independent of each other: one
 * VSCode instance runs the entire suite (`@vscode/test-electron` launches
 * it once for the whole run, not once per test file), so a setting
 * changed or an editor left open by one test would otherwise leak into
 * the next.
 */
import * as vscode from 'vscode';

export async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** Reset every `rewrapPlus.*` setting this suite touches back to its schema default. */
export async function resetRewrapPlusSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration('rewrapPlus');
  await config.update('columnLimit', undefined, vscode.ConfigurationTarget.Global);
  await config.update('enable', undefined, vscode.ConfigurationTarget.Global);
  await config.update('formatOnSave', undefined, vscode.ConfigurationTarget.Global);
  await config.update('wrapStrings', undefined, vscode.ConfigurationTarget.Global);
  await config.update('stringPolicy', undefined, vscode.ConfigurationTarget.Global);
  await config.update('stringWrapInclude', undefined, vscode.ConfigurationTarget.Global);
}

export async function openFixture(absolutePath: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(absolutePath);
  return vscode.window.showTextDocument(document);
}

/** Give a just-applied `WorkspaceEdit` a moment to land before reading `document.getText()` back. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * Extract the logical value of a `return "..." "..." ...;`-shaped
 * string-concatenation statement from `text`, by finding every quoted
 * literal between `return` and the statement's closing `;` and joining
 * their bodies with no separator — the "no separator" semantics both
 * C++'s bare adjacency and Java's `+` concatenation share (dissolving a
 * concatenation run never inserts a character of its own; see
 * `packages/engine/src/strings/dissolve-string.ts`'s own doc comment).
 *
 * Exists so an integration test can assert "wrapping never silently
 * drops a character at a split point" (most commonly the trailing space
 * right before where the line breaks) without hardcoding *where* the
 * wrap engine chooses to put that break. An earlier version of both
 * `cpp.test.ts` and `java.test.ts` asserted `text.includes('"Hello, "')`
 * directly — a specific claim about the exact reflow split point that
 * was never actually true even at the commit that introduced it (the
 * greedy reflow algorithm fits "there! Welcome to the application, we "
 * onto the same physical line as "Hello, ", so the two never appear as
 * separate quoted literals at all) — caught only once this suite was
 * actually run end-to-end against real engine output rather than a
 * hand-guessed expectation. Exact wrap-point placement already has
 * dedicated engine-level gold-fixture coverage (e.g.
 * `cpp-string-wrap-fixtures.test.ts`'s `002-existing-concat-rebalanced`
 * case) and doesn't need re-litigating at the integration-test layer,
 * which exists to prove real-host wiring, not reflow arithmetic.
 */
export function extractReturnedStringValue(text: string): string {
  const match = /return\s+((?:"[^"]*"\s*\+?\s*)+);/.exec(text);
  if (!match) {
    throw new Error(`extractReturnedStringValue: no return string-concatenation statement found in: ${text}`);
  }
  const literals = match[1]!.match(/"[^"]*"/g) ?? [];
  return literals.map((literal) => literal.slice(1, -1)).join('');
}
