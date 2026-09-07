/**
 * Non-blocking reporting for one `wrapRegions` call: every skipped
 * region with its reason to the output channel (including a region
 * skipped because it overlapped a parse error -- "skip region, warn,
 * never block" is the same mechanism as any other skip, not a separate
 * warning path), plus a status-bar summary. Called from
 * `computeWrapResult` (`./commands/apply-wrap.ts`) so every wrap
 * invocation is reported identically, whether it came from a command or
 * the range-formatting provider.
 */
import * as vscode from 'vscode';
import { getOutputChannel } from './output-channel.js';
import type { WrapOutcome } from './commands/apply-wrap.js';

const STATUS_BAR_MESSAGE_TIMEOUT_MS = 5000;

export function reportWrapOutcome(document: vscode.TextDocument, outcome: WrapOutcome): void {
  const { result, resolvedConfig } = outcome;
  const channel = getOutputChannel();

  channel.appendLine(
    `${document.uri.fsPath}: column limit ${resolvedConfig.columnLimit.value} ` +
      `(source: ${resolvedConfig.columnLimit.source})`,
  );

  for (const skipped of result.skipped) {
    // +1: region.span.startRow is 0-based; every editor-facing line
    // number in this extension should read the way VSCode's own status
    // bar and Problems panel do.
    const line = skipped.region.span.startRow + 1;
    channel.appendLine(`  skipped ${skipped.region.kind} at line ${line}: ${skipped.reason}`);
  }

  if (result.cancelled) {
    // No edits were applied for a cancelled result at all (`apply-wrap.ts`'s
    // own "single atomic edit" reasoning) -- the status bar message says
    // so explicitly rather than reporting the partial edit/skip counts
    // `wrapRegions` happened to accumulate before cancellation fired,
    // which would misleadingly read as a completed, if small, wrap.
    channel.appendLine('  cancelled before finishing -- no changes applied');
    vscode.window.setStatusBarMessage('Rewrap+: cancelled, no changes applied', STATUS_BAR_MESSAGE_TIMEOUT_MS);
    return;
  }

  if (outcome.documentVersionChanged) {
    // Checked ahead of the normal-path reporting below for the same reason
    // `cancelled` is: `result.edits` here describes a document that no
    // longer exists (see `WrapOutcome.documentVersionChanged`'s own doc
    // comment), so reporting it as a completed wrap would be actively
    // misleading, not just incomplete.
    channel.appendLine('  document changed while wrapping -- no changes applied');
    vscode.window.setStatusBarMessage(
      'Rewrap+: document changed during wrap, no changes applied',
      STATUS_BAR_MESSAGE_TIMEOUT_MS,
    );
    return;
  }

  const wrapped = result.edits.length;
  const skipped = result.skipped.length;
  vscode.window.setStatusBarMessage(
    `Rewrap+: ${wrapped} region${wrapped === 1 ? '' : 's'} wrapped, ` +
      `${skipped} skipped`,
    STATUS_BAR_MESSAGE_TIMEOUT_MS,
  );
}

/**
 * Reported by `computeAndApplyWrap` (`./commands/apply-wrap.ts`) when
 * `vscode.workspace.applyEdit` returns `false` for a non-empty edit --
 * VSCode's own signal that the edit didn't land (most commonly a
 * document that isn't editable at all: a `git show`/diff-view virtual
 * document, one backed by a read-only `TextDocumentContentProvider`, or
 * one that was closed mid-computation). `reportWrapOutcome` above has
 * already logged a "N wrapped" line and flashed a success-shaped status
 * bar message by the time this runs (it reports on the *computed*
 * result, before the apply attempt -- see `WrapOutcome`'s own doc
 * comment on why apply happens after), so this exists to make sure the
 * user's *last* signal is the true one: a status-bar message that
 * overwrites the premature success flash, an output-channel line
 * explaining why, and -- unlike every other outcome here -- a genuine
 * warning toast, since "the wrap you just ran silently did nothing" is
 * exactly the class of failure a transient status-bar message alone is
 * too easy to miss.
 */
export function reportWrapApplyFailure(document: vscode.TextDocument, editCount: number): void {
  const channel = getOutputChannel();
  channel.appendLine(
    `${document.uri.fsPath}: computed ${editCount} region${editCount === 1 ? '' : 's'} to wrap, but the edit ` +
      'could not be applied -- the document may be read-only or otherwise not editable. No changes were made.',
  );
  vscode.window.setStatusBarMessage(
    'Rewrap+: could not apply changes -- document is not editable',
    STATUS_BAR_MESSAGE_TIMEOUT_MS,
  );
  void vscode.window.showWarningMessage(
    `Rewrap+: could not apply changes to "${vscode.workspace.asRelativePath(document.uri, false)}" -- ` +
      'it may be read-only or otherwise not editable.',
  );
}
