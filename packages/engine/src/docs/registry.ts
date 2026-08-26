import { DialectRegistry } from './dialect.js';
import { plainDialect } from './plain.js';
import { googleDialect } from './google.js';
import { numpyDialect } from './numpy.js';
import { sphinxDialect } from './sphinx.js';
import { jsdocDialect } from './jsdoc.js';
import { doxygenDialect } from './doxygen.js';

/**
 * Build a `DialectRegistry` carrying every dialect this package ships.
 * Split out from `./dialect.ts` itself to avoid a cycle: the registry
 * needs to import every concrete dialect, and every concrete dialect
 * imports `DocDialect`/`reflowDocBlocks`/`segmentLines` from
 * `./dialect.ts`.
 *
 * Dialects are stateless, so a single shared instance (built once by
 * whichever caller needs one — Python's `../languages/python/wrap-docstring.ts`
 * for `'docstring'` regions, `../comments/wrap-doc-comment.ts` for
 * `'docComment'` regions) is always safe to reuse.
 * There's no story yet for a caller registering its *own* dialect, so
 * this stays a plain factory rather than a configurable registry
 * builder.
 */
export function createDialectRegistry(): DialectRegistry {
  const registry = new DialectRegistry();
  registry.register(plainDialect);
  registry.register(googleDialect);
  registry.register(numpyDialect);
  registry.register(sphinxDialect);
  registry.register(jsdocDialect);
  registry.register(doxygenDialect);
  return registry;
}
