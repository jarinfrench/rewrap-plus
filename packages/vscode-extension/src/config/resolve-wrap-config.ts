/**
 * Assembles the engine's `WrapConfig` for one document: the point where
 * `./settings.ts`, `./resolve-column-limit.ts`, and `./editorconfig.ts`
 * all come together into the one object `wrapRegions` needs.
 * Thin `vscode`-facing glue, exercised via the @vscode/test-electron
 * suite (commit 9) — the pieces it composes are each independently unit
 * tested already.
 */
import * as vscode from 'vscode';
// `with { 'resolution-mode': 'import' }` rather than a bare `import
// type { WrapConfig } from '@rewrap-plus/engine'`: a type-only named
// import of this ESM-only package from this CJS file needs that
// explicit resolution-mode attribute (TS1541) — see `../engine-host.ts`'s
// doc comment for the fuller ESM/CJS boundary explanation. Unlike
// `ParserManager` there (which needed a `typeof import(...)` workaround
// because it has a private constructor `InstanceType` rejects),
// `WrapConfig` is a plain interface with no such constraint, so the
// straightforward attributed import works directly.
import type { WrapConfig } from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };
import { resolveEditorConfigMaxLineLength } from './editorconfig.js';
import { resolveColumnLimitForDocument } from './resolve-column-limit.js';
import { readExtensionSettings } from './settings.js';
import { matchesStringWrapInclude } from './string-wrap-include.js';
import type { ResolvedColumnLimit } from './column-limit.js';

export interface ResolvedWrapConfig {
  /** `rewrapPlus.enable` — the global kill switch. Callers must check this before doing anything. */
  readonly enable: boolean;
  readonly wrapConfig: WrapConfig;
  /** The column limit actually used, plus which precedence tier it came from — for the output channel (commit 8) to explain "why did it wrap at N?". */
  readonly columnLimit: ResolvedColumnLimit;
  /**
   * Whether this document's path matched `rewrapPlus.stringWrapInclude`
   * — already folded into `wrapConfig.wrapStrings` below (so nothing
   * else needs to re-check it), kept here separately only so a
   * diagnostic (`rewrapPlus.showResolvedConfig`) can explain *why*
   * `wrapStrings` came out `false` even though the raw setting is `true`.
   */
  readonly stringWrapIncludeMatched: boolean;
}

export function resolveWrapConfigForDocument(document: vscode.TextDocument): ResolvedWrapConfig {
  const settings = readExtensionSettings(document);

  // `.editorconfig` lookup needs a real filesystem path — skipped for
  // untitled/virtual documents (any non-'file' URI scheme), which have
  // no directory to walk up from, rather than passing a nonsensical
  // path to a Node fs call.
  const editorConfigMaxLineLength =
    settings.respectEditorConfig && document.uri.scheme === 'file'
      ? resolveEditorConfigMaxLineLength(document.uri.fsPath)
      : undefined;

  const columnLimit = resolveColumnLimitForDocument(document, editorConfigMaxLineLength);
  const tabSize = vscode.workspace.getConfiguration('editor', document).get<number>('tabSize', 4);
  const stringWrapIncludeMatched = matchesStringWrapInclude(document, settings.stringWrapInclude);

  const wrapConfig: WrapConfig = {
    columnLimit: columnLimit.value,
    tabSize,
    wrapComments: settings.wrapComments,
    // `stringWrapInclude` scopes string wrapping by path — folded in
    // here, alongside the `wrapStrings` toggle it's meant to further
    // restrict, rather than threaded into the engine as a separate
    // concept: the engine's WrapConfig has no notion of a document path
    // to glob-match against (nor should it — that's exactly the kind of
    // vscode/filesystem-shaped concern packages/engine's "never import
    // vscode" rule exists to keep out), so from the engine's point of
    // view a path outside the include scope is indistinguishable from,
    // and handled identically to, wrapStrings being off outright.
    wrapStrings: settings.wrapStrings && stringWrapIncludeMatched,
    stringPolicy: settings.stringPolicy,
    docDialect: settings.docDialect,
    preserveIndentedBlocks: settings.preserveIndentedBlocks,
    balancedWrapping: settings.balancedWrapping,
  };

  return { enable: settings.enable, wrapConfig, columnLimit, stringWrapIncludeMatched };
}
