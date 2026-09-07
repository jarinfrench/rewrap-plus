/**
 * `rewrapPlus.formatOnSave`: wrap the whole document automatically
 * before every save, as its own independent opt-in rather than by
 * leaning on VSCode's native `editor.formatOnSave` +
 * `editor.defaultFormatter` composition (that path is still available --
 * see `./document-formatting-provider.ts` -- and is what "honor
 * `editor.formatOnSave` semantics" refers to).
 *
 * The two paths exist side by side because VSCode's own mechanism
 * requires the user to designate Rewrap+ as *the* default formatter for
 * a language before `editor.formatOnSave` will ever call it -- exactly
 * the kind of setup that puts Rewrap+ in conflict with Black/Prettier
 * for the same slot (see the interaction note in the README's
 * format-on-save section). `rewrapPlus.formatOnSave` needs none of
 * that: it fires from `onWillSaveTextDocument`, which runs regardless of
 * `editor.defaultFormatter`, so a user who already has Black configured
 * as their Python formatter can still opt into Rewrap+ wrapping
 * alongside it without touching that setting at all.
 *
 * `onWillSaveTextDocument` is also the only way to build a toggle that
 * is genuinely save-only: `DocumentFormattingEditProvider#
 * provideDocumentFormattingEdits` (`./document-formatting-provider.ts`)
 * fires identically for "Format Document" and for formatOnSave -- VSCode
 * gives the callback no way to tell those apart -- so gating *that*
 * provider on this setting would also silently disable the explicit
 * command for anyone who hasn't opted in.
 */
import * as vscode from 'vscode';
import { computeWrapResult, toVSCodeTextEdits } from './commands/apply-wrap.js';
import { describeError } from './describe-error.js';
import { getSupportedLanguages } from './engine-host.js';
import { readExtensionSettings } from './config/settings.js';
import { getOutputChannel } from './output-channel.js';

/**
 * Upper bound on how long a format-on-save wrap may run before the save
 * proceeds without it. `docs/benchmarks.md` measured a realistic
 * 2,000-line file (`wrap-document.ts`'s own large-file threshold) at "a
 * small fraction of a second," and even the benchmark's deliberately
 * adversarial 10,000-line/2,000-region case at 0.4s -- 1.5s leaves ample
 * margin above every realistic case that document measured, while still
 * keeping a genuinely pathological file (the same doc's 50,000-line case
 * ran 7.3s) from stalling a save for multiple seconds. "Never block or
 * delay a save" is the harder requirement here than "always wrap on
 * save" -- a save that proceeds unwrapped is a missed opportunity; a save
 * that visibly hangs is a bug report.
 */
const FORMAT_ON_SAVE_TIMEOUT_MS = 1500;

export function registerFormatOnSave(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      event.waitUntil(computeFormatOnSaveEdits(event.document));
    }),
  );
}

/**
 * Never throws and never hangs past `FORMAT_ON_SAVE_TIMEOUT_MS` -- both
 * matter because whatever this resolves to becomes the argument to
 * `event.waitUntil`, and the save is what's waiting on it. A parse
 * failure, an unexpected engine error, or a wrap that's still running
 * past the timeout all take the same path: log to the output channel
 * (non-blocking -- `reportWrapOutcome`'s own "skip region, warn, never
 * block" policy, extended to the whole-call level) and resolve to no
 * edits, exactly as if the document had nothing left to wrap.
 */
async function computeFormatOnSaveEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
  const settings = readExtensionSettings(document);
  if (!settings.formatOnSave) {
    return [];
  }

  const supportedLanguages = await getSupportedLanguages();
  if (!supportedLanguages.includes(document.languageId)) {
    return [];
  }

  const cancellationSource = new vscode.CancellationTokenSource();
  const timeout = setTimeout(() => cancellationSource.cancel(), FORMAT_ON_SAVE_TIMEOUT_MS);

  try {
    const outcome = await computeWrapResult(document, 'all', cancellationSource.token);
    if (!outcome || outcome.result.cancelled || outcome.documentVersionChanged) {
      return [];
    }
    return toVSCodeTextEdits(outcome.result.edits);
  } catch (error) {
    const message = describeError(error);
    getOutputChannel().appendLine(`${document.uri.fsPath}: format-on-save skipped -- wrap failed: ${message}`);
    return [];
  } finally {
    clearTimeout(timeout);
    cancellationSource.dispose();
  }
}
