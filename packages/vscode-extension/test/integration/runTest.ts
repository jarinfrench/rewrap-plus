/**
 * Outer script: runs in plain Node (not inside VSCode), downloads/reuses
 * a real VSCode test build via `@vscode/test-electron`, and launches it
 * with `extensionTestsPath` pointing at `./suite/index.js` -- the inner
 * script that runs *inside* the extension host and drives Mocha.
 *
 * Compiled separately from the rest of this package (`tsconfig.test.json`,
 * `npm run test:integration`) rather than through the main `tsconfig.json`
 * `src` build -- this suite needs a real downloaded VSCode instance and
 * takes tens of seconds even when everything passes, so it's
 * deliberately not part of the fast `npm test` (`vitest run`) most of
 * this package's own unit tests already satisfy, nor of the root
 * typecheck/test/lint/build gate CLAUDE.md defines. See the README for
 * how to run it and why it's separate.
 */
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // __dirname here is the *compiled* location (out-test/), one level
  // below this package's root (tsconfig.test.json's rootDir strips the
  // 'test/integration' prefix, so test/integration/runTest.ts lands at
  // out-test/runTest.js directly, not out-test/test/integration/runTest.js).
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-gpu'],
  });
}

main().catch((error: unknown) => {
  console.error('Integration tests failed to run:', error);
  process.exitCode = 1;
});
