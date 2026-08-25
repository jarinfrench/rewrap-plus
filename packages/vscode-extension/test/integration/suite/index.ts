/**
 * Inner script: runs *inside* the VSCode extension host (loaded via
 * `extensionTestsPath` by `../runTest.ts`), sets up Mocha with the BDD
 * interface, and runs every compiled `*.test.js` sitting alongside it in
 * `out-test/suite/`. `fs.readdirSync` rather than the `glob` package —
 * every test file lives flat in this one directory, so a suffix filter
 * is all discovery needs.
 */
import * as path from 'node:path';
import { readdirSync } from 'node:fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20_000 });
  const testsRoot = __dirname;

  const testFiles = readdirSync(testsRoot).filter((file) => file.endsWith('.test.js'));
  for (const file of testFiles) {
    mocha.addFile(path.join(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
