/**
 * `rewrapPlus.wrapDocument` — every wrappable region in the document,
 * applied as one atomic `WorkspaceEdit` (via `computeAndApplyWrap`) so a
 * single undo reverts everything.
 */
import * as vscode from 'vscode';
import { computeAndApplyWrap } from './apply-wrap.js';

export const WRAP_DOCUMENT_COMMAND = 'rewrapPlus.wrapDocument';

/**
 * Line count above which `wrapDocument` shows a cancellable progress
 * notification instead of running silently, as a large-file guardrail.
 * `docs/benchmarks.md` has the measurements this is based
 * on: a realistic file at this size finishes in a small fraction of a
 * second (the cost that actually matters scales with how many *wrappable
 * regions* the file has, not its raw line count — see that doc's own
 * "deliberately unrealistic density" benchmark file), so the threshold is
 * chosen well below where cost becomes noticeable, trading one extra
 * `withProgress` wrapper on fast documents for headroom against the rare
 * but real large, wrap-region-dense file (a generated module, a
 * data-heavy script) where a multi-second silent freeze would otherwise
 * be the user's first signal anything was happening at all.
 */
export const LARGE_DOCUMENT_LINE_THRESHOLD = 2000;

export function registerWrapDocumentCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(WRAP_DOCUMENT_COMMAND, wrapDocument));
}

async function wrapDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const { document } = editor;

  if (document.lineCount < LARGE_DOCUMENT_LINE_THRESHOLD) {
    await computeAndApplyWrap(document, 'all');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Rewrap+: wrapping document',
      cancellable: true,
    },
    async (_progress, token) => {
      await computeAndApplyWrap(document, 'all', token);
    },
  );
}
