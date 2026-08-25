/**
 * `DocumentRangeFormattingEditProvider` backed by the same wrap path as
 * `rewrapPlus.wrapSelection` (prior art: `farre/rewrapper` does the
 * same). This gives "Format Selection" integration for free, and VSCode
 * supplies the full document range automatically for "Format Document"
 * when a language has a range formatter but no whole-document
 * formatter registered — so this one provider covers both selection and
 * whole-document formatting without duplicated logic. The explicit
 * commands (`rewrapPlus.wrapAtCursor`, `.wrapSelection`, `.wrapDocument`)
 * stay registered too, for keybinding purposes VSCode's formatting
 * commands don't cover on their own.
 *
 * Unlike the commands, a formatting provider must *return* its edits
 * rather than apply them — the editor applies them itself as part of
 * its own formatting flow (including that flow's own undo grouping), so
 * this uses `computeWrapResult` (compute only) rather than
 * `computeAndApplyWrap`.
 */
import * as vscode from 'vscode';
import { getEngine } from './engine-host.js';
import { computeWrapResult, rangeTargetSpan, toVSCodeTextEdits } from './commands/apply-wrap.js';

export function createRangeFormattingProvider(): vscode.DocumentRangeFormattingEditProvider {
  return {
    async provideDocumentRangeFormattingEdits(
      document: vscode.TextDocument,
      range: vscode.Range,
    ): Promise<vscode.TextEdit[]> {
      const engine = await getEngine();
      const mapper = new engine.PositionMapper(document.getText());
      const target = rangeTargetSpan(mapper, document, range);

      const outcome = await computeWrapResult(document, [target]);
      if (!outcome) {
        return [];
      }
      return toVSCodeTextEdits(outcome.result.edits);
    },
  };
}
