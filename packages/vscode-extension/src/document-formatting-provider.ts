/**
 * `DocumentFormattingEditProvider` (whole-document, as opposed to
 * `./range-formatting-provider.ts`'s range provider) backed by the same
 * wrap path as `rewrapPlus.wrapDocument` — this is what lets Rewrap+
 * register as a `DocumentFormattingEditProvider` so it composes with
 * other formatters rather than fighting them, and honors
 * `editor.formatOnSave` semantics.
 *
 * Before this existed, "Format Document" already worked via
 * `./range-formatting-provider.ts` (VSCode falls back to a language's
 * range formatter, given the full document range, when no whole-document
 * formatter is registered — see that file's own test). Registering a
 * real one here isn't about making "Format Document" work for the first
 * time; it's what lets a user opt Rewrap+ into VSCode's *native*
 * `editor.formatOnSave` + `editor.defaultFormatter` composition model
 * (setting `"[python]": { "editor.defaultFormatter": "jarinfrench.rewrap-plus" }`
 * and `"editor.formatOnSave": true`), which only considers a language's
 * registered whole-document formatters, not the range-formatter fallback.
 *
 * This provider is unconditional — like `wrapDocument` and the range
 * provider, it always wraps when invoked. It does **not** consult
 * `rewrapPlus.formatOnSave` (`./format-on-save.ts` owns that setting):
 * VSCode's `DocumentFormattingEditProvider` callback carries no signal
 * distinguishing "invoked via Format Document" from "invoked via
 * formatOnSave", so gating here would also silently break the explicit
 * command for anyone who hasn't opted into `rewrapPlus.formatOnSave`.
 * `rewrapPlus.formatOnSave`'s own automatic-on-save behavior is
 * implemented separately, via `onWillSaveTextDocument`, which *does*
 * fire only on save.
 */
import * as vscode from 'vscode';
import { computeWrapResult, toVSCodeTextEdits } from './commands/apply-wrap.js';

export function createDocumentFormattingProvider(): vscode.DocumentFormattingEditProvider {
  return {
    async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
      const outcome = await computeWrapResult(document, 'all');
      if (!outcome || outcome.result.cancelled) {
        return [];
      }
      return toVSCodeTextEdits(outcome.result.edits);
    },
  };
}
