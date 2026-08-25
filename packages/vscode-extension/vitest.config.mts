import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Files that import the real `vscode` module (the thin
    // editor-host-facing wrappers, e.g. resolve-column-limit.ts) only
    // mean anything inside a real VSCode extension host — `vscode` isn't
    // resolvable as a plain Node module. Those are exercised by the
    // @vscode/test-electron integration suite (commit 9) instead; this
    // config covers only the vscode-free pure logic.
    exclude: ['**/node_modules/**', 'test/integration/**'],
  },
});
