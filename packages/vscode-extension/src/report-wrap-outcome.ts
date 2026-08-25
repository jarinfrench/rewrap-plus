/**
 * Non-blocking reporting for one `wrapRegions` call: every skipped
 * region with its reason to the output channel (including a region
 * skipped because it overlapped a parse error — "skip region, warn,
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

  const wrapped = result.edits.length;
  const skipped = result.skipped.length;
  vscode.window.setStatusBarMessage(
    `Rewrap+: ${wrapped} region${wrapped === 1 ? '' : 's'} wrapped, ` +
      `${skipped} skipped`,
    STATUS_BAR_MESSAGE_TIMEOUT_MS,
  );
}
