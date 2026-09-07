/**
 * Thin `vscode`-facing wrapper around `./column-limit.ts`'s pure
 * resolver: extracts the raw configuration values VSCode holds and hands
 * them to `resolveColumnLimit`. Not unit tested directly (it needs a
 * real editor host to mean anything) -- exercised by the
 * @vscode/test-electron integration suite (commit 9) instead; all the
 * precedence *logic* lives in, and is tested via, `./column-limit.ts`.
 */
import * as vscode from 'vscode';
import { resolveColumnLimit, type ResolvedColumnLimit, type RulerSetting } from './column-limit.js';

/**
 * Split `editor.rulers`'s effective value into its language-scoped and
 * non-language-scoped layers via `WorkspaceConfiguration#inspect`,
 * rather than `get()` -- `get()` would merge both layers into one
 * effective value, losing exactly the distinction tiers 2 and 4 need. A
 * language ID must be part of the configuration scope for VSCode to
 * populate `inspect()`'s `*LanguageValue` fields at all, which is why
 * `document` (not `document.uri`) is passed to `getConfiguration` below.
 */
function inspectRulers(document: vscode.TextDocument): {
  languageRulers: readonly RulerSetting[] | undefined;
  globalRulers: readonly RulerSetting[] | undefined;
} {
  const config = vscode.workspace.getConfiguration('editor', document);
  const inspected = config.inspect<readonly RulerSetting[]>('rulers');

  const languageRulers =
    inspected?.workspaceFolderLanguageValue ??
    inspected?.workspaceLanguageValue ??
    inspected?.globalLanguageValue ??
    inspected?.defaultLanguageValue;

  const globalRulers =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue ??
    inspected?.defaultValue;

  return { languageRulers, globalRulers };
}

/**
 * Resolve the effective column limit for `document`.
 *
 * `editorConfigMaxLineLength` is threaded in by the caller rather than
 * looked up here, since resolving it needs a filesystem walk
 * (`../editorconfig.ts`, commit 3) and a `respectEditorConfig` setting
 * check (commit 4) -- neither of which this module should need to know
 * about to stay focused on the ruler/rewrapPlus-setting side of the
 * precedence chain.
 */
export function resolveColumnLimitForDocument(
  document: vscode.TextDocument,
  editorConfigMaxLineLength: number | undefined,
): ResolvedColumnLimit {
  const config = vscode.workspace.getConfiguration('rewrapPlus', document);
  const rewrapPlusColumnLimit = config.get<number | null>('columnLimit', null);
  const rulerIndex = config.get<number>('rulerIndex', 0);

  const { languageRulers, globalRulers } = inspectRulers(document);

  return resolveColumnLimit({
    rewrapPlusColumnLimit,
    languageRulers,
    editorConfigMaxLineLength,
    globalRulers,
    rulerIndex,
  });
}
