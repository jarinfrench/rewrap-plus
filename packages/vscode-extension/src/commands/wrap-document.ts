/**
 * `rewrapPlus.wrapDocument` -- every wrappable region in the document,
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
 * regions* the file has, not its raw line count -- see that doc's own
 * "deliberately unrealistic density" benchmark file), so the threshold is
 * chosen well below where cost becomes noticeable, trading one extra
 * `withProgress` wrapper on fast documents for headroom against the rare
 * but real large, wrap-region-dense file (a generated module, a
 * data-heavy script) where a multi-second silent freeze would otherwise
 * be the user's first signal anything was happening at all.
 */
export const LARGE_DOCUMENT_LINE_THRESHOLD = 2000;

/**
 * Character-count companion to `LARGE_DOCUMENT_LINE_THRESHOLD` -- that
 * threshold alone misses a pathological *single-line* file (a minified
 * bundle, a generated data literal) entirely: a 500,000-character file
 * with no newlines has `lineCount === 1`, so it would skip the
 * cancellable-progress guardrail no matter how large it actually is,
 * exactly the case the guardrail exists to catch.
 *
 * `200_000` isn't a guess: measured directly (a one-off timing probe
 * against the real engine, in the same spirit as the LaTeX scaling check
 * `docs/benchmarks.md`'s own "Large files" section describes as "a
 * one-off scaling check, not committed as its own test") by wrapping a
 * single Python string-literal region of increasing size, greedy fill,
 * default config -- the same shape `docs/benchmarks.md` already
 * documents at the multi-region/multi-line scale:
 *
 * | Single-region size | Wrap time |
 * |---|---|
 * | ~44,000 characters | 33 ms |
 * | ~239,000 characters | 73 ms |
 * | ~489,000 characters | 134 ms |
 * | ~989,000 characters | 283 ms |
 *
 * Roughly linear, and nowhere near "hang" territory even at a million
 * characters -- a single long line is actually *cheaper* than an
 * equivalently-sized file split across many small wrappable regions,
 * since there's only ever one region's worth of discovery/dissolve/emit
 * overhead. `200_000` sits well below where any of this becomes
 * noticeable, matching this file's own existing line-count threshold's
 * "chosen well below where cost becomes noticeable" reasoning -- the goal
 * here is the same cheap insurance against the rare pathological file,
 * not a tuned-to-the-limit cutoff.
 */
export const LARGE_DOCUMENT_CHAR_THRESHOLD = 200_000;

export function registerWrapDocumentCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(WRAP_DOCUMENT_COMMAND, wrapDocument));
}

async function wrapDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const { document } = editor;

  const isLarge =
    document.lineCount >= LARGE_DOCUMENT_LINE_THRESHOLD ||
    document.getText().length >= LARGE_DOCUMENT_CHAR_THRESHOLD;

  if (!isLarge) {
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
