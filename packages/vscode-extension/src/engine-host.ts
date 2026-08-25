/**
 * Wires the engine's `ParserManager`/`AdapterRegistry` up for this
 * extension process: which language adapters are registered, and where
 * their grammar WASM is loaded from.
 *
 * Kept separate from `extension.ts` so command modules (Phase 7, commits
 * 5-7) can import `getParserManager()`/`getEngine()` without pulling in
 * activation plumbing, and so the v1 language scope decision below lives
 * in exactly one place.
 *
 * ## Why `getEngine()` uses a dynamic `import()`, not a static one
 *
 * `@rewrap-plus/engine` is ESM-only (`"type": "module"`); this package
 * compiles to CommonJS (no `"type": "module"` in its own `package.json`,
 * needed so VSCode's extension host — which loads a `"main"` entry via
 * `require` — can load it universally, without depending on this
 * specific VSCode version's ESM-main support). A static `import` of an
 * ESM module from a CJS file would need `tsc` to emit a `require()` call,
 * which `tsc` itself refuses (TS1479) even though this exact pattern was
 * verified to work at runtime — VSCode 1.120's bundled Node resolves a
 * CJS `require()` of an ESM package without error. `tsc`'s restriction is
 * stricter than the runtime actually is, but there's no supported way to
 * silence it for a CJS output target, so a dynamic `import()` — which
 * every module system can perform regardless of the caller's own
 * format — is the version-agnostic fix. `getEngine()` centralizes it so
 * every other file needing an engine runtime value (`wrapRegions`,
 * `applyTextEdits`, `PositionMapper`, ...) goes through one cached
 * promise instead of repeating this reasoning per call site.
 *
 * Type-only usages of the engine's exports (`WrapConfig`, `SourceSpan`,
 * ...) are unaffected by the require()-vs-import() problem above —
 * `import type` is erased entirely and never becomes a `require`/`import`
 * at runtime either way. They do hit a narrower, separate version of the
 * same underlying ESM/CJS friction, though: `tsc` also requires an
 * explicit `with { 'resolution-mode': 'import' }` attribute on a
 * type-only named import of an ESM module from a CJS file (TS1541/1542) —
 * see the `ParserManager` import below for the straightforward form, and
 * `../config/resolve-wrap-config.ts` for another example.
 */
import * as path from 'node:path';
// `with { 'resolution-mode': 'import' }` rather than a bare `import
// type { ParserManager } from '@rewrap-plus/engine'`: a type-only
// named import of this ESM-only package from this CJS file needs that
// explicit resolution-mode attribute (TS1541/1542) — see the runtime
// `import()` note below for the fuller ESM/CJS boundary explanation.
// Using the class name itself as a type (not `InstanceType<...>`) gives
// the instance type directly, sidestepping `ParserManager`'s private
// constructor entirely — no `InstanceType`/`ReturnType` unwrapping
// needed, unlike deriving the same type from `typeof import(...)`'s
// runtime-namespace shape would require.
import type { ParserManager } from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };

type EngineModule = typeof import('@rewrap-plus/engine', { with: { 'resolution-mode': 'import' } });

let enginePromise: Promise<EngineModule> | undefined;

/** The engine's full runtime export surface, imported once and cached. */
export function getEngine(): Promise<EngineModule> {
  const existing = enginePromise;
  if (existing) {
    return existing;
  }
  const created = import('@rewrap-plus/engine');
  enginePromise = created;
  return created;
}

/**
 * Resolve the directory `ParserManager` should load grammar `.wasm` files
 * from, by locating `@rewrap-plus/engine`'s own package root.
 *
 * `require.resolve('@rewrap-plus/engine/package.json')` rather than
 * resolving via the package's `"main"` entry (`dist/src/index.js`): a
 * `package.json` is guaranteed to exist at the package root regardless of
 * internal build layout, so this doesn't quietly break if `dist/`'s
 * shape ever changes (it already did once — see the sibling commit
 * fixing engine's own `main`/`types` fields, the first real cross-package
 * consumer of the built artifact catching a path that nothing had
 * exercised before). No `"exports"` field restricts engine's subpaths
 * today, so this subpath resolves under Node's default rules. Unlike the
 * ESM/CJS concern above, `require.resolve` itself is fine here — it only
 * resolves a path, it never loads the ESM module.
 *
 * **Known limitation (deferred to Phase 11):** this depends on
 * `@rewrap-plus/engine` being resolvable as an installed package — true
 * today because npm workspaces symlinks it into `node_modules`, and true
 * for any future dev/test run, but not how a packaged `.vsix` will work.
 * Phase 11 commit 1 ("build: add esbuild bundling for the extension")
 * already anticipates this exact seam: "mark `vscode` external, and do
 * not bundle `.wasm` — copy grammar WASM as assets and resolve at runtime
 * via `context.extensionUri`." This function is the one place that swap
 * needs to happen.
 */
function resolveWasmDir(): string {
  const engineManifest = require.resolve('@rewrap-plus/engine/package.json');
  return path.join(path.dirname(engineManifest), 'grammars');
}

let parserManagerPromise: Promise<ParserManager> | undefined;

/**
 * Lazily create (once) and return the process-wide `ParserManager`.
 *
 * v1 language scope is Python only (decision of record) — only
 * `pythonAdapter` is registered. The engine's `javascriptAdapter` exists
 * purely as a Phase 6b conformance canary proving the adapter interface
 * generalizes (see `docs/adapters.md`); it has no docstring/string
 * support and was never meant to be user-facing until Phase 12b builds a
 * real JS/TS adapter. Registering it here would make
 * `registry.supportedLanguages()` — what command handlers check against
 * to gray themselves out in unsupported files — advertise JS support
 * that doesn't actually exist yet.
 */
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
  const engine = await getEngine();
  const registry = new engine.AdapterRegistry();
  registry.register(engine.pythonAdapter);
  return engine.ParserManager.create({ wasmDir: resolveWasmDir(), registry });
}

/** Test-only hook to force a fresh engine import and `ParserManager` on the next call. */
export function resetEngineHostForTests(): void {
  enginePromise = undefined;
  parserManagerPromise = undefined;
}
