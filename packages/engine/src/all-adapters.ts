import type { LanguageAdapter } from './types/adapter.js';
import type { AdapterRegistry } from './adapter-registry.js';
import { pythonAdapter } from './languages/python/adapter.js';
import { javascriptAdapter } from './languages/javascript/adapter.js';
import { typescriptAdapter, typescriptReactAdapter } from './languages/typescript/adapter.js';
import { cppAdapter } from './languages/cpp/adapter.js';
import { javaAdapter } from './languages/java/adapter.js';
import { markdownAdapter } from './languages/markdown/adapter.js';
import { latexAdapter } from './languages/latex/adapter.js';
import { tomlAdapter } from './languages/toml/adapter.js';
import { shellscriptAdapter } from './languages/shellscript/adapter.js';
import { cssAdapter } from './languages/css/adapter.js';
import { scssAdapter } from './languages/scss/adapter.js';
import { powershellAdapter } from './languages/powershell/adapter.js';

/**
 * Every adapter this project ships, in one place.
 *
 * Before this existed, `packages/vscode-extension/src/engine-host.ts` and
 * `packages/cli/src/engine-host.ts` each hardcoded the identical
 * thirteen-adapter `registry.register(...)` list independently -- correct
 * today only because whoever added the fourteenth language remembered to
 * touch both files identically. `docs/adapters.md`/`docs/known-gaps.md`'s
 * whole running theme is exactly this shape of bug: something that looks
 * generic but was only ever exercised, and kept in sync, by hand. This is
 * a structural DRY-up of `packages/engine`'s public surface, made now
 * because a third consumer needed the same list: `scripts/generate-site-data.mjs`
 * (the GitHub Pages language-coverage table) needs to enumerate "every
 * shipped adapter" too, and copying the extension's or CLI's own
 * hardcoded list a third time would have made the exact drift this
 * change prevents even easier to introduce unnoticed. Deliberately not a
 * new engine *capability* -- no adapter's own internals changed, and
 * `AdapterRegistry` itself is untouched -- just the one list moving to a
 * single owner.
 *
 * Order here has no behavioral meaning (`AdapterRegistry.register` only
 * cares about id/alias uniqueness, and `supportedLanguages()` sorts its
 * own output), so this simply mirrors `./index.ts`'s existing adapter
 * export order.
 */
export const allAdapters: readonly LanguageAdapter[] = [
  pythonAdapter,
  javascriptAdapter,
  typescriptAdapter,
  typescriptReactAdapter,
  cppAdapter,
  javaAdapter,
  markdownAdapter,
  latexAdapter,
  tomlAdapter,
  shellscriptAdapter,
  cssAdapter,
  scssAdapter,
  powershellAdapter,
];

/** Registers every adapter in {@link allAdapters} onto `registry`, in order. */
export function registerAllAdapters(registry: AdapterRegistry): void {
  for (const adapter of allAdapters) {
    registry.register(adapter);
  }
}
