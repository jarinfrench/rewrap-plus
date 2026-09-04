import { AdapterRegistry } from '../../src/adapter-registry.js';
import { ParserManager } from '../../src/parser/parser-manager.js';
import type { LanguageAdapter } from '../../src/types/adapter.js';

/**
 * Build a `ParserManager` registered with one or more adapters — the
 * `AdapterRegistry`/`ParserManager.create` triad every gold-fixture and
 * hardening test file's own `beforeAll` used to hand-roll individually
 * (~30 near-identical copies across `test/wrap/` and `test/hardening/`,
 * differing only in which adapter(s) got registered and, for a few
 * multi-adapter suites, in what per-language data rode alongside each
 * adapter in that file's own `LANGUAGE_SETS`-shaped array — this helper
 * only replaces the `beforeAll` triad itself, not those per-file arrays,
 * since their extra fields genuinely differ from file to file).
 *
 * `wasmDir` defaults to `'.'`, matching every existing caller — Vitest's
 * own cwd is this package's root, the same default
 * `../../src/conformance/run-adapter-conformance.ts`'s own
 * `ConformanceFixtures.wasmDir` documents for the same reason.
 */
export async function createTestParserManager(
  adapters: LanguageAdapter | readonly LanguageAdapter[],
  wasmDir = '.',
): Promise<ParserManager> {
  const registry = new AdapterRegistry();
  for (const adapter of Array.isArray(adapters) ? adapters : [adapters]) {
    registry.register(adapter);
  }
  return ParserManager.create({ wasmDir, registry });
}
