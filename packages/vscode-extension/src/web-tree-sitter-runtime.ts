/**
 * Loads the real `web-tree-sitter` package at runtime via a path esbuild
 * cannot statically resolve, rather than a bare `import`/`require`
 * specifier — `esbuild.config`'s `alias` option (`scripts/build.mjs`)
 * redirects every `from 'web-tree-sitter'` specifier in the bundle
 * (including inside `@rewrap-plus/engine`'s own compiled source, several
 * bundling steps removed from this file) here, so this is the one place
 * the real package actually loads.
 *
 * Two problems, not one, forced this rather than the simpler "mark
 * `web-tree-sitter` external" — see `scripts/build.mjs`'s top comment for
 * the first (bundling its ESM build breaks its own WASM loading via
 * `import.meta.url`, fixed by resolving its `.cjs` build instead). The
 * second only showed up while wiring up packaging (Phase 11 commit 2):
 * `external` downlevels to a plain `require('web-tree-sitter')`, which
 * needs a real `node_modules/web-tree-sitter` reachable from
 * `dist/extension.js`. Copying one to this package's own
 * `node_modules/` (the fix for the *first* problem, since the monorepo's
 * hoisted root `node_modules` isn't reachable from a packaged `.vsix`)
 * created a second, worse one: `vsce`'s own packaging file-walk
 * hardcodes `ignore: 'node_modules/**'` on this package's own directory,
 * unconditionally — no `.vscodeignore` negation can override it, so that
 * copy could never actually ship. The only alternative `vsce` offers,
 * its own dependency-resolution walk (the default when *not* passing
 * `--no-dependencies`), shells out to `npm list --production` — which in
 * an npm-workspaces monorepo reports the *workspace root* as a
 * "dependency directory" too, so `vsce` tries to glob-and-package the
 * entire repository (confirmed directly: `vsce ls` from this package
 * without `--no-dependencies` listed `../../.git/**` and every unrelated
 * doc in the repo).
 *
 * Loading `web-tree-sitter` from a directory *not* named `node_modules`
 * sidesteps both `vsce` behaviors at once: `scripts/build.mjs` copies it
 * to `dist/web-tree-sitter-runtime/`, an ordinary subdirectory `vsce`'s
 * default file-walk includes like any other, and packaging always runs
 * with `--no-dependencies` (see `package.json`'s `package` script) since
 * nothing needs its dependency walk once this file exists.
 */
import * as path from 'node:path';

// A *computed* argument, deliberately: esbuild only resolves `require()`
// calls with a literal string argument at bundle time, so this one
// passes through untouched, executing as a genuine Node `require()` at
// runtime against whatever `__dirname` actually is — `dist/`, once
// bundled, the same directory `copyWebTreeSitter()` copies
// `web-tree-sitter.cjs` into a `web-tree-sitter-runtime/` subdirectory
// of. That `.cjs` build locates its own WASM via `__dirname` too (a real
// Node global, unlike the ESM build's `import.meta.url`), so this just
// works once both files are in place.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webTreeSitter = require(path.join(__dirname, 'web-tree-sitter-runtime', 'web-tree-sitter.cjs')) as typeof import('web-tree-sitter');

export const Parser = webTreeSitter.Parser;
export const Language = webTreeSitter.Language;
export const Query = webTreeSitter.Query;
