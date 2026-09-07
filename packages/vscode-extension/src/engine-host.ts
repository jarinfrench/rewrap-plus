/**
 * Wires the engine's `ParserManager`/`AdapterRegistry` up for this
 * extension process: which language adapters are registered, and where
 * their grammar WASM is loaded from.
 *
 * Kept separate from `extension.ts` so command modules (commits 5-7)
 * can import `getParserManager()`/`getEngine()` without pulling in
 * activation plumbing, and so the adapter-registration decision below
 * lives in exactly one place.
 *
 * ## Why `getEngine()` uses a dynamic `import()`, not a static one
 *
 * `@rewrap-plus/engine` is ESM-only (`"type": "module"`); this package
 * compiles to CommonJS (no `"type": "module"` in its own `package.json`,
 * needed so VSCode's extension host -- which loads a `"main"` entry via
 * `require` -- can load it universally, without depending on this
 * specific VSCode version's ESM-main support). A static `import` of an
 * ESM module from a CJS file would need `tsc` to emit a `require()` call,
 * which `tsc` itself refuses (TS1479) even though this exact pattern was
 * verified to work at runtime -- VSCode 1.120's bundled Node resolves a
 * CJS `require()` of an ESM package without error. `tsc`'s restriction is
 * stricter than the runtime actually is, but there's no supported way to
 * silence it for a CJS output target, so a dynamic `import()` -- which
 * every module system can perform regardless of the caller's own
 * format -- is the version-agnostic fix. `getEngine()` centralizes it so
 * every other file needing an engine runtime value (`wrapRegions`,
 * `applyTextEdits`, `PositionMapper`, ...) goes through one cached
 * promise instead of repeating this reasoning per call site.
 *
 * Type-only usages of the engine's exports (`WrapConfig`, `SourceSpan`,
 * ...) are unaffected by the require()-vs-import() problem above --
 * `import type` is erased entirely and never becomes a `require`/`import`
 * at runtime either way. They do hit a narrower, separate version of the
 * same underlying ESM/CJS friction, though: `tsc` also requires an
 * explicit `with { 'resolution-mode': 'import' }` attribute on a
 * type-only named import of an ESM module from a CJS file (TS1541/1542) --
 * see the `ParserManager` import below for the straightforward form, and
 * `../config/resolve-wrap-config.ts` for another example.
 */
