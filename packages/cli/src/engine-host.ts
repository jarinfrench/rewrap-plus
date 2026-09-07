/**
 * Wires the engine's `ParserManager`/`AdapterRegistry` up for the CLI
 * process -- the CLI's counterpart to
 * `packages/vscode-extension/src/engine-host.ts`. Structurally the same
 * job (which adapters are registered, where their grammar WASM loads
 * from), but the mechanics are far simpler here, which is itself the
 * finding this module exists to demonstrate: `docs/adapters.md`'s CLI
 * section on why.
 *
 * ## Why this file needs none of the extension's ESM/CJS workarounds
 *
 * `@rewrap-plus/engine` is ESM-only. `packages/vscode-extension` compiles
 * to CommonJS (VSCode's extension host loads its `"main"` entry via
 * `require`), which forces that package into a dynamic `import()` plus a
 * `with { 'resolution-mode': 'import' }` type-import attribute just to
 * consume the engine at all (see that file's own doc comment for the
 * full TS1479/TS1541 story). `packages/cli` has `"type": "module"` in
 * its own `package.json` -- nothing forces it into CommonJS -- so it
 * imports `@rewrap-plus/engine` with a perfectly ordinary static
 * `import` statement, exactly like any other ESM package depending on
 * another. The acceptance criterion that matters here is concrete: "if
 * the CLI needs engine changes, the seam leaked" -- it turns out the
 * *engine* needed zero changes, and even the glue-layer friction the
 * extension had to solve turns out to have been a VSCode-hosting
 * artifact, not an engine one.
 *
 * ## Why `require.resolve` is the right answer here, not a workaround
 *
 * `engine-host.ts` (extension) explicitly moved *away* from
 * `require.resolve('@rewrap-plus/engine/package.json')` for locating
 * `wasmDir`, because a packaged `.vsix` bundles the engine's compiled
 * output directly into `dist/extension.js` -- no
 * `node_modules/@rewrap-plus/engine` exists at runtime for that lookup
 * to find. The CLI has no equivalent bundling step (`package.json`'s
 * `build` script is a plain `tsc -b`, deliberately -- see that file's own
 * comment), so `@rewrap-plus/engine` is always a real, resolvable
 * package relative to wherever this file runs from, whether that's this
 * monorepo's own hoisted `node_modules` in dev/test or a real installed
 * `node_modules/@rewrap-plus/engine` in a future standalone install. The
 * `require.resolve` approach the extension had to abandon is simply
 * correct for the CLI's own shape of program.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { AdapterRegistry, ParserManager, registerAllAdapters } from '@rewrap-plus/engine';

const require = createRequire(import.meta.url);

function resolveEngineRoot(): string {
  return dirname(require.resolve('@rewrap-plus/engine/package.json'));
}

let registryPromise: Promise<AdapterRegistry> | undefined;

/**
 * Lazily create (once) and return the process-wide `AdapterRegistry`.
 * Delegates to the engine's own `registerAllAdapters()` -- the single
 * source of truth for "every adapter this project ships" -- rather than
 * a second hardcoded `registry.register(...)` list kept in sync with
 * `packages/vscode-extension/src/engine-host.ts`'s own copy by hand; see
 * that file's doc comment and `packages/engine/src/all-adapters.ts` for
 * why this moved. The CLI still supports exactly the same language set
 * as the extension, deliberately -- now structurally guaranteed rather
 * than by convention, since both glue layers call the identical function.
 */
function getRegistry(): Promise<AdapterRegistry> {
  const existing = registryPromise;
  if (existing) {
    return existing;
  }
  const registry = new AdapterRegistry();
  registerAllAdapters(registry);
  registryPromise = Promise.resolve(registry);
  return registryPromise;
}

/** Every VSCode languageId (and alias) a registered adapter supports. */
export async function getSupportedLanguages(): Promise<readonly string[]> {
  const registry = await getRegistry();
  return registry.supportedLanguages();
}

let parserManagerPromise: Promise<ParserManager> | undefined;

/** Lazily create (once) and return the process-wide `ParserManager`, sharing `getRegistry()`'s registry. */
export function getParserManager(): Promise<ParserManager> {
  const existing = parserManagerPromise;
  if (existing) {
    return existing;
  }
  const created = createParserManager();
  parserManagerPromise = created;
  return created;
}

async function createParserManager(): Promise<ParserManager> {
  const registry = await getRegistry();
  return ParserManager.create({ wasmDir: resolveEngineRoot(), registry });
}

/** Test-only hook to force a fresh registry and `ParserManager` on the next call. */
export function resetEngineHostForTests(): void {
  registryPromise = undefined;
  parserManagerPromise = undefined;
}
