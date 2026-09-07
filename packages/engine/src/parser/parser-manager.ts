import { Parser, Language } from 'web-tree-sitter';
import type { AdapterRegistry } from '../adapter-registry.js';
import type { LanguageAdapter } from '../types/adapter.js';

export interface ParserManagerOptions {
  /**
   * Base directory (or base URL, in a browser host) that
   * `LanguageDescriptor.grammarWasm` paths are resolved against -- e.g. if
   * `wasmDir` is the engine package root and a descriptor declares
   * `grammarWasm: 'grammars/tree-sitter-python.wasm'`, the file loaded is
   * `<wasmDir>/grammars/tree-sitter-python.wasm`.
   *
   * Joined with a plain string concatenation, not Node's `path` module --
   * this package stays free of Node built-ins so the same code can run
   * wherever `web-tree-sitter` itself can (`Language.load` accepts a
   * path string in Node and works the same way in a browser given a
   * same-shaped URL string; see decision-of-record on `web-tree-sitter`
   * being chosen partly for future browser support). A trailing slash on
   * `wasmDir` or a leading slash on `grammarWasm` is tolerated so callers
   * don't need to think about it.
   */
  readonly wasmDir: string;

  /**
   * Where `languageId` -> `LanguageDescriptor` lookups come from. Grammar
   * WASM is loaded lazily on first `parserFor` call for a given
   * descriptor, never eagerly at registration -- registering an adapter
   * stays cheap and filesystem-free (see `AdapterRegistry`'s own doc
   * comment), and grammar loading only happens for languages someone
   * actually asks to parse.
   */
  readonly registry: AdapterRegistry;
}

/**
 * Loads and caches tree-sitter `Language`s and hands out `Parser`
 * instances configured with them.
 *
 * `web-tree-sitter` requires `await Parser.init()` -- a one-time async
 * WASM bootstrap -- before any `Parser` or `Language` can be constructed.
 * That's the async step this class exists to hide: `ParserManager.create`
 * does it once, so nothing downstream has to think about init ordering.
 *
 * A `Language` is cached per `LanguageDescriptor.id` (not per requested
 * `languageId`), so resolving the same descriptor through one of its
 * aliases -- `typescriptreact` alongside `typescript`, say -- reuses the
 * already-loaded grammar rather than loading it twice. Concurrent
 * first-time requests for the same language share one in-flight load
 * rather than racing two loads of the same WASM.
 */
export class ParserManager {
  private readonly wasmDir: string;
  private readonly registry: AdapterRegistry;
  private readonly loadedLanguages = new Map<string, Language>();
  private readonly pendingLoads = new Map<string, Promise<Language>>();

  private constructor(wasmDir: string, registry: AdapterRegistry) {
    this.wasmDir = wasmDir;
    this.registry = registry;
  }

  static async create(opts: ParserManagerOptions): Promise<ParserManager> {
    await Parser.init();
    return new ParserManager(opts.wasmDir, opts.registry);
  }

  /**
   * Resolve `languageId` to its registered `LanguageAdapter`, without
   * touching the grammar cache at all -- the counterpart to `parserFor`
   * for callers that need the adapter itself (its descriptor, its
   * `classify`/`groupRegions`/`isSafeToWrap` hooks) rather than a ready
   * `Parser`. Added alongside the generalized, engine-level `wrapRegions`
   * (`../wrap.js`), which needs exactly this: given a
   * `languageId` and this same `ParserManager`, resolve *both* "which
   * adapter" and "a parser for it" through the one registry a caller
   * already constructed, rather than requiring a second, separate
   * `AdapterRegistry` parameter that could in principle disagree with
   * the one `parserFor` uses.
   *
   * Same throw-loudly policy as `parserFor` (and `AdapterRegistry.register`
   * before it): an unresolvable `languageId` is a caller bug, not
   * something to paper over with `undefined`.
   */
  adapterFor(languageId: string): LanguageAdapter {
    const adapter = this.registry.resolve(languageId);
    if (!adapter) {
      throw new Error(
        `ParserManager: no adapter registered for language '${languageId}' ` +
          `(known languages: ${this.registry.supportedLanguages().join(', ') || '(none)'})`,
      );
    }
    return adapter;
  }

  /**
   * Resolve `languageId` to its registered adapter, load (or reuse) its
   * grammar, and return a `Parser` already configured with it -- ready to
   * call `.parse(source)` immediately.
   *
   * Throws if no adapter is registered for `languageId`. This mirrors
   * `AdapterRegistry.register`'s own policy of failing loudly with the
   * offending id rather than surfacing as a confusing null downstream.
   */
  async parserFor(languageId: string): Promise<Parser> {
    const adapter = this.adapterFor(languageId);
    const language = await this.languageFor(adapter.descriptor.id, adapter.descriptor.grammarWasm);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  }

  private async languageFor(cacheKey: string, grammarWasm: string): Promise<Language> {
    const cached = this.loadedLanguages.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.pendingLoads.get(cacheKey);
    if (pending) {
      return pending;
    }

    const load = Language.load(joinWasmPath(this.wasmDir, grammarWasm)).then((language) => {
      this.loadedLanguages.set(cacheKey, language);
      this.pendingLoads.delete(cacheKey);
      return language;
    });

    this.pendingLoads.set(cacheKey, load);
    return load;
  }
}

function joinWasmPath(wasmDir: string, grammarWasm: string): string {
  const dir = wasmDir.endsWith('/') ? wasmDir.slice(0, -1) : wasmDir;
  const file = grammarWasm.startsWith('/') ? grammarWasm.slice(1) : grammarWasm;
  return `${dir}/${file}`;
}