// `with { 'resolution-mode': 'import' }` rather than a bare `import
// type { ParserManager } from '@rewrap-plus/engine'`: a type-only
// named import of this ESM-only package from this CJS file needs that
// explicit resolution-mode attribute (TS1541/1542) -- see the runtime
// `import()` note below for the fuller ESM/CJS boundary explanation.
// Using the class name itself as a type (not `InstanceType<...>`) gives
// the instance type directly, sidestepping `ParserManager`'s private
// constructor entirely -- no `InstanceType`/`ReturnType` unwrapping
// needed, unlike deriving the same type from `typeof import(...)`'s
// runtime-namespace shape would require.
import type { ParserManager } from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };
import type { AdapterRegistry } from '@rewrap-plus/engine' with { 'resolution-mode': 'import' };

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
 * The extension's own installed root directory, set once by
 * `initEngineHost` during `activate()`. `ParserManager`'s `wasmDir`
 * resolves against this: every `LanguageDescriptor.grammarWasm` value
 * (e.g. Python's `'grammars/tree-sitter-python.wasm'`) already embeds the
 * `grammars/` segment itself, and `scripts/build.mjs` copies the engine's
 * vendored `.wasm` files to `<this root>/grammars/` as a build step -- so
 * this needs no `'grammars'` suffix appended here.
 */
let extensionRootDir: string | undefined;

/**
 * Must be called once during `activate()`, before any command resolves a
 * `ParserManager` -- `getParserManager()` throws if it hasn't been.
 *
 * Previously this directory was derived via
 * `require.resolve('@rewrap-plus/engine/package.json')`, which depended
 * on `@rewrap-plus/engine` being resolvable as an installed package --
 * true in every dev/test run (npm workspaces symlinks it into
 * `node_modules`) but not how a packaged `.vsix` works, where
 * `scripts/build.mjs` bundles engine's compiled output directly into
 * `dist/extension.js` and no `node_modules/@rewrap-plus/engine` exists at
 * all. `context.extensionUri.fsPath` (the caller passes this in from
 * `extension.ts`) is the one directory guaranteed to be correct in both
 * dev and packaged runs, since it's how the extension host itself locates
 * this extension.
 */
export function initEngineHost(extensionRoot: string): void {
  extensionRootDir = extensionRoot;
}

function resolveWasmDir(): string {
  if (!extensionRootDir) {
    throw new Error(
      'engine-host: initEngineHost() must be called (from activate()) before resolving grammar WASM paths.',
    );
  }
  return extensionRootDir;
}

let registryPromise: Promise<AdapterRegistry> | undefined;

/**
 * Lazily create (once) and return the process-wide `AdapterRegistry`.
 *
 * `createRegistry()` (below) registers thirteen adapters -- `pythonAdapter`,
 * `javascriptAdapter`, `typescriptAdapter`, `typescriptReactAdapter`,
 * `cppAdapter`, `javaAdapter`, `markdownAdapter`, `latexAdapter`,
 * `tomlAdapter`, `shellscriptAdapter`, `cssAdapter`, `scssAdapter`, and
 * `powershellAdapter` -- and this list is the one deliberate place deciding what's actually user-facing, since
 * `getSupportedLanguages()` (below) drives
 * which documents the extension's commands and formatters activate for.
 * The engine's `javascriptAdapter` didn't start out registered here: it
 * began as a conformance canary proving the adapter interface generalizes
 * beyond Python (see `docs/adapters.md`'s JavaScript canary section),
 * deliberately *not* registered here so `getSupportedLanguages()` wouldn't
 * advertise JS support that didn't actually exist yet. That canary is now
 * the real, full adapter (strings, concatenation, JSDoc doc comments) --
 * see `docs/adapters.md`'s JavaScript/TypeScript/TSX -- full adapters
 * section -- so it's registered alongside its `typescript`/`typescriptreact`
 * siblings. `javascriptAdapter`'s own `javascriptreact` alias and
 * `AdapterRegistry.supportedLanguages()` (which includes aliases -- see
 * that method's own doc comment) are what make `.jsx` files supported
 * here too, with no separate registration needed for it the way `.tsx`
 * needs one (a genuinely different grammar, not an alias --
 * `../../engine/src/languages/typescript/descriptor.ts`'s own doc comment
 * explains why). `cppAdapter` (`'cpp'`) and `javaAdapter` (`'java'`) are
 * each real adapters from the start, unlike JavaScript's canary-then-real
 * path, since neither C++ nor Java had an equivalent thin precursor to
 * extend. `markdownAdapter` (`'markdown'`) is the first `'prose'`-only
 * adapter registered here -- no comment/string discovery at all, see
 * `docs/adapters.md`'s "Markdown and LaTeX -- prose languages" section and
 * `../../engine/src/languages/markdown/descriptor.ts`'s own doc comment.
 * `latexAdapter` (`'latex'`) is the second `'prose'`-only adapter: unlike
 * Markdown, LaTeX's grammar has no paragraph node at all, so its own
 * `discoverProse` is a masked line scan rather than a query capture (see
 * `../../engine/src/languages/latex/discover-prose.ts`'s own doc comment)
 * -- a real, measured, file-size-proportional cost for a single-region
 * "wrap at cursor" request that every other adapter here doesn't pay
 * (`docs/benchmarks.md`'s "LaTeX" section). `tomlAdapter`, `shellscriptAdapter`,
 * `cssAdapter`, `scssAdapter`, and `powershellAdapter` are the five
 * comment-only-batch adapters (`docs/language-candidates.md`'s Pass 4
 * "High" priority row) -- each declares no `strings`/`queries.strings` at
 * all, matching Markdown/LaTeX's own precedent for a language with
 * nothing safe to wrap outside comments, but (unlike Markdown/LaTeX) each
 * discovers ordinary `queries.comments`-driven regions rather than
 * `'prose'` ones.
 *
 * Split out from `getParserManager()` (which used to build this
 * directly) so `getSupportedLanguages()` below doesn't have to go
 * through a full `ParserManager` -- grammar loading -- just to answer "is
 * this language registered", which `AdapterRegistry.supportedLanguages()`
 * alone already answers without touching any WASM.
 */
function getRegistry(): Promise<AdapterRegistry> {
  const existing = registryPromise;
  if (existing) {
    return existing;
  }
  const created = createRegistry();
  registryPromise = created;
  return created;
}

async function createRegistry(): Promise<AdapterRegistry> {
  const engine = await getEngine();
  const registry = new engine.AdapterRegistry();
  registry.register(engine.pythonAdapter);
  registry.register(engine.javascriptAdapter);
  registry.register(engine.typescriptAdapter);
  registry.register(engine.typescriptReactAdapter);
  registry.register(engine.cppAdapter);
  registry.register(engine.javaAdapter);
  registry.register(engine.markdownAdapter);
  registry.register(engine.latexAdapter);
  registry.register(engine.tomlAdapter);
  registry.register(engine.shellscriptAdapter);
  registry.register(engine.cssAdapter);
  registry.register(engine.scssAdapter);
  registry.register(engine.powershellAdapter);
  return registry;
}

/** Every VSCode languageId (and alias) a registered adapter supports -- see `getRegistry()`'s doc comment for which adapters that includes and why. */
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
  const [engine, registry] = await Promise.all([getEngine(), getRegistry()]);
  return engine.ParserManager.create({ wasmDir: resolveWasmDir(), registry });
}

/** Test-only hook to force a fresh engine import, registry, and `ParserManager` on the next call. */
export function resetEngineHostForTests(): void {
  enginePromise = undefined;
  registryPromise = undefined;
  parserManagerPromise = undefined;
}
