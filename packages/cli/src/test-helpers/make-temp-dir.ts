import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

/**
 * Scoped temp-directory scaffold for a test file that needs real files on
 * disk -- `run.test.ts`, `file-discovery.test.ts`, and three of
 * `config/*.test.ts` each hand-rolled this identically (a `tempDir`
 * variable, an `afterEach` cleanup, and a `makeTempDir` that
 * `mkdtempSync`s under `os.tmpdir()`), differing only in the literal
 * prefix passed to `mkdtempSync`. Call this once per test file, at module
 * scope -- it registers its own `afterEach` the same way each of those
 * files' own copy did, so cleanup still runs with no further wiring
 * needed at each call site.
 *
 * Lives under `src/` rather than a sibling `test/` directory (unlike
 * `packages/engine/test/helpers/`'s own equivalent) because
 * `packages/cli/tsconfig.json` sets `rootDir: "src"`: a file outside that
 * root pulled into the compilation by an in-`src` test file's import
 * would trip `tsc -b`'s rootDir-containment check (TS6059). The minor
 * cost is this helper being emitted into `dist/` alongside real CLI
 * source even though nothing in the shipped CLI ever imports it -- judged
 * cheaper than changing `tsconfig.json`'s `rootDir`/`include` shape for a
 * mechanical test-only extraction.
 */
export function makeTempDirHelper(prefix: string): () => string {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  return function makeTempDir(): string {
    tempDir = mkdtempSync(join(tmpdir(), prefix));
    return tempDir;
  };
}
