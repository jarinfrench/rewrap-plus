/**
 * `rewrapPlus.stringWrapInclude` -- scopes *string-literal* wrapping to
 * specific paths via glob patterns matched against the document's path
 * relative to its workspace folder, so string wrapping (which edits
 * actual program values, unlike comment/docstring wrapping) can be
 * trialled on one package or `docs/` before trusting it repo-wide.
 *
 * Thin `vscode`-facing glue around `./glob.ts`'s pure matcher, like
 * `./resolve-column-limit.ts` -- not unit tested directly (computing a
 * workspace-relative path needs a real editor host to mean anything),
 * exercised via the @vscode/test-electron suite instead; the glob engine
 * itself is unit tested in `./glob.test.ts`.
 */
import * as vscode from 'vscode';
import { matchesGlob } from './glob.js';

/**
 * `false` when every pattern misses -- including the pathological case of
 * an empty `patterns` array, which `Array#some` already treats as "no
 * match" without a special case here, consistent with an explicit
 * `"rewrapPlus.stringWrapInclude": []` meaning "scope string wrapping to
 * nothing" rather than being silently equivalent to the unset default.
 *
 * `includeWorkspaceFolder: false` on `asRelativePath`: its own default
 * flips to `true` in a multi-root workspace, which would prepend the
 * workspace folder's name to the path (e.g. `myRepo/src/a.py`) -- exactly
 * the kind of prefix that makes an otherwise-portable pattern like
 * `src/**` stop matching depending on how many folders happen to be open.
 * A document outside every workspace folder (single-file mode, or a
 * folder VSCode doesn't know about) falls back to `asRelativePath`
 * returning the input unchanged -- an absolute, OS-separator path -- which
 * still matches the default `**` (an unanchored `.*`) as intended, just
 * not anything more specific; there is no workspace root left to scope
 * a directory-anchored pattern against in that case.
 */
export function matchesStringWrapInclude(
  document: vscode.TextDocument,
  patterns: readonly string[],
): boolean {
  const relativePath = vscode.workspace.asRelativePath(document.uri, false).split('\\').join('/');
  return patterns.some((pattern) => matchesGlob(pattern, relativePath));
}
