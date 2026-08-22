import type { LanguageAdapter, LanguageDescriptor } from './types/adapter.js';

/**
 * Validates the structural invariants of a descriptor that can be checked
 * without a loaded grammar: non-empty ids and delimiters, and an
 * internally consistent concatenation configuration.
 *
 * This is deliberately partial. Deeper validation — that the declared
 * tree-sitter queries actually compile against the grammar — needs a
 * loaded `Language` and so is layered on once the parser exists (Phase 2),
 * and comprehensively by the adapter conformance kit (Phase 6b,
 * "descriptor validates; all tree-sitter queries compile against the
 * grammar"). What's checked here is everything that's knowable before any
 * of that exists.
 *
 * Throws — including the offending descriptor's `id` in the message —
 * rather than letting a malformed descriptor surface later as a confusing
 * runtime error mid-wrap.
 */
export function validateDescriptor(descriptor: LanguageDescriptor): void {
  const fail = (message: string): never => {
    const label = descriptor.id.trim() ? `'${descriptor.id}'` : '(missing id)';
    throw new Error(`invalid language descriptor ${label}: ${message}`);
  };

  if (!descriptor.id.trim()) {
    fail('id must be a non-empty string');
  }
  if (!descriptor.grammarWasm.trim()) {
    fail('grammarWasm must be a non-empty string');
  }
  if (!descriptor.queries.comments.trim()) {
    fail('queries.comments must be a non-empty query source');
  }
  if (!descriptor.queries.strings.trim()) {
    fail('queries.strings must be a non-empty query source');
  }

  const { line, block, doc } = descriptor.comments;
  if (line && !line.marker.trim()) {
    fail('comments.line.marker must be non-empty');
  }
  if (block && (!block.open.trim() || !block.close.trim())) {
    fail('comments.block.open and comments.block.close must both be non-empty');
  }
  if (doc && (doc.markers.length === 0 || doc.dialects.length === 0)) {
    fail(
      'comments.doc.markers and comments.doc.dialects must each be non-empty when comments.doc is present',
    );
  }

  if (descriptor.strings.quotes.length === 0) {
    fail('strings.quotes must declare at least one quote form');
  }
  for (const quote of descriptor.strings.quotes) {
    if (!quote.delimiter.trim()) {
      fail('every strings.quotes entry needs a non-empty delimiter');
    }
  }

  const { concatenation } = descriptor.strings;
  if (concatenation.style === 'operator' && !concatenation.operator?.trim()) {
    fail("strings.concatenation.operator is required when style is 'operator'");
  }
}

/**
 * Registry mapping VSCode languageIds — and their aliases — to language
 * adapters.
 *
 * Grammar WASM is loaded lazily by `ParserManager` (Phase 2) on first
 * *parse*, not here: registering an adapter never touches the filesystem
 * or a grammar, so it's always cheap and safe to do eagerly at extension
 * activation.
 *
 * The extension enumerates `supportedLanguages()` to build its activation
 * events and to gray out commands in unsupported files, so adding a
 * language touches no extension code — only this registry.
 */
export class AdapterRegistry {
  private readonly byKey = new Map<string, LanguageAdapter>();
  private readonly primaryIds = new Set<string>();

  register(adapter: LanguageAdapter): void {
    validateDescriptor(adapter.descriptor);

    const { id, aliases = [] } = adapter.descriptor;
    const keys = [id, ...aliases];

    for (const key of keys) {
      const existing = this.byKey.get(key);
      if (existing) {
        throw new Error(
          `cannot register language descriptor '${id}': '${key}' is already registered ` +
            `by '${existing.descriptor.id}'`,
        );
      }
    }

    for (const key of keys) {
      this.byKey.set(key, adapter);
    }
    this.primaryIds.add(id);
  }

  resolve(languageId: string): LanguageAdapter | undefined {
    return this.byKey.get(languageId);
  }

  /**
   * Distinct primary language ids — not aliases — sorted for stable
   * output.
   */
  supportedLanguages(): string[] {
    return [...this.primaryIds].sort();
  }
}
