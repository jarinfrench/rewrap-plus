/**
 * Absolute path to `test/integration/fixtures/` from a compiled test
 * file's own location (`out-test/suite/*.test.js`) -- fixtures are plain
 * data files, never compiled by `tsc`, so they stay in the *source* tree
 * rather than appearing anywhere under `out-test/`.
 */
import * as path from 'node:path';

// __dirname here (compiled) is <package>/out-test/suite -- two levels up
// reaches the package root, from which the *source* fixtures directory
// is test/integration/fixtures.
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'test', 'integration', 'fixtures');

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}
